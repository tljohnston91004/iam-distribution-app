/**
 * LIVE integration proof for Stage 4B: the governed workflow (candidate -> management decision -> ownership -> active
 * action -> escalation -> completion) writes Results Return events through the 4A outbox, the REAL DPOS Data Hub application
 * (`buildDataHubApp`, own migrated SQLite database, loopback HTTP) acknowledges every one of them, and Data Hub's
 * current-state projection can represent the 4B workflow without any contract change.
 *
 * Skipped (visibly) when the DPOS repository or its dependencies are not available (set DPOS_REPO_ROOT).
 */
import type { PrismaClient } from "@prisma/client";
import assert from "node:assert/strict";
import { execSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { after, before, describe, it } from "node:test";
import type { DposCompanyContext } from "../../src/lib/dpos/company-context";
import { DataHubClient } from "../../src/lib/dpos/data-hub-client";
import { flushOutbox, summarizeOutbox } from "../../src/lib/dpos/outbox";
import { WorkshopServiceIdentityProvider, issueServiceIdentity } from "../../src/lib/dpos/service-identity";
import {
  acceptOwnership,
  approveCandidate,
  archiveToHistory,
  clearBlocker,
  completeAction,
  decidePause,
  ingestGovernedEvidence,
  presentCandidate,
  rejectCandidate,
  raiseBlocker,
  reactivateAction,
  reassign,
  releaseSuppression,
  requestDiscussion,
  requestPause,
  startAction,
  suppressCandidate,
  updateConditionReduction,
  updateProgress,
  validateCompletion,
} from "../../src/lib/dpos/workflow";
import { boundContext, createTestDb, DEFAULT_COMPANY_ID, findDposRoot, makeConfig, type TestDb } from "./helpers";
import { DAY, MANAGER, OWNER_USER, PLAN, describeGroup, evidence } from "./workflow-helpers";

const dposRoot = findDposRoot();
const hubRoot = dposRoot ? path.join(dposRoot, "services", "data-hub") : null;
const skip = !dposRoot || !hubRoot || !fs.existsSync(path.join(hubRoot, "src", "api", "app.ts")) || !fs.existsSync(path.join(dposRoot, "node_modules"))
  ? "DPOS repository (with installed dependencies) not found - set DPOS_REPO_ROOT"
  : false;

// Real-time anchored (Data Hub validates producer times), all strictly in the past.
const BASE = Date.now() - 30 * DAY;
const t = (days: number, hours = 0) => new Date(BASE + days * DAY + hours * 3_600_000);
const d = (days: number) => t(days).toISOString().slice(0, 10);
describe("live Data Hub: Stage 4B workflow events (real DPOS application over HTTP)", { skip }, () => {
  let iam: TestDb;
  let hubDir = "";
  let hubDb: { $disconnect(): Promise<void>; iamCandidateCurrentState: { findMany(a?: unknown): Promise<any[]> }; iamResultsReturnSubmission: { count(a?: unknown): Promise<number> } };
  let app: { listen(o: unknown): Promise<string>; close(): Promise<void>; inject(o: unknown): Promise<{ statusCode: number; body: string; json(): any }> };
  let baseUrl = "";
  let ctx: DposCompanyContext;
  let config: ReturnType<typeof makeConfig>;
  let identityId = "";
  let genericOnlyId = "";
  let client: DataHubClient;
  let deps: { db: PrismaClient; config: ReturnType<typeof makeConfig>; context: DposCompanyContext; client: DataHubClient };
  let eligible = true;
  const operatorId = randomUUID();
  const hdr = () => ({ "x-identity-id": operatorId, "x-user-id": operatorId, "x-company-id": DEFAULT_COMPANY_ID, "x-correlation-id": randomUUID() });

  before(async () => {
    const mod = (rel: string) => import(pathToFileURL(path.join(hubRoot!, "src", rel)).href);
    hubDir = fs.mkdtempSync(path.join(os.tmpdir(), "iam4b-live-hub-"));
    const dbUrl = `file:${path.join(hubDir, "hub.db").replace(/\\/g, "/")}`;
    (process.env as Record<string, string | undefined>).NODE_ENV = "test";
    process.env.DATA_HUB_DATABASE_URL = dbUrl;
    execSync("npx prisma migrate deploy --schema prisma/schema.prisma", { cwd: hubRoot!, stdio: "pipe", env: { ...process.env, DATA_HUB_DATABASE_URL: dbUrl } });

    const [{ buildDataHubApp }, { createDataHubPrisma }, { createDataHubBus }, ports, { InProcessOutboxDelivery }, loc, lic, { LocalStorageAdapter }, seedA, seedB, types] = await Promise.all([
      mod("api/app.ts"), mod("db/prisma.ts"), mod("events/outbox.ts"), mod("integrations/ports.ts"), mod("integrations/eaas-delivery.ts"),
      mod("integrations/company-location-port.ts"), mod("integrations/company-license-port.ts"), mod("adapters/storage/local-storage.ts"),
      mod("seed/seed-validation-rules.ts"), mod("seed/seed-bp005a-rules.ts"), mod("domain/types.ts"),
    ]);
    const hub = createDataHubPrisma(dbUrl);
    hubDb = hub;
    await seedA.seedValidationRules(hub);
    await seedB.seedBp005aRules(hub);

    // IAM side: governed company + a real (workshop) service identity.
    iam = await createTestDb();
    const base = makeConfig();
    ctx = await boundContext(iam.prisma, base);
    const rec = await issueServiceIdentity(iam.prisma, base, new WorkshopServiceIdentityProvider(), { actor: "op", issuanceKind: "WORKSHOP" });
    identityId = rec.identityId;

    const permissions = new ports.AllowlistPermissionPort();
    permissions.grant(operatorId, types.ALL_DATAHUB_PERMISSION_KEYS);
    // The Data Hub operator's grants for the IAM service principal (4A-D2): Results Return plus ONLY the dedicated
    // governed-input read capability. No generic source / canonical / lineage read is granted.
    permissions.grant(identityId, [
      types.PermissionKeys.IAM_RESULTS_RETURN_WRITE,
      types.PermissionKeys.IAM_RESULTS_RETURN_READ,
      types.PermissionKeys.IAM_GOVERNED_INPUT_READ,
    ]);
    // A registered IAM service principal holding only the generic read keys (must NOT be able to read the IAM inputs).
    genericOnlyId = `iam-svc-${randomUUID()}`;
    permissions.grant(genericOnlyId, [types.PermissionKeys.SOURCE_READ, types.PermissionKeys.CANONICAL_READ, types.PermissionKeys.LINEAGE_READ]);
    const storage = new LocalStorageAdapter(path.join(hubDir, "storage"));
    await storage.ensureReady();
    const license = new lic.InMemoryCompanyLicensePort();
    license.seed(DEFAULT_COMPANY_ID, { licensedModules: [], enabledModules: [], timeZone: "America/Chicago" });
    ({ app } = await buildDataHubApp({
      db: hub,
      bus: createDataHubBus(new InProcessOutboxDelivery()),
      permissionPort: permissions,
      storage,
      productAdminIdentityIds: new Set(),
      companyLocationPort: new loc.InMemoryCompanyLocationPort(),
      companyLicensePort: license,
      iamResultsReturnServiceIdentityIds: new Set([identityId, genericOnlyId]),
      iamResultsReturnEligibility: {
        async check() {
          return eligible ? { eligible: true } : { eligible: false, code: "IAM_MODULE_NOT_ENABLED", detail: "IAM is not enabled for this company" };
        },
      },
    }));
    baseUrl = (await app.listen({ port: 0, host: "127.0.0.1" })).replace("[::1]", "127.0.0.1");

    config = makeConfig({ DATA_HUB_BASE_URL: new URL(baseUrl).origin, IAM_SERVICE_IDENTITY_ID: identityId });
    client = new DataHubClient({ config, identity: { identityId, credentialRef: null } });
    deps = { db: iam.prisma as PrismaClient, config, context: ctx, client };
  });

  after(async () => {
    try {
      await app?.close();
    } catch {
      /* already closed */
    }
    await hubDb?.$disconnect();
    await iam?.close();
    if (hubDir) fs.rmSync(hubDir, { recursive: true, force: true });
  });

  async function drainOutbox(): Promise<void> {
    for (let i = 0; i < 40; i++) {
      await flushOutbox(deps);
      if (!(await iam.prisma.dposResultsReturnOutbox.count({ where: { syncStatus: { in: ["PENDING", "SYNC_PENDING_RETRY"] } } }))) break;
    }
  }
  const outboxFor = (candidateId: string) => iam.prisma.dposResultsReturnOutbox.findMany({ where: { candidateId }, orderBy: { createdAt: "asc" } });

  it("the whole 4B workflow is acknowledged by the real Data Hub and its current state represents ownership, action, progress and escalation", async () => {
    const db = iam.prisma as PrismaClient;
    const created = await ingestGovernedEvidence(db, ctx, MANAGER, {
      evidence: [evidence("1"), evidence("2"), evidence("3")],
      sourceRunId: "live-run-1",
      describe: describeGroup(),
      at: t(0),
    });
    const id = created.groups[0]!.candidateId;
    await presentCandidate(db, ctx, MANAGER, id, { at: t(0, 1) });
    await approveCandidate(db, ctx, MANAGER, id, {
      plan: PLAN,
      assignment: { responsibleDepartment: "Purchasing", taskOwnerId: OWNER_USER.actorId, taskOwnerName: "Olivia Owner" },
      targetStart: d(1),
      targetResolution: d(29),
      baselineExposure: 1000,
      exposureUnit: "USD",
      at: t(0, 2),
    });
    const hubState = async () => (await hubDb.iamCandidateCurrentState.findMany({ where: { candidateId: id } }))[0]!;

    // grouped candidate + approval + assignment + acceptance -> explicit NOT_STARTED (4B-D3), live
    await acceptOwnership(db, ctx, OWNER_USER, id, { at: t(0, 3) });
    await drainOutbox();
    let live = await hubState();
    assert.equal(live.actionStatus, "NOT_STARTED", "accepted but not started: the Data Hub shows NOT_STARTED, not null");
    assert.equal(live.actionStartedAt, null);
    assert.equal(live.executionCompleted, false);

    await startAction(db, ctx, OWNER_USER, id, { at: t(1) });
    await updateProgress(db, ctx, OWNER_USER, id, { actionCompletionPct: 40, nextMilestone: "Vendor confirmation", at: t(5) });
    await updateConditionReduction(db, ctx, OWNER_USER, id, { currentExposure: 600, at: t(5, 6) });
    await drainOutbox();
    live = await hubState();
    assert.equal(live.actionStatus, "ON_TRACK", "the start moved the action off NOT_STARTED");
    assert.equal(live.actionStartedAt?.toISOString(), t(1).toISOString(), "4B-D1: start time projected");
    assert.equal(live.actionCompletionPct, 40);
    assert.ok(live.conditionReductionPct !== null && live.conditionReductionPct !== undefined);

    // management decision required: explicit true, then explicit resolution (4B-D2), live
    await raiseBlocker(db, ctx, OWNER_USER, id, { reason: "Vendor portal down", at: t(6) });
    await drainOutbox();
    live = await hubState();
    assert.equal(live.managementDecisionRequired, true);
    assert.ok(live.decisionRequiredCategory && live.decisionRequiredReason && live.decisionRequiredAt && live.decisionRequiredEventId);
    assert.equal(live.decisionResolvedAt, null);
    assert.equal(live.actionStartedAt?.toISOString(), t(1).toISOString(), "4B-D1: later events do not erase the start time");
    await clearBlocker(db, ctx, OWNER_USER, id, { at: t(7) });
    await drainOutbox();
    live = await hubState();
    assert.equal(live.managementDecisionRequired, false, "explicit resolution clears the active state");
    assert.ok(live.decisionResolvedAt, "resolution time recorded");
    assert.equal(live.decisionRequiredReason, null, "the active requirement fields are cleared");
    assert.equal(await hubDb.iamResultsReturnSubmission.count({ where: { candidateId: id, eventType: "MANAGEMENT_DECISION_REQUIRED", outcome: "ACCEPTED" } }), 1, "the historical REQUIRED event is retained");

    // pause -> reactivation
    await requestPause(db, ctx, OWNER_USER, id, { reason: "Receiving freeze", expectedDurationDays: 3, at: t(8) });
    await decidePause(db, ctx, MANAGER, id, { decision: "APPROVE", reason: "Approved", at: t(9) });
    await drainOutbox();
    live = await hubState();
    assert.equal(live.actionStatus, "PAUSED");
    assert.equal(live.managementDecisionRequired, false, "the pause decision resolved its own requirement");
    await reactivateAction(db, ctx, OWNER_USER, id, { at: t(12) });
    await drainOutbox();
    live = await hubState();
    assert.notEqual(live.actionStatus, "PAUSED");
    assert.equal(live.actionStartedAt?.toISOString(), t(1).toISOString());

    // completion -> validation -> Completed History: execution complete, NOT formally closed (4B-D4)
    await completeAction(db, ctx, OWNER_USER, id, { at: t(14) });
    await validateCompletion(db, ctx, MANAGER, id, { finalResolutionStatus: "FULLY_RESOLVED", at: t(15) });
    await archiveToHistory(db, ctx, MANAGER, id, { at: t(16) });

    const rows = await outboxFor(id);
    assert.ok(rows.length >= 15, `expected the full lifecycle events, got ${rows.length}`);
    await drainOutbox();
    for (const r of await outboxFor(id)) {
      assert.equal(r.syncStatus, "SYNCED", `${r.eventType}: ${r.failureCode ?? ""} ${r.failureReason ?? ""}`);
      assert.ok(r.acknowledgementId && r.acceptedAt, "real acknowledgement recorded");
      assert.equal(JSON.parse(r.acknowledgementJson!).processingResult, "ACCEPTED");
    }
    assert.equal(await hubDb.iamResultsReturnSubmission.count({ where: { candidateId: id, outcome: "ACCEPTED" } }), rows.length);

    const states = await hubDb.iamCandidateCurrentState.findMany({ where: { candidateId: id } });
    assert.equal(states.length, 1, "one current state for the candidate");
    const s = states[0]!;
    assert.equal(s.candidateCreatedSeen, true);
    assert.equal(s.responsibleDepartment, "Purchasing");
    assert.equal(s.taskOwner, "Olivia Owner");
    assert.ok(s.ownerAcceptedAt, "owner acceptance represented");
    // 4B-D1 (was finding DH-4B-F1): both dates are preserved in the current state after every later event
    assert.equal(s.actionStartedAt?.toISOString(), t(1).toISOString(), "actionStartedAt preserved to the end");
    assert.equal(s.actionCompletedAt?.toISOString(), t(14).toISOString(), "actionCompletedAt preserved to the end");
    // 4B-D4: execution completed is not formal closeout
    assert.equal(s.executionCompleted, true);
    assert.equal(s.closeoutCompleted, false);
    assert.equal(s.actionStatus, "COMPLETED");
    // 4B-D6: no score or rank was invented
    assert.equal(s.domainScore, null);
    assert.equal(s.domainRank, null);
    assert.equal(s.actionCompletionPct, 100, "completion percentage tracked");
    assert.ok(s.conditionReductionPct !== null && s.conditionReductionPct !== undefined, "condition reduction tracked separately");
    assert.ok(s.managementPlanJson, "versioned management plan represented");
    assert.equal(s.decisionBy, MANAGER.actorId);
    assert.equal(s.managementDecisionRequired, false, "the completion validation requirement was explicitly resolved");
    assert.equal(s.decisionRequiredReason, null, "no active requirement remains");
    assert.ok(s.decisionResolvedAt, "the last resolution is recorded");
    assert.ok((await hubDb.iamResultsReturnSubmission.count({ where: { candidateId: id, eventType: "MANAGEMENT_DECISION_REQUIRED", outcome: "ACCEPTED" } })) >= 3, "every requirement event is retained as history");
    assert.equal(s.closeoutState, "OPEN", "Data Hub closes a candidate only after CLOSEOUT_COMPLETED (Stage 4C), which 4B never sends");
    assert.equal(s.recommendationVersion, 1);
    assert.ok(s.systemRecommendationJson, "original system recommendation kept separate from the management plan");

    // idempotent replay of an accepted event: no second accepted submission, no state change
    const first = (await outboxFor(id))[0]!;
    const replay = await client.submitResultsReturnEvent(first.payloadJson);
    assert.equal(replay.acknowledgement?.duplicate, true);
    assert.equal(await hubDb.iamResultsReturnSubmission.count({ where: { candidateId: id, outcome: "ACCEPTED" } }), rows.length);
    assert.equal((await summarizeOutbox(iam.prisma, ctx.dposCompanyId)).counts.PENDING ?? 0, 0);
    // The workflow never generated RSE/PRE board work: IAM holds no V1.5 run and the Hub only holds the candidate state.
    assert.equal(await iam.prisma.iamRun.count(), 0);
  });

  it("rejection, suppression, release, owner discussion and recurrence are acknowledged and represented", async () => {
    const db = iam.prisma as PrismaClient;
    const key = { conditionKey: "Excess open purchase orders - Vendor LIVE-B" };
    const first = (await ingestGovernedEvidence(db, ctx, MANAGER, { evidence: [evidence("b1", key)], sourceRunId: "live-run-2", describe: describeGroup(), at: t(20) })).groups[0]!.candidateId;
    await presentCandidate(db, ctx, MANAGER, first, { at: t(20, 1) });
    await rejectCandidate(db, ctx, MANAGER, first, { reason: "Not now.", at: t(20, 2) });
    const second = (await ingestGovernedEvidence(db, ctx, MANAGER, { evidence: [evidence("b1", key)], sourceRunId: "live-run-3", describe: describeGroup(), at: t(21) })).groups[0]!.candidateId;
    assert.notEqual(second, first, "a closed candidate is never reopened");
    await presentCandidate(db, ctx, MANAGER, second, { at: t(21, 1) });
    await suppressCandidate(db, ctx, MANAGER, second, { reason: "Defer one cycle", cycles: 1, at: t(21, 2) });
    await releaseSuppression(db, ctx, MANAGER, second, { reason: "Reconsider", at: t(22) });
    await approveCandidate(db, ctx, MANAGER, second, {
      plan: PLAN,
      assignment: { responsibleDepartment: "Purchasing", taskOwnerId: OWNER_USER.actorId, taskOwnerName: "Olivia Owner" },
      targetStart: d(23),
      targetResolution: d(40),
      at: t(22, 1),
    });
    await requestDiscussion(db, ctx, OWNER_USER, second, { note: "Vendor lead time concern", at: t(22, 2) });
    await reassign(db, ctx, MANAGER, second, { toOwnerId: "owner-2", toOwnerName: "Omar Owner", reason: "Reassigned after discussion", at: t(22, 3) });

    await drainOutbox();
    for (const id of [first, second]) {
      for (const r of await outboxFor(id)) assert.equal(r.syncStatus, "SYNCED", `${r.eventType}: ${r.failureCode ?? ""} ${r.failureReason ?? ""}`);
    }
    const types = new Set((await outboxFor(first)).concat(await outboxFor(second)).map((r) => r.eventType));
    for (const e of ["MANAGEMENT_REJECTED", "SUPPRESSED", "SUPPRESSION_RELEASED", "OWNER_DISCUSSION_REQUESTED", "RECURRENCE_LINKED", "TASK_OWNER_ASSIGNED"]) assert.ok(types.has(e), e);
    const s1 = (await hubDb.iamCandidateCurrentState.findMany({ where: { candidateId: first } }))[0]!;
    assert.ok(s1.decisionReason, "rejection reason represented");
    const s2 = (await hubDb.iamCandidateCurrentState.findMany({ where: { candidateId: second } }))[0]!;
    assert.equal(s2.recurrenceOfCandidateId, first, "recurrence is a new candidate linked to the closed one");
    assert.equal(s2.taskOwner, "Omar Owner", "reassignment replaces the current owner");
    assert.ok(s2.ownerDiscussionNote || s2.ownerDiscussionNote === null);
  });

  it("a Data Hub outage leaves workflow events pending and retryable; nothing is lost and nothing is duplicated", async () => {
    const db = iam.prisma as PrismaClient;
    const id = (await ingestGovernedEvidence(db, ctx, MANAGER, { evidence: [evidence("c1", { conditionKey: "Outage condition" })], sourceRunId: "live-run-4", describe: describeGroup(), at: t(25) })).groups[0]!.candidateId;
    const before = await outboxFor(id);
    assert.equal(before.length, 1);
    await app.close();
    await flushOutbox(deps);
    const cur = await iam.prisma.dposResultsReturnOutbox.findUniqueOrThrow({ where: { id: before[0]!.id } });
    assert.equal(cur.syncStatus, "SYNC_PENDING_RETRY");
    assert.equal(cur.retryEligible, true);
    assert.equal(cur.producerEventId, before[0]!.producerEventId);
  });
});
