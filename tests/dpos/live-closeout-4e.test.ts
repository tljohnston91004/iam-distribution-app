/**
 * LIVE integration proof for Stage 4E: formal closeout (start, measure, approve, learn, complete) and a later recurrence write Results Return
 * events through the outbox; the REAL DPOS Data Hub application (own migrated SQLite database, loopback HTTP) acknowledges every one of
 * them; the Data Hub current state closes the candidate ONLY after CLOSEOUT_COMPLETED, never reopens it, and links the recurrence candidate.
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
  completeAction,
  ingestGovernedEvidence,
  presentCandidate,
  startAction,
  updateConditionReduction,
  updateProgress,
  validateCompletion,
} from "../../src/lib/dpos/workflow";
import { approveCloseout, completeCloseout, recordLearning, recordMeasurement, startCloseout } from "../../src/lib/dpos/closeout";
import { boundContext, createTestDb, DEFAULT_COMPANY_ID, findDposRoot, makeConfig, type TestDb } from "./helpers";
import { DAY, MANAGER, OWNER_USER, PLAN, describeGroup, evidence } from "./workflow-helpers";
import { measurement } from "./closeout-helpers";

const dposRoot = findDposRoot();
const hubRoot = dposRoot ? path.join(dposRoot, "services", "data-hub") : null;
const skip = !dposRoot || !hubRoot || !fs.existsSync(path.join(hubRoot, "src", "api", "app.ts")) || !fs.existsSync(path.join(dposRoot, "node_modules"))
  ? "DPOS repository (with installed dependencies) not found - set DPOS_REPO_ROOT"
  : false;

// Real-time anchored (Data Hub validates producer times), all strictly in the past.
const BASE = Date.now() - 30 * DAY;
const t = (days: number, hours = 0) => new Date(BASE + days * DAY + hours * 3_600_000);
const d = (days: number) => t(days).toISOString().slice(0, 10);
describe("live Data Hub: Stage 4E closeout events (real DPOS application over HTTP)", { skip }, () => {
  let iam: TestDb;
  let hubDir = "";
  let hubDb: { $disconnect(): Promise<void>; iamCandidateCurrentState: { findMany(a?: unknown): Promise<any[]> }; iamResultsReturnSubmission: { count(a?: unknown): Promise<number>; findMany(a?: unknown): Promise<any[]> } };
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
    hubDir = fs.mkdtempSync(path.join(os.tmpdir(), "iam4e-live-hub-"));
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

  it("closeout events are acknowledged live; the current state closes only after CLOSEOUT_COMPLETED; a returning condition is a new linked candidate", async () => {
    const db = iam.prisma as PrismaClient;
    const created = await ingestGovernedEvidence(db, ctx, MANAGER, { evidence: [evidence("1"), evidence("2"), evidence("3")], sourceRunId: "live-run-1", describe: describeGroup(), at: t(0) });
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
    await acceptOwnership(db, ctx, OWNER_USER, id, { at: t(0, 3) });
    await startAction(db, ctx, OWNER_USER, id, { at: t(1) });
    await updateProgress(db, ctx, OWNER_USER, id, { actionCompletionPct: 60, at: t(5) });
    await updateConditionReduction(db, ctx, OWNER_USER, id, { currentExposure: 300, at: t(8) });
    await completeAction(db, ctx, OWNER_USER, id, { at: t(14) });
    await validateCompletion(db, ctx, MANAGER, id, { finalResolutionStatus: "SUBSTANTIALLY_RESOLVED", at: t(15) });
    await archiveToHistory(db, ctx, MANAGER, id, { at: t(16) });
    await drainOutbox();
    const hubState = async (candidateId = id) => (await hubDb.iamCandidateCurrentState.findMany({ where: { candidateId } }))[0]!;

    // Completed History: execution complete, NOT closed (4E-D1)
    let live = await hubState();
    assert.equal(live.executionCompleted, true);
    assert.equal(live.closeoutCompleted, false);
    assert.notEqual(live.closeoutState, "CLOSED");

    const W = { measurementStart: d(18), measurementEnd: d(28), evidenceCurrentThrough: d(29) };
    await startCloseout(db, ctx, MANAGER, id, { at: t(29) });
    await drainOutbox();
    live = await hubState();
    assert.equal(live.closeoutState, "IN_PROGRESS");
    assert.equal(live.closeoutCompleted, false);

    await recordMeasurement(db, ctx, MANAGER, id, measurement({ ...W, finalExposure: 0, at: t(29, 1) }));
    await drainOutbox();
    live = await hubState();
    assert.equal(live.closeoutState, "MEASURED");
    assert.equal(live.closeoutCompleted, false, "measured is not closed");

    await approveCloseout(db, ctx, MANAGER, id, { finalStatus: "FULLY_RESOLVED", at: t(29, 2) });
    await drainOutbox();
    live = await hubState();
    assert.equal(live.closeoutState, "APPROVED");
    assert.equal(live.closeoutCompleted, false, "approved is not yet closed");

    await recordLearning(db, ctx, MANAGER, id, { whatWorked: "Early vendor contact released the open orders.", futureHandling: "Contact the vendor before the PO release date.", evidenceRefs: ["ev-final-balance-1"], at: t(29, 3) });
    await drainOutbox();
    live = await hubState();
    assert.equal(live.closeoutCompleted, false, "learning recorded is not yet closed");
    assert.ok(live.learningJson, "learning support published");

    await completeCloseout(db, ctx, MANAGER, id, { at: t(29, 4) });
    await drainOutbox();
    for (const r of await outboxFor(id)) {
      assert.equal(r.syncStatus, "SYNCED", `${r.eventType}: ${r.failureCode ?? ""} ${r.failureReason ?? ""}`);
      assert.equal(JSON.parse(r.acknowledgementJson!).processingResult, "ACCEPTED");
    }
    const types = (await outboxFor(id)).map((r) => r.eventType);
    for (const e of ["CLOSEOUT_STARTED", "CLOSEOUT_APPROVED", "LEARNING_RECORDED", "CLOSEOUT_COMPLETED"]) assert.ok(types.includes(e), e);

    live = await hubState();
    assert.equal(live.executionCompleted, true);
    assert.equal(live.closeoutCompleted, true);
    assert.equal(live.closeoutState, "CLOSED");
    assert.ok(live.closedAt, "closeout timestamp published");
    assert.equal(live.finalResolutionState, "FULLY_RESOLVED");
    const detail = JSON.parse(live.closeoutJson);
    assert.equal(detail.finalResolutionStatus, "FULLY_RESOLVED");
    assert.ok(live.attributionConfidence !== undefined);
    assert.equal(live.domainScore, null, "no score or rank was invented for a closed candidate");

    // idempotent replay of an accepted closeout event: duplicate, no second accepted submission, state unchanged
    const completedRow = (await outboxFor(id)).find((r) => r.eventType === "CLOSEOUT_COMPLETED")!;
    const accepted = await hubDb.iamResultsReturnSubmission.count({ where: { candidateId: id, outcome: "ACCEPTED" } });
    const replay = await client.submitResultsReturnEvent(completedRow.payloadJson);
    assert.equal(replay.acknowledgement?.duplicate, true);
    assert.equal(await hubDb.iamResultsReturnSubmission.count({ where: { candidateId: id, outcome: "ACCEPTED" } }), accepted);
    const stateAfterReplay = await hubState();
    assert.equal(stateAfterReplay.closedAt?.toISOString(), live.closedAt?.toISOString());

    // the condition returns: a NEW candidate linked as a recurrence; the Hub keeps the closed one CLOSED
    const again = await ingestGovernedEvidence(db, ctx, MANAGER, { evidence: [evidence("1"), evidence("2"), evidence("3")], sourceRunId: "live-run-recur", describe: describeGroup(), at: t(29, 8) });
    const next = again.groups[0]!;
    assert.notEqual(next.candidateId, id);
    assert.equal(next.recurrenceOfCandidateId, id);
    await drainOutbox();
    for (const r of await outboxFor(next.candidateId)) assert.equal(r.syncStatus, "SYNCED", `${r.eventType}: ${r.failureCode ?? ""} ${r.failureReason ?? ""}`);
    const recur = await hubState(next.candidateId);
    assert.equal(recur.recurrenceOfCandidateId, id, "the Data Hub links the recurrence candidate to the prior closed candidate");
    assert.equal(recur.closeoutCompleted, false);
    const old = await hubState();
    assert.equal(old.closeoutState, "CLOSED", "the prior candidate is never reopened");
    assert.equal(old.closedAt?.toISOString(), live.closedAt?.toISOString());
    assert.equal(old.executionCompleted, true);
  });
});
