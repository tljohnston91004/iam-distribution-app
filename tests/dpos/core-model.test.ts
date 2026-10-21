import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { assignOwnership, createCandidate, decidePlan, proposePlan, readCandidate, recordCloseout, recordSystemRecommendation, saveExecutionState, saveOutcomeStructure, setLifecycleState } from "../../src/lib/dpos/core";
import type { DposCompanyContext } from "../../src/lib/dpos/company-context";
import { DposError } from "../../src/lib/dpos/errors";
import { boundContext, createTestDb, makeConfig, uuid, type TestDb } from "./helpers";

async function code(fn: () => Promise<unknown>): Promise<string> {
  try {
    await fn();
  } catch (e) {
    if (e instanceof DposError) return e.code;
    return "RAW:" + (e instanceof Error ? e.message.split("\n").pop() : String(e));
  }
  return "NO_ERROR";
}

describe("canonical IAM core persistence (structure only)", () => {
  let t: TestDb;
  let ctx: DposCompanyContext;
  before(async () => {
    t = await createTestDb();
    ctx = await boundContext(t.prisma, makeConfig());
  });
  after(async () => t.close());

  it("keeps A identity, B system recommendation, C management-approved plan, D ownership, E execution state and F outcome in separate tables", async () => {
    const cand = await createCandidate(t.prisma, ctx, { groupedConditionKey: "EXCESS|VENDOR:ACME|DEPT:PLUMBING", groupedCondition: { kind: "EXCESS" }, sourceRunId: "legacy-run-or-null", evidenceRefs: ["evidence:1"] });
    assert.equal(cand.lifecycleState, "CANDIDATE");
    assert.equal(cand.closedAt, null);
    assert.equal(cand.recurrenceOfCandidateId, null);

    const rec = await recordSystemRecommendation(t.prisma, ctx, cand.candidateId, { recommendedActionDirection: "REDUCE_STOCK", title: "Reduce Acme excess", recommendedBy: "system", domainScore: 71.5, domainRank: 3 });
    assert.equal(rec.recommendationVersion, 1);
    const plan = await proposePlan(t.prisma, ctx, cand.candidateId, { createdBy: "mgr-1", planSummary: "Return to vendor + markdown" });
    assert.equal(plan.basedOnRecommendationId, rec.recommendationId);
    assert.equal(plan.approvalState, "PROPOSED");
    const approved = await decidePlan(t.prisma, ctx, plan.planId, { approver: "owner-1", decision: "APPROVED", deviatesFromRecommendation: true, deviationReason: "Vendor will not accept returns" });
    assert.equal(approved.approvalState, "APPROVED");
    assert.equal(approved.deviatesFromRecommendation, true);

    const own = await assignOwnership(t.prisma, ctx, cand.candidateId, { responsibleDepartment: "Purchasing", taskOwnerId: "u-9", taskOwnerName: "Pat", contributors: [{ userId: "u-10" }], assignedBy: "mgr-1" });
    assert.equal(own.contributors.length, 1);
    await saveExecutionState(t.prisma, ctx, cand.candidateId, { actionStatus: "ON_TRACK", actionCompletionPct: 25, remainingExposure: 12345.67, remainingExposureUnit: "USD" });
    await saveOutcomeStructure(t.prisma, ctx, cand.candidateId, { measuredResult: { note: "supplied, not computed" }, attributionConfidence: undefined });

    const full = await readCandidate(t.prisma, ctx, cand.candidateId);
    assert.equal(full.recommendations.length, 1);
    assert.equal(full.managementPlans.length, 1);
    assert.equal(full.ownerships.length, 1);
    assert.ok(full.executionState && full.outcome);

    // the system recommendation was NOT overwritten by the approved plan / deviation
    const recAfter = full.recommendations[0]!;
    assert.equal(recAfter.recommendedActionDirection, "REDUCE_STOCK");
    assert.equal(recAfter.title, "Reduce Acme excess");
    assert.equal(recAfter.domainScore, 71.5);
    assert.equal(full.managementPlans[0]!.planSummary, "Return to vendor + markdown");
    // E/F hold exactly what was supplied — nothing is calculated in Stage 4A
    assert.equal(full.executionState!.remainingExposure, 12345.67);
    assert.equal(full.executionState!.conditionReductionPct, null);
    assert.equal(full.outcome!.finalResolutionState, null);
    assert.equal(full.outcome!.closeoutAt, null);
  });

  it("the system recommendation is immutable (database-enforced); a revised recommendation is a new version", async () => {
    const cand = await createCandidate(t.prisma, ctx, { groupedConditionKey: "SHORT|SKU:1" });
    const v1 = await recordSystemRecommendation(t.prisma, ctx, cand.candidateId, { recommendedActionDirection: "EXPEDITE", recommendedBy: "system" });
    await assert.rejects(() => t.prisma.iamCoreSystemRecommendation.update({ where: { recommendationId: v1.recommendationId }, data: { title: "tampered" } }));
    await assert.rejects(() => t.prisma.iamCoreSystemRecommendation.delete({ where: { recommendationId: v1.recommendationId } }));
    const v2 = await recordSystemRecommendation(t.prisma, ctx, cand.candidateId, { recommendedActionDirection: "EXPEDITE_AND_SPLIT", recommendedBy: "system" });
    assert.equal(v2.recommendationVersion, 2);
    const all = await t.prisma.iamCoreSystemRecommendation.findMany({ where: { candidateId: cand.candidateId }, orderBy: { recommendationVersion: "asc" } });
    assert.deepEqual(all.map((r) => r.recommendedActionDirection), ["EXPEDITE", "EXPEDITE_AND_SPLIT"]);
  });

  it("a plan that deviates from the recommendation must say why; approving a new plan supersedes (never edits) the old one", async () => {
    const cand = await createCandidate(t.prisma, ctx, { groupedConditionKey: "DEAD|SKU:2" });
    await recordSystemRecommendation(t.prisma, ctx, cand.candidateId, { recommendedActionDirection: "LIQUIDATE", recommendedBy: "system" });
    const p1 = await proposePlan(t.prisma, ctx, cand.candidateId, { createdBy: "m" });
    assert.equal(await code(() => decidePlan(t.prisma, ctx, p1.planId, { approver: "o", decision: "APPROVED", deviatesFromRecommendation: true })), "DEVIATION_REASON_REQUIRED");
    await decidePlan(t.prisma, ctx, p1.planId, { approver: "o", decision: "APPROVED" });
    const p2 = await proposePlan(t.prisma, ctx, cand.candidateId, { createdBy: "m", planSummary: "revised" });
    await decidePlan(t.prisma, ctx, p2.planId, { approver: "o", decision: "APPROVED" });
    const plans = await t.prisma.iamCoreManagementPlan.findMany({ where: { candidateId: cand.candidateId }, orderBy: { planVersion: "asc" } });
    assert.deepEqual(plans.map((p) => p.approvalState), ["SUPERSEDED", "APPROVED"]);
    assert.equal(await code(() => decidePlan(t.prisma, ctx, p1.planId, { approver: "o", decision: "APPROVED" })), "PLAN_NOT_PENDING");
  });

  it("a plan requires a system recommendation to be based on", async () => {
    const cand = await createCandidate(t.prisma, ctx, { groupedConditionKey: "SLOW|SKU:3" });
    assert.equal(await code(() => proposePlan(t.prisma, ctx, cand.candidateId, { createdBy: "m" })), "RECOMMENDATION_REQUIRED");
  });

  it("reassigning ownership ends the previous assignment (history kept)", async () => {
    const cand = await createCandidate(t.prisma, ctx, { groupedConditionKey: "EXCESS|SKU:4" });
    await assignOwnership(t.prisma, ctx, cand.candidateId, { responsibleDepartment: "Purchasing", assignedBy: "m", assignedAt: new Date("2026-10-01T00:00:00Z") });
    await assignOwnership(t.prisma, ctx, cand.candidateId, { responsibleDepartment: "Sales", assignedBy: "m", assignedAt: new Date("2026-10-05T00:00:00Z") });
    const rows = await t.prisma.iamCoreOwnership.findMany({ where: { candidateId: cand.candidateId }, orderBy: { assignedAt: "asc" } });
    assert.deepEqual(rows.map((r) => [r.responsibleDepartment, r.endedAt?.toISOString() ?? null]), [["Purchasing", "2026-10-05T00:00:00.000Z"], ["Sales", null]]);
  });

  it("validates vocabularies and ranges but calculates nothing", async () => {
    const cand = await createCandidate(t.prisma, ctx, { groupedConditionKey: "EXCESS|SKU:5" });
    assert.equal(await code(() => saveExecutionState(t.prisma, ctx, cand.candidateId, { actionStatus: "WINNING" })), "VOCABULARY_VIOLATION");
    assert.equal(await code(() => saveExecutionState(t.prisma, ctx, cand.candidateId, { actionCompletionPct: 140 })), "OUT_OF_RANGE");
    assert.equal(await code(() => setLifecycleState(t.prisma, ctx, cand.candidateId, "SUPER_CLOSED")), "VOCABULARY_VIOLATION");
    assert.equal(await code(() => saveOutcomeStructure(t.prisma, ctx, cand.candidateId, { finalResolutionState: "NAILED_IT" })), "VOCABULARY_VIOLATION");
    const st = await saveExecutionState(t.prisma, ctx, cand.candidateId, { actionStatus: "AT_RISK", actionCompletionPct: 10 });
    assert.equal(st.actionStatus, "AT_RISK");
    assert.equal(st.conditionReductionPct, null, "never inferred");
    assert.equal(await code(() => createCandidate(t.prisma, ctx, { groupedConditionKey: "  " })), "GROUPED_CONDITION_REQUIRED");
  });

  describe("closed candidates and recurrence", () => {
    let closedId: string;
    const KEY = "EXCESS|VENDOR:CLOSED-TEST";
    before(async () => {
      const c = await createCandidate(t.prisma, ctx, { groupedConditionKey: KEY });
      await recordSystemRecommendation(t.prisma, ctx, c.candidateId, { recommendedActionDirection: "REDUCE_STOCK", recommendedBy: "system" });
      await assignOwnership(t.prisma, ctx, c.candidateId, { responsibleDepartment: "Purchasing", assignedBy: "m" });
      await saveExecutionState(t.prisma, ctx, c.candidateId, { actionStatus: "COMPLETED", actionCompletionPct: 100 });
      closedId = c.candidateId;
      const closed = await recordCloseout(t.prisma, ctx, c.candidateId, { finalResolutionState: "FULLY_RESOLVED", closeoutAt: new Date("2026-10-10T00:00:00Z") });
      assert.equal(closed.lifecycleState, "CLOSED");
      assert.equal(closed.closedAt?.toISOString(), "2026-10-10T00:00:00.000Z");
    });

    it("a closed candidate is never silently reopened or changed — at the service layer", async () => {
      for (const fn of [
        () => setLifecycleState(t.prisma, ctx, closedId, "ACTIVE"),
        () => saveExecutionState(t.prisma, ctx, closedId, { actionStatus: "AT_RISK" }),
        () => saveOutcomeStructure(t.prisma, ctx, closedId, { finalResolutionState: "UNSUCCESSFUL" }),
        () => recordSystemRecommendation(t.prisma, ctx, closedId, { recommendedActionDirection: "X", recommendedBy: "s" }),
        () => assignOwnership(t.prisma, ctx, closedId, { responsibleDepartment: "Sales", assignedBy: "m" }),
        () => proposePlan(t.prisma, ctx, closedId, { createdBy: "m" }),
        () => recordCloseout(t.prisma, ctx, closedId, { finalResolutionState: "FULLY_RESOLVED" }),
      ]) {
        assert.equal(await code(fn), "CLOSED_CANDIDATE_NO_REOPEN");
      }
    });

    it("…and at the database layer (triggers), so no code path can reopen it", async () => {
      await assert.rejects(() => t.prisma.iamCoreCandidate.update({ where: { candidateId: closedId }, data: { closedAt: null } }));
      await assert.rejects(() => t.prisma.iamCoreCandidate.update({ where: { candidateId: closedId }, data: { lifecycleState: "ACTIVE" } }));
      await assert.rejects(() => t.prisma.iamCoreCandidate.delete({ where: { candidateId: closedId } }));
      await assert.rejects(() => t.prisma.iamCoreExecutionState.update({ where: { candidateId: closedId }, data: { actionStatus: "BLOCKED" } }));
      await assert.rejects(() => t.prisma.iamCoreOutcome.update({ where: { candidateId: closedId }, data: { finalResolutionState: "UNSUCCESSFUL" } }));
      await assert.rejects(() => t.prisma.iamCoreSystemRecommendation.create({ data: { candidateId: closedId, recommendationVersion: 99, recommendedActionDirection: "X", recommendedBy: "s", recommendedAt: new Date() } }));
      const still = await readCandidate(t.prisma, ctx, closedId);
      assert.equal(still.lifecycleState, "CLOSED");
      assert.equal(still.outcome?.finalResolutionState, "FULLY_RESOLVED");
    });

    it("a recurrence is a NEW candidate linked to the closed one; the closed one is untouched", async () => {
      const again = await createCandidate(t.prisma, ctx, { groupedConditionKey: KEY });
      assert.notEqual(again.candidateId, closedId);
      assert.equal(again.recurrenceOfCandidateId, closedId);
      assert.equal(again.closedAt, null);
      assert.equal(again.lifecycleState, "CANDIDATE");
      assert.equal(await code(() => createCandidate(t.prisma, ctx, { groupedConditionKey: KEY })), "CANDIDATE_ALREADY_OPEN", "only one open candidate per grouped condition");
      assert.equal(await code(() => createCandidate(t.prisma, ctx, { groupedConditionKey: "OTHER|KEY", recurrenceOfCandidateId: closedId })), "RECURRENCE_CONDITION_MISMATCH");
      assert.equal(await code(() => createCandidate(t.prisma, ctx, { groupedConditionKey: "ANOTHER|KEY", recurrenceOfCandidateId: again.candidateId })), "RECURRENCE_TARGET_NOT_CLOSED");
      const original = await readCandidate(t.prisma, ctx, closedId);
      assert.equal(original.lifecycleState, "CLOSED");
      assert.equal(original.recommendations.length, 1);
    });

    it("the one-open-per-condition rule is also enforced by the database", async () => {
      const open = await t.prisma.iamCoreCandidate.findFirstOrThrow({ where: { groupedConditionKey: KEY, closedAt: null } });
      await assert.rejects(() =>
        t.prisma.iamCoreCandidate.create({ data: { dposCompanyId: ctx.dposCompanyId, groupedConditionKey: KEY, lifecycleState: "CANDIDATE", originalCreatedAt: new Date() } }),
      );
      assert.ok(open);
    });
  });

  it("candidate identity is immutable and company-scoped", async () => {
    const cand = await createCandidate(t.prisma, ctx, { groupedConditionKey: "EXCESS|SKU:ISO" });
    await assert.rejects(() => t.prisma.iamCoreCandidate.update({ where: { candidateId: cand.candidateId }, data: { groupedConditionKey: "changed" } }));
    await assert.rejects(() => t.prisma.iamCoreCandidate.update({ where: { candidateId: cand.candidateId }, data: { dposCompanyId: uuid() } }));
    const other: DposCompanyContext = { ...ctx, dposCompanyId: uuid() };
    assert.equal(await code(() => readCandidate(t.prisma, other, cand.candidateId)), "CANDIDATE_NOT_FOUND");
    assert.equal(await code(() => recordSystemRecommendation(t.prisma, other, cand.candidateId, { recommendedActionDirection: "X", recommendedBy: "s" })), "CANDIDATE_NOT_FOUND");
  });

  it("legacy V1.5 records stay readable and are never promoted to authoritative candidates; the new model has no foreign key into V1.5 tables", async () => {
    const run = await t.prisma.iamRun.create({ data: { companyId: ctx.iamCompanyId, runName: "Legacy test board", reviewDate: new Date("2026-05-01"), reviewWeekStart: new Date("2026-04-27"), reviewWeekEnd: new Date("2026-05-03") } });
    const legacyBefore = await t.prisma.iamRun.findUniqueOrThrow({ where: { id: run.id } });
    assert.equal(await t.prisma.iamCoreCandidate.count({ where: { sourceRunId: run.id } }), 0, "creating/keeping a legacy run creates no candidate");
    const cand = await createCandidate(t.prisma, ctx, { groupedConditionKey: "EXCESS|SKU:LEGACYREF", sourceRunId: run.id });
    assert.equal(cand.sourceRunId, run.id, "a loose reference (no FK) records provenance");
    assert.deepEqual(await t.prisma.iamRun.findUniqueOrThrow({ where: { id: run.id } }), legacyBefore, "legacy record untouched");
    const fks = (await t.prisma.$queryRawUnsafe(`SELECT m.name AS tbl, f."table" AS ref FROM sqlite_master m, pragma_foreign_key_list(m.name) f WHERE m.type='table' AND (m.name LIKE 'iam_core_%' OR m.name LIKE 'dpos_%')`)) as Array<{ tbl: string; ref: string }>;
    const legacyTables = new Set(((await t.prisma.$queryRawUnsafe(`SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'iam_core_%' AND name NOT LIKE 'dpos_%' AND name NOT LIKE '\\_%' ESCAPE '\\' AND name NOT LIKE 'sqlite_%'`)) as Array<{ name: string }>).map((r) => r.name));
    const bad = fks.filter((f) => legacyTables.has(f.ref));
    assert.deepEqual(bad, [], "no iam_core_*/dpos_* table references a V1.5 table");
  });
});
