/**
 * The REAL V1.5 route handlers (wrapped by withDposAccess) and the new /api/dpos/* endpoints, exercised in-process.
 *  - STANDALONE_LEGACY: byte-for-byte V1.5 behaviour (no headers needed).
 *  - DPOS_INTEGRATED: governed company + eligibility chain + company-scoped resources.
 * The global Prisma client is pointed at a throw-away migrated database BEFORE any application module is imported.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import { after, before, describe, it } from "node:test";
import { bindCompany } from "../../src/lib/dpos/company-context";
import { FRONT_DOOR_SERVICE_ID } from "../../src/lib/dpos/access-guard";
import { WorkshopServiceIdentityProvider, issueServiceIdentity } from "../../src/lib/dpos/service-identity";
import { sqliteUrl } from "../../src/lib/dpos/migrate/governed-migrate";
import { createTestDb, DEFAULT_COMPANY_ID, findDposRoot, loadDposFixtures, makeConfig, uuid, writeAttainableRegistry, type TestDb } from "./helpers";

const dposRoot = findDposRoot();
const skip = dposRoot ? false : "DPOS repository not found (set DPOS_REPO_ROOT)";
const SECRET = "front-door-route-test-secret";
const INSTALLATION_ID = "front-door-test-installation";

const INTEGRATED_KEYS = [
  "IAM_DEPLOYMENT_MODE", "IAM_ENVIRONMENT_CLASS", "IAM_CONFIGURATION_ID", "IAM_DPOS_COMPANY_ID", "IAM_DATA_HUB_COMPANY_ID", "IAM_INSTALLATION_ID",
  "IAM_COMPANY_TIME_ZONE", "DATA_HUB_BASE_URL", "IAM_SERVICE_IDENTITY_ID", "IAM_DPOS_APPLICATION_ROOT", "IAM_DPOS_INSTALLATION_ROOT",
  "IAM_ELIGIBILITY_CACHE_TTL_MS", "IAM_FRONT_DOOR_CREDENTIAL",
] as const;

function headers(over: Record<string, string> = {}): Record<string, string> {
  return {
    "x-service-identity": FRONT_DOOR_SERVICE_ID,
    "x-service-credential": SECRET,
    "x-identity-id": "identity-user-1",
    "x-user-id": "user-1",
    "x-company-id": DEFAULT_COMPANY_ID,
    "x-roles": "OPERATOR",
    "x-dpos-allowed-modules": "IAM",
    ...over,
  };
}
const req = (url: string, init: RequestInit & { headers?: Record<string, string> } = {}) => new Request(`http://iam.test${url}`, init);

describe("route guard on the real handlers", { skip }, () => {
  let t: TestDb;
  let reg: { file: string; dir: string };
  const tmp: string[] = [];
  let routes: {
    runs: typeof import("../../src/app/api/runs/route");
    run: typeof import("../../src/app/api/runs/[runId]/route");
    seed: typeof import("../../src/app/api/seed/route");
    oec: typeof import("../../src/app/api/companies/[companyId]/oec/route");
    dposStatus: typeof import("../../src/app/api/dpos/status/route");
    dposRefresh: typeof import("../../src/app/api/dpos/refresh/route");
    dposOutbox: typeof import("../../src/app/api/dpos/outbox/route");
  };
  let fixtures: Awaited<ReturnType<typeof loadDposFixtures>>;
  let runA = "";
  let runB = "";
  let otherCompanyId = "";

  const useInstallation = (opts: { entitled: string[]; ready?: string[]; enabled?: string[] }) => {
    const fx = fixtures.createModuleInstallation({ companyId: DEFAULT_COMPANY_ID, entitledModules: opts.entitled, ready: opts.ready, enabled: opts.enabled, registryFile: reg.file });
    tmp.push(fx.base);
    process.env.IAM_DPOS_APPLICATION_ROOT = `${fx.base}/app`;
    process.env.IAM_DPOS_INSTALLATION_ROOT = fx.root;
  };
  const integrated = (identityId?: string) => {
    Object.assign(process.env, {
      IAM_DEPLOYMENT_MODE: "DPOS_INTEGRATED",
      IAM_ENVIRONMENT_CLASS: "TEST",
      IAM_CONFIGURATION_ID: "cfg-test-1",
      IAM_DPOS_COMPANY_ID: DEFAULT_COMPANY_ID,
      IAM_DATA_HUB_COMPANY_ID: DEFAULT_COMPANY_ID,
      IAM_INSTALLATION_ID: INSTALLATION_ID,
      IAM_COMPANY_TIME_ZONE: "America/Chicago",
      DATA_HUB_BASE_URL: "http://127.0.0.1:9",
      IAM_ELIGIBILITY_CACHE_TTL_MS: "0",
      IAM_FRONT_DOOR_CREDENTIAL: SECRET,
      ...(identityId ? { IAM_SERVICE_IDENTITY_ID: identityId } : {}),
    });
  };

  before(async () => {
    t = await createTestDb();
    process.env.DATABASE_URL = sqliteUrl(t.file); // the global prisma used by the route handlers
    reg = writeAttainableRegistry(dposRoot!);
    fixtures = await loadDposFixtures(dposRoot!);
    const config = makeConfig({ IAM_INSTALLATION_ID: INSTALLATION_ID });
    const ctx = await bindCompany(t.prisma, config, { actor: "op", createCompanyName: "Route Co" });
    const other = await t.prisma.company.create({ data: { name: "Other Co" } });
    otherCompanyId = other.id;
    const mk = (companyId: string, name: string) =>
      t.prisma.iamRun.create({ data: { companyId, runName: name, reviewDate: new Date("2026-05-01"), reviewWeekStart: new Date("2026-04-27"), reviewWeekEnd: new Date("2026-05-03") } });
    runA = (await mk(ctx.iamCompanyId, "Bound company cycle")).id;
    runB = (await mk(other.id, "Other company cycle")).id;
    const identity = await issueServiceIdentity(t.prisma, config, new WorkshopServiceIdentityProvider(), { actor: "op", issuanceKind: "WORKSHOP" });
    process.env.TEST_IDENTITY_ID = identity.identityId;
    routes = {
      runs: await import("../../src/app/api/runs/route"),
      run: await import("../../src/app/api/runs/[runId]/route"),
      seed: await import("../../src/app/api/seed/route"),
      oec: await import("../../src/app/api/companies/[companyId]/oec/route"),
      dposStatus: await import("../../src/app/api/dpos/status/route"),
      dposRefresh: await import("../../src/app/api/dpos/refresh/route"),
      dposOutbox: await import("../../src/app/api/dpos/outbox/route"),
    };
  });
  after(async () => {
    for (const k of INTEGRATED_KEYS) delete process.env[k];
    await (await import("../../src/lib/db")).prisma.$disconnect(); // release the file before the temp dir is removed
    await t.close();
    for (const d of [...tmp, reg?.dir].filter(Boolean)) fs.rmSync(d as string, { recursive: true, force: true });
  });

  it("STANDALONE_LEGACY (default): V1.5 handlers behave exactly as before — all companies, no headers required", async () => {
    for (const k of INTEGRATED_KEYS) delete process.env[k];
    const list = await routes.runs.GET(req("/api/runs"));
    assert.equal(list.status, 200);
    const body = (await list.json()) as { runs: Array<{ id: string }> };
    assert.deepEqual(body.runs.map((r) => r.id).sort(), [runA, runB].sort());
    const one = await routes.run.GET(req(`/api/runs/${runB}`), { params: Promise.resolve({ runId: runB }) });
    assert.equal(one.status, 200);
  });

  it("DPOS_INTEGRATED: no trusted front door => closed", async () => {
    integrated();
    useInstallation({ entitled: ["IAM"], ready: ["IAM"], enabled: ["IAM"] });
    const r = await routes.runs.GET(req("/api/runs"));
    assert.equal(r.status, 401);
    assert.equal(((await r.json()) as { error: { code: string } }).error.code, "END_USER_CONTEXT_REQUIRED");
  });

  it("DPOS_INTEGRATED: an eligible user reaches V1.5 behaviour, scoped to the bound company", async () => {
    integrated();
    useInstallation({ entitled: ["IAM"], ready: ["IAM"], enabled: ["IAM"] });
    const list = await routes.runs.GET(req("/api/runs", { headers: headers() }));
    assert.equal(list.status, 200);
    assert.deepEqual(((await list.json()) as { runs: Array<{ id: string }> }).runs.map((r) => r.id), [runA]);
    const own = await routes.run.GET(req(`/api/runs/${runA}`, { headers: headers() }), { params: Promise.resolve({ runId: runA }) });
    assert.equal(own.status, 200);
  });

  it("DPOS_INTEGRATED: another company's review cycle is not found (never leaked)", async () => {
    integrated();
    useInstallation({ entitled: ["IAM"], ready: ["IAM"], enabled: ["IAM"] });
    const foreign = await routes.run.GET(req(`/api/runs/${runB}`, { headers: headers() }), { params: Promise.resolve({ runId: runB }) });
    assert.equal(foreign.status, 404);
  });

  it("DPOS_INTEGRATED: not entitled / not ready / disabled / user not authorized are all blocked on real routes", async () => {
    integrated();
    const cases: Array<[string, { entitled: string[]; ready?: string[]; enabled?: string[] }, Record<string, string>]> = [
      ["NOT_ENTITLED", { entitled: ["DATA_HUB"] }, headers()],
      ["NOT_READY", { entitled: ["IAM"], ready: [], enabled: [] }, headers()],
      ["DISABLED", { entitled: ["IAM"], ready: ["IAM"], enabled: [] }, headers()],
      ["USER_NOT_AUTHORIZED", { entitled: ["IAM"], ready: ["IAM"], enabled: ["IAM"] }, headers({ "x-dpos-allowed-modules": "DECISION_BOARD" })],
    ];
    for (const [state, install, h] of cases) {
      useInstallation(install);
      const r = await routes.runs.GET(req("/api/runs", { headers: h }));
      assert.ok(r.status >= 400, `${state} must be blocked (got ${r.status})`);
      const j = (await r.json()) as { error: { details?: { state: string } } };
      assert.equal(j.error.details?.state, state);
    }
  });

  it("DPOS_INTEGRATED: a service identity (Results Return path) cannot be used as an end user", async () => {
    integrated();
    useInstallation({ entitled: ["IAM"], ready: ["IAM"], enabled: ["IAM"] });
    const r = await routes.runs.GET(req("/api/runs", { headers: headers({ "x-identity-id": process.env.TEST_IDENTITY_ID!, "x-user-id": process.env.TEST_IDENTITY_ID! }) }));
    assert.equal(r.status, 403);
    assert.equal(((await r.json()) as { error: { code: string } }).error.code, "SERVICE_IDENTITY_NOT_END_USER");
  });

  it("DPOS_INTEGRATED: demo/seed routes are unavailable and a path company id must be the bound company", async () => {
    integrated();
    useInstallation({ entitled: ["IAM"], ready: ["IAM"], enabled: ["IAM"] });
    const seed = await routes.seed.POST(req("/api/seed", { method: "POST", headers: headers() }));
    assert.equal(seed.status, 403);
    assert.equal(((await seed.json()) as { error: { code: string } }).error.code, "NOT_AVAILABLE_IN_INTEGRATED_MODE");
    const oec = await routes.oec.POST(req(`/api/companies/${otherCompanyId}/oec`, { method: "POST", headers: headers(), body: "{}" }), { params: Promise.resolve({ companyId: otherCompanyId }) });
    assert.equal(oec.status, 403);
    assert.equal(((await oec.json()) as { error: { code: string } }).error.code, "COMPANY_MISMATCH");
  });

  it("an invalid integration configuration fails closed (503), never falls back to standalone", async () => {
    integrated();
    process.env.IAM_DATA_HUB_COMPANY_ID = uuid();
    const r = await routes.runs.GET(req("/api/runs", { headers: headers() }));
    assert.equal(r.status, 503);
    integrated();
  });

  it("/api/dpos/status is eligibility-enforced and reports context, eligibility chain, identity, refresh and outbox", async () => {
    integrated(process.env.TEST_IDENTITY_ID);
    useInstallation({ entitled: ["IAM"], ready: ["IAM"], enabled: ["IAM"] });
    const denied = await routes.dposStatus.GET(req("/api/dpos/status"), undefined as never);
    assert.equal(denied.status, 401);
    const r = await routes.dposStatus.GET(req("/api/dpos/status", { headers: headers() }), undefined as never);
    assert.equal(r.status, 200);
    const j = (await r.json()) as Record<string, any>;
    assert.equal(j.companyContext.dposCompanyId, DEFAULT_COMPANY_ID);
    assert.equal(j.eligibility.allowed, true);
    assert.deepEqual(j.eligibility.chain, { INSTALLED: true, ENTITLED: true, IMPLEMENTATION_READY: true, ENABLED: true, USER_AUTHORIZED: true });
    assert.equal(j.serviceIdentities.length, 1);
    assert.equal(j.refresh.nextScheduledRefreshAt !== null, true);
    assert.equal(j.config.environmentClass, "TEST");
    assert.doesNotMatch(JSON.stringify(j), new RegExp(SECRET), "no secret is ever returned");
  });

  it("manual refresh requires an administrative role, records a failed attempt when Data Hub is unreachable, and the outbox flush endpoint is guarded", async () => {
    integrated(process.env.TEST_IDENTITY_ID);
    useInstallation({ entitled: ["IAM"], ready: ["IAM"], enabled: ["IAM"] });
    const viewer = await routes.dposRefresh.POST(req("/api/dpos/refresh", { method: "POST", headers: headers({ "x-roles": "VIEW_ONLY" }) }), undefined as never);
    assert.equal(viewer.status, 403);
    const r = await routes.dposRefresh.POST(req("/api/dpos/refresh", { method: "POST", headers: headers() }), undefined as never);
    assert.equal(r.status, 502);
    const j = (await r.json()) as { ok: boolean; failureCategory: string; trigger: string };
    assert.equal(j.ok, false);
    assert.equal(j.trigger, "MANUAL_REFRESH");
    assert.equal(j.failureCategory, "TEMPORARY_TECHNICAL");
    assert.equal(await t.prisma.dposRefreshAttempt.count({ where: { trigger: "MANUAL_REFRESH", status: "FAILED" } }), 1);
    const flush = await routes.dposOutbox.POST(req("/api/dpos/outbox", { method: "POST", headers: headers() }), undefined as never);
    assert.equal(flush.status, 200);
    const noAuth = await routes.dposOutbox.POST(req("/api/dpos/outbox", { method: "POST" }), undefined as never);
    assert.equal(noAuth.status, 401);
  });

  it("/api/dpos/* do not exist in STANDALONE_LEGACY mode", async () => {
    for (const k of INTEGRATED_KEYS) delete process.env[k];
    const r = await routes.dposStatus.GET(req("/api/dpos/status", { headers: headers() }), undefined as never);
    assert.equal(r.status, 503);
    assert.equal(((await r.json()) as { error: { code: string } }).error.code, "IAM_NOT_DPOS_INTEGRATED");
  });
});
