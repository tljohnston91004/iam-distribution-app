/**
 * IAM-internal eligibility enforcement: Installed -> Entitled -> Implementation Ready -> Enabled -> User Authorized.
 * Uses the REAL DPOS Stage 1B module-access runtime and its signed-entitlement test installation fixture (from the DPOS
 * repository: DPOS_REPO_ROOT, which must point at an isolated DPOS worktree; skipped visibly when unset). IAM is never marked Implementation Ready
 * in any real installation: the "allowed" case uses a TEST-ONLY registry copy in a temp directory.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { after, before, describe, it } from "node:test";
import { authorizeOperationalRequest, FRONT_DOOR_SERVICE_ID, type GuardResult } from "../../src/lib/dpos/access-guard";
import { bindCompany } from "../../src/lib/dpos/company-context";
import { createInstallationModuleEligibilityPort, NotConfiguredModuleEligibilityPort, type ModuleEligibilityPort } from "../../src/lib/dpos/eligibility";
import { createTestDb, DEFAULT_COMPANY_ID, findDposRoot, makeConfig, uuid, type TestDb } from "./helpers";

const dposRoot = findDposRoot();
const skip = dposRoot ? false : "DPOS repository not found (set DPOS_REPO_ROOT)";
const INSTALLATION_ID = "front-door-test-installation";
const FRONT_DOOR_SECRET = "front-door-test-secret";
const config = makeConfig({ IAM_INSTALLATION_ID: INSTALLATION_ID });
const env = { [config.frontDoor.credentialEnvName]: FRONT_DOOR_SECRET };

type Fixture = { base: string; root: string };
let fixtures: { createModuleInstallation(o: Record<string, unknown>): Fixture };
let attainableRegistry: string;
const tmpDirs: string[] = [];

function headers(over: Record<string, string> = {}) {
  const h: Record<string, string> = {
    "x-service-identity": FRONT_DOOR_SERVICE_ID,
    "x-service-credential": FRONT_DOOR_SECRET,
    "x-identity-id": "identity-user-1",
    "x-user-id": "user-1",
    "x-company-id": DEFAULT_COMPANY_ID,
    "x-roles": "OPERATOR",
    "x-dpos-allowed-modules": "IAM,DECISION_BOARD",
    ...over,
  };
  return new Headers(h);
}

describe("IAM eligibility enforcement", { skip }, () => {
  let t: TestDb;

  before(async () => {
    t = await createTestDb();
    await bindCompany(t.prisma, config, { actor: "test-operator", createCompanyName: "Eligibility Co" });
    fixtures = (await import(pathToFileURL(path.join(dposRoot!, "packages", "deployment", "operator-front-door", "tests", "module-installation-fixture.mjs")).href)) as typeof fixtures;
    // TEST-ONLY registry: IAM has a live service and an attainable readiness path, so the full chain can be exercised.
    const registry = JSON.parse(fs.readFileSync(path.join(dposRoot!, "release", "module-registry.json"), "utf8"));
    const iam = registry.modules.find((m: { moduleId: string }) => m.moduleId === "IAM");
    iam.service = { serviceId: "iam", kind: "DPOS_SERVICE" };
    iam.operationalService = true;
    iam.implementationReadiness.attainable = true;
    delete iam.implementationReadiness.notAttainableReason;
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "iam4a-registry-"));
    tmpDirs.push(dir);
    attainableRegistry = path.join(dir, "module-registry.json");
    fs.writeFileSync(attainableRegistry, JSON.stringify(registry, null, 2));
  });
  after(async () => {
    await t.close();
    for (const d of tmpDirs) fs.rmSync(d, { recursive: true, force: true });
  });

  function portFor(opts: { entitled: string[] | null; ready?: string[]; enabled?: string[]; registry?: string }): ModuleEligibilityPort {
    const fx = fixtures.createModuleInstallation({
      companyId: DEFAULT_COMPANY_ID,
      entitledModules: opts.entitled,
      ready: opts.ready,
      enabled: opts.enabled,
      ...(opts.registry ? { registryFile: opts.registry } : {}),
    });
    tmpDirs.push(fx.base);
    return createInstallationModuleEligibilityPort({
      applicationRoot: path.join(fx.base, "app"),
      installationRoot: fx.root,
      cacheTtlMs: 0,
    });
  }

  const guard = (eligibility: ModuleEligibilityPort, h = headers(), opts = {}): Promise<GuardResult> =>
    authorizeOperationalRequest(h, { db: t.prisma, config, eligibility, env }, opts);

  function denied(r: GuardResult): Extract<GuardResult, { ok: false }> {
    assert.equal(r.ok, false, "expected the request to be blocked");
    return r as Extract<GuardResult, { ok: false }>;
  }

  it("blocks when the company is not entitled to IAM (stops at ENTITLED)", async () => {
    const r = denied(await guard(portFor({ entitled: ["DATA_HUB", "DECISION_BOARD"], registry: attainableRegistry })));
    assert.equal((r.details as { blockedAt: string }).blockedAt, "ENTITLED");
    assert.equal((r.details as { state: string }).state, "NOT_ENTITLED");
    assert.ok(r.status === 403 || r.status === 409 || r.status === 402);
  });

  it("blocks when IAM is entitled but not Implementation Ready (stops at IMPLEMENTATION_READY)", async () => {
    const r = denied(await guard(portFor({ entitled: ["IAM", "DATA_HUB"], ready: ["DATA_HUB"], enabled: ["DATA_HUB"], registry: attainableRegistry })));
    assert.equal((r.details as { blockedAt: string }).blockedAt, "IMPLEMENTATION_READY");
    assert.equal((r.details as { state: string }).state, "NOT_READY");
  });

  it("blocks when IAM is ready but disabled (stops at ENABLED)", async () => {
    const r = denied(await guard(portFor({ entitled: ["IAM", "DATA_HUB"], ready: ["IAM", "DATA_HUB"], enabled: ["DATA_HUB"], registry: attainableRegistry })));
    assert.equal((r.details as { blockedAt: string }).blockedAt, "ENABLED");
    assert.equal((r.details as { state: string }).state, "DISABLED");
  });

  it("blocks a user whose DPOS access list does not include IAM (stops at USER_AUTHORIZED)", async () => {
    const port = portFor({ entitled: ["IAM"], ready: ["IAM"], enabled: ["IAM"], registry: attainableRegistry });
    const r = denied(await guard(port, headers({ "x-dpos-allowed-modules": "DECISION_BOARD,RSE" })));
    assert.equal((r.details as { blockedAt: string }).blockedAt, "USER_AUTHORIZED");
    assert.equal((r.details as { state: string }).state, "USER_NOT_AUTHORIZED");
    const none = denied(await guard(port, headers({ "x-dpos-allowed-modules": "" })));
    assert.equal((none.details as { blockedAt: string }).blockedAt, "USER_AUTHORIZED");
  });

  it("allows only when Installed, Entitled, Implementation Ready, Enabled and User Authorized all hold", async () => {
    const port = portFor({ entitled: ["IAM"], ready: ["IAM"], enabled: ["IAM"], registry: attainableRegistry });
    const r = await guard(port);
    assert.equal(r.ok, true, JSON.stringify(r));
    if (r.ok) {
      assert.deepEqual(r.verdict.chain, { INSTALLED: true, ENTITLED: true, IMPLEMENTATION_READY: true, ENABLED: true, USER_AUTHORIZED: true });
      assert.equal(r.verdict.blockedAt, null);
      assert.equal(r.context.dposCompanyId, DEFAULT_COMPANY_ID);
    }
    // role restriction for administrative endpoints stays an additional gate
    const roleDenied = denied(await guard(port, headers({ "x-roles": "VIEW_ONLY" }), { requireAnyRole: ["OWNER", "ADMINISTRATOR", "MANAGER", "OPERATOR"] }));
    assert.equal(roleDenied.code, "ROLE_NOT_PERMITTED");
  });

  it("the shipped DPOS registry (IAM not yet operational/attainable) still blocks an otherwise valid user — IAM is not Implementation Ready", async () => {
    const port = portFor({ entitled: ["IAM"], ready: [], enabled: [] });
    const r = denied(await guard(port));
    assert.equal((r.details as { state: string }).state, "NOT_READY");
  });

  it("an installation that does not match the configured IAM installation or company is refused", async () => {
    const port = portFor({ entitled: ["IAM"], ready: ["IAM"], enabled: ["IAM"], registry: attainableRegistry });
    const wrongInstallation = makeConfig({ IAM_INSTALLATION_ID: "some-other-installation" });
    const verdict = await port.evaluate({ dposCompanyId: wrongInstallation.dposCompanyId, installationId: wrongInstallation.installationId }, { identityId: "i", userId: "u", allowedModules: ["IAM"], roles: [] });
    assert.equal(verdict.allowed, false);
    assert.equal(verdict.code, "INSTALLATION_MISMATCH");
    const wrongCompany = await port.evaluate({ dposCompanyId: uuid(), installationId: INSTALLATION_ID }, { identityId: "i", userId: "u", allowedModules: ["IAM"], roles: [] });
    assert.equal(wrongCompany.allowed, false);
  });

  it("fails closed when eligibility cannot be determined", async () => {
    const broken = createInstallationModuleEligibilityPort({ applicationRoot: path.join(os.tmpdir(), "does-not-exist-iam4a"), installationRoot: path.join(os.tmpdir(), "nope") });
    const r = denied(await guard(broken));
    assert.equal(r.code, "IAM_ELIGIBILITY_UNAVAILABLE");
    assert.equal(r.status, 503);
    const nc = denied(await guard(new NotConfiguredModuleEligibilityPort()));
    assert.equal(nc.code, "IAM_ELIGIBILITY_NOT_CONFIGURED");
  });

  it("the Results Return service path never grants end-user access: a service identity on an operational route is refused", async () => {
    const port = portFor({ entitled: ["IAM"], ready: ["IAM"], enabled: ["IAM"], registry: attainableRegistry });
    // presented as the trusted caller
    assert.equal(denied(await guard(port, headers({ "x-service-identity": "iam-svc-" + uuid() }))).code, "SERVICE_IDENTITY_NOT_END_USER");
    // presented as the end user behind a valid front door
    assert.equal(denied(await guard(port, headers({ "x-identity-id": "iam-svc-" + uuid(), "x-user-id": "iam-svc-" + uuid() }))).code, "SERVICE_IDENTITY_NOT_END_USER");
  });

  it("requires the trusted front door and the bound company", async () => {
    const port = portFor({ entitled: ["IAM"], ready: ["IAM"], enabled: ["IAM"], registry: attainableRegistry });
    assert.equal(denied(await guard(port, new Headers({ "x-user-id": "u", "x-company-id": DEFAULT_COMPANY_ID }))).code, "END_USER_CONTEXT_REQUIRED");
    assert.equal(denied(await guard(port, headers({ "x-service-credential": "wrong" }))).code, "FRONT_DOOR_NOT_TRUSTED");
    assert.equal(denied(await guard(port, headers({ "x-company-id": uuid() }))).code, "COMPANY_MISMATCH");
    const noCompany = new Headers(headers());
    noCompany.delete("x-company-id");
    assert.equal(denied(await guard(port, noCompany)).code, "COMPANY_MISSING");
    const noUser = new Headers(headers());
    noUser.delete("x-user-id");
    noUser.delete("x-identity-id");
    assert.equal(denied(await guard(port, noUser)).code, "END_USER_CONTEXT_REQUIRED");
    // unconfigured front-door secret keeps operational routes closed
    const closed = await authorizeOperationalRequest(headers(), { db: t.prisma, config, eligibility: port, env: {} });
    assert.equal(denied(closed).code, "FRONT_DOOR_NOT_CONFIGURED");
    // a route-level company id that is not the bound company is rejected
    assert.equal(denied(await guard(port, headers(), { suppliedCompanyId: uuid() })).code, "COMPANY_MISMATCH");
  });

  it("denials are audited", async () => {
    const n = await t.prisma.dposAuditEvent.count({ where: { category: "ELIGIBILITY", outcome: "DENIED" } });
    assert.ok(n >= 8, `expected audited denials, found ${n}`);
  });
});
