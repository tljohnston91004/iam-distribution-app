/**
 * TEST / DEV TOOLING ONLY (Stage 4D, extended in 4D-R). NOT part of the product, never bundled into or used by the customer runtime, and
 * it must never be pointed at a customer database or a customer Data Hub: it creates and destroys its own throw-away temp state, uses
 * synthetic STRUCTURE-ONLY fixtures, embeds no secrets (the front-door credential below is a throw-away smoke value) and no customer paths.
 *
 * Boots, all in throw-away temp state:
 *   1. the REAL DPOS Data Hub application (from DPOS_REPO_ROOT) with Open PO + Customer Backorder governed inputs imported,
 *   2. a governed-migrated IAM database bound to a test company, seeded with realistic Stage 4D data (Health history, scored
 *      candidates, an approved plan, a Holdover, a pause request, a completed measured action),
 *   3. IAM `next dev` in DPOS_INTEGRATED mode (with a TEST-ONLY attainable module registry),
 *   4. a tiny proxy that plays the DPOS front door (injects the trusted front-door headers). Visit /__as/manager | owner | viewer
 *      to choose who you are.
 *
 * Usage: DPOS_REPO_ROOT=<dpos worktree> npx tsx scripts/dev-board-smoke.ts
 * Prints the proxy URL, then keeps running until stopped (Ctrl+C or kill).
 */
import { execSync, spawn, type ChildProcess } from "node:child_process";
import { randomUUID } from "node:crypto";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { bindCompany } from "../src/lib/dpos/company-context";
import { FRONT_DOOR_SERVICE_ID } from "../src/lib/dpos/access-guard";
import { WorkshopServiceIdentityProvider, issueServiceIdentity } from "../src/lib/dpos/service-identity";
import { sqliteUrl } from "../src/lib/dpos/migrate/governed-migrate";
import { calculateHealth, createDataHubBackorderProvider, createDataHubRseHealthProvider, ingestRseHealthInputs, recordHealthEvidence } from "../src/lib/dpos/health";
import { DataHubClient } from "../src/lib/dpos/data-hub-client";
import { recordScoringInputs, runScoring } from "../src/lib/dpos/scoring";
import { SYSTEM_ACTOR, acceptOwnership, approveCandidate, completeAction, ingestGovernedEvidence, presentCandidate, requestPause, startAction, updateConditionReduction, updateProgress } from "../src/lib/dpos/workflow";
import { PrismaClient } from "@prisma/client";
import { DEFAULT_COMPANY_ID, createTestDb, findDposRoot, loadDposFixtures, makeConfig, writeAttainableRegistry } from "../tests/dpos/helpers";
import { MANAGER, describeGroup, evidence } from "../tests/dpos/workflow-helpers";
import { P80, P89, fromPoints } from "../tests/dpos/scoring-helpers";

if (process.env.NODE_ENV === "production" || process.env.IAM_ENVIRONMENT_CLASS === "PRODUCTION") throw new Error("dev-board-smoke is test tooling and refuses to run in a production environment.");
const dposRoot = findDposRoot();
if (!dposRoot) throw new Error("Set DPOS_REPO_ROOT to the DPOS worktree.");
const hubRoot = path.join(dposRoot, "services", "data-hub");
const SECRET = "smoke-front-door-secret";
// Must equal the installation id of the DPOS module-installation fixture (TEST-ONLY).
const INSTALLATION_ID = "front-door-test-installation";
const NEXT_PORT = Number(process.env.SMOKE_NEXT_PORT ?? 3100);
const PROXY_PORT = Number(process.env.SMOKE_PROXY_PORT ?? 3101);

const H = 3600 * 1000;
const NOW = new Date();
const t = (hours: number) => new Date(NOW.getTime() + hours * H);
const d = (days: number) => t(days * 24);
const dateOnly = (days: number) => d(days).toISOString().slice(0, 10);

const PO_CSV = ["Trans#,Date,Vendor,Stck#,Description,Code,Class,Qty,Cost,Total", "90001,01/09/26,5 - VENDOR A,27419,ITEM ONE,CODE1,LGX,1,15.5,15.5", "90002,03/30/26,9 - VENDOR B,7620,ITEM TWO,CODE2,02.0,40,0.72,28.8"].join("\n");
const BO_CSV = [
  "Trans#,Date,Customer,Stck#,Description,Code,Class,Qty,Price,Total",
  "800002,10/05/26,1942 - CUSTOMER TWO,37053,ITEM TWO,CODE2,9.00,1,34.95,34.95",
  "800002,10/05/26,1942 - CUSTOMER TWO,37053,ITEM TWO,CODE2,10.0,1,34.95,34.95",
  "800003,10/12/26,2001 - CUSTOMER THREE,37053,ITEM TWO,CODE2,10.5,2,34.95,69.9",
].join("\n");

const children: ChildProcess[] = [];
const cleanups: Array<() => Promise<void> | void> = [];
async function shutdown() {
  for (const c of children) try { c.kill(); } catch { /* ignore */ }
  for (const f of cleanups.reverse()) try { await f(); } catch { /* ignore */ }
  process.exit(0);
}
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

async function main() {
  // ---- 1. real Data Hub ----------------------------------------------------------------------------------------------------------
  const mod = (rel: string) => import(pathToFileURL(path.join(hubRoot, "src", rel)).href);
  const hubDir = fs.mkdtempSync(path.join(os.tmpdir(), "iam4d-smoke-hub-"));
  cleanups.push(() => fs.rmSync(hubDir, { recursive: true, force: true }));
  const hubUrl = `file:${path.join(hubDir, "hub.db").replace(/\\/g, "/")}`;
  (process.env as Record<string, string | undefined>).NODE_ENV = "development";
  process.env.DATA_HUB_DATABASE_URL = hubUrl;
  execSync("npx prisma migrate deploy --schema prisma/schema.prisma", { cwd: hubRoot, stdio: "pipe", env: { ...process.env, DATA_HUB_DATABASE_URL: hubUrl } });
  const [{ buildDataHubApp }, { createDataHubPrisma }, { createDataHubBus }, ports, { InProcessOutboxDelivery }, loc, lic, { LocalStorageAdapter }, seedA, seedB, types] = await Promise.all([
    mod("api/app.ts"), mod("db/prisma.ts"), mod("events/outbox.ts"), mod("integrations/ports.ts"), mod("integrations/eaas-delivery.ts"),
    mod("integrations/company-location-port.ts"), mod("integrations/company-license-port.ts"), mod("adapters/storage/local-storage.ts"),
    mod("seed/seed-validation-rules.ts"), mod("seed/seed-bp005a-rules.ts"), mod("domain/types.ts"),
  ]);
  const hub = createDataHubPrisma(hubUrl);
  cleanups.push(() => hub.$disconnect());
  await seedA.seedValidationRules(hub);
  await seedB.seedBp005aRules(hub);

  // ---- 2. IAM database + service identity ----------------------------------------------------------------------------------------
  const iam = await createTestDb();
  cleanups.push(async () => { await iam.prisma.$disconnect(); });
  const baseConfig = makeConfig({ IAM_INSTALLATION_ID: INSTALLATION_ID });
  const ctx = await bindCompany(iam.prisma, baseConfig, { actor: "smoke", createCompanyName: "Smoke Test Company" });
  const identity = await issueServiceIdentity(iam.prisma, baseConfig, new WorkshopServiceIdentityProvider(), { actor: "smoke", issuanceKind: "WORKSHOP" });

  const operatorId = randomUUID();
  const permissions = new ports.AllowlistPermissionPort();
  permissions.grant(operatorId, types.ALL_DATAHUB_PERMISSION_KEYS);
  permissions.grant(identity.identityId, [types.PermissionKeys.IAM_RESULTS_RETURN_WRITE, types.PermissionKeys.IAM_RESULTS_RETURN_READ, types.PermissionKeys.IAM_GOVERNED_INPUT_READ]);
  const storage = new LocalStorageAdapter(path.join(hubDir, "storage"));
  await storage.ensureReady();
  const license = new lic.InMemoryCompanyLicensePort();
  license.seed(DEFAULT_COMPANY_ID, { licensedModules: [], enabledModules: [], timeZone: "America/Chicago" });
  const { app } = await buildDataHubApp({
    db: hub,
    bus: createDataHubBus(new InProcessOutboxDelivery()),
    permissionPort: permissions,
    storage,
    productAdminIdentityIds: new Set(),
    companyLocationPort: new loc.InMemoryCompanyLocationPort(),
    companyLicensePort: license,
    iamResultsReturnServiceIdentityIds: new Set([identity.identityId]),
    iamResultsReturnEligibility: { async check() { return { eligible: true }; } },
  });
  cleanups.push(() => app.close());
  const hubBase = new URL((await app.listen({ port: 0, host: "127.0.0.1" })).replace("[::1]", "127.0.0.1")).origin;
  const hdr = () => ({ "x-identity-id": operatorId, "x-user-id": operatorId, "x-company-id": DEFAULT_COMPANY_ID, "x-correlation-id": randomUUID() });
  for (const [family, csv] of [["OPEN_PURCHASE_ORDER_LINE", PO_CSV], ["CUSTOMER_BACKORDER_LINE", BO_CSV]] as const) {
    const created = await app.inject({ method: "POST", url: "/api/v1/data-sources", headers: hdr(), payload: { name: `smoke-${family}-${randomUUID().slice(0, 6)}`, sourceType: "FILE", systemName: "Keystroke" } });
    const id = created.json().dataSourceId as string;
    await app.inject({ method: "PATCH", url: `/api/v1/data-sources/${id}`, headers: hdr(), payload: { status: "ACTIVE" } });
    const imp = await app.inject({ method: "POST", url: "/api/v1/imports/csv", headers: hdr(), payload: { dataSourceId: id, objectFamily: family, csv, originalName: "SMOKE-STRUCTURE-ONLY.csv", approvePendingMappings: true } });
    if (![200, 201].includes(imp.statusCode)) throw new Error(`Data Hub import failed: ${imp.body}`);
  }
  const hubConfig = makeConfig({ IAM_INSTALLATION_ID: INSTALLATION_ID, DATA_HUB_BASE_URL: hubBase, IAM_SERVICE_IDENTITY_ID: identity.identityId });
  const client = new DataHubClient({ config: hubConfig, identity: { identityId: identity.identityId, credentialRef: null } });

  // ---- 3. seed realistic Stage 4D data (all times relative to now) ---------------------------------------------------------------
  const db: PrismaClient = iam.prisma;
  const mk = async (key: string, title: string, created: Date, direction: string) => {
    const r = await ingestGovernedEvidence(db, ctx, MANAGER, {
      evidence: [evidence(`${key}-1`, { conditionKey: title }), evidence(`${key}-2`, { conditionKey: title }), evidence(`${key}-3`, { conditionKey: title })],
      sourceRunId: `smoke-run-${key}`,
      describe: describeGroup({ title, recommendedActionDirection: direction }),
      at: created,
    });
    const id = r.groups[0]!.candidateId;
    await presentCandidate(db, ctx, MANAGER, id, { at: new Date(created.getTime() + H) });
    return id;
  };
  const planDetail = (objective: string, primary: string) => ({
    objective,
    metric: { name: "Open excess purchase-order value", target: 0, direction: "REDUCE", unit: "USD" },
    primaryAction: { title: primary, department: "Purchasing" },
    supportingActions: [{ title: "Confirm vendor cancellation terms" }],
    alternativeActions: [{ title: "Defer deliveries by 30 days" }],
    escalationActions: [{ title: "Escalate to the vendor account manager" }],
    notRecommended: [{ title: "Return received stock", reason: "Restocking fees exceed the carrying cost saved" }],
    dependencies: ["Vendor agreement to cancel open lines"],
    constraints: ["Some lines are inside the vendor's cancellation window"],
    assumptions: ["Demand stays at the trailing 13-week level"],
    feasibility: { level: "LIKELY_FEASIBLE", basis: "Vendor has accepted cancellations before" },
  });

  const A = await mk("A", "Excess open purchase orders - Vendor A", d(-4), "Cancel or defer open purchase orders for the affected items.");
  const B = await mk("B", "Customer backorders on SKU 37053 - recover supply", d(-4), "Expedite supply for SKU 37053 and communicate promise dates.");
  await recordScoringInputs(db, ctx, SYSTEM_ACTOR, A, { ...fromPoints(P80), dataConfidence: "HIGH" }, { at: d(-3) });
  await recordScoringInputs(db, ctx, SYSTEM_ACTOR, B, { ...fromPoints(P89), dataConfidence: "MEDIUM" }, { at: d(-3) });

  // C: an approved, started action from a prior week (Holdover) with measured condition reduction.
  const C = await mk("C", "Slow-moving fasteners - reduce open orders", d(-14), "Reduce open orders on slow-moving fasteners.");
  await approveCandidate(db, ctx, MANAGER, C, {
    plan: { summary: "Cancel the three oldest open POs and defer the remainder by 30 days.", detail: planDetail("Cut excess open PO value", "Cancel the three oldest open POs") },
    assignment: { responsibleDepartment: "Purchasing", taskOwnerId: "owner-1", taskOwnerName: "Olivia Owner" },
    targetStart: dateOnly(-12),
    targetResolution: dateOnly(14),
    baselineExposure: 5000,
    exposureUnit: "USD",
    at: d(-12),
  });
  await acceptOwnership(db, ctx, { actorId: "owner-1", role: "OPERATOR", displayName: "Olivia Owner" }, C, { at: d(-12) });
  await startAction(db, ctx, { actorId: "owner-1", role: "OPERATOR" }, C, { at: d(-11) });
  await updateProgress(db, ctx, { actorId: "owner-1", role: "OPERATOR" }, C, { actionCompletionPct: 40, nextMilestone: "Vendor confirmation", nextMilestoneDue: dateOnly(3), at: d(-2) });
  await updateConditionReduction(db, ctx, { actorId: "owner-1", role: "OPERATOR" }, C, { baselineExposure: 5000, currentExposure: 3500, exposureUnit: "USD", at: d(-2) });

  // D: an action whose owner has asked to pause it (needs a management decision).
  const D = await mk("D", "Seasonal overstock - Garden", d(-13), "Defer seasonal purchase orders.");
  await approveCandidate(db, ctx, MANAGER, D, {
    plan: { summary: "Defer seasonal purchase orders until Q2.", detail: planDetail("Avoid carrying seasonal overstock", "Defer seasonal purchase orders") },
    assignment: { responsibleDepartment: "Merchandising", taskOwnerId: "owner-2", taskOwnerName: "Owen Owner" },
    targetStart: dateOnly(-10),
    targetResolution: dateOnly(20),
    baselineExposure: 8000,
    exposureUnit: "USD",
    at: d(-10),
  });
  await acceptOwnership(db, ctx, { actorId: "owner-2", role: "OPERATOR" }, D, { at: d(-10) });
  await startAction(db, ctx, { actorId: "owner-2", role: "OPERATOR" }, D, { at: d(-9) });
  await requestPause(db, ctx, { actorId: "owner-2", role: "OPERATOR" }, D, { reason: "Vendor holds the open lines until the end of the month.", at: t(-20) });

  // E: completed with a measured reduction (Results and What's Working Well).
  const E = await mk("E", "Obsolete electrical stock - clear", d(-22), "Liquidate obsolete electrical stock.");
  await approveCandidate(db, ctx, MANAGER, E, {
    plan: { summary: "Clear obsolete electrical stock through the liquidation channel." },
    assignment: { responsibleDepartment: "Sales", taskOwnerId: "owner-1", taskOwnerName: "Olivia Owner" },
    targetStart: dateOnly(-20),
    targetResolution: dateOnly(-4),
    baselineExposure: 2000,
    exposureUnit: "USD",
    at: d(-20),
  });
  await acceptOwnership(db, ctx, { actorId: "owner-1", role: "OPERATOR" }, E, { at: d(-20) });
  await startAction(db, ctx, { actorId: "owner-1", role: "OPERATOR" }, E, { at: d(-19) });
  await updateConditionReduction(db, ctx, { actorId: "owner-1", role: "OPERATOR" }, E, { baselineExposure: 2000, currentExposure: 400, exposureUnit: "USD", at: d(-5) });
  await updateProgress(db, ctx, { actorId: "owner-1", role: "OPERATOR" }, E, { actionCompletionPct: 100, at: d(-4) });
  await completeAction(db, ctx, { actorId: "owner-1", role: "OPERATOR" }, E, { at: d(-3) });

  // Scoring run (explicit; the board never runs it) and Health calculations (prior week, then now), with governed evidence.
  await runScoring(db, ctx, SYSTEM_ACTOR, { at: t(-2), runKey: "smoke-weekly" });
  // Stage 4D-R: Position & Balance, Efficiency and Slow / Nonmoving come through the REAL governed path:
  //   RSE-structured MANAGEMENT_SNAPSHOT -> real Data Hub Results Return receive route -> governed read endpoint -> IAM client
  //   -> ingestRseHealthInputs -> iam_core_health_evidence -> calculateHealth. Nothing here reads an RSE database or file.
  const { RSE_PRE_RESULTS_RETURN_V1, RSE_PRE_RESULTS_RETURN_CONTRACT_VERSION } = await mod("domain/step10-results-return.ts");
  const postRseSnapshot = async (runId: string, producerEventAt: Date, s: { inv: number; under: number; over: number; turns: number }) => {
    const snapshot = {
      snapshotVersion: 1,
      recommendationType: "MANAGEMENT_SNAPSHOT",
      salesDollarLabel: "Annual Sales $",
      catalog: { skuCount: 900, inventoryValue: s.inv, underDollars: s.under, overDollars: s.over, impliedTurns: s.turns, belowMinCount: 80, aboveMaxCount: 140, dataGapCount: 3 },
      classificationByClass: [
        { classCode: "A", skuCount: 120, skuPercent: 13.3, salesDollars: 600000, salesPercent: 60, grossProfitDollars: 210000, grossProfitPercent: 35, inventoryValue: 90000, impliedTurns: 6, belowMinCount: 12, aboveMaxCount: 8, dataGapCount: 0, underDollars: 4000, overDollars: 3000 },
        { classCode: "F", skuCount: 150, skuPercent: 16.7, salesDollars: 0, salesPercent: 0, grossProfitDollars: 0, grossProfitPercent: 0, inventoryValue: 9000, impliedTurns: 0, belowMinCount: 0, aboveMaxCount: 150, dataGapCount: 0, underDollars: 0, overDollars: 9000 },
      ],
      fParkedCash: { value: 9000, unit: "USD", basis: "f_class_over_max_do_not_stock" },
      dOverMaxCash: null,
      financialImpact: null,
      cashImpact: null,
      observations: [],
      preStatus: { suggestedDollars: 0, approvedDollars: 0, buyerReviewCount: 0, approvedSkuCount: 0, exportReadyVendorCount: 0, exceptionCount: 0 },
      rseModuleHealth: { score: 70, color: "yellow", provenance: "MODULE_CALCULATED", notEnterpriseHealthScore: true },
    };
    const iso = producerEventAt.toISOString();
    const res = await app.inject({
      method: "POST",
      url: `/api/v1/companies/${DEFAULT_COMPANY_ID}/knowledge/results-return/events`,
      headers: hdr(),
      payload: {
        envelope: { producerEventId: randomUUID(), contractId: RSE_PRE_RESULTS_RETURN_V1, contractVersion: RSE_PRE_RESULTS_RETURN_CONTRACT_VERSION, companyId: DEFAULT_COMPANY_ID, originatingModule: "RSE", eventType: "RECOMMENDATION", producerEventAt: iso, sourceReferenceId: `mgmt-snapshot:${runId}`, recommendationVersion: 1, recommendationCorrelationId: `mgmt-snapshot:${runId}` },
        origin: { runId, providerMode: "DIRECT", businessCutoffAt: iso },
        recommendation: { recommendationIdentity: `mgmt-snapshot:${runId}`, recommendationType: "MANAGEMENT_SNAPSHOT", modulePriority: "Medium", recommendedAction: "Management snapshot", recommendedParameters: snapshot, itemScope: "RUN", locationScope: "*" },
      },
    });
    if (res.statusCode !== 201) throw new Error(`RSE snapshot post failed: ${res.body}`);
  };
  const seedCanonical = async (objectType: string, businessKey: string, payload: Record<string, unknown>) => {
    const rid = randomUUID();
    const vid = randomUUID();
    const now = new Date();
    await hub.canonicalRecord.create({ data: { canonicalRecordId: rid, companyId: DEFAULT_COMPANY_ID, objectType, businessKey, currentVersionId: vid, publicationStatus: "PUBLISHED", createdAt: now, updatedAt: now } });
    await hub.canonicalRecordVersion.create({ data: { canonicalVersionId: vid, companyId: DEFAULT_COMPANY_ID, canonicalRecordId: rid, version: 1, payloadJson: JSON.stringify(payload), observedAt: now, confidence: "HIGH", sourceCount: 1, publicationStatus: "PUBLISHED", importBatchId: "smoke-batch", createdAt: now, createdBy: "smoke" } });
  };
  const rseProvider = createDataHubRseHealthProvider(client);
  // TEST_FIXTURE_ONLY: a synthetic revenue basis so the Customer Backorder severity can be judged in the smoke. NO turns or GMROI target
  // is seeded: those are governed company configuration (4DR-C3). To exercise Efficiency, add a TEST-ONLY target through the real
  // management route (PUT /api/dpos/health/targets {"turnsTarget": 4}) and remove it again ({"turnsTarget": null}).
  const facts = (when: Date) => recordHealthEvidence(db, ctx, MANAGER, "COMPANY_FACTS", { averageWeeklyRevenue: 120000, note: "TEST_FIXTURE_ONLY" }, { sourceRefs: ["smoke-test-fixture"], at: when });
  const postRseLine = async (runId: string, sku: string, annualSalesDollars: number, annualGrossProfitDollars: number) => {
    const iso = t(-3).toISOString();
    const res = await app.inject({
      method: "POST",
      url: `/api/v1/companies/${DEFAULT_COMPANY_ID}/knowledge/results-return/events`,
      headers: hdr(),
      payload: {
        envelope: { producerEventId: randomUUID(), contractId: RSE_PRE_RESULTS_RETURN_V1, contractVersion: RSE_PRE_RESULTS_RETURN_CONTRACT_VERSION, companyId: DEFAULT_COMPANY_ID, originatingModule: "RSE", eventType: "RECOMMENDATION", producerEventAt: iso, sourceReferenceId: `line:${runId}:${sku}`, recommendationVersion: 1, recommendationCorrelationId: `line:${runId}:${sku}` },
        origin: { runId, providerMode: "DIRECT", businessCutoffAt: iso },
        recommendation: { recommendationIdentity: `line:${runId}:${sku}`, recommendationType: "MIN_MAX", modulePriority: "Medium", recommendedAction: "Set min/max", recommendedParameters: { recommendedMin: 1, recommendedMax: 2, annualSalesDollars, annualGrossProfitDollars }, itemScope: sku, locationScope: "MAIN" },
      },
    });
    if (res.statusCode !== 201) throw new Error(`RSE line post failed: ${res.body}`);
  };
  const backorder = createDataHubBackorderProvider(client);
  await postRseSnapshot("smoke-rse-run-1", d(-12), { inv: 250000, under: 9000, over: 22000, turns: 2.8 });
  await facts(d(-12));
  const first = await ingestRseHealthInputs(db, ctx, MANAGER, rseProvider, { at: d(-12) });
  console.log("SMOKE RSE INGEST #1", JSON.stringify(first.components.map((c) => [c.kind, c.status, c.reason])));
  await calculateHealth(db, ctx, MANAGER, { at: d(-12), backorder });
  await postRseSnapshot("smoke-rse-run-2", t(-3), { inv: 250000, under: 6000, over: 22000, turns: 3.3 });
  const asOf = t(-3).toISOString();
  const lastSold = (days: number) => new Date(t(-3).getTime() - days * 24 * H).toISOString();
  const seedItems: Array<[string, number, number, number | null]> = [["SMK-1", 100, 40, 10], ["SMK-2", 50, 100, 100], ["SMK-3", 40, 100, 150], ["SMK-4", 200, 10, 300], ["SMK-5", 30, 100, null]];
  for (const [item, onHand, cost, days] of seedItems) await seedCanonical("INVENTORY_POSITION", `${item}|MAIN|${asOf}`, { itemRef: item, locationRef: "MAIN", asOf, onHand, unitCost: cost, ...(days === null ? {} : { lastSoldDate: lastSold(days) }) });
  // governed RSE demand (PRIMARY) for SMK-2; SMK-3 has only the lower-confidence recent-sales fallback
  await postRseLine("smoke-rse-run-2", "SMK-2", 5000, 1500);
  await seedCanonical("SALES_PERIOD_FACT", "SMK-3|p1", { sourceItemId: "SMK-3", reportingPeriodStart: d(-100).toISOString(), reportingPeriodEnd: d(-10).toISOString(), quantitySold: 5, totalCost: 900 });
  await seedCanonical("SALES_PERIOD_FACT", "SMK-2|p1", { sourceItemId: "SMK-2", reportingPeriodStart: d(-100).toISOString(), reportingPeriodEnd: d(-10).toISOString(), quantitySold: 10, totalCost: 2000 });
  // The second RSE snapshot, the positions and the sales facts are deliberately NOT ingested here: the smoke clicks the real
  // "Refresh from Data Hub" (POST /api/dpos/refresh), which must pull them in and recalculate Health by itself (4DR-C4).
  await calculateHealth(db, ctx, MANAGER, { at: t(-3), backorder });

  // ---- 4. IAM next dev in integrated mode + front-door proxy ---------------------------------------------------------------------
  const fixtures = await loadDposFixtures(dposRoot!);
  const reg = writeAttainableRegistry(dposRoot!);
  cleanups.push(() => fs.rmSync(reg.dir, { recursive: true, force: true }));
  const inst = fixtures.createModuleInstallation({ companyId: DEFAULT_COMPANY_ID, entitledModules: ["IAM"], ready: ["IAM"], enabled: ["IAM"], registryFile: reg.file });
  cleanups.push(() => fs.rmSync(inst.base, { recursive: true, force: true }));
  const env = {
    ...process.env,
    NODE_ENV: "development",
    DATABASE_URL: sqliteUrl(iam.file),
    IAM_DEPLOYMENT_MODE: "DPOS_INTEGRATED",
    IAM_ENVIRONMENT_CLASS: "TEST",
    IAM_CONFIGURATION_ID: "cfg-test-1",
    IAM_DPOS_COMPANY_ID: DEFAULT_COMPANY_ID,
    IAM_DATA_HUB_COMPANY_ID: DEFAULT_COMPANY_ID,
    IAM_INSTALLATION_ID: INSTALLATION_ID,
    IAM_COMPANY_TIME_ZONE: "America/Chicago",
    DATA_HUB_BASE_URL: hubBase,
    IAM_SERVICE_IDENTITY_ID: identity.identityId,
    IAM_DPOS_APPLICATION_ROOT: `${inst.base}/app`,
    IAM_DPOS_INSTALLATION_ROOT: inst.root,
    IAM_ELIGIBILITY_CACHE_TTL_MS: "0",
    IAM_FRONT_DOOR_CREDENTIAL: SECRET,
  } as NodeJS.ProcessEnv;
  const next = spawn(process.execPath, [path.join(process.cwd(), "node_modules", "next", "dist", "bin", "next"), "dev", "--port", String(NEXT_PORT)], { cwd: process.cwd(), env, stdio: ["ignore", "pipe", "pipe"] });
  children.push(next);
  next.stdout?.on("data", (b) => process.stdout.write(`[next] ${b}`));
  next.stderr?.on("data", (b) => process.stderr.write(`[next] ${b}`));

  const USERS: Record<string, { id: string; roles: string }> = { manager: { id: "mgr-1", roles: "MANAGER" }, owner: { id: "owner-1", roles: "OPERATOR" }, viewer: { id: "viewer-1", roles: "VIEW_ONLY" } };
  const proxy = http.createServer((req, res) => {
    const url = req.url ?? "/";
    const m = /^\/__as\/(manager|owner|viewer)/.exec(url);
    if (m) {
      res.writeHead(302, { "set-cookie": `smoke_user=${m[1]}; Path=/`, location: "/board" });
      res.end();
      return;
    }
    const who = /smoke_user=(manager|owner|viewer)/.exec(req.headers.cookie ?? "")?.[1] ?? "manager";
    const u = USERS[who]!;
    const headers = { ...req.headers, host: `127.0.0.1:${NEXT_PORT}`, "x-service-identity": FRONT_DOOR_SERVICE_ID, "x-service-credential": SECRET, "x-identity-id": `identity-${u.id}`, "x-user-id": u.id, "x-company-id": DEFAULT_COMPANY_ID, "x-roles": u.roles, "x-dpos-allowed-modules": "IAM" };
    const up = http.request({ host: "127.0.0.1", port: NEXT_PORT, path: url, method: req.method, headers }, (r) => {
      res.writeHead(r.statusCode ?? 502, r.headers);
      r.pipe(res);
    });
    up.on("error", (e) => { res.writeHead(502); res.end(String(e)); });
    req.pipe(up);
  });
  await new Promise<void>((r) => proxy.listen(PROXY_PORT, "127.0.0.1", r));
  cleanups.push(() => new Promise<void>((r) => proxy.close(() => r())));
  fs.writeFileSync(path.join(os.tmpdir(), "iam-4d-smoke.json"), JSON.stringify({ proxy: `http://127.0.0.1:${PROXY_PORT}`, next: `http://127.0.0.1:${NEXT_PORT}`, dataHub: hubBase, candidates: { A, B, C, D, E }, iamDb: iam.file }, null, 2));
  console.log(`SMOKE READY proxy=http://127.0.0.1:${PROXY_PORT} next=${NEXT_PORT} dataHub=${hubBase}`);
  console.log(`SMOKE CANDIDATES A=${A} B=${B} C=${C} D=${D} E=${E}`);
}

main().catch((e) => {
  console.error("SMOKE FAILED", e);
  void shutdown();
});
