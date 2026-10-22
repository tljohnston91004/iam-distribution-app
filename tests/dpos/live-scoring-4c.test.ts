/**
 * LIVE integration proof for Stage 4C: the IAM scoring run, domain ranking, governed priority controls, emergency decisions
 * and the Stage 4B governance events are written through the 4A outbox, the REAL DPOS Data Hub application
 * (`buildDataHubApp`, own migrated SQLite database, loopback HTTP) acknowledges every one of them, and the Data Hub's
 * current-state projection holds the IAM-published score, rank, band, flags and governance facts. Historical submissions
 * are retained, an accepted replay is idempotent, and no RSE/PRE board work is generated.
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
import { flushOutbox } from "../../src/lib/dpos/outbox";
import { WorkshopServiceIdentityProvider, issueServiceIdentity } from "../../src/lib/dpos/service-identity";
import { authorizeStrategic, confirmEmergency, lockRank, recordScoringInputs, runScoring, setPriorityOverride } from "../../src/lib/dpos/scoring";
import {
  SYSTEM_ACTOR,
  acceptOwnership,
  approveCandidate,
  decidePause,
  ingestGovernedEvidence,
  presentCandidate,
  reassign,
  requestPause,
  returnForReview,
  startAction,
  updateConditionReduction,
} from "../../src/lib/dpos/workflow";
import { boundContext, createTestDb, DEFAULT_COMPANY_ID, findDposRoot, makeConfig, type TestDb } from "./helpers";
import { DAY, MANAGER, OWNER_USER, PLAN, describeGroup, evidence } from "./workflow-helpers";
import { P41, P80, P89, ZERO, fromPoints, pts } from "./scoring-helpers";
const dposRoot = findDposRoot();
const hubRoot = dposRoot ? path.join(dposRoot, "services", "data-hub") : null;
const skip = !dposRoot || !hubRoot || !fs.existsSync(path.join(hubRoot, "src", "api", "app.ts")) || !fs.existsSync(path.join(dposRoot, "node_modules"))
  ? "DPOS repository (with installed dependencies) not found - set DPOS_REPO_ROOT"
  : false;

// Real-time anchored (Data Hub validates producer times), all strictly in the past.
const BASE = Date.now() - 30 * DAY;
const t = (days: number, hours = 0) => new Date(BASE + days * DAY + hours * 3_600_000);
const d = (days: number) => t(days).toISOString().slice(0, 10);
describe("live Data Hub: Stage 4C scoring and priority events (real DPOS application over HTTP)", { skip }, () => {
  let iam: TestDb;
  let hubDir = "";
  let hubDb: { $disconnect(): Promise<void>; iamCandidateCurrentState: { findMany(a?: unknown): Promise<any[]> }; iamCandidateScoringState: { findMany(a?: unknown): Promise<any[]> }; iamResultsReturnSubmission: { count(a?: unknown): Promise<number> } };
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
    hubDir = fs.mkdtempSync(path.join(os.tmpdir(), "iam4c-live-hub-"));
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

  /** A presented candidate with stored scoring inputs, anchored in real (past) time as the Data Hub requires. */
  async function candidate(key: string, inputs: ReturnType<typeof fromPoints>, day = 0): Promise<string> {
    const db = iam.prisma as PrismaClient;
    const r = await ingestGovernedEvidence(db, ctx, MANAGER, { evidence: [evidence(key, { conditionKey: `Live 4C condition ${key}` })], sourceRunId: `live4c-${key}`, describe: describeGroup(), at: t(day) });
    const id = r.groups[0]!.candidateId;
    await presentCandidate(db, ctx, MANAGER, id, { at: t(day, 1) });
    await recordScoringInputs(db, ctx, SYSTEM_ACTOR, id, inputs, { at: t(day, 2) });
    return id;
  }
  // Stage 4C scoring columns live in iam_candidate_scoring_state (own table: a governed UPDATE never alters the populated Stage 3/4B table).
  const hubState = async (id: string) => {
    const main = (await hubDb.iamCandidateCurrentState.findMany({ where: { candidateId: id } }))[0]!;
    const scoring = (await hubDb.iamCandidateScoringState.findMany({ where: { candidateId: id } }))[0] ?? {};
    return { ...main, ...scoring, iamCandidateStateId: main.iamCandidateStateId, createdAt: main.createdAt, updatedAt: main.updatedAt };
  };
  const accepted = (id: string, eventType: string) => hubDb.iamResultsReturnSubmission.count({ where: { candidateId: id, eventType, outcome: "ACCEPTED" } });
  const allSynced = async (ids: string[]) => {
    for (const id of ids) for (const r of await outboxFor(id)) assert.equal(r.syncStatus, "SYNCED", `${r.eventType}: ${r.failureCode ?? ""} ${r.failureReason ?? ""}`);
  };

  it("score and rank are accepted by the real Data Hub, current state follows the latest result, history is retained, replay is idempotent", async () => {
    const db = iam.prisma as PrismaClient;
    const a = await candidate("a", fromPoints(P89));
    const b = await candidate("b", fromPoints(P80));
    const c = await candidate("c", fromPoints(P41));
    const run1 = await runScoring(db, ctx, MANAGER, { runKey: "live-wk-1", at: t(1) });
    assert.deepEqual(run1.ranked.map((x) => x.candidateId), [a, b, c]);
    assert.deepEqual(run1.top2, [a, b]);
    await drainOutbox();
    await allSynced([a, b, c]);

    const sa = await hubState(a);
    assert.equal(sa.domainScore, 89);
    assert.equal(sa.domainRank, 1);
    assert.equal(sa.displayedDomainRank, 1);
    assert.equal(sa.priorityBand, "CRITICAL");
    assert.equal(sa.scoreVersion, "IAM_PRIORITY_SCORING_V1");
    assert.equal(sa.scoreSourceRunId, run1.scoringRunId);
    assert.equal(sa.rawCoreScore, 89);
    assert.equal(sa.dataConfidence, "HIGH");
    assert.equal(sa.top2Qualified, true);
    assert.equal(sa.emergencyReviewCandidate, false);
    assert.equal(sa.criticalOutsideTop2, false);
    assert.equal(sa.forcedReviewRequired, false);
    assert.ok(sa.scoredAt, "scoredAt projected");
    assert.ok(sa.scoreDetailJson, "factor scores and modifier values are projected for explainability");
    assert.equal((await hubState(b)).domainRank, 2);
    const sc = await hubState(c);
    assert.equal(sc.domainRank, 3);
    assert.equal(sc.top2Qualified, false);
    assert.equal(sc.priorityBand, "WATCH");

    // a later, changed result updates current state and adds a second accepted event; the first stays in history
    await recordScoringInputs(db, ctx, SYSTEM_ACTOR, c, fromPoints(pts(P41, { cash: 30, prof: 15, inv: 15 })), { at: t(2) }); // 41+18+9+9 = 77
    const run2 = await runScoring(db, ctx, MANAGER, { runKey: "live-wk-2", at: t(8) });
    assert.equal(run2.ranked[0]!.candidateId, a);
    await drainOutbox();
    await allSynced([a, b, c]);
    const sc2 = await hubState(c);
    assert.equal(sc2.domainScore, 78, "77 plus the +1 persistence of the second weekly cycle");
    assert.equal(sc2.scoreSourceRunId, run2.scoringRunId);
    assert.equal(sc2.previousDomainRank, 3, "the previous rank travels with the new result");
    assert.equal(await accepted(c, "CANDIDATE_SCORED"), 2, "the historical result is retained as an accepted submission");

    // idempotent replay of an accepted score event
    const first = (await outboxFor(c)).find((r) => r.eventType === "CANDIDATE_SCORED")!;
    const replay = await client.submitResultsReturnEvent(first.payloadJson);
    assert.equal(replay.acknowledgement?.duplicate, true);
    assert.equal(await accepted(c, "CANDIDATE_SCORED"), 2);
    assert.equal((await hubState(c)).domainScore, 78, "a replay of the older event never rolls current state back");

    // a replayed scoring request (same run key) creates nothing new
    const before = await iam.prisma.dposResultsReturnOutbox.count();
    assert.equal((await runScoring(db, ctx, MANAGER, { runKey: "live-wk-2", at: t(9) })).replayed, true);
    assert.equal(await iam.prisma.dposResultsReturnOutbox.count(), before);

    // IAM never produced RSE/PRE board work: it holds no V1.5 run, only canonical candidates and scoring records
    assert.equal(await iam.prisma.iamRun.count(), 0);
  });

  it("governed priority controls and emergency decisions are accepted and represented without altering IAM's calculated score", async () => {
    const db = iam.prisma as PrismaClient;
    const x = await candidate("x", fromPoints(P80), 10);
    const y = await candidate("y", fromPoints(pts(P80, { cash: 24 })), 10); // 74
    const e = await candidate("e", fromPoints(pts(ZERO, { op: 15, time: 8, cash: 6 })), 10); // emergency trigger A
    await runScoring(db, ctx, MANAGER, { runKey: "live-gov-1", at: t(11) });
    await setPriorityOverride(db, ctx, MANAGER, y, { points: 8, reason: "A key customer depends on this.", at: t(11, 1) });
    await authorizeStrategic(db, ctx, MANAGER, x, { level: "IMPORTANT", reason: "Board objective.", at: t(11, 2) });
    await lockRank(db, ctx, MANAGER, e, { rank: 1, reason: "Lender meeting this week.", at: t(11, 3), until: t(15) });
    await runScoring(db, ctx, MANAGER, { runKey: "live-gov-2", at: t(12) });
    await confirmEmergency(db, ctx, MANAGER, e, { reason: "Supplier shutdown is confirmed.", at: t(12, 1) });
    await drainOutbox();
    await allSynced([x, y, e]);

    const sy = await hubState(y);
    assert.equal(sy.domainScore, 74, "IAM's calculated score is preserved");
    assert.ok(sy.domainRank !== null && sy.displayedDomainRank !== null && sy.displayedDomainRank < sy.domainRank, "the governed display moved ahead of the calculated rank");
    const override = JSON.parse(sy.priorityOverrideJson!);
    assert.equal(override.priorityOverrideType ?? override.type ?? "PROMOTE", "PROMOTE");
    assert.match(sy.priorityOverrideJson!, /A key customer depends on this/);
    assert.match(sy.priorityOverrideJson!, new RegExp(MANAGER.actorId));
    const se = await hubState(e);
    assert.equal(se.emergencyPriority, true, "management-confirmed emergency, published immediately");
    assert.equal(se.emergencyReviewCandidate, true);
    assert.ok(se.rankLockedUntil, "rank lock end published");
    assert.equal(await accepted(e, "DOMAIN_PRIORITY_CHANGED") >= 1, true);
    assert.equal((await hubState(x)).domainScore, 82, "80 + 2 strategic (authorized by management)");
    assert.ok((await hubDb.iamCandidateCurrentState.findMany({})).every((s) => s.domainScore === null || s.domainScore <= 100));
    assert.equal(await iam.prisma.iamRun.count(), 0);
  });

  it("the dedicated governance events (pause, plan revision, return for review) and signed condition reduction are accepted", async () => {
    const db = iam.prisma as PrismaClient;
    const r = await ingestGovernedEvidence(db, ctx, MANAGER, { evidence: [evidence("g1", { conditionKey: "Live 4C governance" })], sourceRunId: "live4c-g", describe: describeGroup(), at: t(20) });
    const id = r.groups[0]!.candidateId;
    await presentCandidate(db, ctx, MANAGER, id, { at: t(20, 1) });
    await returnForReview(db, ctx, MANAGER, id, { reason: "Need the vendor's position first.", at: t(20, 2) });
    await presentCandidate(db, ctx, MANAGER, id, { at: t(20, 3) });
    await approveCandidate(db, ctx, MANAGER, id, {
      plan: PLAN,
      assignment: { responsibleDepartment: "Purchasing", taskOwnerId: OWNER_USER.actorId, taskOwnerName: "Olivia Owner" },
      targetStart: d(21),
      targetResolution: d(49),
      baselineExposure: 1000,
      exposureUnit: "USD",
      at: t(20, 4),
    });
    await acceptOwnership(db, ctx, OWNER_USER, id, { at: t(20, 5) });
    await startAction(db, ctx, OWNER_USER, id, { at: t(21) });
    await requestPause(db, ctx, OWNER_USER, id, { reason: "Receiving freeze", expectedDurationDays: 3, at: t(22) });
    await decidePause(db, ctx, MANAGER, id, { decision: "DENY", reason: "The deadline cannot move.", at: t(22, 1) });
    await requestPause(db, ctx, OWNER_USER, id, { reason: "Freeze again", expectedDurationDays: 3, at: t(23) });
    await decidePause(db, ctx, MANAGER, id, { decision: "APPROVE", reason: "Approved this time.", at: t(23, 1) });
    await reassign(db, ctx, MANAGER, id, { reason: "Scope changed.", planChange: { summary: "Cancel only the two oldest purchase orders." }, at: t(24) });
    await updateConditionReduction(db, ctx, OWNER_USER, id, { currentExposure: 1300, at: t(25) }); // worse than baseline: -30
    await drainOutbox();
    await allSynced([id]);
    for (const type of ["RETURNED_FOR_REVIEW", "PAUSE_REQUESTED", "PAUSE_DENIED", "PAUSE_APPROVED", "PLAN_REVISED"]) {
      assert.ok((await accepted(id, type)) >= 1, `${type} accepted by the real Data Hub`);
    }
    assert.equal(await accepted(id, "PAUSE_REQUESTED"), 2);
    const s = await hubState(id);
    assert.equal(s.conditionReductionPct, -30, "a worse-than-baseline condition keeps its negative value in the Data Hub");
    assert.ok(s.pauseRequestStatus, "the pause decision is represented in current state");
  });
});