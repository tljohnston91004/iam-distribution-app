/**
 * Stage 4B workflow integration tests (candidate, management decision, ownership, active action, aging/escalation,
 * condition reduction, Results Return outbox, legacy preservation). Every test runs on a throw-away governed-migrated
 * database; the real data/iam.db is never opened.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import { DatabaseSync } from "node:sqlite";
import type { PrismaClient } from "@prisma/client";
import { enqueueResultsReturnEvent } from "../../src/lib/dpos/outbox";
import { legacyFingerprint, legacyTableNames } from "../../src/lib/dpos/migrate/governed-migrate";
import {
  SYSTEM_ACTOR,
  acceptOwnership,
  addSupportEntry,
  approveCandidate,
  archiveToHistory,
  assignDepartment,
  assignOwner,
  attachEvidence,
  authorizeContributor,
  clearBlocker,
  completeAction,
  computeCapacity,
  createRecurrence,
  decidePause,
  declineOwnership,
  escalateCandidate,
  evaluateAction,
  evaluateSuppressions,
  ingestGovernedEvidence,
  listDecisionRequired,
  listWhatChangedMarkers,
  presentCandidate,
  raiseBlocker,
  raiseManagementAttention,
  reactivateAction,
  readRecurrenceChain,
  readWorkflowView,
  reassign,
  rejectCandidate,
  releaseSuppression,
  requestDiscussion,
  requestPause,
  resolveDecisionRequired,
  returnForReview,
  revokeContributorAuthorization,
  riskAcceptCandidate,
  signalConditionChange,
  startAction,
  suppressCandidate,
  updateConditionReduction,
  updateProgress,
  validateCompletion,
  listCompletedHistory,
} from "../../src/lib/dpos/workflow";
import { REPO_ROOT, boundContext, createTestDb, makeConfig, type TestDb } from "./helpers";
import {
  ADMIN,
  CONTRIBUTOR,
  DAY,
  MANAGER,
  MANAGER_2,
  OWNER_USER,
  OWNER_USER_2,
  STRANGER,
  T0,
  VIEWER,
  acceptedCandidate,
  approvedCandidate,
  at,
  dateStr,
  describeGroup,
  evidence,
  eventTypes,
  expectCode,
  newCandidate,
  pendingAcceptanceCandidate,
  presentedCandidate,
  startedCandidate,
  PLAN,
  type Fixture,
} from "./workflow-helpers";

async function withFixture(fn: (f: Fixture, tdb: TestDb) => Promise<void>): Promise<void> {
  const tdb = await createTestDb();
  try {
    const ctx = await boundContext(tdb.prisma, makeConfig());
    await fn({ db: tdb.prisma, ctx }, tdb);
  } finally {
    await tdb.close();
  }
}

/** Run SQL on a raw connection: the Prisma client hides trigger messages behind a generic constraint error. */
function sqlThrows(file: string, sql: string, re: RegExp): void {
  const raw = new DatabaseSync(file);
  try {
    assert.throws(() => raw.exec(sql), re, sql);
  } finally {
    raw.close();
  }
}

const outboxCount = (db: PrismaClient) => db.dposResultsReturnOutbox.count();
const auditCount = (db: PrismaClient) => db.dposAuditEvent.count();
const payloadsOf = async (db: PrismaClient, candidateId: string, eventType?: string) =>
  (await db.dposResultsReturnOutbox.findMany({ where: { candidateId, ...(eventType ? { eventType } : {}) }, orderBy: { createdAt: "asc" } })).map((r) => JSON.parse(r.payloadJson) as Record<string, Record<string, unknown>>);

// =====================================================================================================================
describe("CANDIDATE: grouping, duplicates, closure and recurrence", () => {
  it("creates ONE candidate from several evidence items; SKU/vendor/category stay drill-down evidence", () =>
    withFixture(async (f) => {
      const r = await ingestGovernedEvidence(f.db, f.ctx, MANAGER, {
        evidence: [evidence("1"), evidence("2"), evidence("3", { sku: undefined, poRef: "PO-9", kind: "PURCHASE_ORDER" })],
        sourceRunId: "run-1",
        describe: describeGroup(),
        at: T0,
      });
      assert.equal(r.groups.length, 1);
      assert.equal(r.groups[0]!.action, "CREATED");
      assert.equal(r.groups[0]!.evidenceAttached, 3);
      assert.equal(await f.db.iamCoreCandidate.count(), 1, "one candidate, not one per SKU");
      const v = await readWorkflowView(f.db, f.ctx, r.groups[0]!.candidateId);
      assert.equal(v.workflowState?.workflowState, "NEW_CANDIDATE");
      assert.equal(v.evidence.length, 3);
      assert.deepEqual(v.evidence.map((e) => e.kind).sort(), ["PURCHASE_ORDER", "SKU", "SKU"]);
      assert.equal(v.recommendations.length, 1);
      assert.equal(v.recommendations[0]!.recommendationVersion, 1);
      assert.equal(v.lifecycleState, "CANDIDATE");
      assert.deepEqual(await eventTypes(f.db, v.candidateId), ["CANDIDATE_CREATED"]);
      const history = v.workflowHistory;
      assert.equal(history.length, 1);
      assert.equal(history[0]!.toState, "NEW_CANDIDATE");
    }));

  it("creates SEPARATE candidates when the action path, department or objective materially differs", () =>
    withFixture(async (f) => {
      const r = await ingestGovernedEvidence(f.db, f.ctx, MANAGER, {
        evidence: [evidence("1"), evidence("2"), evidence("3", { actionPath: "Expedite vendor shipments", responsibleDepartment: "Logistics" })],
        sourceRunId: "run-1",
        describe: describeGroup(),
        at: T0,
      });
      assert.equal(r.groups.length, 2);
      assert.equal(await f.db.iamCoreCandidate.count(), 2);
      const sizes = await Promise.all(r.groups.map(async (g) => (await f.db.iamCoreCandidateEvidence.count({ where: { candidateId: g.candidateId } }))));
      assert.deepEqual(sizes.sort(), [1, 2]);
    }));

  it("attaches new evidence to the SAME active condition instead of creating a duplicate, and sends no event", () =>
    withFixture(async (f) => {
      const id = await newCandidate(f);
      const before = await outboxCount(f.db);
      const r = await ingestGovernedEvidence(f.db, f.ctx, MANAGER, { evidence: [evidence("3"), evidence("4"), evidence("5")], sourceRunId: "run-2", describe: describeGroup(), at: at(1) });
      assert.equal(r.groups[0]!.action, "EVIDENCE_ATTACHED");
      assert.equal(r.groups[0]!.candidateId, id);
      assert.equal(r.groups[0]!.evidenceAttached, 2);
      assert.equal(r.groups[0]!.evidenceAlreadyPresent, 1);
      assert.equal(await f.db.iamCoreCandidate.count(), 1);
      assert.equal(await f.db.iamCoreCandidateEvidence.count({ where: { candidateId: id } }), 5);
      assert.equal(await outboxCount(f.db), before, "attaching drill-down evidence is not a meaningful transition");
      // a materially different condition at the same time is a NEW candidate
      const other = await ingestGovernedEvidence(f.db, f.ctx, MANAGER, { evidence: [evidence("9", { actionPath: "Return to vendor" })], sourceRunId: "run-2", describe: describeGroup(), at: at(1) });
      assert.equal(other.groups[0]!.action, "CREATED");
      assert.equal(await f.db.iamCoreCandidate.count(), 2);
    }));

  it("refuses evidence of another condition on a candidate (it must form its own candidate)", () =>
    withFixture(async (f) => {
      const id = await newCandidate(f);
      await expectCode(attachEvidence(f.db, f.ctx, MANAGER, id, { evidence: [evidence("7", { responsibleDepartment: "Sales" })] }), "EVIDENCE_GROUP_MISMATCH");
      const ok = await attachEvidence(f.db, f.ctx, MANAGER, id, { evidence: [evidence("7")] });
      assert.equal(ok.attached, 1);
    }));

  it("a CLOSED candidate is never reopened; the returning condition is a NEW candidate linked as a recurrence", () =>
    withFixture(async (f, tdb) => {
      const first = await presentedCandidate(f);
      await rejectCandidate(f.db, f.ctx, MANAGER, first, { reason: "Not a priority this quarter.", at: at(0, 3) });
      const closed = await f.db.iamCoreCandidate.findUniqueOrThrow({ where: { candidateId: first } });
      assert.ok(closed.closedAt, "rejection closes the candidate");

      // service level
      await expectCode(approveCandidate(f.db, f.ctx, MANAGER, first, { plan: PLAN, at: at(1) }), "CLOSED_CANDIDATE_NO_REOPEN");
      await expectCode(presentCandidate(f.db, f.ctx, MANAGER, first), "CLOSED_CANDIDATE_NO_REOPEN");
      // database level
      sqlThrows(tdb.file, `UPDATE iam_core_candidates SET closed_at = NULL WHERE candidate_id = '${first}'`, /IAM_CORE_CLOSED_CANDIDATE_NO_REOPEN/);
      sqlThrows(tdb.file, `UPDATE iam_core_workflow_states SET workflow_state = 'PRESENTED' WHERE candidate_id = '${first}'`, /IAM_CORE_CLOSED_CANDIDATE_NO_REOPEN/);
      sqlThrows(tdb.file, `INSERT INTO iam_core_workflow_history (history_id, candidate_id, dpos_company_id, to_state, operation, actor_id, actor_role, at) VALUES ('h1', '${first}', '${f.ctx.dposCompanyId}', 'PRESENTED', 'X', 'a', 'MANAGER', 0)`, /IAM_CORE_CLOSED_CANDIDATE_NO_REOPEN/);
      await assert.rejects(f.db.iamCoreCandidate.update({ where: { candidateId: first }, data: { closedAt: null } }), "the Prisma client is refused as well");

      // the same condition returns -> NEW candidate linked to the closed one
      const r = await ingestGovernedEvidence(f.db, f.ctx, MANAGER, { evidence: [evidence("1"), evidence("2")], sourceRunId: "run-2", describe: describeGroup(), at: at(7) });
      const g = r.groups[0]!;
      assert.equal(g.action, "CREATED");
      assert.notEqual(g.candidateId, first);
      assert.equal(g.recurrenceOfCandidateId, first);
      assert.deepEqual(await eventTypes(f.db, g.candidateId), ["CANDIDATE_CREATED", "RECURRENCE_LINKED"]);
      const recurrence = (await payloadsOf(f.db, g.candidateId, "RECURRENCE_LINKED"))[0]!;
      assert.equal(recurrence.recurrence!.priorCandidateId, first);
      const again = await f.db.iamCoreCandidate.findUniqueOrThrow({ where: { candidateId: first } });
      assert.deepEqual(again.closedAt, closed.closedAt, "the closed candidate is untouched");
      const chain = await readRecurrenceChain(f.db, f.ctx, closed.groupedConditionKey);
      assert.equal(chain.length, 2);
      assert.equal(chain[1]!.recurrenceOfCandidateId, first);
    }));

  it("createRecurrence only follows a closed candidate of the SAME condition and only when none is open", () =>
    withFixture(async (f) => {
      const open = await presentedCandidate(f);
      const opts = { evidence: [evidence("1")], sourceRunId: "run-2", describe: describeGroup(), at: at(5) };
      await expectCode(createRecurrence(f.db, f.ctx, MANAGER, { priorCandidateId: open, ...opts }), "RECURRENCE_TARGET_NOT_CLOSED");
      await rejectCandidate(f.db, f.ctx, MANAGER, open, { reason: "Defer.", at: at(1) });
      await expectCode(createRecurrence(f.db, f.ctx, MANAGER, { priorCandidateId: open, ...opts, evidence: [evidence("1", { actionPath: "Different path" })] }), "RECURRENCE_CONDITION_MISMATCH");
      const r = await createRecurrence(f.db, f.ctx, MANAGER, { priorCandidateId: open, ...opts, reason: "The same vendor exposure is back." });
      assert.equal(r.recurrenceOfCandidateId, open);
      await expectCode(createRecurrence(f.db, f.ctx, MANAGER, { priorCandidateId: open, ...opts, at: at(6) }), "CANDIDATE_ALREADY_OPEN");
    }));

  it("4B-D6: never calculates, accepts or synthesizes a domain score or rank (they stay null until Stage 4C)", () =>
    withFixture(async (f) => {
      // supplying them is refused and creates nothing
      for (const supplied of [{ domainScore: 50 }, { domainRank: 1 }]) {
        await expectCode(
          ingestGovernedEvidence(f.db, f.ctx, MANAGER, { evidence: [evidence("1")], sourceRunId: "r", describe: describeGroup(supplied as never), at: T0 }),
          "SCORE_AND_RANK_NOT_SUPPORTED",
        );
      }
      assert.equal(await f.db.iamCoreCandidate.count(), 0);
      assert.equal(await outboxCount(f.db), 0);
      // the normal path stores no placeholder anywhere
      const id = await newCandidate(f);
      const rec = await f.db.iamCoreSystemRecommendation.findFirstOrThrow({ where: { candidateId: id } });
      assert.equal(rec.domainScore, null);
      assert.equal(rec.domainRank, null);
      const created = await f.db.dposResultsReturnOutbox.findFirstOrThrow({ where: { candidateId: id, eventType: "CANDIDATE_CREATED" } });
      const payload = JSON.parse(created.payloadJson) as { recommendation: Record<string, unknown> };
      assert.equal("domainScore" in payload.recommendation, false);
      assert.equal("domainRank" in payload.recommendation, false);
      assert.equal(created.syncStatus, "PENDING", "CANDIDATE_CREATED is valid without a score or rank");
      // candidates of different conditions carry no ordering either
      const other = await newCandidate(f, { refs: ["x1"], over: { conditionKey: "Another condition" } });
      assert.equal((await f.db.iamCoreSystemRecommendation.findFirstOrThrow({ where: { candidateId: other } })).domainRank, null);
    }));

  it("only the IAM system or a manager creates candidates", () =>
    withFixture(async (f) => {
      for (const who of [STRANGER, VIEWER, OWNER_USER]) {
        await expectCode(ingestGovernedEvidence(f.db, f.ctx, who, { evidence: [evidence("1")], sourceRunId: "r", describe: describeGroup(), at: T0 }), "SYSTEM_OR_MANAGEMENT_REQUIRED");
      }
      const r = await ingestGovernedEvidence(f.db, f.ctx, SYSTEM_ACTOR, { evidence: [evidence("1")], sourceRunId: "r", describe: describeGroup(), at: T0 });
      assert.equal(r.groups[0]!.action, "CREATED");
    }));
});

// =====================================================================================================================
describe("MANAGEMENT: decisions, recommendation vs plan, rejection and suppression governance", () => {
  it("approval preserves the ORIGINAL recommendation, the decision (reason, actor, time) and a SEPARATE plan", () =>
    withFixture(async (f) => {
      const id = await presentedCandidate(f);
      const before = await f.db.iamCoreSystemRecommendation.findMany({ where: { candidateId: id } });
      const res = await approveCandidate(f.db, f.ctx, MANAGER, id, { reason: "Agrees with the system recommendation.", plan: PLAN, assignment: { responsibleDepartment: "Purchasing" }, targetStart: dateStr(1), targetResolution: dateStr(29), at: at(0, 2) });
      const v = await readWorkflowView(f.db, f.ctx, id);
      assert.equal(v.workflowState?.workflowState, "APPROVED_ASSIGNED");
      assert.equal(v.lifecycleState, "APPROVED");
      const d = v.managementDecisions.find((x) => x.decisionType === "APPROVE")!;
      assert.equal(d.reason, "Agrees with the system recommendation.");
      assert.equal(d.actorId, MANAGER.actorId);
      assert.equal(d.actorRole, "MANAGER");
      assert.equal(d.decidedAt.getTime(), at(0, 2).getTime());
      assert.equal(d.systemRecommendationId, before[0]!.recommendationId);
      assert.equal(d.recommendationVersion, 1);
      assert.equal(d.planId, res.planId);
      assert.equal(d.planVersion, 1);
      assert.deepEqual(v.recommendations, before, "the system recommendation row is unchanged");
      assert.equal(v.managementPlans.length, 1);
      assert.equal(v.managementPlans[0]!.approvalState, "APPROVED");
      assert.equal(v.managementPlans[0]!.approver, MANAGER.actorId);
      assert.equal(v.managementPlans[0]!.deviatesFromRecommendation, false);
      assert.equal(v.managementPlans[0]!.basedOnRecommendationId, before[0]!.recommendationId);
      assert.deepEqual(await eventTypes(f.db, id), ["CANDIDATE_CREATED", "MANAGEMENT_APPROVED", "DEPARTMENT_ASSIGNED"]);
      assert.ok(v.actionTracking, "approval opens the action-tracking record");
      assert.equal(v.actionTracking!.actionStatus, "NOT_STARTED");
    }));

  it("the system recommendation is immutable at the database level", () =>
    withFixture(async (f, tdb) => {
      const id = await newCandidate(f);
      sqlThrows(tdb.file, `UPDATE iam_core_system_recommendations SET recommended_action_direction = 'Something else' WHERE candidate_id = '${id}'`, /IAM_CORE_SYSTEM_RECOMMENDATION_IMMUTABLE/);
      await assert.rejects(f.db.iamCoreSystemRecommendation.updateMany({ where: { candidateId: id }, data: { recommendedActionDirection: "Something else" } }));
    }));

  it("a plan that deviates from the recommendation needs a reason; the deviation is recorded without touching the recommendation", () =>
    withFixture(async (f) => {
      const id = await presentedCandidate(f);
      await expectCode(approveCandidate(f.db, f.ctx, MANAGER, id, { plan: { summary: "Instead, expedite everything.", actionDirection: "Expedite all open purchase orders" }, at: at(0, 2) }), "DEVIATION_REASON_REQUIRED");
      assert.equal(await f.db.iamCoreManagementPlan.count({ where: { candidateId: id } }), 0, "nothing is persisted when the approval is refused");
      assert.equal((await readWorkflowView(f.db, f.ctx, id)).workflowState?.workflowState, "PRESENTED");
      const r = await approveCandidate(f.db, f.ctx, MANAGER, id, {
        plan: { summary: "Instead, expedite everything.", actionDirection: "Expedite all open purchase orders", deviationReason: "Customer commitments outweigh the excess exposure." },
        at: at(0, 2),
      });
      assert.equal(r.deviatesFromRecommendation, true);
      const plan = await f.db.iamCoreManagementPlan.findFirstOrThrow({ where: { candidateId: id } });
      assert.equal(plan.deviatesFromRecommendation, true);
      assert.equal(plan.deviationReason, "Customer commitments outweigh the excess exposure.");
      const rec = await f.db.iamCoreSystemRecommendation.findFirstOrThrow({ where: { candidateId: id } });
      assert.equal(rec.recommendedActionDirection, "Cancel or defer open purchase orders for the affected items.");
      const approved = (await payloadsOf(f.db, id, "MANAGEMENT_APPROVED"))[0]!;
      assert.equal(approved.plan!.deviatesFromSystemRecommendation, true);
      assert.equal(approved.plan!.deviationReason, "Customer commitments outweigh the excess exposure.");
    }));

  it("rejection REQUIRES a reason, keeps the recommendation and score untouched, and records history", () =>
    withFixture(async (f) => {
      const id = await presentedCandidate(f);
      const outbox = await outboxCount(f.db);
      await expectCode(rejectCandidate(f.db, f.ctx, MANAGER, id, { reason: "   " }), "REASON_REQUIRED");
      assert.equal(await outboxCount(f.db), outbox);
      assert.equal((await readWorkflowView(f.db, f.ctx, id)).workflowState?.workflowState, "PRESENTED");
      const r = await rejectCandidate(f.db, f.ctx, MANAGER, id, { reason: "Budget freeze.", at: at(0, 5) });
      assert.equal(r.qualifiedRejection, true);
      assert.equal(r.rejectionOrdinal, 1);
      assert.equal(r.repeatedRejectionFlagged, false);
      const v = await readWorkflowView(f.db, f.ctx, id);
      assert.equal(v.workflowState?.workflowState, "REJECTED");
      assert.equal(v.lifecycleState, "REJECTED");
      assert.ok(v.closedAt);
      assert.equal(v.recommendations[0]!.domainScore, null, "no score exists in Stage 4B, so there is nothing to penalize");
      assert.equal(v.recommendations[0]!.domainRank, null);
      assert.equal(v.workflowHistory.length, 3);
      assert.equal(v.managementDecisions.at(-1)!.reason, "Budget freeze.");
      assert.deepEqual(await eventTypes(f.db, id), ["CANDIDATE_CREATED", "MANAGEMENT_REJECTED"]);
    }));

  it("flags a REPEATED rejection after 3 qualified rejections of the same recurring condition and requires senior review; no penalty", () =>
    withFixture(async (f) => {
      const flagged: boolean[] = [];
      let last = "";
      for (let i = 0; i < 3; i++) {
        const r = await ingestGovernedEvidence(f.db, f.ctx, MANAGER, { evidence: [evidence("1"), evidence("2")], sourceRunId: `run-${i}`, describe: describeGroup(), at: at(i * 10) });
        last = r.groups[0]!.candidateId;
        await presentCandidate(f.db, f.ctx, MANAGER, last, { at: at(i * 10, 1) });
        const rej = await rejectCandidate(f.db, f.ctx, MANAGER, last, { reason: `Rejection ${i + 1}`, at: at(i * 10, 2) });
        assert.equal(rej.rejectionOrdinal, i + 1);
        flagged.push(rej.repeatedRejectionFlagged);
      }
      assert.deepEqual(flagged, [false, false, true]);
      // the 4th appearance of the condition
      const fourth = (await ingestGovernedEvidence(f.db, f.ctx, MANAGER, { evidence: [evidence("1")], sourceRunId: "run-4", describe: describeGroup(), at: at(40) })).groups[0]!.candidateId;
      const wf = await f.db.iamCoreWorkflowState.findUniqueOrThrow({ where: { candidateId: fourth } });
      assert.equal(wf.priorQualifiedRejections, 3);
      assert.equal(wf.repeatedRejectionFlag, true);
      assert.equal(wf.seniorReviewRequired, true);
      await presentCandidate(f.db, f.ctx, MANAGER, fourth, { at: at(40, 1) });
      const rec = await f.db.iamCoreSystemRecommendation.findFirstOrThrow({ where: { candidateId: fourth } });
      assert.equal(rec.domainScore, null, "repeated rejection never scores or penalizes the candidate");
      // avoiding it again needs senior review ...
      await expectCode(rejectCandidate(f.db, f.ctx, MANAGER, fourth, { reason: "No again", at: at(40, 2) }), "SENIOR_REVIEW_REQUIRED");
      await expectCode(suppressCandidate(f.db, f.ctx, MANAGER, fourth, { reason: "Defer again", at: at(40, 2) }), "SENIOR_REVIEW_REQUIRED");
      await expectCode(riskAcceptCandidate(f.db, f.ctx, MANAGER, fourth, { reason: "Accept it", at: at(40, 2) }), "SENIOR_REVIEW_REQUIRED");
      // ... but approving is always open to management, and a senior reviewer can decide
      const ok = await rejectCandidate(f.db, f.ctx, ADMIN, fourth, { reason: "Senior review: still not now.", at: at(40, 3) });
      assert.equal(ok.rejectionOrdinal, 4);
      assert.equal(ok.repeatedRejectionFlagged, true);
      const decisions = await f.db.iamCoreManagementDecision.count({ where: { decisionType: "REJECT", qualifiedRejection: true, groupedConditionKey: wf.groupedConditionKey } });
      assert.equal(decisions, 4, "full rejection history is preserved");
      const fifth = (await ingestGovernedEvidence(f.db, f.ctx, MANAGER, { evidence: [evidence("1")], sourceRunId: "run-5", describe: describeGroup(), at: at(50) })).groups[0]!.candidateId;
      await presentCandidate(f.db, f.ctx, MANAGER, fifth, { at: at(50, 1) });
      await approveCandidate(f.db, f.ctx, MANAGER, fifth, { plan: PLAN, assignment: { responsibleDepartment: "Purchasing" }, at: at(50, 2) });
      assert.ok(last);
    }));

  it("a rejection because the condition NO LONGER QUALIFIES is not a qualified rejection", () =>
    withFixture(async (f) => {
      const id = await presentedCandidate(f);
      const r = await rejectCandidate(f.db, f.ctx, MANAGER, id, { reason: "The exposure has cleared.", conditionStillQualifies: false, at: at(1) });
      assert.equal(r.qualifiedRejection, false);
      assert.equal(r.rejectionOrdinal, null);
      const wf = await f.db.iamCoreWorkflowState.findUniqueOrThrow({ where: { candidateId: id } });
      const next = (await ingestGovernedEvidence(f.db, f.ctx, MANAGER, { evidence: [evidence("1")], sourceRunId: "r2", describe: describeGroup(), at: at(8) })).groups[0]!.candidateId;
      assert.equal((await f.db.iamCoreWorkflowState.findUniqueOrThrow({ where: { candidateId: next } })).priorQualifiedRejections, 0);
      assert.ok(wf);
    }));

  it("suppression: default maximum of 4 weekly cycles, full record, candidate and history never erased", () =>
    withFixture(async (f) => {
      const id = await presentedCandidate(f);
      await expectCode(suppressCandidate(f.db, f.ctx, MANAGER, id, { reason: "Long deferral", cycles: 5, at: at(1) }), "SUPPRESSION_EXCEEDS_MAXIMUM");
      await expectCode(suppressCandidate(f.db, f.ctx, MANAGER, id, { reason: "x", cycles: 0, at: at(1) }), "SUPPRESSION_CYCLES_INVALID");
      await expectCode(suppressCandidate(f.db, f.ctx, MANAGER, id, { reason: "", at: at(1) }), "REASON_REQUIRED");
      const r = await suppressCandidate(f.db, f.ctx, MANAGER, id, { reason: "Waiting on the vendor's revised schedule.", at: at(1) });
      assert.equal(r.cycles, 4);
      assert.equal(r.reviewDueAt.getTime(), at(1).getTime() + 28 * DAY);
      const v = await readWorkflowView(f.db, f.ctx, id);
      assert.equal(v.workflowState?.workflowState, "SUPPRESSED");
      assert.equal(v.closedAt, null, "a suppressed candidate is not closed or erased");
      assert.equal(v.recommendations.length, 1);
      assert.equal(v.suppressions.length, 1);
      const s = v.suppressions[0]!;
      assert.equal(s.status, "ACTIVE");
      assert.equal(s.reason, "Waiting on the vendor's revised schedule.");
      assert.equal(s.actorId, MANAGER.actorId);
      assert.equal(s.startedAt.getTime(), at(1).getTime());
      assert.equal(s.maxCycles, 4);
      const ev = (await payloadsOf(f.db, id, "SUPPRESSED"))[0]!;
      assert.equal(ev.management!.suppressedUntil, new Date(at(1).getTime() + 28 * DAY).toISOString().slice(0, 10));
      await expectCode(suppressCandidate(f.db, f.ctx, MANAGER, id, { reason: "again", at: at(2) }), "INVALID_WORKFLOW_STATE");
    }));

  it("suppression expiry forces a management re-review without erasing anything", () =>
    withFixture(async (f) => {
      const id = await presentedCandidate(f);
      await suppressCandidate(f.db, f.ctx, MANAGER, id, { reason: "Defer", cycles: 2, at: at(0, 2) });
      const early = await evaluateSuppressions(f.db, f.ctx, { now: at(13) });
      assert.deepEqual(early.expired, []);
      const due = await evaluateSuppressions(f.db, f.ctx, { now: at(14, 3) });
      assert.deepEqual(due.expired, [id]);
      const v = await readWorkflowView(f.db, f.ctx, id);
      assert.equal(v.workflowState?.workflowState, "PRESENTED");
      assert.equal(v.workflowState?.reReviewRequired, true);
      assert.equal(v.workflowState?.reReviewReason, "EXPIRED");
      assert.equal(v.suppressions[0]!.status, "EXPIRED");
      assert.equal(v.suppressions[0]!.endTrigger, "EXPIRED");
      assert.equal(v.recommendations.length, 1);
      assert.ok(v.workflowHistory.some((h) => h.toState === "SUPPRESSED") && v.workflowHistory.some((h) => h.operation === "SUPPRESSION_ENDED"));
      assert.deepEqual(await eventTypes(f.db, id), ["CANDIDATE_CREATED", "SUPPRESSED", "SUPPRESSION_RELEASED"]);
      assert.deepEqual((await evaluateSuppressions(f.db, f.ctx, { now: at(40) })).expired, [], "an expired suppression is not processed twice");
      // the candidate can be suppressed again by a new management decision
      await suppressCandidate(f.db, f.ctx, MANAGER, id, { reason: "Defer once more", cycles: 1, at: at(15) });
      assert.equal((await f.db.iamCoreSuppression.count({ where: { candidateId: id } })), 2);
    }));

  it("suppression ends early and forces re-review when the condition becomes Critical, materially worsens, re-enters, or management releases it", () =>
    withFixture(async (f) => {
      const make = async (key: string) => {
        const id = await newCandidate(f, { refs: [key], over: { conditionKey: `Condition ${key}` } });
        await presentCandidate(f.db, f.ctx, MANAGER, id, { at: at(0, 1) });
        await suppressCandidate(f.db, f.ctx, MANAGER, id, { reason: "Defer", at: at(0, 2) });
        return id;
      };
      const a = await make("a");
      const aRes = await signalConditionChange(f.db, f.ctx, SYSTEM_ACTOR, a, { becameCritical: true, at: at(3) });
      assert.equal(aRes.trigger, "BECAME_CRITICAL");
      assert.equal((await f.db.iamCoreWorkflowState.findUniqueOrThrow({ where: { candidateId: a } })).reReviewReason, "BECAME_CRITICAL");

      const b = await make("b");
      await signalConditionChange(f.db, f.ctx, SYSTEM_ACTOR, b, { materiallyWorsened: true, at: at(3) });
      assert.equal((await f.db.iamCoreSuppression.findFirstOrThrow({ where: { candidateId: b } })).endTrigger, "MATERIALLY_WORSENED");

      const c = await make("c");
      const ing = await ingestGovernedEvidence(f.db, f.ctx, MANAGER, {
        evidence: [evidence("c", { conditionKey: "Condition c" })],
        sourceRunId: "r9",
        describe: describeGroup(),
        signals: Object.fromEntries([[(await f.db.iamCoreCandidate.findUniqueOrThrow({ where: { candidateId: c } })).groupedConditionKey, { reEntered: true }]]),
        at: at(3),
      });
      assert.equal(ing.groups[0]!.suppressionEnded, "RE_ENTERED");
      assert.equal((await f.db.iamCoreWorkflowState.findUniqueOrThrow({ where: { candidateId: c } })).workflowState, "PRESENTED");

      const d = await make("d");
      await expectCode(releaseSuppression(f.db, f.ctx, OWNER_USER, d, { reason: "x" }), "MANAGEMENT_AUTHORIZATION_REQUIRED");
      await releaseSuppression(f.db, f.ctx, MANAGER_2, d, { reason: "Vendor confirmed; reconsider now.", at: at(3) });
      const sd = await f.db.iamCoreSuppression.findFirstOrThrow({ where: { candidateId: d } });
      assert.equal(sd.endTrigger, "MANAGEMENT_RELEASE");
      assert.equal(sd.status, "RELEASED");
      assert.equal(sd.endedBy, MANAGER_2.actorId);
      await expectCode(releaseSuppression(f.db, f.ctx, MANAGER, d, { reason: "again" }), "INVALID_WORKFLOW_STATE");
    }));

  it("escalation moves the decision to senior management; return-for-review reopens discussion; risk acceptance closes without counting as a rejection", () =>
    withFixture(async (f) => {
      const e = await presentedCandidate(f, { refs: ["e"], over: { conditionKey: "Esc" } });
      await expectCode(escalateCandidate(f.db, f.ctx, MANAGER, e, { escalatedTo: "", reason: "x" }), "REASON_REQUIRED");
      await escalateCandidate(f.db, f.ctx, MANAGER, e, { escalatedTo: "VP Operations", reason: "Exceeds my authority.", at: at(1) });
      assert.equal((await f.db.iamCoreWorkflowState.findUniqueOrThrow({ where: { candidateId: e } })).workflowState, "ESCALATED");
      await expectCode(approveCandidate(f.db, f.ctx, MANAGER, e, { plan: PLAN, at: at(2) }), "SENIOR_REVIEW_REQUIRED");
      await approveCandidate(f.db, f.ctx, ADMIN, e, { plan: PLAN, at: at(2) });
      const escalated = (await payloadsOf(f.db, e, "ESCALATED"))[0]!;
      assert.equal(escalated.management!.escalatedTo, "VP Operations");

      const r = await presentedCandidate(f, { refs: ["r"], over: { conditionKey: "Return" } });
      await expectCode(returnForReview(f.db, f.ctx, MANAGER, r, { reason: "" }), "REASON_REQUIRED");
      const before = await outboxCount(f.db);
      await returnForReview(f.db, f.ctx, MANAGER, r, { reason: "Need the vendor's position first.", at: at(1) });
      assert.equal(await outboxCount(f.db), before, "a local review step is not sent to the Data Hub");
      const w = await f.db.iamCoreWorkflowState.findUniqueOrThrow({ where: { candidateId: r } });
      assert.equal(w.workflowState, "NEW_CANDIDATE");
      assert.equal(w.reReviewRequired, true);
      await presentCandidate(f.db, f.ctx, MANAGER, r, { at: at(2) });
      assert.equal((await f.db.iamCoreWorkflowState.findUniqueOrThrow({ where: { candidateId: r } })).presentationCount, 2);

      const k = await presentedCandidate(f, { refs: ["k"], over: { conditionKey: "Risk" } });
      await riskAcceptCandidate(f.db, f.ctx, MANAGER, k, { reason: "Accepted: exposure is within tolerance.", at: at(1) });
      const kv = await readWorkflowView(f.db, f.ctx, k);
      assert.equal(kv.workflowState?.workflowState, "RISK_ACCEPTED");
      assert.ok(kv.closedAt);
      assert.equal(await f.db.iamCoreManagementDecision.count({ where: { candidateId: k, qualifiedRejection: true } }), 0);
      assert.deepEqual(await eventTypes(f.db, k), ["CANDIDATE_CREATED", "RISK_ACCEPTED"]);
    }));

  it("decisions need management authorization and the right workflow state", () =>
    withFixture(async (f) => {
      const fresh = await newCandidate(f);
      await expectCode(approveCandidate(f.db, f.ctx, MANAGER, fresh, { plan: PLAN }), "INVALID_WORKFLOW_STATE");
      await presentCandidate(f.db, f.ctx, SYSTEM_ACTOR, fresh);
      for (const who of [OWNER_USER, STRANGER, VIEWER, CONTRIBUTOR]) {
        await expectCode(approveCandidate(f.db, f.ctx, who, fresh, { plan: PLAN }), "MANAGEMENT_AUTHORIZATION_REQUIRED");
        await expectCode(rejectCandidate(f.db, f.ctx, who, fresh, { reason: "no" }), "MANAGEMENT_AUTHORIZATION_REQUIRED");
        await expectCode(suppressCandidate(f.db, f.ctx, who, fresh, { reason: "no" }), "MANAGEMENT_AUTHORIZATION_REQUIRED");
      }
      await expectCode(approveCandidate(f.db, f.ctx, { actorId: "iam-svc-9", role: "MANAGER" }, fresh, { plan: PLAN }), "SERVICE_IDENTITY_NOT_A_USER");
      await expectCode(approveCandidate(f.db, f.ctx, MANAGER, "00000000-0000-0000-0000-000000000000", { plan: PLAN }), "CANDIDATE_NOT_FOUND");
    }));
});

// =====================================================================================================================
describe("ASSIGNMENT: department, owner, acceptance, Request Discussion, contributors, reassignment", () => {
  it("assigns department then task owner (with timestamps), requires acceptance, and the owner accepts", () =>
    withFixture(async (f) => {
      const id = await presentedCandidate(f);
      await approveCandidate(f.db, f.ctx, MANAGER, id, { plan: PLAN, targetStart: dateStr(1), targetResolution: dateStr(29), at: at(0, 2) });
      assert.equal((await readWorkflowView(f.db, f.ctx, id)).currentOwnership, null);
      await expectCode(assignOwner(f.db, f.ctx, MANAGER, id, { taskOwnerId: OWNER_USER.actorId, at: at(0, 3) }), "DEPARTMENT_REQUIRED");
      await assignDepartment(f.db, f.ctx, MANAGER, id, { responsibleDepartment: "Purchasing", at: at(0, 3) });
      await expectCode(assignDepartment(f.db, f.ctx, MANAGER, id, { responsibleDepartment: "Sales" }), "USE_REASSIGN");
      await expectCode(assignOwner(f.db, f.ctx, OWNER_USER, id, { taskOwnerId: OWNER_USER.actorId }), "MANAGEMENT_AUTHORIZATION_REQUIRED");
      assert.equal((await f.db.iamCoreWorkflowState.findUniqueOrThrow({ where: { candidateId: id } })).workflowState, "APPROVED_ASSIGNED");
      await assignOwner(f.db, f.ctx, MANAGER, id, { taskOwnerId: OWNER_USER.actorId, taskOwnerName: "Olivia Owner", contributors: [{ userId: CONTRIBUTOR.actorId }], at: at(0, 4) });
      assert.equal((await f.db.iamCoreWorkflowState.findUniqueOrThrow({ where: { candidateId: id } })).workflowState, "PENDING_OWNER_ACCEPTANCE");
      await expectCode(acceptOwnership(f.db, f.ctx, STRANGER, id), "OWNER_OR_MANAGER_REQUIRED");
      await expectCode(acceptOwnership(f.db, f.ctx, CONTRIBUTOR, id), "OWNER_OR_MANAGER_REQUIRED");
      const acc = await acceptOwnership(f.db, f.ctx, OWNER_USER, id, { at: at(0, 5) });
      assert.equal(acc.onBehalf, false);
      const v = await readWorkflowView(f.db, f.ctx, id);
      assert.equal(v.workflowState?.workflowState, "ACTIVE_ACTION");
      assert.equal(v.lifecycleState, "ACTIVE");
      assert.deepEqual(v.assignmentEvents.map((e) => e.kind), ["DEPARTMENT_ASSIGNED", "OWNER_ASSIGNED", "OWNER_ACCEPTED"]);
      assert.deepEqual(v.assignmentEvents.map((e) => e.at.getTime()), [at(0, 3).getTime(), at(0, 4).getTime(), at(0, 5).getTime()]);
      assert.equal(v.currentOwnership!.responsibleDepartment, "Purchasing");
      assert.equal(v.currentOwnership!.taskOwnerId, OWNER_USER.actorId);
      assert.deepEqual(v.currentOwnership!.contributors.map((c) => c.userId), [CONTRIBUTOR.actorId]);
      assert.deepEqual(await eventTypes(f.db, id), ["CANDIDATE_CREATED", "MANAGEMENT_APPROVED", "DEPARTMENT_ASSIGNED", "TASK_OWNER_ASSIGNED", "OWNER_ACCEPTED"]);
      assert.equal(JSON.stringify(v).toLowerCase().includes("sponsor"), false, "no DPOS Enterprise Sponsor concept");
    }));

  it("a manager may accept on the owner's behalf, and it is recorded as such", () =>
    withFixture(async (f) => {
      const id = await pendingAcceptanceCandidate(f);
      const r = await acceptOwnership(f.db, f.ctx, MANAGER, id, { note: "Owner is on leave.", at: at(1) });
      assert.equal(r.onBehalf, true);
      const row = await f.db.iamCoreAssignmentEvent.findFirstOrThrow({ where: { candidateId: id, kind: "OWNER_ACCEPTED" } });
      assert.equal(row.onBehalf, true);
      assert.equal(row.actorId, MANAGER.actorId);
    }));

  it("Request Discussion keeps the assignment and the plan, records the comment and raises a management decision requirement; the owner cannot simply decline", () =>
    withFixture(async (f) => {
      const id = await pendingAcceptanceCandidate(f);
      const planBefore = await f.db.iamCoreManagementPlan.findMany({ where: { candidateId: id } });
      await expectCode(requestDiscussion(f.db, f.ctx, OWNER_USER, id, { note: " " }), "REASON_REQUIRED");
      await expectCode(requestDiscussion(f.db, f.ctx, STRANGER, id, { note: "I object" }), "OWNER_OR_MANAGER_REQUIRED");
      const r = await requestDiscussion(f.db, f.ctx, OWNER_USER, id, { note: "The target date conflicts with the receiving freeze.", at: at(1) });
      assert.equal(r.assignmentKept, true);
      assert.equal(r.decisionRequiredRaised, true);
      const v = await readWorkflowView(f.db, f.ctx, id);
      assert.equal(v.workflowState?.workflowState, "PENDING_OWNER_ACCEPTANCE", "still pending: not accepted, not declined");
      assert.equal(v.currentOwnership!.taskOwnerId, OWNER_USER.actorId, "the assignment is kept");
      assert.deepEqual(await f.db.iamCoreManagementPlan.findMany({ where: { candidateId: id } }), planBefore, "the plan is kept");
      assert.equal(v.assignmentEvents.at(-1)!.note, "The target date conflicts with the receiving freeze.");
      const open = await listDecisionRequired(f.db, f.ctx);
      assert.deepEqual(open.map((x) => x.reasonCode), ["OWNER_DISCUSSION"]);
      assert.deepEqual((await eventTypes(f.db, id)).slice(-2), ["OWNER_DISCUSSION_REQUESTED", "MANAGEMENT_DECISION_REQUIRED"]);
      await expectCode(declineOwnership(f.db, f.ctx, OWNER_USER, id), "OWNER_DECLINE_NOT_PERMITTED");
      // management resolves it by deciding; accepting afterwards works
      await acceptOwnership(f.db, f.ctx, OWNER_USER, id, { at: at(2) });
      assert.equal((await listDecisionRequired(f.db, f.ctx)).length, 0, "accepting resolves the discussion requirement");
      assert.equal((await listDecisionRequired(f.db, f.ctx, { status: "RESOLVED" })).length, 1);
    }));

  it("contributors add notes, supporting work and evidence only - never official values - unless management explicitly authorizes them", () =>
    withFixture(async (f) => {
      const id = await startedCandidate(f, { contributors: [CONTRIBUTOR.actorId], baselineExposure: 1000 });
      const note = await addSupportEntry(f.db, f.ctx, CONTRIBUTOR, id, { kind: "SUPPORTING_WORK", note: "Pulled the PO list.", at: at(2) });
      const row = await f.db.iamCoreProgressUpdate.findUniqueOrThrow({ where: { updateId: note.updateId } });
      assert.equal(row.official, false);
      assert.equal(row.actorId, CONTRIBUTOR.actorId);
      await expectCode(addSupportEntry(f.db, f.ctx, STRANGER, id, { note: "drive-by" }), "CONTRIBUTOR_OR_ABOVE_REQUIRED");
      await expectCode(addSupportEntry(f.db, f.ctx, VIEWER, id, { note: "view only" }), "CONTRIBUTOR_OR_ABOVE_REQUIRED");
      for (const op of [
        () => updateProgress(f.db, f.ctx, CONTRIBUTOR, id, { actionCompletionPct: 80, at: at(3) }),
        () => updateConditionReduction(f.db, f.ctx, CONTRIBUTOR, id, { currentExposure: 10, at: at(3) }),
        () => completeAction(f.db, f.ctx, CONTRIBUTOR, id, { at: at(3) }),
        () => requestPause(f.db, f.ctx, CONTRIBUTOR, id, { reason: "x", at: at(3) }),
        () => reassign(f.db, f.ctx, CONTRIBUTOR, id, { reason: "x", toDepartment: "Sales" }),
      ]) {
        await assert.rejects(op(), (e: { code?: string }) => ["CONTRIBUTOR_NOT_AUTHORIZED", "OWNER_OR_MANAGER_REQUIRED", "MANAGEMENT_AUTHORIZATION_REQUIRED"].includes(String(e.code)));
      }
      assert.equal((await f.db.iamCoreActionTracking.findUniqueOrThrow({ where: { candidateId: id } })).actionCompletionPct, 0, "official progress is unchanged");
      await expectCode(authorizeContributor(f.db, f.ctx, OWNER_USER, id, { userId: CONTRIBUTOR.actorId, reason: "x" }), "MANAGEMENT_AUTHORIZATION_REQUIRED");
      await expectCode(authorizeContributor(f.db, f.ctx, MANAGER, id, { userId: STRANGER.actorId, reason: "x" }), "CONTRIBUTOR_NOT_LISTED");
      await authorizeContributor(f.db, f.ctx, MANAGER, id, { userId: CONTRIBUTOR.actorId, reason: "Owner is travelling; contributor reports for the owner.", at: at(3) });
      await updateProgress(f.db, f.ctx, CONTRIBUTOR, id, { actionCompletionPct: 30, at: at(4) });
      const official = await f.db.iamCoreProgressUpdate.findFirstOrThrow({ where: { candidateId: id, kind: "OFFICIAL_PROGRESS" } });
      assert.match(official.newValueJson!, /"viaAuthorization":true/);
      await revokeContributorAuthorization(f.db, f.ctx, MANAGER, id, { userId: CONTRIBUTOR.actorId, reason: "Owner is back." });
      await expectCode(updateProgress(f.db, f.ctx, CONTRIBUTOR, id, { actionCompletionPct: 40, at: at(5) }), "CONTRIBUTOR_NOT_AUTHORIZED");
    }));

  it("reassignment keeps the full ownership history, requires a reason, and preserves progress", () =>
    withFixture(async (f) => {
      const id = await startedCandidate(f, { contributors: [CONTRIBUTOR.actorId] });
      await updateProgress(f.db, f.ctx, OWNER_USER, id, { actionCompletionPct: 30, at: at(5) });
      await expectCode(reassign(f.db, f.ctx, MANAGER, id, { reason: " ", toDepartment: "Sales" }), "REASON_REQUIRED");
      await expectCode(reassign(f.db, f.ctx, OWNER_USER, id, { reason: "swap", toDepartment: "Sales" }), "MANAGEMENT_AUTHORIZATION_REQUIRED");
      await expectCode(reassign(f.db, f.ctx, MANAGER, id, { reason: "swap" }), "NOTHING_TO_ASSIGN");
      await reassign(f.db, f.ctx, MANAGER, id, { reason: "Vendor relationship moved to Sales.", toDepartment: "Sales", toOwnerId: OWNER_USER_2.actorId, toOwnerName: "Omar Owner", at: at(6) });
      const v = await readWorkflowView(f.db, f.ctx, id);
      assert.equal(v.ownerships.length, 2);
      assert.ok(v.ownerships[0]!.endedAt, "the old ownership row is ended, not rewritten");
      assert.equal(v.ownerships[0]!.taskOwnerId, OWNER_USER.actorId);
      assert.equal(v.currentOwnership!.taskOwnerId, OWNER_USER_2.actorId);
      assert.equal(v.currentOwnership!.responsibleDepartment, "Sales");
      assert.deepEqual(v.currentOwnership!.contributors.map((c) => c.userId), [CONTRIBUTOR.actorId], "contributors carry over");
      const row = v.assignmentEvents.find((e) => e.kind === "REASSIGNED")!;
      assert.equal(row.fromDepartment, "Purchasing");
      assert.equal(row.toDepartment, "Sales");
      assert.equal(row.fromOwnerId, OWNER_USER.actorId);
      assert.equal(row.toOwnerId, OWNER_USER_2.actorId);
      assert.equal(row.reason, "Vendor relationship moved to Sales.");
      assert.equal(row.actorId, MANAGER.actorId);
      assert.equal(row.at.getTime(), at(6).getTime());
      assert.equal(v.actionTracking!.actionCompletionPct, 30, "progress is preserved");
      assert.equal(v.workflowState?.workflowState, "ACTIVE_ACTION");
      const events = await payloadsOf(f.db, id);
      const dep = events.find((p) => p.envelope!.eventType === "DEPARTMENT_ASSIGNED" && p.assignment!.previousResponsibleDepartment)!;
      assert.equal(dep.assignment!.responsibleDepartment, "Sales");
      assert.equal(dep.assignment!.previousResponsibleDepartment, "Purchasing");
      const own = events.filter((p) => p.envelope!.eventType === "TASK_OWNER_ASSIGNED").at(-1)!;
      assert.equal(own.assignment!.taskOwner, "Omar Owner");
      assert.equal(own.assignment!.previousTaskOwner, "Olivia Owner");
      // the previous owner no longer controls the action
      await expectCode(updateProgress(f.db, f.ctx, OWNER_USER, id, { actionCompletionPct: 40, at: at(7) }), "OWNER_OR_MANAGER_REQUIRED");
      await updateProgress(f.db, f.ctx, OWNER_USER_2, id, { actionCompletionPct: 40, at: at(7) });
    }));

  it("a plan change on reassignment creates a NEW plan version; the old version is superseded and the recommendation is untouched", () =>
    withFixture(async (f) => {
      const id = await startedCandidate(f);
      const recBefore = await f.db.iamCoreSystemRecommendation.findMany({ where: { candidateId: id } });
      await reassign(f.db, f.ctx, MANAGER, id, {
        reason: "Scope narrowed after the vendor call.",
        planChange: { summary: "Only cancel the two oldest POs.", actionDirection: "Cancel two open purchase orders", deviationReason: "Vendor will not cancel more." },
        at: at(4),
      });
      const v = await readWorkflowView(f.db, f.ctx, id);
      assert.deepEqual(v.managementPlans.map((p) => [p.planVersion, p.approvalState]), [[1, "SUPERSEDED"], [2, "APPROVED"]]);
      assert.equal(v.managementPlans[1]!.deviatesFromRecommendation, true);
      assert.deepEqual(v.recommendations, recBefore);
      const row = v.assignmentEvents.find((e) => e.kind === "REASSIGNED")!;
      assert.equal(row.planVersionBefore, 1);
      assert.equal(row.planVersionAfter, 2);
      assert.equal(v.managementDecisions.at(-1)!.decisionType, "PLAN_REVISED");
      assert.equal(v.managementDecisions.at(-1)!.planVersion, 2);
    }));

  it("reassigning the owner resolves an unresolved owner discussion", () =>
    withFixture(async (f) => {
      const id = await pendingAcceptanceCandidate(f);
      await requestDiscussion(f.db, f.ctx, OWNER_USER, id, { note: "I cannot take this on.", at: at(1) });
      assert.equal((await listDecisionRequired(f.db, f.ctx)).length, 1);
      await reassign(f.db, f.ctx, MANAGER, id, { reason: "Reassigned after discussion.", toOwnerId: OWNER_USER_2.actorId, at: at(2) });
      assert.equal((await listDecisionRequired(f.db, f.ctx)).length, 0);
      assert.equal((await f.db.iamCoreWorkflowState.findUniqueOrThrow({ where: { candidateId: id } })).workflowState, "PENDING_OWNER_ACCEPTANCE");
    }));
});

// =====================================================================================================================
describe("ACTIVE ACTION: start rules, completion vs condition reduction, progress history, valid transitions", () => {
  it("an action starts only after management approval and owner acceptance", () =>
    withFixture(async (f) => {
      const approved = await approvedCandidate(f, { key: "a" });
      await expectCode(startAction(f.db, f.ctx, MANAGER, approved), "INVALID_WORKFLOW_STATE");
      const pending = await pendingAcceptanceCandidate(f, { key: "p" });
      await expectCode(startAction(f.db, f.ctx, OWNER_USER, pending), "INVALID_WORKFLOW_STATE");
      await expectCode(updateProgress(f.db, f.ctx, OWNER_USER, pending, { actionCompletionPct: 10 }), "INVALID_WORKFLOW_STATE");
      const accepted = await acceptedCandidate(f, { key: "c" });
      await expectCode(updateProgress(f.db, f.ctx, OWNER_USER, accepted, { actionCompletionPct: 10 }), "ACTION_NOT_STARTED");
      await expectCode(startAction(f.db, f.ctx, STRANGER, accepted), "OWNER_OR_MANAGER_REQUIRED");
      const s = await startAction(f.db, f.ctx, OWNER_USER, accepted, { at: at(1) });
      assert.equal(s.status, "ON_TRACK");
      const t = await f.db.iamCoreActionTracking.findUniqueOrThrow({ where: { candidateId: accepted } });
      assert.equal(t.startedAt!.getTime(), at(1).getTime());
      assert.equal(t.actionCompletionPct, 0);
      assert.ok((await eventTypes(f.db, accepted)).includes("ACTION_STARTED"));
      const started = (await payloadsOf(f.db, accepted, "ACTION_STARTED"))[0]!;
      assert.equal(started.progress!.actionStatus, "ON_TRACK");
      assert.equal(started.progress!.startedAt, at(1).toISOString());
      await expectCode(startAction(f.db, f.ctx, OWNER_USER, accepted), "ACTION_ALREADY_STARTED");
    }));

  it("stores action completion and condition reduction SEPARATELY and never combines them", () =>
    withFixture(async (f) => {
      const id = await startedCandidate(f, { baselineExposure: 1000 });
      let t = await f.db.iamCoreActionTracking.findUniqueOrThrow({ where: { candidateId: id } });
      assert.equal(t.conditionReductionStatus, "NOT_YET_MEASURED", "a baseline alone does not measure a reduction");
      assert.equal(t.conditionReductionPct, null);
      await updateProgress(f.db, f.ctx, OWNER_USER, id, { actionCompletionPct: 40, at: at(5) });
      t = await f.db.iamCoreActionTracking.findUniqueOrThrow({ where: { candidateId: id } });
      assert.equal(t.actionCompletionPct, 40);
      assert.equal(t.conditionReductionPct, null, "action progress never produces a condition reduction");
      await updateConditionReduction(f.db, f.ctx, OWNER_USER, id, { currentExposure: 700, at: at(6) });
      t = await f.db.iamCoreActionTracking.findUniqueOrThrow({ where: { candidateId: id } });
      assert.equal(t.conditionReductionPct, 30);
      assert.equal(t.conditionReductionStatus, "MEASURED");
      assert.equal(t.actionCompletionPct, 40, "condition reduction never changes action completion");
      await updateProgress(f.db, f.ctx, OWNER_USER, id, { actionCompletionPct: 60, at: at(7) });
      t = await f.db.iamCoreActionTracking.findUniqueOrThrow({ where: { candidateId: id } });
      assert.equal(t.conditionReductionPct, 30);
      assert.equal(t.actionCompletionPct, 60);
      const exec = await f.db.iamCoreExecutionState.findUniqueOrThrow({ where: { candidateId: id } });
      assert.equal(exec.actionCompletionPct, 60);
      assert.equal(exec.conditionReductionPct, 30);
      assert.equal(exec.remainingExposure, 700);
      assert.equal(exec.remainingExposureUnit, "USD");
      assert.equal(exec.actionStatus, "ON_TRACK");
    }));

  it("keeps a progress history with who, what, when, prior and new value", () =>
    withFixture(async (f, tdb) => {
      const id = await startedCandidate(f);
      await updateProgress(f.db, f.ctx, OWNER_USER, id, { actionCompletionPct: 20, note: "PO list reviewed", at: at(3) });
      await updateProgress(f.db, f.ctx, MANAGER, id, { actionCompletionPct: 35, at: at(4) });
      await updateProgress(f.db, f.ctx, OWNER_USER, id, { nextMilestone: "Vendor confirmation", nextMilestoneDue: dateStr(10), at: at(5) });
      const rows = await f.db.iamCoreProgressUpdate.findMany({ where: { candidateId: id, kind: { in: ["OFFICIAL_PROGRESS", "MILESTONE"] } }, orderBy: { at: "asc" } });
      assert.deepEqual(rows.map((r) => [r.kind, r.actorId, r.at.getTime()]), [["OFFICIAL_PROGRESS", OWNER_USER.actorId, at(3).getTime()], ["OFFICIAL_PROGRESS", MANAGER.actorId, at(4).getTime()], ["MILESTONE", OWNER_USER.actorId, at(5).getTime()]]);
      assert.deepEqual(JSON.parse(rows[0]!.priorValueJson!), { actionCompletionPct: 0 });
      assert.equal(JSON.parse(rows[0]!.newValueJson!).actionCompletionPct, 20);
      assert.equal(JSON.parse(rows[1]!.priorValueJson!).actionCompletionPct, 20);
      assert.equal(JSON.parse(rows[1]!.newValueJson!).onBehalf, true);
      assert.equal(rows[0]!.note, "PO list reviewed");
      const t = await f.db.iamCoreActionTracking.findUniqueOrThrow({ where: { candidateId: id } });
      assert.equal(t.nextMilestone, "Vendor confirmation");
      assert.equal(t.latestOwnerUpdateBy, OWNER_USER.actorId);
      assert.equal(t.latestOwnerUpdateAt!.getTime(), at(5).getTime());
      sqlThrows(tdb.file, `UPDATE iam_core_progress_updates SET note = 'edited' WHERE update_id = '${rows[0]!.updateId}'`, /IAM_CORE_LEDGER_APPEND_ONLY/);
    }));

  it("sends PROGRESS_UPDATED only for material changes (meaningless small changes are recorded, not sent)", () =>
    withFixture(async (f) => {
      const id = await startedCandidate(f);
      const count = async () => (await eventTypes(f.db, id)).filter((e) => e === "PROGRESS_UPDATED").length;
      await updateProgress(f.db, f.ctx, OWNER_USER, id, { actionCompletionPct: 3, at: at(2) });
      assert.equal(await count(), 0);
      await updateProgress(f.db, f.ctx, OWNER_USER, id, { actionCompletionPct: 4, note: "just a note", at: at(2, 2) });
      assert.equal(await count(), 0);
      await updateProgress(f.db, f.ctx, OWNER_USER, id, { actionCompletionPct: 10, at: at(3) });
      assert.equal(await count(), 1);
      await updateProgress(f.db, f.ctx, OWNER_USER, id, { note: "Only a note", at: at(3, 2) });
      assert.equal(await count(), 1);
      assert.equal((await f.db.iamCoreProgressUpdate.count({ where: { candidateId: id, kind: "OFFICIAL_PROGRESS" } })), 3);
      await expectCode(updateProgress(f.db, f.ctx, OWNER_USER, id, { actionCompletionPct: 101 }), "OUT_OF_RANGE");
      await expectCode(updateProgress(f.db, f.ctx, OWNER_USER, id, { actionCompletionPct: -1 }), "OUT_OF_RANGE");
    }));

  it("enforces valid operations by action state (no skipping, no operating on a completed action)", () =>
    withFixture(async (f) => {
      const id = await startedCandidate(f);
      await expectCode(reactivateAction(f.db, f.ctx, OWNER_USER, id), "NOT_PAUSED");
      await expectCode(clearBlocker(f.db, f.ctx, OWNER_USER, id), "NO_OPEN_BLOCKER");
      await expectCode(validateCompletion(f.db, f.ctx, MANAGER, id, { finalResolutionStatus: "FULLY_RESOLVED" }), "ACTION_NOT_COMPLETED");
      await expectCode(archiveToHistory(f.db, f.ctx, MANAGER, id), "INVALID_WORKFLOW_STATE");
      await expectCode(decidePause(f.db, f.ctx, MANAGER, id, { decision: "APPROVE", reason: "x" }), "PAUSE_REQUEST_NOT_FOUND");
      const unstarted = await acceptedCandidate(f, { key: "u" });
      await expectCode(completeAction(f.db, f.ctx, OWNER_USER, unstarted), "ACTION_NOT_STARTED");
      await completeAction(f.db, f.ctx, OWNER_USER, id, { at: at(10) });
      for (const op of [
        () => updateProgress(f.db, f.ctx, OWNER_USER, id, { actionCompletionPct: 50 }),
        () => updateConditionReduction(f.db, f.ctx, OWNER_USER, id, { currentExposure: 1 }),
        () => completeAction(f.db, f.ctx, OWNER_USER, id),
        () => requestPause(f.db, f.ctx, OWNER_USER, id, { reason: "x" }),
        () => raiseBlocker(f.db, f.ctx, OWNER_USER, id, { reason: "x" }),
      ]) {
        await expectCode(op(), "ACTION_ALREADY_COMPLETED");
      }
    }));

  it("completion -> management validation -> Completed History (closed, never reopened), with the contract events", () =>
    withFixture(async (f) => {
      const id = await startedCandidate(f, { baselineExposure: 1000 });
      await updateConditionReduction(f.db, f.ctx, OWNER_USER, id, { currentExposure: 100, at: at(8) });
      const c = await completeAction(f.db, f.ctx, OWNER_USER, id, { note: "All POs actioned.", at: at(10) });
      assert.equal(c.conditionReductionPct, 90);
      let v = await readWorkflowView(f.db, f.ctx, id);
      assert.equal(v.actionTracking!.actionStatus, "COMPLETED");
      assert.equal(v.actionTracking!.actionCompletionPct, 100);
      assert.equal(v.workflowState?.workflowState, "ACTIVE_ACTION", "not Completed and Validated until management validates");
      assert.equal(v.lifecycleState, "COMPLETED");
      assert.deepEqual((await listDecisionRequired(f.db, f.ctx)).map((x) => x.reasonCode), ["COMPLETION_VALIDATION"]);
      await expectCode(validateCompletion(f.db, f.ctx, OWNER_USER, id, { finalResolutionStatus: "FULLY_RESOLVED" }), "MANAGEMENT_AUTHORIZATION_REQUIRED");
      await expectCode(validateCompletion(f.db, f.ctx, MANAGER, id, { finalResolutionStatus: "IMPROVING" }), "VOCABULARY_VIOLATION");
      await expectCode(resolveDecisionRequired(f.db, f.ctx, MANAGER, id, { reasonCode: "COMPLETION_VALIDATION", resolution: "ok" }), "DEDICATED_WORKFLOW_REQUIRED");
      await validateCompletion(f.db, f.ctx, MANAGER, id, { finalResolutionStatus: "SUBSTANTIALLY_RESOLVED", at: at(11) });
      v = await readWorkflowView(f.db, f.ctx, id);
      assert.equal(v.workflowState?.workflowState, "COMPLETED_VALIDATED");
      assert.equal(v.actionTracking!.resolutionStatus, "SUBSTANTIALLY_RESOLVED");
      assert.equal((await listDecisionRequired(f.db, f.ctx)).length, 0);
      await archiveToHistory(f.db, f.ctx, MANAGER, id, { at: at(12) });
      v = await readWorkflowView(f.db, f.ctx, id);
      assert.equal(v.workflowState?.workflowState, "COMPLETED_HISTORY");
      // 4B-D4: execution is complete, formal closeout is NOT
      assert.equal(v.lifecycleState, "COMPLETED");
      assert.equal(v.closedAt, null, "Completed History is not formal closeout");
      assert.equal(v.executionCompleted, true);
      assert.equal(v.closeoutCompleted, false);
      assert.equal(v.outcome, null, "no outcome / learning / closeout record is written in Stage 4B");
      assert.equal(v.actionTracking!.resolutionStatus, "SUBSTANTIALLY_RESOLVED");
      assert.deepEqual((await listCompletedHistory(f.db, f.ctx)).map((x) => x.candidateId), [id]);
      await expectCode(updateProgress(f.db, f.ctx, OWNER_USER, id, { actionCompletionPct: 10 }), "INVALID_WORKFLOW_STATE");
      const ev = (await payloadsOf(f.db, id, "ACTION_COMPLETED"))[0]!;
      assert.equal(ev.progress!.actionCompletionPct, 100);
      assert.equal(ev.progress!.conditionReductionPct, 90);
      assert.equal(ev.progress!.completedAt, at(10).toISOString());
      assert.ok(!(await eventTypes(f.db, id)).includes("CLOSEOUT_COMPLETED"), "closeout / learning is a later stage");
      // new evidence for the same condition waits for the later closeout stage: nothing is created, nothing changes
      const again = await ingestGovernedEvidence(f.db, f.ctx, MANAGER, { evidence: [evidence("77")], sourceRunId: "r9", describe: describeGroup(), at: at(40) });
      assert.equal(again.groups[0]!.action, "DEFERRED_AWAITING_CLOSEOUT");
      assert.equal(again.groups[0]!.candidateId, id);
      assert.equal(await f.db.iamCoreCandidate.count(), 1);
      await expectCode(attachEvidence(f.db, f.ctx, MANAGER, id, { evidence: [evidence("78")] }), "CANDIDATE_AWAITING_CLOSEOUT");
    }));
});

// =====================================================================================================================
describe("AGING and ESCALATION: status model over time, Management Decision Required, pause workflow", () => {
  it("moves ON_TRACK -> ATTENTION -> AT_RISK -> OVERDUE with management-decision requirements and What-Changed markers for the escalating statuses", () =>
    withFixture(async (f) => {
      const id = await startedCandidate(f);
      await updateProgress(f.db, f.ctx, OWNER_USER, id, { actionCompletionPct: 50, at: at(15) });
      const status = async () => (await f.db.iamCoreActionTracking.findUniqueOrThrow({ where: { candidateId: id } })).actionStatus;
      assert.equal(await status(), "ON_TRACK");
      const attention = await evaluateAction(f.db, f.ctx, SYSTEM_ACTOR, id, { now: at(18) });
      assert.equal(attention.to, "ATTENTION");
      assert.equal(attention.decisionRequiredRaised, false);
      assert.equal((await listDecisionRequired(f.db, f.ctx)).length, 0, "Attention alone does not require a management decision");
      const atRisk = await evaluateAction(f.db, f.ctx, SYSTEM_ACTOR, id, { now: at(23) });
      assert.equal(atRisk.to, "AT_RISK");
      assert.equal(atRisk.decisionRequiredRaised, true);
      assert.deepEqual((await listDecisionRequired(f.db, f.ctx)).map((x) => x.reasonCode), ["AT_RISK"]);
      const overdue = await evaluateAction(f.db, f.ctx, SYSTEM_ACTOR, id, { now: at(31) });
      assert.equal(overdue.to, "OVERDUE");
      assert.deepEqual((await listDecisionRequired(f.db, f.ctx)).map((x) => x.reasonCode), ["OVERDUE"], "the AT_RISK requirement is superseded by OVERDUE");
      const markers = await listWhatChangedMarkers(f.db, f.ctx);
      assert.deepEqual(markers.map((m) => m.toStatus), ["AT_RISK", "OVERDUE"]);
      const history = await f.db.iamCoreActionStatusHistory.findMany({ where: { candidateId: id }, orderBy: { at: "asc" } });
      assert.deepEqual(history.map((h) => h.toStatus), ["NOT_STARTED", "ON_TRACK", "ATTENTION", "AT_RISK", "OVERDUE"]);
      assert.deepEqual(history.map((h) => h.includeInWhatChanged), [false, false, false, true, true]);
      assert.ok(JSON.parse(history[3]!.reasonsJson!).length > 0, "reasons are recorded");
      const types = await eventTypes(f.db, id);
      assert.equal(types.filter((t) => t === "MANAGEMENT_DECISION_REQUIRED").length, 2);
      assert.equal(types.filter((t) => t === "ACTION_STATUS_CHANGED").length, 3);
      // an evaluation that changes nothing changes nothing
      const before = await outboxCount(f.db);
      const same = await evaluateAction(f.db, f.ctx, SYSTEM_ACTOR, id, { now: at(32) });
      assert.equal(same.changed, false);
      assert.equal(await outboxCount(f.db), before);
      // management decision on the overdue action is recorded; the flag does not come back until the status changes
      await resolveDecisionRequired(f.db, f.ctx, MANAGER, id, { reasonCode: "OVERDUE", resolution: "Target moved by management; continue.", at: at(33) });
      assert.equal((await listDecisionRequired(f.db, f.ctx)).length, 0);
      await evaluateAction(f.db, f.ctx, SYSTEM_ACTOR, id, { now: at(34) });
      assert.equal((await listDecisionRequired(f.db, f.ctx)).length, 0);
      await expectCode(resolveDecisionRequired(f.db, f.ctx, OWNER_USER, id, { reasonCode: "OVERDUE", resolution: "x" }), "MANAGEMENT_AUTHORIZATION_REQUIRED");
    }));

  it("a Blocked action becomes BLOCKED with a management-decision requirement until the blocker is cleared", () =>
    withFixture(async (f) => {
      const id = await startedCandidate(f);
      await updateProgress(f.db, f.ctx, OWNER_USER, id, { actionCompletionPct: 20, at: at(4) });
      await expectCode(raiseBlocker(f.db, f.ctx, STRANGER, id, { reason: "x" }), "OWNER_OR_MANAGER_REQUIRED");
      const b = await raiseBlocker(f.db, f.ctx, OWNER_USER, id, { reason: "Vendor portal is down", dependency: "Vendor IT", at: at(5) });
      assert.equal(b.status, "BLOCKED");
      assert.equal(b.decisionRequiredRaised, true);
      await expectCode(raiseBlocker(f.db, f.ctx, OWNER_USER, id, { reason: "another" }), "BLOCKER_ALREADY_OPEN");
      await expectCode(completeAction(f.db, f.ctx, OWNER_USER, id), "BLOCKER_OPEN");
      assert.deepEqual((await listDecisionRequired(f.db, f.ctx)).map((x) => x.reasonCode), ["BLOCKED"]);
      await expectCode(resolveDecisionRequired(f.db, f.ctx, MANAGER, id, { reasonCode: "BLOCKED", resolution: "x" }), "DEDICATED_WORKFLOW_REQUIRED");
      const exec = await f.db.iamCoreExecutionState.findUniqueOrThrow({ where: { candidateId: id } });
      assert.equal(exec.actionStatus, "BLOCKED");
      assert.match(exec.blockersJson!, /Vendor portal is down/);
      const blocked = (await payloadsOf(f.db, id, "ACTION_BLOCKED"))[0]!;
      assert.match(String(blocked.progress!.blockedReason), /Vendor portal is down/);
      const c = await clearBlocker(f.db, f.ctx, OWNER_USER, id, { note: "Portal restored.", at: at(6) });
      assert.equal(c.status, "ON_TRACK");
      assert.equal((await listDecisionRequired(f.db, f.ctx)).length, 0, "clearing the blocker clears the status-driven requirement");
      assert.equal((await f.db.iamCoreBlocker.findFirstOrThrow({ where: { candidateId: id } })).status, "CLEARED");
      assert.equal((await f.db.iamCoreExecutionState.findUniqueOrThrow({ where: { candidateId: id } })).blockersJson, null);
      assert.equal((await listWhatChangedMarkers(f.db, f.ctx)).length, 1);
    }));

  it("PAUSE: the owner only REQUESTS; management approves or denies; nobody approves their own request; the paused action stays in the portfolio", () =>
    withFixture(async (f) => {
      const id = await startedCandidate(f);
      await updateProgress(f.db, f.ctx, OWNER_USER, id, { actionCompletionPct: 30, at: at(5) });
      const ownershipBefore = (await readWorkflowView(f.db, f.ctx, id)).currentOwnership!.ownershipId;
      const req = await requestPause(f.db, f.ctx, OWNER_USER, id, { reason: "Year-end receiving freeze.", expectedDurationDays: 10, reactivationCondition: "Freeze lifted", at: at(6) });
      assert.notEqual(req.status, "PAUSED", "a request does not pause the action");
      const live = await f.db.iamCorePauseRequest.findFirstOrThrow({ where: { candidateId: id } });
      assert.equal(live.status, "REQUESTED");
      assert.equal(live.requestedBy, OWNER_USER.actorId);
      assert.deepEqual((await listDecisionRequired(f.db, f.ctx)).map((x) => x.reasonCode), ["PAUSE_REQUEST"]);
      await expectCode(requestPause(f.db, f.ctx, OWNER_USER, id, { reason: "again" }), "PAUSE_ALREADY_LIVE");
      await expectCode(requestPause(f.db, f.ctx, OWNER_USER, id, { reason: " " }), "REASON_REQUIRED");
      // the owner cannot self-approve; neither can a manager approve their own request
      await expectCode(decidePause(f.db, f.ctx, OWNER_USER, id, { decision: "APPROVE", reason: "ok" }), "MANAGEMENT_AUTHORIZATION_REQUIRED");
      await expectCode(decidePause(f.db, f.ctx, MANAGER, id, { decision: "APPROVE", reason: " " }), "REASON_REQUIRED");
      await expectCode(completeAction(f.db, f.ctx, OWNER_USER, id), "PAUSE_LIVE");
      const approved = await decidePause(f.db, f.ctx, MANAGER, id, { decision: "APPROVE", reason: "Approved; review at the end of the freeze.", at: at(7) });
      assert.equal(approved.status, "PAUSED");
      assert.equal(approved.reviewDueAt!.getTime(), at(7).getTime() + 10 * DAY);
      const v = await readWorkflowView(f.db, f.ctx, id);
      assert.equal(v.actionTracking!.actionStatus, "PAUSED");
      assert.equal(v.workflowState?.workflowState, "ACTIVE_ACTION", "a paused action stays in the active portfolio");
      assert.equal(v.currentOwnership!.ownershipId, ownershipBefore, "ownership is preserved");
      assert.equal(v.actionTracking!.actionCompletionPct, 30, "progress is preserved");
      assert.equal((await listDecisionRequired(f.db, f.ctx)).length, 0);
      const paused = (await payloadsOf(f.db, id, "ACTION_PAUSED"))[0]!;
      assert.match(String(paused.progress!.statusReason), /Year-end receiving freeze/);
      assert.equal(paused.progress!.reactivationCondition, "Freeze lifted");
      const capacity = await computeCapacity(f.db, f.ctx, at(8));
      assert.equal(capacity.overall.activePrograms, 1);
      assert.equal(capacity.overall.paused, 1);
      // a paused action requires review/reactivation
      const early = await evaluateAction(f.db, f.ctx, SYSTEM_ACTOR, id, { now: at(10) });
      assert.equal(early.pauseReviewFlagRaised, false);
      const due = await evaluateAction(f.db, f.ctx, SYSTEM_ACTOR, id, { now: at(18) });
      assert.equal(due.pauseReviewFlagRaised, true);
      assert.equal(due.to, "PAUSED");
      assert.deepEqual((await listDecisionRequired(f.db, f.ctx)).map((x) => x.reasonCode), ["PAUSE_REVIEW_DUE"]);
      await expectCode(startAction(f.db, f.ctx, OWNER_USER, id), "ACTION_ALREADY_STARTED");
      const re = await reactivateAction(f.db, f.ctx, OWNER_USER, id, { note: "Freeze lifted.", at: at(19) });
      assert.notEqual(re.status, "PAUSED");
      // The pause review flag is resolved. The 12 pause days are NOT deducted from the schedule (a target change needs a plan
      // revision), so 30% at day 19 of 28 honestly re-evaluates to AT_RISK (documented as a Product Owner decision).
      assert.deepEqual((await listDecisionRequired(f.db, f.ctx)).map((x) => x.reasonCode), ["AT_RISK"]);
      assert.ok((await eventTypes(f.db, id)).includes("ACTION_REACTIVATED"));
      assert.equal((await f.db.iamCorePauseRequest.findFirstOrThrow({ where: { candidateId: id } })).status, "REACTIVATED");
    }));

  it("a requesting manager cannot decide their own pause request; a denial leaves the action running", () =>
    withFixture(async (f) => {
      const id = await startedCandidate(f);
      await requestPause(f.db, f.ctx, MANAGER, id, { reason: "Manager-initiated pause.", at: at(3) });
      await expectCode(decidePause(f.db, f.ctx, MANAGER, id, { decision: "APPROVE", reason: "self" }), "SELF_APPROVAL_NOT_PERMITTED");
      const denied = await decidePause(f.db, f.ctx, MANAGER_2, id, { decision: "DENY", reason: "Not justified.", at: at(4) });
      assert.equal(denied.approved, false);
      assert.notEqual(denied.status, "PAUSED");
      assert.equal((await f.db.iamCorePauseRequest.findFirstOrThrow({ where: { candidateId: id } })).status, "DENIED");
      assert.equal((await listDecisionRequired(f.db, f.ctx)).length, 0);
      assert.ok((await f.db.iamCoreManagementDecision.findMany({ where: { candidateId: id } })).some((d) => d.decisionType === "PAUSE_DENIED"));
      // a new request is allowed after a denial
      await requestPause(f.db, f.ctx, OWNER_USER, id, { reason: "Trying again.", at: at(5) });
    }));

  it("material dependency, plan deviation and escalation requests surface as Management Decision Required, distinct from a NEW candidate awaiting initial approval", () =>
    withFixture(async (f) => {
      const id = await startedCandidate(f);
      const fresh = await presentedCandidate(f, { refs: ["z"], over: { conditionKey: "Another" } });
      assert.ok(fresh);
      assert.equal((await listDecisionRequired(f.db, f.ctx)).length, 0, "a new candidate awaiting initial approval is NOT a decision-required flag");
      for (const reason of ["MATERIAL_DEPENDENCY", "MATERIAL_PLAN_DEVIATION", "ESCALATION_REQUEST"] as const) {
        const r = await raiseManagementAttention(f.db, f.ctx, OWNER_USER, id, { reason, detail: `${reason} detail`, at: at(2) });
        assert.equal(r.raised, true);
      }
      assert.deepEqual((await listDecisionRequired(f.db, f.ctx)).map((x) => x.reasonCode).sort(), ["ESCALATION_REQUEST", "MATERIAL_DEPENDENCY", "MATERIAL_PLAN_DEVIATION"]);
      const again = await raiseManagementAttention(f.db, f.ctx, OWNER_USER, id, { reason: "ESCALATION_REQUEST", detail: "still", at: at(3) });
      assert.equal(again.raised, false, "no duplicate open flag for the same reason");
      const capacity = await computeCapacity(f.db, f.ctx, at(4));
      assert.equal(capacity.overall.awaitingManagementDecision, 1);
      assert.equal(capacity.newCandidatesAwaitingInitialDecision, 1);
      await expectCode(raiseManagementAttention(f.db, f.ctx, STRANGER, id, { reason: "ESCALATION_REQUEST", detail: "x" }), "OWNER_OR_MANAGER_REQUIRED");
    }));

  it("capacity foundation counts active programs overall and by department, and never filters or hides a candidate", () =>
    withFixture(async (f) => {
      const a = await startedCandidate(f, { key: "a", department: "Purchasing" });
      assert.ok(a);
      const b = await pendingAcceptanceCandidate(f, { key: "b", department: "Sales" });
      await acceptOwnership(f.db, f.ctx, OWNER_USER, b, { at: at(1) });
      const cap = await computeCapacity(f.db, f.ctx, at(2));
      assert.equal(cap.overall.activePrograms, 2);
      assert.equal(cap.overall.onTrack, 1);
      assert.equal(cap.overall.notStarted, 1);
      assert.equal(cap.byDepartment.Purchasing!.onTrack, 1);
      assert.equal(cap.byDepartment.Sales!.notStarted, 1);
      for (const k of ["attention", "atRisk", "overdue", "paused", "blocked", "awaitingManagementDecision"] as const) assert.equal(cap.overall[k], 0);
      // heavy load changes nothing about new candidates
      const created = await ingestGovernedEvidence(f.db, f.ctx, MANAGER, { evidence: [evidence("n1", { conditionKey: "Brand new" })], sourceRunId: "rn", describe: describeGroup(), at: at(2) });
      assert.equal(created.groups[0]!.action, "CREATED");
      await presentCandidate(f.db, f.ctx, MANAGER, created.groups[0]!.candidateId, { at: at(2, 1) });
      assert.equal((await f.db.iamCoreWorkflowState.findUniqueOrThrow({ where: { candidateId: created.groups[0]!.candidateId } })).workflowState, "PRESENTED");
      // capacity is information only: no workflow module reads it
      const dir = path.join(REPO_ROOT, "src", "lib", "dpos", "workflow");
      for (const file of fs.readdirSync(dir)) {
        if (file === "read.ts" || file === "index.ts") continue;
        assert.doesNotMatch(fs.readFileSync(path.join(dir, file), "utf8"), /computeCapacity/, `${file} must not consult capacity`);
      }
    }));
});

// =====================================================================================================================
describe("CONDITION REDUCTION", () => {
  it("never fabricates a percentage without a valid quantitative baseline; computes it once a baseline exists", () =>
    withFixture(async (f) => {
      const id = await startedCandidate(f); // no baseline
      const before = await outboxCount(f.db);
      const r = await updateConditionReduction(f.db, f.ctx, OWNER_USER, id, { currentExposure: 500, exposureUnit: "USD", at: at(3) });
      assert.equal(r.conditionReductionStatus, "NOT_YET_MEASURED");
      assert.equal(r.conditionReductionPct, null);
      assert.equal(r.reductionEventSent, false);
      assert.equal(await outboxCount(f.db), before, "nothing is sent for an unmeasured reduction");
      let t = await f.db.iamCoreActionTracking.findUniqueOrThrow({ where: { candidateId: id } });
      assert.equal(t.conditionReductionPct, null);
      assert.equal(t.resolutionStatus, "NOT_YET_MEASURED");
      assert.equal((await f.db.iamCoreExecutionState.findUniqueOrThrow({ where: { candidateId: id } })).conditionReductionPct, null);
      // zero baseline is not a valid baseline
      const zero = await updateConditionReduction(f.db, f.ctx, OWNER_USER, id, { baselineExposure: 0, at: at(3, 2) });
      assert.equal(zero.conditionReductionStatus, "NOT_YET_MEASURED");
      // a valid baseline: (1000 - 500) / 1000 x 100 = 50
      const ok = await updateConditionReduction(f.db, f.ctx, OWNER_USER, id, { baselineExposure: 1000, at: at(4) });
      assert.equal(ok.conditionReductionPct, 50);
      assert.equal(ok.reductionEventSent, true);
      assert.equal(ok.resolutionStatus, "IMPROVING");
      const ev = (await payloadsOf(f.db, id, "CONDITION_REDUCTION_UPDATED")).at(-1)!;
      assert.equal(ev.progress!.conditionReductionPct, 50);
      assert.equal(ev.progress!.remainingExposure, 500);
      assert.equal(ev.progress!.remainingExposureUnit, "USD");
      // changing an established baseline is a management action with a reason
      await expectCode(updateConditionReduction(f.db, f.ctx, OWNER_USER, id, { baselineExposure: 2000, note: "restated" }), "MANAGEMENT_AUTHORIZATION_REQUIRED");
      await expectCode(updateConditionReduction(f.db, f.ctx, MANAGER, id, { baselineExposure: 2000 }), "REASON_REQUIRED");
      const restated = await updateConditionReduction(f.db, f.ctx, MANAGER, id, { baselineExposure: 2000, note: "Baseline restated after the ERP correction.", at: at(5) });
      assert.equal(restated.conditionReductionPct, 75);
      t = await f.db.iamCoreActionTracking.findUniqueOrThrow({ where: { candidateId: id } });
      assert.equal(t.baselineExposure, 2000);
      assert.equal(await f.db.iamCoreProgressUpdate.count({ where: { candidateId: id, kind: "BASELINE" } }), 3, "every baseline change is in the ledger");
    }));

  it("a condition worse than its baseline keeps the negative value, is capped only in the contract copy, and asks for a management decision", () =>
    withFixture(async (f) => {
      const id = await startedCandidate(f, { baselineExposure: 1000 });
      const r = await updateConditionReduction(f.db, f.ctx, OWNER_USER, id, { currentExposure: 1300, at: at(3) });
      assert.equal(r.conditionReductionPct, -30);
      assert.equal((await f.db.iamCoreActionTracking.findUniqueOrThrow({ where: { candidateId: id } })).conditionReductionPct, -30);
      assert.equal((await f.db.iamCoreExecutionState.findUniqueOrThrow({ where: { candidateId: id } })).conditionReductionPct, 0);
      assert.deepEqual((await listDecisionRequired(f.db, f.ctx)).map((x) => x.reasonCode).sort(), ["AT_RISK", "CONDITION_WORSENED"], "the worsened condition and the status it causes both need management");
      await updateConditionReduction(f.db, f.ctx, OWNER_USER, id, { currentExposure: 900, at: at(4) });
      assert.equal((await listDecisionRequired(f.db, f.ctx)).length, 0, "improving past the baseline clears the requirement");
    }));

  it("rejects invalid inputs and final resolution statuses while the action is active; small reduction changes are not sent", () =>
    withFixture(async (f) => {
      const id = await startedCandidate(f, { baselineExposure: 1000 });
      await expectCode(updateConditionReduction(f.db, f.ctx, OWNER_USER, id, { currentExposure: -1 }), "OUT_OF_RANGE");
      await expectCode(updateConditionReduction(f.db, f.ctx, OWNER_USER, id, { currentExposure: Number.NaN }), "OUT_OF_RANGE");
      await expectCode(updateConditionReduction(f.db, f.ctx, OWNER_USER, id, { resolutionStatus: "FULLY_RESOLVED" }), "RESOLUTION_STATUS_NOT_IN_FLIGHT");
      await updateConditionReduction(f.db, f.ctx, OWNER_USER, id, { currentExposure: 500, resolutionStatus: "ON_TARGET", at: at(3) });
      const count = async () => (await eventTypes(f.db, id)).filter((e) => e === "CONDITION_REDUCTION_UPDATED").length;
      assert.equal(await count(), 1);
      await updateConditionReduction(f.db, f.ctx, OWNER_USER, id, { currentExposure: 480, at: at(4) }); // 52% vs 50% sent
      assert.equal(await count(), 1);
      await updateConditionReduction(f.db, f.ctx, OWNER_USER, id, { currentExposure: 400, at: at(5) }); // 60%
      assert.equal(await count(), 2);
      assert.equal((await f.db.iamCoreActionTracking.findUniqueOrThrow({ where: { candidateId: id } })).resolutionStatus, "ON_TARGET");
    }));
});

// =====================================================================================================================
describe("RESULTS RETURN: meaningful transitions create outbox events, retries are idempotent", () => {
  const FULL_SEQUENCE = [
    "CANDIDATE_CREATED",
    "MANAGEMENT_APPROVED",
    "DEPARTMENT_ASSIGNED",
    "TASK_OWNER_ASSIGNED",
    "OWNER_ACCEPTED",
    "ACTION_STARTED",
    "PROGRESS_UPDATED",
    "CONDITION_REDUCTION_UPDATED",
    "ACTION_BLOCKED",
    "MANAGEMENT_DECISION_REQUIRED",
    "ACTION_STATUS_CHANGED",
    "MANAGEMENT_DECISION_RESOLVED", // blocker cleared
    "MANAGEMENT_DECISION_REQUIRED", // pause requested
    "ACTION_STATUS_CHANGED",
    "ACTION_PAUSED",
    "MANAGEMENT_DECISION_RESOLVED", // pause decided
    "ACTION_REACTIVATED",
    "ACTION_COMPLETED",
    "MANAGEMENT_DECISION_REQUIRED", // completion validation
    "MANAGEMENT_DECISION_RESOLVED", // completion validated; Completed History creates no event
  ];

  async function fullLifecycle(f: Fixture): Promise<string> {
    const id = await presentedCandidate(f);
    await approveCandidate(f.db, f.ctx, MANAGER, id, {
      plan: PLAN,
      assignment: { responsibleDepartment: "Purchasing", taskOwnerId: OWNER_USER.actorId, taskOwnerName: "Olivia Owner" },
      targetStart: dateStr(1),
      targetResolution: dateStr(29),
      baselineExposure: 1000,
      exposureUnit: "USD",
      at: at(0, 2),
    });
    await acceptOwnership(f.db, f.ctx, OWNER_USER, id, { at: at(0, 3) });
    await startAction(f.db, f.ctx, OWNER_USER, id, { at: at(1) });
    await updateProgress(f.db, f.ctx, OWNER_USER, id, { actionCompletionPct: 40, at: at(5) });
    await updateConditionReduction(f.db, f.ctx, OWNER_USER, id, { currentExposure: 600, at: at(5, 6) });
    await raiseBlocker(f.db, f.ctx, OWNER_USER, id, { reason: "Vendor portal down", at: at(6) });
    await clearBlocker(f.db, f.ctx, OWNER_USER, id, { at: at(7) });
    await requestPause(f.db, f.ctx, OWNER_USER, id, { reason: "Freeze", expectedDurationDays: 3, at: at(8) });
    await decidePause(f.db, f.ctx, MANAGER, id, { decision: "APPROVE", reason: "ok", at: at(9) });
    await reactivateAction(f.db, f.ctx, OWNER_USER, id, { at: at(12) });
    await completeAction(f.db, f.ctx, OWNER_USER, id, { at: at(14) });
    await validateCompletion(f.db, f.ctx, MANAGER, id, { finalResolutionStatus: "FULLY_RESOLVED", at: at(15) });
    await archiveToHistory(f.db, f.ctx, MANAGER, id, { at: at(16) });
    return id;
  }

  it("a full lifecycle creates exactly the meaningful events, in order, all locally valid and pending", () =>
    withFixture(async (f) => {
      const id = await fullLifecycle(f);
      assert.deepEqual(await eventTypes(f.db, id), FULL_SEQUENCE);
      const rows = await f.db.dposResultsReturnOutbox.findMany({ where: { candidateId: id }, orderBy: { createdAt: "asc" } });
      assert.ok(rows.every((r) => r.syncStatus === "PENDING"), "persisted for transmission, none rejected locally");
      assert.equal(new Set(rows.map((r) => r.producerEventId)).size, rows.length);
      assert.equal(new Set(rows.map((r) => r.operationKey)).size, rows.length);
      assert.ok(rows.every((r) => r.operationKey!.startsWith("wf4b:")));
      const times = rows.map((r) => r.createdAt.getTime());
      assert.deepEqual([...times].sort((a, b) => a - b), times, "outbox order is creation order");
      const payloads = rows.map((r) => JSON.parse(r.payloadJson) as Record<string, Record<string, unknown>>);
      const producerTimes = payloads.map((p) => new Date(String(p.envelope!.producerEventAt)).getTime());
      assert.deepEqual([...producerTimes].sort((a, b) => a - b), producerTimes, "producer event times never go backwards");
      assert.ok(payloads.every((p) => (p.auditReceipt as Record<string, unknown>).originatingSource === "IAM_WORKFLOW_STAGE_4B"));
      assert.equal(payloads[1]!.auditReceipt!.originatingActor, MANAGER.actorId);
      assert.equal(payloads[4]!.auditReceipt!.originatingActor, OWNER_USER.actorId);
      // the closed candidate: Completed History, no RSE/PRE board regeneration artifacts are produced
      const v = await readWorkflowView(f.db, f.ctx, id);
      assert.equal(v.workflowState?.workflowState, "COMPLETED_HISTORY");
      assert.equal(await f.db.iamRun.count(), 0, "the workflow never touches the V1.5 run / board tables");
    }));

  it("produces ALL of the required event types across the workflow", () =>
    withFixture(async (f) => {
      await fullLifecycle(f);
      // rejection, suppression + release, owner discussion, recurrence
      const rej = await presentedCandidate(f, { refs: ["r"], over: { conditionKey: "Rej" } });
      await rejectCandidate(f.db, f.ctx, MANAGER, rej, { reason: "No.", at: at(20) });
      const again = (await ingestGovernedEvidence(f.db, f.ctx, MANAGER, { evidence: [evidence("r", { conditionKey: "Rej" })], sourceRunId: "r2", describe: describeGroup(), at: at(21) })).groups[0]!.candidateId;
      await presentCandidate(f.db, f.ctx, MANAGER, again, { at: at(21, 1) });
      await suppressCandidate(f.db, f.ctx, MANAGER, again, { reason: "Defer", cycles: 1, at: at(21, 2) });
      await releaseSuppression(f.db, f.ctx, MANAGER, again, { reason: "Reconsider", at: at(22) });
      const disc = await pendingAcceptanceCandidate(f, { key: "disc" });
      await requestDiscussion(f.db, f.ctx, OWNER_USER, disc, { note: "Concern", at: at(22) });
      const seen = new Set((await f.db.dposResultsReturnOutbox.findMany({ select: { eventType: true } })).map((r) => r.eventType));
      const REQUIRED = [
        "CANDIDATE_CREATED", "MANAGEMENT_APPROVED", "MANAGEMENT_REJECTED", "SUPPRESSED", "SUPPRESSION_RELEASED", "DEPARTMENT_ASSIGNED", "TASK_OWNER_ASSIGNED",
        "OWNER_ACCEPTED", "OWNER_DISCUSSION_REQUESTED", "ACTION_STARTED", "ACTION_STATUS_CHANGED", "PROGRESS_UPDATED", "CONDITION_REDUCTION_UPDATED",
        "MANAGEMENT_DECISION_REQUIRED", "MANAGEMENT_DECISION_RESOLVED", "ACTION_PAUSED", "ACTION_REACTIVATED", "ACTION_BLOCKED", "ACTION_COMPLETED", "RECURRENCE_LINKED",
      ];
      for (const t of REQUIRED) assert.ok(seen.has(t), `missing event type ${t}`);
      assert.equal(await f.db.dposResultsReturnOutbox.count({ where: { syncStatus: "REJECTED_CORRECTION_REQUIRED" } }), 0, "no event failed local contract validation");
    }));

  it("creates NO event for meaningless or purely local changes", () =>
    withFixture(async (f) => {
      const id = await newCandidate(f);
      const base = await outboxCount(f.db);
      await presentCandidate(f.db, f.ctx, MANAGER, id, { at: at(0, 1) });
      await attachEvidence(f.db, f.ctx, MANAGER, id, { evidence: [evidence("9")] });
      await returnForReview(f.db, f.ctx, MANAGER, id, { reason: "Need more info", at: at(0, 2) });
      await presentCandidate(f.db, f.ctx, MANAGER, id, { at: at(0, 3) });
      assert.equal(await outboxCount(f.db), base);
      const s = await startedCandidate(f, { key: "s" });
      const mark = await outboxCount(f.db);
      await updateProgress(f.db, f.ctx, OWNER_USER, s, { actionCompletionPct: 2, at: at(2) });
      await updateProgress(f.db, f.ctx, OWNER_USER, s, { note: "note only", at: at(2, 1) });
      await updateConditionReduction(f.db, f.ctx, OWNER_USER, s, { currentExposure: 5, at: at(2, 2) }); // no baseline: not measured
      await evaluateAction(f.db, f.ctx, SYSTEM_ACTOR, s, { now: at(2, 3) });
      assert.equal(await outboxCount(f.db), mark);
    }));

  it("a failed operation leaves no event, history or audit row behind (single transaction)", () =>
    withFixture(async (f) => {
      const id = await presentedCandidate(f);
      const counts = async () => [await outboxCount(f.db), await auditCount(f.db), await f.db.iamCoreWorkflowHistory.count(), await f.db.iamCoreManagementDecision.count(), await f.db.iamCoreManagementPlan.count()];
      const before = await counts();
      await expectCode(rejectCandidate(f.db, f.ctx, MANAGER, id, { reason: "" }), "REASON_REQUIRED");
      await expectCode(approveCandidate(f.db, f.ctx, MANAGER, id, { plan: { summary: "x", actionDirection: "different" } }), "DEVIATION_REASON_REQUIRED");
      await expectCode(approveCandidate(f.db, f.ctx, MANAGER, id, { plan: PLAN, assignment: { responsibleDepartment: "Purchasing" }, targetStart: "2026-12-31", targetResolution: "2026-01-01" }), "TARGET_DATES_INVALID");
      assert.deepEqual(await counts(), before);
    }));

  it("retries are idempotent: the same business record never produces a second event", () =>
    withFixture(async (f) => {
      const id = await fullLifecycle(f);
      const row = await f.db.dposResultsReturnOutbox.findFirstOrThrow({ where: { candidateId: id, eventType: "MANAGEMENT_APPROVED" } });
      const before = await outboxCount(f.db);
      const replay = await enqueueResultsReturnEvent(f.db, f.ctx, { eventType: "MANAGEMENT_APPROVED", candidateId: id, operationKey: row.operationKey, sections: {}, at: at(30) });
      assert.equal(replay.created, false);
      assert.equal(replay.row.producerEventId, row.producerEventId);
      assert.equal(await outboxCount(f.db), before);
      // operations do not overlap: every operation key is unique to its record
      const keys = (await f.db.dposResultsReturnOutbox.findMany({ select: { operationKey: true } })).map((r) => r.operationKey);
      assert.equal(new Set(keys).size, keys.length);
    }));

  it("all Stage 4B ledgers are append-only at the database level", () =>
    withFixture(async (f, tdb) => {
      const id = await startedCandidate(f);
      await updateProgress(f.db, f.ctx, OWNER_USER, id, { actionCompletionPct: 20, at: at(3) });
      const checks: Array<[string, string, RegExp]> = [
        ["workflow history", "UPDATE iam_core_workflow_history SET reason = 'x'", /IAM_CORE_LEDGER_APPEND_ONLY/],
        ["management decisions", "UPDATE iam_core_management_decisions SET reason = 'x'", /IAM_CORE_LEDGER_APPEND_ONLY/],
        ["assignment events", "UPDATE iam_core_assignment_events SET reason = 'x'", /IAM_CORE_LEDGER_APPEND_ONLY/],
        ["progress updates", "UPDATE iam_core_progress_updates SET note = 'x'", /IAM_CORE_LEDGER_APPEND_ONLY/],
        ["action status history", "UPDATE iam_core_action_status_history SET trigger = 'x'", /IAM_CORE_LEDGER_APPEND_ONLY/],
        ["candidate evidence", "UPDATE iam_core_candidate_evidence SET sku = 'x'", /IAM_CORE_LEDGER_APPEND_ONLY/],
        ["workflow history delete", "DELETE FROM iam_core_workflow_history", /IAM_CORE_LEDGER_APPEND_ONLY/],
        ["decisions delete", "DELETE FROM iam_core_management_decisions", /IAM_CORE_LEDGER_APPEND_ONLY/],
        ["tracking delete", "DELETE FROM iam_core_action_tracking", /IAM_CORE_WORKFLOW_NOT_DELETABLE/],
        ["workflow state delete", "DELETE FROM iam_core_workflow_states", /IAM_CORE_WORKFLOW_NOT_DELETABLE/],
        ["workflow state vocabulary", "UPDATE iam_core_workflow_states SET workflow_state = 'NOT_A_STATE'", /IAM_CORE_WORKFLOW_STATE_VOCABULARY/],
        ["action status vocabulary", "UPDATE iam_core_action_tracking SET action_status = 'NOT_A_STATUS'", /IAM_CORE_ACTION_STATUS_VOCABULARY/],
      ];
      for (const [name, sql, re] of checks) sqlThrows(tdb.file, sql, re);
      await assert.rejects(f.db.iamCoreWorkflowHistory.deleteMany({}));
      assert.ok((await f.db.iamCoreWorkflowHistory.count()) > 0);
      assert.equal(checks.length, 12);
    }));
});
// =====================================================================================================================
describe("LEGACY V1.5 preservation", () => {
  it("legacy records are unchanged by the workflow and are never auto-promoted to canonical candidates", () =>
    withFixture(async (f, tdb) => {
      const company = await f.db.company.create({ data: { name: "Legacy Co" } });
      await f.db.iamRun.create({ data: { companyId: company.id, runName: "Legacy review cycle", reviewDate: new Date("2026-05-01"), reviewWeekStart: new Date("2026-04-27"), reviewWeekEnd: new Date("2026-05-03") } });
      const tables = legacyTableNames(REPO_ROOT);
      const before = legacyFingerprint(tdb.file, tables);
      assert.equal(await f.db.iamCoreCandidate.count(), 0, "legacy data produces no canonical candidate");
      await ingestGovernedEvidence(f.db, f.ctx, MANAGER, { evidence: [evidence("1")], sourceRunId: "run-1", describe: describeGroup(), at: T0 });
      const id = (await f.db.iamCoreCandidate.findFirstOrThrow()).candidateId;
      await presentCandidate(f.db, f.ctx, MANAGER, id, { at: at(0, 1) });
      await approveCandidate(f.db, f.ctx, MANAGER, id, { plan: PLAN, assignment: { responsibleDepartment: "Purchasing", taskOwnerId: OWNER_USER.actorId }, at: at(0, 2) });
      await acceptOwnership(f.db, f.ctx, OWNER_USER, id, { at: at(0, 3) });
      await startAction(f.db, f.ctx, OWNER_USER, id, { at: at(1) });
      await completeAction(f.db, f.ctx, OWNER_USER, id, { at: at(2) });
      await validateCompletion(f.db, f.ctx, MANAGER, id, { finalResolutionStatus: "FULLY_RESOLVED", at: at(3) });
      await archiveToHistory(f.db, f.ctx, MANAGER, id, { at: at(4) });
      assert.deepEqual(legacyFingerprint(tdb.file, tables), before, "every V1.5 table is byte-identical after a full workflow");
      assert.equal(await f.db.iamCoreCandidate.count(), 1, "only the explicitly ingested candidate exists");
    }));

  it("workflow source code reads no V1.5 model, implements no Health Score / ranking / recommendation engine, and encodes no local path", () => {
    const schema = fs.readFileSync(path.join(REPO_ROOT, "prisma", "schema.prisma"), "utf8");
    const legacyModels = [...schema.matchAll(/^model\s+(\w+)\s*\{/gm)].map((m) => m[1]!).filter((n) => !/^(Dpos|IamCore)/.test(n));
    assert.ok(legacyModels.length >= 30);
    const dir = path.join(REPO_ROOT, "src", "lib", "dpos", "workflow");
    for (const file of fs.readdirSync(dir)) {
      const src = fs.readFileSync(path.join(dir, file), "utf8");
      for (const m of legacyModels) {
        const delegate = m[0]!.toLowerCase() + m.slice(1);
        assert.doesNotMatch(src, new RegExp(`\\b(tx|db|prisma)\\.${delegate}\\b`), `${file} reads the V1.5 model ${m}`);
      }
      assert.doesNotMatch(src, /health\s*score|healthScore|HealthScore/i, `${file} must not implement the Inventory Management Health Score`);
      assert.doesNotMatch(src, /from\s+["']@\/lib\/iam|from\s+["'][./]+\/iam\//, `${file} must not import the V1.5 IAM engines`);
      assert.doesNotMatch(src, new RegExp(["DPOSDH-iam-", "integration|[A-Z]:\\\\Users|/Users/|OneDrive"].join("")), `${file} encodes a local path`);
      assert.doesNotMatch(src, /process\.env\.(?!IAM_PRODUCER_VERSION)/, `${file} must not read environment configuration`);
    }
  });
});

// =====================================================================================================================
describe("PO CLOSEOUT CORRECTIONS (4B-D1 .. 4B-D6): timestamps, explicit decision state, NOT_STARTED, execution vs closeout, pause policy", () => {
  const progressOf = async (f: Fixture, id: string, type: string, nth = 0) => (await payloadsOf(f.db, id, type))[nth]!.progress as Record<string, unknown>;

  it("4B-D3: ownership acceptance reports the explicit NOT_STARTED status; the start moves it to a started status; NOT_STARTED is never null", () =>
    withFixture(async (f) => {
      const id = await acceptedCandidate(f);
      const accepted = await progressOf(f, id, "OWNER_ACCEPTED");
      assert.equal(accepted.actionStatus, "NOT_STARTED");
      assert.equal((await f.db.iamCoreExecutionState.findUniqueOrThrow({ where: { candidateId: id } })).actionStatus, "NOT_STARTED");
      await startAction(f.db, f.ctx, OWNER_USER, id, { at: at(1) });
      assert.notEqual((await progressOf(f, id, "ACTION_STARTED")).actionStatus, "NOT_STARTED");
      for (const p of await payloadsOf(f.db, id)) assert.notEqual((p.progress as Record<string, unknown> | undefined)?.actionStatus, null, "a legitimate status is never null");
    }));

  it("4B-D1: the start and completion timestamps are explicit in their events (and only in the authoritative ones)", () =>
    withFixture(async (f) => {
      const id = await startedCandidate(f);
      const started = await progressOf(f, id, "ACTION_STARTED");
      assert.equal(started.startedAt, at(1).toISOString(), "ACTION_STARTED carries the start time");
      await updateProgress(f.db, f.ctx, OWNER_USER, id, { actionCompletionPct: 50, at: at(5) });
      const upd = await progressOf(f, id, "PROGRESS_UPDATED");
      assert.equal(upd.completedAt, undefined, "a progress update never invents a completion time (omitted, not null)");
      assert.equal("startedAt" in upd, false, "a progress update does not restate the start time (the Data Hub preserves it)");
      await completeAction(f.db, f.ctx, OWNER_USER, id, { at: at(10) });
      const done = await progressOf(f, id, "ACTION_COMPLETED");
      assert.equal(done.completedAt, at(10).toISOString());
    }));

  it("4B-D2: management decision required is explicit; resolving the blocker / pause / discussion / escalation emits an explicit resolution", () =>
    withFixture(async (f) => {
      const id = await startedCandidate(f);
      await raiseBlocker(f.db, f.ctx, OWNER_USER, id, { reason: "Vendor portal down", at: at(3) });
      const required = (await progressOf(f, id, "MANAGEMENT_DECISION_REQUIRED"));
      assert.equal(required.managementDecisionRequired, true);
      assert.ok(required.decisionRequiredCategory);
      await clearBlocker(f.db, f.ctx, OWNER_USER, id, { at: at(4) });
      const resolved = await progressOf(f, id, "MANAGEMENT_DECISION_RESOLVED");
      assert.equal(resolved.managementDecisionRequired, false);
      assert.ok(resolved.decisionResolution);
      assert.deepEqual(await listDecisionRequired(f.db, f.ctx), []);
      // the original REQUIRED event is retained (history), never rewritten
      assert.equal((await payloadsOf(f.db, id, "MANAGEMENT_DECISION_REQUIRED")).length, 1);
      // no second resolution is produced by a harmless later change
      const before = (await payloadsOf(f.db, id, "MANAGEMENT_DECISION_RESOLVED")).length;
      await updateProgress(f.db, f.ctx, OWNER_USER, id, { actionCompletionPct: 20, at: at(5) });
      assert.equal((await payloadsOf(f.db, id, "MANAGEMENT_DECISION_RESOLVED")).length, before);
      // pause request -> decision resolves it
      await requestPause(f.db, f.ctx, OWNER_USER, id, { reason: "Freeze", expectedDurationDays: 3, at: at(6) });
      assert.equal((await payloadsOf(f.db, id, "MANAGEMENT_DECISION_REQUIRED")).length, 2);
      await decidePause(f.db, f.ctx, MANAGER, id, { decision: "DENY", reason: "Keep going.", at: at(7) });
      assert.equal((await payloadsOf(f.db, id, "MANAGEMENT_DECISION_RESOLVED")).length, 2);
      // owner discussion on a pending-acceptance candidate is a management matter that its resolution closes
      const disc = await pendingAcceptanceCandidate(f, { key: "d" });
      await requestDiscussion(f.db, f.ctx, OWNER_USER, disc, { note: "Concern", at: at(8) });
      assert.ok((await eventTypes(f.db, disc)).includes("OWNER_DISCUSSION_REQUESTED"));
    }));

  it("4B-D4: Completed History is execution completion only, never formal closeout; closeout / learning events do not exist yet", () =>
    withFixture(async (f) => {
      const id = await startedCandidate(f);
      await completeAction(f.db, f.ctx, OWNER_USER, id, { at: at(10) });
      await validateCompletion(f.db, f.ctx, MANAGER, id, { finalResolutionStatus: "FULLY_RESOLVED", at: at(11) });
      await archiveToHistory(f.db, f.ctx, MANAGER, id, { at: at(12) });
      const v = await readWorkflowView(f.db, f.ctx, id);
      assert.equal(v.executionCompleted, true);
      assert.equal(v.closeoutCompleted, false);
      assert.equal(v.closedAt, null);
      assert.notEqual(v.lifecycleState, "CLOSED");
      assert.equal(v.outcome, null);
      const types = await eventTypes(f.db, id);
      assert.ok(!types.includes("CLOSEOUT_COMPLETED") && !types.includes("OUTCOME_RECORDED"));
      // archiving twice is harmless
      await archiveToHistory(f.db, f.ctx, MANAGER, id, { at: at(13) }).catch(() => undefined);
      assert.equal((await readWorkflowView(f.db, f.ctx, id)).closeoutCompleted, false);
    }));

  it("4B-D5: a pause never moves the target dates; reactivation re-evaluates against the ORIGINAL target (At Risk allowed)", () =>
    withFixture(async (f) => {
      const id = await startedCandidate(f);
      await updateProgress(f.db, f.ctx, OWNER_USER, id, { actionCompletionPct: 30, at: at(5) });
      const before = await f.db.iamCoreActionTracking.findUniqueOrThrow({ where: { candidateId: id } });
      await requestPause(f.db, f.ctx, OWNER_USER, id, { reason: "Freeze", expectedDurationDays: 12, at: at(6) });
      await decidePause(f.db, f.ctx, MANAGER, id, { decision: "APPROVE", reason: "ok", at: at(7) });
      const paused = await f.db.iamCoreActionTracking.findUniqueOrThrow({ where: { candidateId: id } });
      assert.equal(paused.targetResolution?.getTime(), before.targetResolution?.getTime(), "pause does not extend the target");
      assert.equal(paused.targetStart?.getTime(), before.targetStart?.getTime());
      await reactivateAction(f.db, f.ctx, OWNER_USER, id, { at: at(19) });
      const after = await f.db.iamCoreActionTracking.findUniqueOrThrow({ where: { candidateId: id } });
      assert.equal(after.targetResolution?.getTime(), before.targetResolution?.getTime(), "reactivation does not extend the target");
      assert.equal(after.actionStatus, "AT_RISK", "re-evaluated against the original target, not an extended one");
    }));

  it("4B-D6: no score or rank is created anywhere in Stage 4B events or state", () =>
    withFixture(async (f) => {
      const id = await startedCandidate(f);
      await completeAction(f.db, f.ctx, OWNER_USER, id, { at: at(10) });
      for (const p of await payloadsOf(f.db, id)) {
        const flat = JSON.stringify(p);
        assert.ok(!/domainScore|domainRank|healthScore/i.test(flat), "no score / rank key in any event payload");
      }
      const rec = await f.db.iamCoreSystemRecommendation.findFirstOrThrow({ where: { candidateId: id } });
      assert.equal(rec.domainScore, null);
      assert.equal(rec.domainRank, null);
    }));
});
