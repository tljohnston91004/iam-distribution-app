/**
 * LIVE integration proof: IAM's Stage 4A code talks over real loopback HTTP to the REAL DPOS Data Hub application
 * (`buildDataHubApp` from the DPOS repository, with its own migrated SQLite database in a temp directory).
 *
 * Proves, end to end and with no stubs on the IAM side:
 *   - service identity accepted by Data Hub (and a user identity / unregistered service refused),
 *   - Open PO + Customer Backorder governed input reads (parentSku = Stck#, childPartOrVariant = Class verbatim, lineage,
 *     freshness, source run identity),
 *   - manual refresh + Sunday-02:00 scheduler against the live Data Hub (time-zone cross-check),
 *   - CANDIDATE_CREATED -> ACTION_STATUS_CHANGED -> CLOSEOUT_COMPLETED through the outbox with real acknowledgements,
 *     idempotent replay, Data Hub-side eligibility block, and a temporary outage that leaves the event pending.
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
import { calculateHealth, createDataHubBackorderProvider } from "../../src/lib/dpos/health";
import { FIXTURE_EVENT_TYPES, fixtureEvent } from "../../src/lib/dpos/fixtures";
import { enqueueResultsReturnEvent, flushOutbox, summarizeOutbox } from "../../src/lib/dpos/outbox";
import { getRefreshStatus, runRefresh } from "../../src/lib/dpos/refresh";
import { schedulerTick } from "../../src/lib/dpos/scheduler";
import { WorkshopServiceIdentityProvider, issueServiceIdentity } from "../../src/lib/dpos/service-identity";
import { boundContext, createTestDb, DEFAULT_COMPANY_ID, findDposRoot, makeConfig, type TestDb } from "./helpers";

const dposRoot = findDposRoot();
const hubRoot = dposRoot ? path.join(dposRoot, "services", "data-hub") : null;
const skip = !dposRoot || !hubRoot || !fs.existsSync(path.join(hubRoot, "src", "api", "app.ts")) || !fs.existsSync(path.join(dposRoot, "node_modules"))
  ? "DPOS repository (with installed dependencies) not found — set DPOS_REPO_ROOT"
  : false;

const PO = "OPEN_PURCHASE_ORDER_LINE";
const BO = "CUSTOMER_BACKORDER_LINE";
// STRUCTURE-ONLY synthetic rows with the real Keystroke V1 column names (no customer data).
const PO_CSV = [
  "Trans#,Date,Vendor,Stck#,Description,Code,Class,Qty,Cost,Total",
  "90001,01/09/25,5 - VENDOR A,27419,ITEM ONE,CODE1,LGX,1,15.5,15.5",
  "90002,03/30/25,9 - VENDOR B,7620,ITEM TWO,CODE2,02.0,40,0.72,28.8",
  "90002,03/30/25,9 - VENDOR B,7666,ITEM THREE,CODE3,09.0,32,0.72,23.04",
  "90003,05/11/25,9 - VENDOR B,37261,ITEM FOUR,CODE4,,5,76.8,384",
].join("\n");
const BO_CSV = [
  "Trans#,Date,Customer,Stck#,Description,Code,Class,Qty,Price,Total",
  "800002,02/13/25,1942 - CUSTOMER TWO,37053,ITEM TWO,CODE2,9.00,1,34.95,34.95",
  "800002,02/13/25,1942 - CUSTOMER TWO,37053,ITEM TWO,CODE2,10.0,1,34.95,34.95",
  "800002,02/13/25,1942 - CUSTOMER TWO,37053,ITEM TWO,CODE2,10.5,1,34.95,34.95",
].join("\n");

describe("live Data Hub (real DPOS application over HTTP)", { skip }, () => {
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
  let eligible = true;
  const operatorId = randomUUID();
  const hdr = () => ({ "x-identity-id": operatorId, "x-user-id": operatorId, "x-company-id": DEFAULT_COMPANY_ID, "x-correlation-id": randomUUID() });

  before(async () => {
    const mod = (rel: string) => import(pathToFileURL(path.join(hubRoot!, "src", rel)).href);
    hubDir = fs.mkdtempSync(path.join(os.tmpdir(), "iam4a-live-hub-"));
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

    // Governed inputs: import the two IAM families through the real Data Hub import path.
    for (const [family, csv] of [[PO, PO_CSV], [BO, BO_CSV]] as const) {
      const created = await app.inject({ method: "POST", url: "/api/v1/data-sources", headers: hdr(), payload: { name: `live-${family}-${randomUUID().slice(0, 6)}`, sourceType: "FILE", systemName: "Keystroke" } });
      assert.equal(created.statusCode, 201, created.body);
      const id = created.json().dataSourceId as string;
      await app.inject({ method: "PATCH", url: `/api/v1/data-sources/${id}`, headers: hdr(), payload: { status: "ACTIVE" } });
      const imp = await app.inject({ method: "POST", url: "/api/v1/imports/csv", headers: hdr(), payload: { dataSourceId: id, objectFamily: family, csv, originalName: "STRUCTURE-ONLY.csv", approvePendingMappings: true } });
      assert.ok([200, 201].includes(imp.statusCode), imp.body);
    }
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

  it("Data Hub accepts the IAM service identity and refuses a user identity or an unregistered service", async () => {
    const ok = await client.getInputStatus();
    assert.equal(ok.companyId, DEFAULT_COMPANY_ID);
    // a user (non-service) principal has no read permission on the governed inputs
    const user = new DataHubClient({ config, identity: { identityId: randomUUID(), credentialRef: null } });
    await assert.rejects(() => user.getInputStatus(), (e: { category: string }) => e.category === "CONFIGURATION_SYSTEM");
    // …and cannot submit Results Return events
    const submit = await user.submitResultsReturnEvent(JSON.stringify({ envelope: { producerEventId: randomUUID() } }));
    assert.equal(submit.outcome.failureCategory, "CONFIGURATION_SYSTEM");
    // 4A-D2: generic source/canonical/lineage read does not substitute for the dedicated governed-read capability
    const genericOnly = new DataHubClient({ config, identity: { identityId: genericOnlyId, credentialRef: null } });
    await assert.rejects(() => genericOnly.getInputStatus(), (e: { category: string }) => e.category === "CONFIGURATION_SYSTEM");
    await assert.rejects(async () => { for await (const _ of genericOnly.iterateInputRecords(PO)) void _; }, (e: { category: string }) => e.category === "CONFIGURATION_SYSTEM");
    const stranger = new DataHubClient({ config, identity: { identityId: "iam-svc-" + randomUUID(), credentialRef: null } });
    const s2 = await stranger.submitResultsReturnEvent(JSON.stringify({ envelope: { producerEventId: randomUUID() } }));
    assert.equal(s2.outcome.failureCategory, "CONFIGURATION_SYSTEM");
  });

  it("reads Open PO and Customer Backorder governed inputs with parentSku/childPartOrVariant verbatim, lineage, freshness and source run identity", async () => {
    const status = await client.getInputStatus();
    for (const s of status.sources.filter((x) => x.objectFamily === PO || x.objectFamily === BO)) {
      assert.equal(s.availability, "AVAILABLE", `${s.objectFamily} should be available`);
      assert.ok(s.latestSuccessfulRun?.importBatchId, "source run identity");
      assert.ok(s.freshness, "freshness metadata");
    }
    const read = async (family: typeof PO | typeof BO) => {
      const out = [];
      for await (const r of client.iterateInputRecords(family, { pageSize: 2 })) out.push(r);
      return out;
    };
    const po = await read(PO);
    assert.equal(po.length, 4);
    assert.deepEqual(new Set(po.map((r) => r.values.parentSku)), new Set(["27419", "7620", "7666", "37261"]));
    const poClass = po.map((r) => r.values.childPartOrVariant).filter((c) => c !== null && c !== undefined && c !== "").sort();
    assert.deepEqual(poClass, ["02.0", "09.0", "LGX"].sort(), "Class preserved verbatim (no numeric normalization of 02.0 / 09.0)");
    const bo = await read(BO);
    assert.equal(bo.length, 3);
    assert.deepEqual(bo.map((r) => r.values.childPartOrVariant).sort(), ["10.0", "10.5", "9.00"].sort(), "9.00 / 10.0 / 10.5 stay distinct");
    assert.deepEqual(new Set(bo.map((r) => r.values.parentSku)), new Set(["37053"]));
    for (const r of [...po, ...bo]) {
      assert.ok(r.importBatchId, "source run identity");
      assert.ok(r.lineage?.sourceSystemId && r.lineage.ingestionBatchId && r.lineage.mappingProfileId, "lineage/reference ids");
      assert.ok(r.quality?.freshnessStatus && r.quality.validationStatus, "freshness + validation metadata");
      assert.ok(r.confidence, "confidence-support metadata");
    }
  });

  it("Stage 4D: the live Customer Backorder feed drives the Shortage component with Stck# / Class preserved and the Health Score stored", async () => {
    const provider = createDataHubBackorderProvider(client, { pageSize: 2 });
    const fetched = await provider.fetch();
    assert.equal(fetched.ok, true, JSON.stringify(fetched));
    if (!fetched.ok) return;
    assert.equal(fetched.input.lines.length, 3);
    assert.deepEqual(new Set(fetched.input.lines.map((l) => l.parentSku)), new Set(["37053"]), "Stck# is the parent SKU");
    assert.deepEqual(fetched.input.lines.map((l) => l.childPartOrVariant).sort(), ["10.0", "10.5", "9.00"].sort(), "Class stays the child part / variant (never merged with Stck#)");
    assert.ok(fetched.input.sourceRefs.some((r) => r.includes("CUSTOMER_BACKORDER_LINE")), "source run identity is carried");
    const health = await calculateHealth(iam.prisma, ctx, { actorId: "live-proof", role: "MANAGER" }, {
      at: new Date("2026-10-27T15:00:00Z"),
      backorder: provider,
    });
    const shortage = health.health.components.find((c) => c.key === "SHORTAGE_BACKORDER")!;
    // Without a company revenue basis the shortage cannot be put on a scale: it is reported unavailable, never scored as zero.
    assert.equal(shortage.available, false);
    assert.match(shortage.unavailableReason ?? "", /revenue/i);
    const detail = shortage.detail as { lines?: number; parts?: number };
    assert.ok(detail.lines === undefined || detail.lines === 3);
  });

  it("manual refresh against the live Data Hub records the attempt and retained timestamps; Data Hub's own schedule agrees (Sunday 02:00 America/Chicago)", async () => {
    const r = await runRefresh({ db: iam.prisma, config, context: ctx, client }, { trigger: "MANUAL_REFRESH", requestedBy: "live-proof" });
    assert.equal(r.ok, true, JSON.stringify(r));
    assert.ok(r.dataCurrentThrough && r.lastIamRefreshAt && r.nextScheduledRefreshAt);
    assert.ok(!r.warnings.some((w) => w.startsWith("TIME_ZONE_DISAGREES")), `time zone cross-check: ${r.warnings.join("; ")}`);
    const sync = await client.getSyncStatus();
    assert.equal(sync.refresh?.schedule?.timeZone, "America/Chicago");
    assert.equal(sync.refresh?.schedule?.refreshHourLocal, 2);
    const st = await getRefreshStatus({ db: iam.prisma, config, context: ctx });
    assert.equal(st.lastAttemptStatus, "SUCCEEDED");
    assert.equal(new Date(st.nextScheduledRefreshAt!).getUTCDay() === 0 || new Date(st.nextScheduledRefreshAt!).getUTCDay() === 6, true);
    // scheduler: a due Sunday occurrence runs once against the live hub
    const tick = await schedulerTick({ db: iam.prisma, config, context: ctx, client, now: () => new Date("2026-10-25T07:01:00Z") });
    assert.equal(tick.action, "RAN");
    assert.equal((tick as { result: { ok: boolean } }).result.ok, true);
    assert.equal((await schedulerTick({ db: iam.prisma, config, context: ctx, client, now: () => new Date("2026-10-25T07:02:00Z") })).action, "ALREADY_COMPLETE");
  });

  it("CANDIDATE_CREATED -> ACTION_STATUS_CHANGED -> CLOSEOUT_COMPLETED flow through the outbox and are acknowledged by the real Data Hub; replay is idempotent", async () => {
    const candidateId = randomUUID();
    const rows = [];
    for (const t of FIXTURE_EVENT_TYPES) rows.push((await enqueueResultsReturnEvent(iam.prisma, ctx, fixtureEvent(t, candidateId, new Date(Date.now() - 60_000)))).row);
    assert.equal(rows.every((r) => r.syncStatus === "PENDING"), true, "persisted before any send");
    const deps = { db: iam.prisma as PrismaClient, config, context: ctx, client };
    for (let i = 0; i < 3; i++) await flushOutbox(deps);
    for (const r of rows) {
      const done = await iam.prisma.dposResultsReturnOutbox.findUniqueOrThrow({ where: { id: r.id } });
      assert.equal(done.syncStatus, "SYNCED", `${done.eventType}: ${done.failureCode ?? ""} ${done.failureReason ?? ""}`);
      assert.ok(done.acknowledgementId && done.acceptedAt, "real acknowledgement recorded");
      assert.equal(JSON.parse(done.acknowledgementJson!).processingResult, "ACCEPTED");
    }
    // Data Hub-side evidence
    const states = await hubDb.iamCandidateCurrentState.findMany({ where: { candidateId } });
    assert.equal(states.length, 1, "Data Hub holds one current state for the candidate");
    assert.equal(await hubDb.iamResultsReturnSubmission.count({ where: { candidateId, outcome: "ACCEPTED" } }), 3);
    // replay of an accepted event is a safe no-op on the Hub
    const replay = await client.submitResultsReturnEvent(rows[0]!.payloadJson);
    assert.equal(replay.kind, "RESPONSE");
    assert.equal(replay.acknowledgement?.duplicate, true);
    assert.equal(replay.outcome.syncState, "SYNCED");
    assert.equal(await hubDb.iamResultsReturnSubmission.count({ where: { candidateId, outcome: "ACCEPTED" } }), 3, "no duplicate accepted event");
    assert.equal(await hubDb.iamResultsReturnSubmission.count({ where: { candidateId, outcome: "IDEMPOTENT_REPLAY" } }), 1, "replay recorded in the Hub attempt ledger only");
    const summary = await summarizeOutbox(iam.prisma, ctx.dposCompanyId);
    assert.equal(summary.counts.SYNCED, 3);
  });

  it("Data Hub's own IAM eligibility check blocks Results Return: IAM keeps the event and surfaces it for administrator action", async () => {
    eligible = false;
    try {
      const { row } = await enqueueResultsReturnEvent(iam.prisma, ctx, fixtureEvent("CANDIDATE_CREATED", randomUUID(), new Date(Date.now() - 60_000)));
      await flushOutbox({ db: iam.prisma as PrismaClient, config, context: ctx, client });
      const cur = await iam.prisma.dposResultsReturnOutbox.findUniqueOrThrow({ where: { id: row.id } });
      assert.equal(cur.syncStatus, "BLOCKED_ADMIN_ACTION", `${cur.failureCode}`);
      assert.equal(cur.failureCategory, "CONFIGURATION_SYSTEM");
      assert.equal(cur.adminAlertRaised, true);
    } finally {
      eligible = true;
    }
  });

  it("a Data Hub outage leaves the event pending and retryable (same producerEventId), never lost", async () => {
    const { row } = await enqueueResultsReturnEvent(iam.prisma, ctx, fixtureEvent("CANDIDATE_CREATED", randomUUID(), new Date(Date.now() - 60_000)));
    await app.close();
    await flushOutbox({ db: iam.prisma as PrismaClient, config, context: ctx, client });
    const cur = await iam.prisma.dposResultsReturnOutbox.findUniqueOrThrow({ where: { id: row.id } });
    assert.equal(cur.syncStatus, "SYNC_PENDING_RETRY");
    assert.equal(cur.failureCategory, "TEMPORARY_TECHNICAL");
    assert.equal(cur.retryEligible, true);
    assert.equal(cur.producerEventId, row.producerEventId);
  });
});
