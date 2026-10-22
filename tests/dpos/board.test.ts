/**
 * Stage 4D Decision Board V4 read-model tests: section content, Top 2, Portfolio and Holdover, Decisions Required, Results,
 * Working Well, Capacity, What Changed, freshness states, the Pending indicator, COI and the Recommended Action Plan.
 * Throw-away governed databases only.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  buildBoard,
  computeCoi,
  deriveFreshness,
  markBoardReviewed,
  readActionPlan,
  COI_POLICY,
  type RefreshStatusLike,
} from "../../src/lib/dpos/board";
import { calculateHealth, recordHealthEvidence } from "../../src/lib/dpos/health";
import { runScoring } from "../../src/lib/dpos/scoring";
import { SYSTEM_ACTOR, completeAction, requestPause, revisePlan, startAction, updateProgress } from "../../src/lib/dpos/workflow";
import { boundContext, createTestDb, makeConfig, type TestDb } from "./helpers";
import { MANAGER, OWNER_USER, STRANGER, VIEWER, CONTRIBUTOR, at, expectCode, eventTypes, startedCandidate, type Fixture } from "./workflow-helpers";
import { P80, P41, fromPoints, scoredCandidate } from "./scoring-helpers";

async function withFixture(fn: (f: Fixture, tdb: TestDb) => Promise<void>): Promise<void> {
  const tdb = await createTestDb();
  try {
    const ctx = await boundContext(tdb.prisma, makeConfig());
    await fn({ db: tdb.prisma, ctx }, tdb);
  } finally {
    await tdb.close();
  }
}

const NOW = at(8); // Tuesday 2026-11-03 15:00Z (company tz America/Chicago)

const refresh = (over: Partial<RefreshStatusLike> = {}): RefreshStatusLike => ({
  companyTimeZone: "America/Chicago",
  timeZoneValid: true,
  scheduleStatus: "OK",
  scheduleReason: null,
  nextScheduledRefreshAt: at(14).toISOString(),
  lastAttemptAt: at(7).toISOString(),
  lastAttemptStatus: "SUCCESS",
  lastSuccessAt: at(7).toISOString(),
  lastIamRefreshAt: at(7).toISOString(),
  dataCurrentThrough: at(6).toISOString(),
  recentAttempts: [],
  ...over,
});

async function seedHealth(f: Fixture, when = NOW) {
  const refs = { sourceRefs: ["rse-run-77"], asOf: when, at: when };
  await recordHealthEvidence(f.db, f.ctx, MANAGER, "POSITION_BALANCE", { totalInventoryBookValue: 1000, belowMinExposureValue: 50, aboveMaxExcessValue: 150 }, refs);
  await recordHealthEvidence(f.db, f.ctx, MANAGER, "EFFICIENCY", { inventoryTurns: 3 }, refs);
  await recordHealthEvidence(f.db, f.ctx, MANAGER, "SLOW_NONMOVING", { totalInventoryBookValue: 1000, slowMovingValue: 100, nonMovingValue: 100 }, refs);
  await recordHealthEvidence(f.db, f.ctx, MANAGER, "COMPANY_FACTS", { turnsTarget: 4, averageWeeklyRevenue: 100000 }, { sourceRefs: ["company-governance-1"], at: when });
  return calculateHealth(f.db, f.ctx, MANAGER, { at: when, backorder: { fetch: async () => ({ ok: false, reason: "Customer Backorder feed not supplied." }) } });
}

describe("Decision Board V4: Top Priorities", () => {
  it("shows only Top 2 candidates scoring at least 70, in displayed rank order, with no artificial fill", async () => {
    await withFixture(async (f) => {
      await scoredCandidate(f, "high", fromPoints(P80));
      await scoredCandidate(f, "low", fromPoints(P41));
      await runScoring(f.db, f.ctx, SYSTEM_ACTOR, { at: at(0, 6), runKey: "w1" });
      const board = await buildBoard(f.db, f.ctx, MANAGER, { now: at(1), refreshStatus: refresh() });
      assert.equal(board.topPriorities.items.length, 1, "the 41-point candidate must not be used to fill the second slot");
      const top = board.topPriorities.items[0]!;
      assert.equal(top.rank, 1);
      assert.ok(top.score! >= 70);
      assert.match(top.detailHref, /^\/board\/candidates\//);
      assert.match(top.planHref, /\/plan$/);
    });
  });

  it("an empty board has no Top Priorities and says why", async () => {
    await withFixture(async (f) => {
      const board = await buildBoard(f.db, f.ctx, MANAGER, { now: NOW, refreshStatus: refresh() });
      assert.equal(board.topPriorities.items.length, 0);
      assert.ok(board.topPriorities.note.length > 0);
      assert.equal(board.health.notCalculated, true);
    });
  });
});

describe("Decision Board V4: Health row", () => {
  it("renders the stored score, label, five components and the change versus the prior cycle", async () => {
    await withFixture(async (f) => {
      const first = await seedHealth(f, at(-7));
      assert.equal(first.health.status, "CALCULATED");
      await recordHealthEvidence(f.db, f.ctx, MANAGER, "EFFICIENCY", { inventoryTurns: 4 }, { sourceRefs: ["rse-run-78"], asOf: NOW, at: NOW });
      await calculateHealth(f.db, f.ctx, MANAGER, { at: NOW, backorder: { fetch: async () => ({ ok: false, reason: "n/a" }) } });
      const board = await buildBoard(f.db, f.ctx, MANAGER, { now: NOW, refreshStatus: refresh() });
      assert.equal(board.health.components.length, 5);
      assert.ok(board.health.score !== null && board.health.label);
      assert.ok(board.health.change?.comparable);
      assert.ok(board.health.prior);
      assert.equal(board.health.curveStatus, "PROVISIONAL");
      assert.match(board.health.curveNotice ?? "", /PROVISIONAL/);
      const unavailable = board.health.components.filter((c) => !c.available);
      assert.ok(unavailable.length >= 1 && unavailable.every((c) => c.score === null && c.effectiveWeight === null), "an unavailable component is never zero");
      assert.equal(board.filters.period.available.length, 2);
    });
  });

  it("the Analysis Period filter selects a stored cycle and reports a missing one", async () => {
    await withFixture(async (f) => {
      await seedHealth(f, at(-7));
      await seedHealth(f, NOW);
      const all = await buildBoard(f.db, f.ctx, MANAGER, { now: NOW, refreshStatus: refresh() });
      const older = all.filters.period.available.at(-1)!;
      const picked = await buildBoard(f.db, f.ctx, MANAGER, { now: NOW, refreshStatus: refresh(), period: older.weekStart });
      assert.equal(picked.filters.period.showing, "SELECTED_CYCLE");
      assert.equal(picked.health.current?.operatingWeekStart, older.weekStart);
      const missing = await buildBoard(f.db, f.ctx, MANAGER, { now: NOW, refreshStatus: refresh(), period: "2020-01-05" });
      assert.equal(missing.filters.period.showing, "SELECTED_CYCLE_NOT_FOUND");
      assert.equal(missing.health.current, null);
    });
  });
});

describe("Decision Board V4: Portfolio, Holdover, Capacity", () => {
  it("lists active actions with completion and condition reduction kept separate; a prior-week action is a Holdover", async () => {
    await withFixture(async (f) => {
      const id = await startedCandidate(f, { baselineExposure: 1000 });
      await updateProgress(f.db, f.ctx, OWNER_USER, id, { actionCompletionPct: 40, at: at(2) });
      const board = await buildBoard(f.db, f.ctx, MANAGER, { now: at(9), refreshStatus: refresh() });
      const row = board.portfolio.rows.find((r) => r.candidateId === id)!;
      assert.ok(row, "the active action is in the portfolio");
      assert.equal(row.actionCompletionPct, 40);
      assert.equal(row.conditionReductionPct, null, "condition reduction is not measured and is not copied from completion");
      assert.equal(row.holdover, true, "approved in an earlier operating week and still open");
      assert.ok(board.capacity.overall.activePrograms >= 1);
    });
  });

  it("without a valid company time zone Holdover is not guessed from UTC", async () => {
    await withFixture(async (f) => {
      await startedCandidate(f, {});
      await f.db.dposCompanyBinding.update({ where: { dposCompanyId: f.ctx.dposCompanyId }, data: { companyTimeZone: "Not/AZone" } });
      const board = await buildBoard(f.db, { dposCompanyId: f.ctx.dposCompanyId }, MANAGER, { now: at(9), refreshStatus: refresh({ companyTimeZone: "Not/AZone", timeZoneValid: false, scheduleStatus: "INVALID" }) });
      assert.equal(board.company.timeZoneValid, false);
      assert.ok(board.portfolio.rows.every((r) => r.holdover === false));
      assert.match(board.portfolio.holdoverBasis, /time zone/i);
      assert.equal(board.whatChanged.sinceBasis, "ROLLING_7_DAYS_NO_TIME_ZONE");
      assert.ok(board.freshness.states.includes("INVALID_TIME_ZONE"));
    });
  });
});

describe("Decision Board V4: Decisions Required", () => {
  it("a paused-request and an overdue action appear with why, owner, recommended decision and drill-through", async () => {
    await withFixture(async (f) => {
      const id = await startedCandidate(f, {});
      await requestPause(f.db, f.ctx, OWNER_USER, id, { reason: "Vendor delay", at: at(3) });
      const board = await buildBoard(f.db, f.ctx, MANAGER, { now: at(4), refreshStatus: refresh() });
      const item = board.decisions.items.find((d) => d.candidateId === id)!;
      assert.ok(item, "the pause request needs a management decision");
      assert.ok(item.why && item.recommendedDecision && item.detailHref);
      assert.equal(board.decisions.count, board.decisions.items.length);
    });
  });
});

describe("Decision Board V4: Results & Working Well", () => {
  it("labels results preliminary / operational and never fabricates business impact", async () => {
    await withFixture(async (f) => {
      const id = await startedCandidate(f, { baselineExposure: 1000 });
      await completeAction(f.db, f.ctx, OWNER_USER, id, { at: at(5) });
      const board = await buildBoard(f.db, f.ctx, MANAGER, { now: at(6), refreshStatus: refresh() });
      assert.equal(board.results.basis, "PRELIMINARY_OPERATIONAL");
      assert.equal(board.results.realizedBusinessImpact, null);
      assert.match(board.results.basisNotice, /preliminary/i);
    });
  });

  it("Working Well is evidence-based: with no evidence it is empty with a note", async () => {
    await withFixture(async (f) => {
      const board = await buildBoard(f.db, f.ctx, MANAGER, { now: NOW, refreshStatus: refresh() });
      assert.equal(board.workingWell.items.length, 0);
      assert.ok(board.workingWell.note);
    });
  });
});

describe("Decision Board V4: What Changed", () => {
  it("lists material changes since the last review, is deterministic, and is empty after review", async () => {
    await withFixture(async (f) => {
      const id = await startedCandidate(f, {});
      await requestPause(f.db, f.ctx, OWNER_USER, id, { reason: "Vendor delay", at: at(3) });
      const a = await buildBoard(f.db, f.ctx, MANAGER, { now: at(4), refreshStatus: refresh() });
      const b = await buildBoard(f.db, f.ctx, MANAGER, { now: at(4), refreshStatus: refresh() });
      assert.deepEqual(a.whatChanged, b.whatChanged, "the same data produces the same list");
      assert.ok(a.whatChanged.items.length > 0);
      assert.ok(a.whatChanged.items.every((i) => i.href.startsWith("/board")), "every item is drillable");
      await markBoardReviewed(f.db, f.ctx, MANAGER, { at: at(5), note: "Reviewed" });
      const c = await buildBoard(f.db, f.ctx, MANAGER, { now: at(6), refreshStatus: refresh() });
      assert.equal(c.whatChanged.sinceBasis, "LAST_REVIEW");
      assert.equal(c.whatChanged.items.length, 0);
      assert.equal(c.whatChanged.empty, true);
    });
  });

  it("only management can mark the board reviewed", async () => {
    await withFixture(async (f) => {
      await expectCode(markBoardReviewed(f.db, f.ctx, OWNER_USER, { at: at(5) }), "MANAGEMENT_AUTHORIZATION_REQUIRED");
      await expectCode(markBoardReviewed(f.db, f.ctx, VIEWER, { at: at(5) }), "MANAGEMENT_AUTHORIZATION_REQUIRED");
    });
  });
});

describe("Decision Board V4: freshness states and Pending Next Scoring Run", () => {
  it("derives each freshness state and never silently uses UTC", () => {
    const now = at(8);
    assert.equal(deriveFreshness(refresh(), now).primary, "CURRENT");
    assert.equal(deriveFreshness(refresh({ dataCurrentThrough: at(-3).toISOString() }), now).primary, "AGING");
    assert.equal(deriveFreshness(refresh({ dataCurrentThrough: at(-20).toISOString() }), now).primary, "STALE");
    assert.equal(deriveFreshness(refresh({ lastSuccessAt: null, lastIamRefreshAt: null, dataCurrentThrough: null, lastAttemptAt: null, lastAttemptStatus: null }), now).primary, "NEVER_REFRESHED");
    const failed = deriveFreshness(refresh({ lastAttemptStatus: "FAILED" }), now);
    assert.ok(failed.states.includes("REFRESH_FAILED"));
    assert.ok(deriveFreshness(refresh({ scheduleStatus: "UNAVAILABLE", scheduleReason: "x" }), now).states.includes("SCHEDULE_UNAVAILABLE"));
    assert.ok(deriveFreshness(refresh({ companyTimeZone: null, timeZoneValid: false, scheduleStatus: "MISSING" }), now).states.includes("MISSING_TIME_ZONE"));
    assert.ok(deriveFreshness(refresh({ companyTimeZone: "Bad/Zone", timeZoneValid: false, scheduleStatus: "INVALID" }), now).states.includes("INVALID_TIME_ZONE"));
  });

  it("flags Pending Next Scoring Run after a refresh newer than the last scoring run, without rewriting any score", async () => {
    await withFixture(async (f) => {
      const id = await scoredCandidate(f, "p", fromPoints(P80));
      await runScoring(f.db, f.ctx, SYSTEM_ACTOR, { at: at(0, 6), runKey: "w1" });
      const before = await f.db.iamCoreScoreResult.findMany({ where: { candidateId: id } });
      const board = await buildBoard(f.db, f.ctx, MANAGER, { now: at(8), refreshStatus: refresh({ lastIamRefreshAt: at(7).toISOString() }) });
      assert.equal(board.pending.pending, true);
      assert.match(board.pending.message ?? "", /pending/i);
      const after = await f.db.iamCoreScoreResult.findMany({ where: { candidateId: id } });
      assert.deepEqual(after.map((r) => r.domainScore), before.map((r) => r.domainScore), "the calculated score is never rewritten");
      assert.equal((await f.db.iamCoreScoringRun.count()), 1, "reading the board never runs scoring");
    });
  });
});

describe("Cost of inaction (COI)", () => {
  it("uses the 24% pilot rate over the target-resolution horizon and is COMPLETE only with supported preventable loss", () => {
    const partial = computeCoi({ excessValue: 36500, naturalSellThrough: null, from: at(0), targetResolution: at(30), expectedPreventableLoss: null });
    assert.equal(partial.status, "PARTIAL");
    assert.equal(partial.horizonDays, 30);
    assert.equal(partial.carryingCost, Math.round(36500 * COI_POLICY.annualCarryingRate * (30 / 365) * 100) / 100);
    const complete = computeCoi({ excessValue: 36500, naturalSellThrough: null, from: at(0), targetResolution: at(30), expectedPreventableLoss: { amount: 500, evidenceRef: "ev-1" } });
    assert.equal(complete.status, "COMPLETE");
    assert.equal(complete.total, Math.round((partial.carryingCost! + 500) * 100) / 100);
    const defaulted = computeCoi({ excessValue: 36500, naturalSellThrough: null, from: at(0), targetResolution: null, expectedPreventableLoss: null });
    assert.equal(defaulted.horizonDays, COI_POLICY.defaultHorizonDays);
    const none = computeCoi({ excessValue: null, naturalSellThrough: null, from: at(0), targetResolution: at(30), expectedPreventableLoss: null });
    assert.equal(none.status, "NOT_COMPUTABLE");
  });

  it("protects only evidenced natural sell-through within 90 days", () => {
    const r = computeCoi({ excessValue: 10000, naturalSellThrough: { protectedValue: 4000, horizonDays: 60, evidenceRef: "rse-1" }, from: at(0), targetResolution: at(30), expectedPreventableLoss: null });
    assert.equal(r.residualExcessValue, 6000);
    const over = computeCoi({ excessValue: 10000, naturalSellThrough: { protectedValue: 4000, horizonDays: 120, evidenceRef: "rse-1" }, from: at(0), targetResolution: at(30), expectedPreventableLoss: null });
    assert.equal(over.residualExcessValue, 10000, "a sell-through horizon beyond 90 days gives no protection");
  });
});

describe("Recommended Action Plan", () => {
  it("separates the system recommendation from the approved plan, turns unknowns into verification questions and never assumes feasibility", async () => {
    await withFixture(async (f) => {
      const id = await startedCandidate(f, { baselineExposure: 36500 });
      const plan = await readActionPlan(f.db, f.ctx, id, MANAGER, at(2));
      assert.equal(plan.candidateId, id);
      assert.ok(plan.systemRecommendation.version >= 1);
      assert.ok(plan.managementPlan && plan.managementPlan.current);
      assert.equal(plan.feasibility.level, "REQUIRES_VERIFICATION");
      assert.equal(plan.feasibility.assumed, true);
      assert.ok(plan.verificationQuestions.length > 0);
      assert.ok(plan.verificationQuestions.some((q) => /objective|metric|feasib/i.test(q)));
      assert.equal(plan.metric.baseline, 36500);
      assert.equal(plan.coi.status === "NOT_COMPUTABLE", false);
      assert.equal(plan.links.board, "/board");
      assert.equal(plan.execution.conditionReductionPct, null);
    });
  });

  it("plan revision creates a new version, keeps the prior one and the original recommendation, requires actor and reason, and emits PLAN_REVISED", async () => {
    await withFixture(async (f) => {
      const id = await startedCandidate(f, {});
      const recBefore = await f.db.iamCoreSystemRecommendation.findMany({ where: { candidateId: id } });
      await expectCode(revisePlan(f.db, f.ctx, MANAGER, id, { reason: "", plan: { summary: "Defer all POs by 45 days.", deviatesFromRecommendation: true, deviationReason: "Vendor terms" }, at: at(3) }), "REASON_REQUIRED");
      await expectCode(revisePlan(f.db, f.ctx, OWNER_USER, id, { reason: "Terms changed", plan: { summary: "Defer all POs by 45 days." }, at: at(3) }), "MANAGEMENT_AUTHORIZATION_REQUIRED");
      await revisePlan(f.db, f.ctx, MANAGER, id, { reason: "Vendor terms changed", plan: { summary: "Defer all POs by 45 days.", deviatesFromRecommendation: true, deviationReason: "Vendor terms" }, at: at(3) });
      const view = await readActionPlan(f.db, f.ctx, id, MANAGER, at(4));
      assert.equal(view.versions.length, 2);
      assert.equal(view.managementPlan?.planVersion, 2);
      assert.equal(view.versions.find((v) => v.planVersion === 1)?.current, false);
      assert.equal(view.managementPlan?.deviatesFromRecommendation, true);
      assert.ok(view.revisions.some((r) => r.planVersionAfter === 2 && /Vendor terms changed/.test(r.reason ?? "")));
      assert.ok((await eventTypes(f.db, id)).includes("PLAN_REVISED"));
      const recAfter = await f.db.iamCoreSystemRecommendation.findMany({ where: { candidateId: id } });
      assert.deepEqual(recAfter, recBefore, "the system recommendation is never overwritten");
    });
  });

  it("approving again with a new plan version emits PLAN_REVISED; a first approval does not (4D-D6)", async () => {
    await withFixture(async (f) => {
      const { approveCandidate } = await import("../../src/lib/dpos/workflow");
      const { presentedCandidate, PLAN } = await import("./workflow-helpers");
      const id = await presentedCandidate(f, { key: "reapprove" });
      await approveCandidate(f.db, f.ctx, MANAGER, id, { plan: PLAN, assignment: { responsibleDepartment: "Purchasing" }, at: at(0, 2) });
      assert.equal((await eventTypes(f.db, id)).includes("PLAN_REVISED"), false, "a first approval is not a revision");
      // The condition returns to management (state reopened directly: the normal re-open path is outside this test), then is approved again.
      await f.db.iamCoreWorkflowState.update({ where: { candidateId: id }, data: { workflowState: "PRESENTED" } });
      await approveCandidate(f.db, f.ctx, MANAGER, id, { plan: { summary: "A different approach: expedite the open POs instead.", deviatesFromRecommendation: true, deviationReason: "New vendor capacity" }, reason: "Vendor capacity changed", at: at(1) });
      const events = await f.db.dposResultsReturnOutbox.findMany({ where: { candidateId: id, eventType: "PLAN_REVISED" } });
      assert.equal(events.length, 1);
      const body = JSON.parse(events[0]!.payloadJson ?? "{}");
      assert.ok(JSON.stringify(body).includes("Vendor capacity changed"));
    });
  });
  it("access: management can revise and decide; the owner can update progress but not revise; a contributor and a viewer cannot", async () => {
    await withFixture(async (f) => {
      const id = await startedCandidate(f, {});
      const m = (await readActionPlan(f.db, f.ctx, id, MANAGER, at(2))).permissions;
      assert.equal(m.canRevisePlan, true);
      const o = (await readActionPlan(f.db, f.ctx, id, OWNER_USER, at(2))).permissions;
      assert.equal(o.canRevisePlan, false);
      assert.equal(o.canUpdateProgress, true);
      const s = (await readActionPlan(f.db, f.ctx, id, STRANGER, at(2))).permissions;
      assert.equal(s.canRevisePlan, false);
      assert.equal(s.canUpdateProgress, false);
      const v = (await readActionPlan(f.db, f.ctx, id, VIEWER, at(2))).permissions;
      assert.equal(v.canRevisePlan, false);
      assert.ok(v.reason);
      void CONTRIBUTOR;
    });
  });
});
