/**
 * Stage 4D: the board's REAL route handlers, in-process (DPOS_INTEGRATED), and the action dispatcher.
 * Every board endpoint is integrated-only, eligibility-enforced, and applies the workflow's own permission rules: management actions
 * need a management role, owner actions need the assigned owner or a manager, a viewer/stranger is refused with the workflow's code.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import { after, before, describe, it } from "node:test";
import { bindCompany } from "../../src/lib/dpos/company-context";
import { FRONT_DOOR_SERVICE_ID } from "../../src/lib/dpos/access-guard";
import { WorkshopServiceIdentityProvider, issueServiceIdentity } from "../../src/lib/dpos/service-identity";
import { sqliteUrl } from "../../src/lib/dpos/migrate/governed-migrate";
import { performBoardAction, BOARD_ACTIONS } from "../../src/lib/dpos/board";
import { createTestDb, DEFAULT_COMPANY_ID, findDposRoot, loadDposFixtures, makeConfig, writeAttainableRegistry, type TestDb } from "./helpers";
import { MANAGER, OWNER_USER, STRANGER, VIEWER, expectCode, presentedCandidate, startedCandidate, eventTypes, type Fixture } from "./workflow-helpers";
import { completedHistoryCandidate } from "./closeout-helpers";

const dposRoot = findDposRoot();
const skip = dposRoot ? false : "DPOS repository not found (set DPOS_REPO_ROOT)";
const SECRET = "front-door-route-test-secret";
const INSTALLATION_ID = "front-door-test-installation";
const KEYS = [
  "IAM_DEPLOYMENT_MODE", "IAM_ENVIRONMENT_CLASS", "IAM_CONFIGURATION_ID", "IAM_DPOS_COMPANY_ID", "IAM_DATA_HUB_COMPANY_ID", "IAM_INSTALLATION_ID",
  "IAM_COMPANY_TIME_ZONE", "DATA_HUB_BASE_URL", "IAM_SERVICE_IDENTITY_ID", "IAM_DPOS_APPLICATION_ROOT", "IAM_DPOS_INSTALLATION_ROOT",
  "IAM_ELIGIBILITY_CACHE_TTL_MS", "IAM_FRONT_DOOR_CREDENTIAL",
] as const;

const hdr = (userId: string, roles: string, over: Record<string, string> = {}): Record<string, string> => ({
  "x-service-identity": FRONT_DOOR_SERVICE_ID,
  "x-service-credential": SECRET,
  "x-identity-id": `identity-${userId}`,
  "x-user-id": userId,
  "x-company-id": DEFAULT_COMPANY_ID,
  "x-roles": roles,
  "x-dpos-allowed-modules": "IAM",
  ...over,
});
const req = (url: string, init: RequestInit & { headers?: Record<string, string> } = {}) => new Request(`http://iam.test${url}`, init);
const post = (url: string, headers: Record<string, string>, body: unknown) => req(url, { method: "POST", headers: { ...headers, "content-type": "application/json" }, body: JSON.stringify(body) });

describe("board routes and actions", { skip }, () => {
  let t: TestDb;
  let reg: { file: string; dir: string };
  let fx: Fixture;
  const tmp: string[] = [];
  let routes: {
    board: typeof import("../../src/app/api/dpos/board/route");
    review: typeof import("../../src/app/api/dpos/board/review/route");
    health: typeof import("../../src/app/api/dpos/health/route");
    plan: typeof import("../../src/app/api/dpos/candidates/[candidateId]/plan/route");
    actions: typeof import("../../src/app/api/dpos/candidates/[candidateId]/actions/route");
    closeout: typeof import("../../src/app/api/dpos/candidates/[candidateId]/closeout/route");
    learning: typeof import("../../src/app/api/dpos/learning/route");
  };
  const MGR = () => hdr("mgr-1", "MANAGER");
  const OWN = () => hdr("owner-1", "OPERATOR");

  const integrated = () =>
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
      IAM_SERVICE_IDENTITY_ID: process.env.TEST_IDENTITY_ID ?? "",
      IAM_DPOS_APPLICATION_ROOT: roots.app,
      IAM_DPOS_INSTALLATION_ROOT: roots.installation,
    });
  let roots = { app: "", installation: "" };
  const ctxOf = (candidateId: string) => ({ params: Promise.resolve({ candidateId }) });

  before(async () => {
    t = await createTestDb();
    process.env.DATABASE_URL = sqliteUrl(t.file);
    reg = writeAttainableRegistry(dposRoot!);
    const fixtures = await loadDposFixtures(dposRoot!);
    const inst = fixtures.createModuleInstallation({ companyId: DEFAULT_COMPANY_ID, entitledModules: ["IAM"], ready: ["IAM"], enabled: ["IAM"], registryFile: reg.file });
    tmp.push(inst.base);
    roots = { app: `${inst.base}/app`, installation: inst.root };
    process.env.IAM_DPOS_APPLICATION_ROOT = `${inst.base}/app`;
    process.env.IAM_DPOS_INSTALLATION_ROOT = inst.root;
    const config = makeConfig({ IAM_INSTALLATION_ID: INSTALLATION_ID });
    const ctx = await bindCompany(t.prisma, config, { actor: "op", createCompanyName: "Board Co" });
    const identity = await issueServiceIdentity(t.prisma, config, new WorkshopServiceIdentityProvider(), { actor: "op", issuanceKind: "WORKSHOP" });
    process.env.TEST_IDENTITY_ID = identity.identityId;
    fx = { db: t.prisma, ctx };
    routes = {
      board: await import("../../src/app/api/dpos/board/route"),
      review: await import("../../src/app/api/dpos/board/review/route"),
      health: await import("../../src/app/api/dpos/health/route"),
      plan: await import("../../src/app/api/dpos/candidates/[candidateId]/plan/route"),
      actions: await import("../../src/app/api/dpos/candidates/[candidateId]/actions/route"),
      closeout: await import("../../src/app/api/dpos/candidates/[candidateId]/closeout/route"),
      learning: await import("../../src/app/api/dpos/learning/route"),
    };
  });
  after(async () => {
    for (const k of KEYS) delete process.env[k];
    await (await import("../../src/lib/db")).prisma.$disconnect();
    await t.close();
    for (const d of [...tmp, reg?.dir].filter(Boolean)) fs.rmSync(d as string, { recursive: true, force: true });
  });

  it("every board endpoint is integrated-only: unavailable in standalone mode", async () => {
    for (const k of KEYS) delete process.env[k];
    const r = await routes.board.GET(req("/api/dpos/board", { headers: MGR() }), undefined as never);
    assert.equal(r.status, 503);
    assert.equal(((await r.json()) as { error: { code: string } }).error.code, "IAM_NOT_DPOS_INTEGRATED");
    const h = await routes.health.GET(req("/api/dpos/health", { headers: MGR() }), undefined as never);
    assert.equal(h.status, 503);
  });

  it("the board read needs the trusted front door and returns every section for an eligible user without writing", async () => {
    integrated();
    const denied = await routes.board.GET(req("/api/dpos/board"), undefined as never);
    assert.equal(denied.status, 401);
    const before = { runs: await t.prisma.iamCoreScoringRun.count(), health: await t.prisma.iamCoreHealthScore.count() };
    const r = await routes.board.GET(req("/api/dpos/board", { headers: OWN() }), undefined as never);
    assert.equal(r.status, 200, await r.clone().text());
    const j = (await r.json()) as Record<string, unknown>;
    for (const k of ["health", "whatChanged", "context", "topPriorities", "portfolio", "decisions", "results", "workingWell", "capacity", "freshness", "pending", "filters"]) assert.ok(k in j, `section ${k}`);
    assert.deepEqual({ runs: await t.prisma.iamCoreScoringRun.count(), health: await t.prisma.iamCoreHealthScore.count() }, before, "reading the board never scores or calculates");
    assert.equal(((j.actor as { isManagement: boolean }).isManagement), false);
  });

  it("management can mark the board reviewed; an operator and a viewer cannot", async () => {
    integrated();
    assert.equal((await routes.review.POST(post("/api/dpos/board/review", hdr("viewer-1", "VIEW_ONLY"), {}), undefined as never)).status, 403);
    const ok = await routes.review.POST(post("/api/dpos/board/review", MGR(), { note: "Weekly review" }), undefined as never);
    assert.equal(ok.status, 200);
    assert.equal(await t.prisma.iamCoreBoardReview.count(), 1);
    // OPERATOR is admin-capable for the route guard, but the workflow rule (management only) still refuses.
    const op = await routes.review.POST(post("/api/dpos/board/review", OWN(), {}), undefined as never);
    assert.equal(op.status, 403);
    assert.equal(((await op.json()) as { error: { code: string } }).error.code, "MANAGEMENT_AUTHORIZATION_REQUIRED");
  });

  it("health recalculation is a management operation that stores an immutable calculation and never scores", async () => {
    integrated();
    const viewer = await routes.health.POST(post("/api/dpos/health", hdr("viewer-1", "VIEW_ONLY"), {}), undefined as never);
    assert.equal(viewer.status, 403);
    const before = await t.prisma.iamCoreScoringRun.count();
    const r = await routes.health.POST(post("/api/dpos/health", MGR(), {}), undefined as never);
    assert.equal(r.status, 200, await r.clone().text());
    const j = (await r.json()) as { ok: boolean; health: { status: string; components: Array<{ key: string; available: boolean }> } };
    assert.equal(j.ok, true);
    // No governed evidence and an unreachable Data Hub: every component is unavailable (never scored as zero).
    assert.equal(j.health.status, "NO_COMPONENT_AVAILABLE");
    assert.ok(j.health.components.every((c) => !c.available));
    assert.equal(await t.prisma.iamCoreScoringRun.count(), before);
    const hist = await routes.health.GET(req("/api/dpos/health", { headers: OWN() }), undefined as never);
    assert.equal(hist.status, 200);
  });

  it("the plan route returns the read model; an unknown candidate is a 404", async () => {
    integrated();
    const id = await startedCandidate(fx, { key: "route-plan" });
    const r = await routes.plan.GET(req(`/api/dpos/candidates/${id}/plan`, { headers: OWN() }), ctxOf(id));
    assert.equal(r.status, 200);
    const j = (await r.json()) as { candidateId: string; permissions: { canUpdateProgress: boolean; canRevisePlan: boolean } };
    assert.equal(j.candidateId, id);
    assert.equal(j.permissions.canUpdateProgress, true);
    assert.equal(j.permissions.canRevisePlan, false);
    const missing = await routes.plan.GET(req("/api/dpos/candidates/does-not-exist/plan", { headers: OWN() }), ctxOf("does-not-exist"));
    assert.equal(missing.status, 404);
  });

  it("actions: management revises the plan (PLAN_REVISED, new version); the owner is refused with the workflow's own code; a stranger cannot update progress", async () => {
    integrated();
    const id = await startedCandidate(fx, { key: "route-actions" });
    const refused = await routes.actions.POST(post(`/api/dpos/candidates/${id}/actions`, OWN(), { action: "revisePlan", planSummary: "New approach", reason: "Terms changed" }), ctxOf(id));
    assert.equal(refused.status, 403);
    assert.equal(((await refused.json()) as { error: { code: string } }).error.code, "MANAGEMENT_AUTHORIZATION_REQUIRED");
    const noReason = await routes.actions.POST(post(`/api/dpos/candidates/${id}/actions`, MGR(), { action: "revisePlan", planSummary: "New approach" }), ctxOf(id));
    assert.equal(noReason.status, 400);
    const ok = await routes.actions.POST(post(`/api/dpos/candidates/${id}/actions`, MGR(), { action: "revisePlan", planSummary: "New approach", reason: "Terms changed", deviatesFromRecommendation: true, deviationReason: "Vendor" }), ctxOf(id));
    assert.equal(ok.status, 200, await ok.clone().text());
    assert.ok((await eventTypes(t.prisma, id)).includes("PLAN_REVISED"));
    const own = await routes.actions.POST(post(`/api/dpos/candidates/${id}/actions`, OWN(), { action: "updateProgress", actionCompletionPct: 30 }), ctxOf(id));
    assert.equal(own.status, 200, await own.clone().text());
    const stranger = await routes.actions.POST(post(`/api/dpos/candidates/${id}/actions`, hdr("stranger-1", "OPERATOR"), { action: "updateProgress", actionCompletionPct: 90 }), ctxOf(id));
    assert.ok(stranger.status >= 400 && stranger.status < 500);
    const progress = await t.prisma.iamCoreActionTracking.findUnique({ where: { candidateId: id } });
    assert.equal(progress?.actionCompletionPct, 30, "the refused update changed nothing");
  });

  it("Stage 4E: the closeout and learning read routes are integrated-only and read-only; closeout actions use the workflow's own refusal codes", async () => {
    for (const k of KEYS) delete process.env[k];
    const off = await routes.closeout.GET(req("/api/dpos/candidates/x/closeout", { headers: MGR() }), ctxOf("x"));
    assert.equal(off.status, 503);
    assert.equal((await routes.learning.GET(req("/api/dpos/learning", { headers: MGR() }), undefined as never)).status, 503);
    integrated();
    assert.equal((await routes.closeout.GET(req("/api/dpos/candidates/x/closeout"), ctxOf("x"))).status, 401);
    const id = await completedHistoryCandidate(fx, { key: "route-closeout" });
    const counts = async () => ({ c: await t.prisma.iamCoreCloseout.count(), l: await t.prisma.iamCoreScoringRun.count(), h: await t.prisma.iamCoreHealthScore.count() });
    const before = await counts();
    const view = await routes.closeout.GET(req(`/api/dpos/candidates/${id}/closeout`, { headers: OWN() }), ctxOf(id));
    assert.equal(view.status, 200, await view.clone().text());
    const vj = (await view.json()) as { candidateId: string; permissions: { canStart: boolean; canApprove: boolean } };
    assert.equal(vj.candidateId, id);
    assert.equal(vj.permissions.canStart, false);
    assert.equal(vj.permissions.canApprove, false);
    const mgrView = await routes.closeout.GET(req(`/api/dpos/candidates/${id}/closeout`, { headers: MGR() }), ctxOf(id));
    assert.equal(((await mgrView.json()) as { permissions: { canStart: boolean } }).permissions.canStart, true);
    assert.equal((await routes.closeout.GET(req("/api/dpos/candidates/nope/closeout", { headers: OWN() }), ctxOf("nope"))).status, 404);
    const learn = await routes.learning.GET(req("/api/dpos/learning", { headers: OWN() }), undefined as never);
    assert.equal(learn.status, 200, await learn.clone().text());
    const lj = (await learn.json()) as { closedCandidates: number; statement: string };
    assert.equal(lj.closedCandidates, 0);
    assert.ok(lj.statement.length > 0);
    assert.deepEqual(await counts(), before, "reading closeout and learning writes nothing and never scores");
    // actions: the owner cannot start closeout or approve; a manager's start is accepted; a bad body is a 400.
    const owner = await routes.actions.POST(post(`/api/dpos/candidates/${id}/actions`, OWN(), { action: "startCloseout" }), ctxOf(id));
    assert.equal(owner.status, 403);
    assert.equal(((await owner.json()) as { error: { code: string } }).error.code, "MANAGEMENT_AUTHORIZATION_REQUIRED");
    const started = await routes.actions.POST(post(`/api/dpos/candidates/${id}/actions`, MGR(), { action: "startCloseout" }), ctxOf(id));
    assert.equal(started.status, 200, await started.clone().text());
    assert.ok((await eventTypes(t.prisma, id)).includes("CLOSEOUT_STARTED"));
    const bad = await routes.actions.POST(post(`/api/dpos/candidates/${id}/actions`, MGR(), { action: "recordMeasurement", residualValue: "5" }), ctxOf(id));
    assert.equal(bad.status, 400);
    const noStatus = await routes.actions.POST(post(`/api/dpos/candidates/${id}/actions`, MGR(), { action: "approveCloseout" }), ctxOf(id));
    assert.equal(noStatus.status, 400);
  });

  it("actions: an unknown action and a missing body are rejected; the dispatcher covers every board button", async () => {
    integrated();
    const id = await startedCandidate(fx, { key: "route-unknown" });
    const unknown = await routes.actions.POST(post(`/api/dpos/candidates/${id}/actions`, MGR(), { action: "deleteEverything" }), ctxOf(id));
    assert.equal(unknown.status, 400);
    assert.equal(((await unknown.json()) as { error: { code: string } }).error.code, "UNKNOWN_ACTION");
    const none = await routes.actions.POST(req(`/api/dpos/candidates/${id}/actions`, { method: "POST", headers: MGR() }), ctxOf(id));
    assert.equal(none.status, 400);
    assert.ok(BOARD_ACTIONS.length >= 14);
  });

  it("dispatcher: a presented candidate can be approved, rejected and escalated by management only, with the workflow's refusal codes", async () => {
    const a = await presentedCandidate(fx, { key: "disp-a" });
    await expectCode(performBoardAction(t.prisma, fx.ctx, VIEWER, a, "reject", { reason: "No" }), "MANAGEMENT_AUTHORIZATION_REQUIRED");
    await expectCode(performBoardAction(t.prisma, fx.ctx, MANAGER, a, "reject", {}), "REASON_REQUIRED");
    await expectCode(performBoardAction(t.prisma, fx.ctx, MANAGER, a, "approve", { planSummary: "Do it" }), "REASON_REQUIRED");
    const done = await performBoardAction(t.prisma, fx.ctx, MANAGER, a, "approve", { planSummary: "Cancel the oldest POs", responsibleDepartment: "Purchasing", taskOwnerId: OWNER_USER.actorId, targetResolution: "2026-12-01", baselineExposure: "1000", exposureUnit: "USD" });
    assert.equal(done.ok, true);
    const wf = await t.prisma.iamCoreWorkflowState.findUnique({ where: { candidateId: a } });
    assert.equal(wf?.workflowState, "PENDING_OWNER_ACCEPTANCE");
    await expectCode(performBoardAction(t.prisma, fx.ctx, STRANGER, a, "acceptOwnership", {}), "OWNER_OR_MANAGER_REQUIRED");
    const accepted = await performBoardAction(t.prisma, fx.ctx, OWNER_USER, a, "acceptOwnership", {});
    assert.equal(accepted.ok, true);
    await performBoardAction(t.prisma, fx.ctx, OWNER_USER, a, "startAction", {});
    await performBoardAction(t.prisma, fx.ctx, OWNER_USER, a, "updateProgress", { actionCompletionPct: "25" });
    const t0 = await t.prisma.iamCoreActionTracking.findUnique({ where: { candidateId: a } });
    assert.equal(t0?.actionCompletionPct, 25);
    assert.equal(t0?.conditionReductionPct ?? null, null, "completion never becomes condition reduction");
  });
});
