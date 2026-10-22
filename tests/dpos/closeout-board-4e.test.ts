/**
 * Stage 4E board layer: Completed History vs Closeout Complete, the board closeout section, formal Results & Business Impact,
 * What's Working Well, the dispatcher (flat form bodies -> the closeout service), and the access matrix at the board boundary.
 * Throw-away governed databases only.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { BOARD_ACTIONS, CLOSEOUT_BOARD_ACTIONS, buildBoard, parseMeasurementBody, performBoardAction, type RefreshStatusLike } from "../../src/lib/dpos/board";
import { readCloseout, readEffectiveness } from "../../src/lib/dpos/closeout";
import { boundContext, createTestDb, makeConfig, type TestDb } from "./helpers";
import { ADEQUATE_WINDOW, completedHistoryCandidate, measurement } from "./closeout-helpers";
import { CONTRIBUTOR, MANAGER, OWNER_USER, VIEWER, at, dateStr, expectCode, eventTypes, type Fixture } from "./workflow-helpers";

async function withFixture(fn: (f: Fixture, tdb: TestDb) => Promise<void>): Promise<void> {
  const tdb = await createTestDb();
  try {
    const ctx = await boundContext(tdb.prisma, makeConfig());
    await fn({ db: tdb.prisma, ctx }, tdb);
  } finally {
    await tdb.close();
  }
}

const NOW = at(60);
const refresh = (): RefreshStatusLike => ({
  companyTimeZone: "America/Chicago",
  timeZoneValid: true,
  scheduleStatus: "OK",
  scheduleReason: null,
  nextScheduledRefreshAt: at(61).toISOString(),
  lastAttemptAt: at(59).toISOString(),
  lastAttemptStatus: "SUCCESS",
  lastSuccessAt: at(59).toISOString(),
  lastIamRefreshAt: at(59).toISOString(),
  dataCurrentThrough: at(58).toISOString(),
  recentAttempts: [],
});

/** Flat form body for a measurable outcome with a credited attribution and an evidenced actual. */
const measureBody = (over: Record<string, unknown> = {}) => ({
  finalExposure: "0",
  measurementStart: ADEQUATE_WINDOW.measurementStart,
  measurementEnd: ADEQUATE_WINDOW.measurementEnd,
  evidenceCurrentThrough: ADEQUATE_WINDOW.evidenceCurrentThrough,
  evidenceRefs: "ev-final-balance-1",
  attributionCategory: "PROBABLE_CONTRIBUTION",
  attributionRationale: "The cancelled purchase orders account for the reduction in open PO exposure.",
  attributionEvidenceKind1: "EVIDENCE",
  attributionEvidenceRef1: "po-cancel-confirmation-1",
  attributionAlternatives: "Seasonal demand lifted sell-through",
  actual_inventoryDollarsReduced_value: "900",
  actual_inventoryDollarsReduced_unit: "USD",
  actual_inventoryDollarsReduced_evidence: "ev-final-balance-1",
  ...over,
});

describe("Stage 4E board: flat body parsing", () => {
  it("empty fields stay undefined and nothing is defaulted; partial residual / expected / actual are refused", () => {
    const p = parseMeasurementBody({ finalExposure: "", assessedStatus: "  " });
    assert.deepEqual(p, {});
    const full = parseMeasurementBody(measureBody({ residualType: "OPEN_PO", residualValue: "40", residualUnit: "USD" }));
    assert.equal(full.finalExposure, 0);
    assert.deepEqual(full.residual, [{ type: "OPEN_PO", value: 40, unit: "USD" }]);
    assert.equal(full.attribution?.category, "PROBABLE_CONTRIBUTION");
    assert.deepEqual(full.attribution?.alternatives, ["Seasonal demand lifted sell-through"]);
    assert.equal(full.expectedVsActual?.actual?.inventoryDollarsReduced?.value, 900);
    for (const bad of [{ residualValue: "5" }, { residualType: "X", residualValue: "5" }]) {
      assert.throws(() => parseMeasurementBody(bad), (e: { code?: string }) => e.code === "RESIDUAL_INCOMPLETE");
    }
    assert.throws(() => parseMeasurementBody({ expected_cash_value: "5" }), (e: { code?: string }) => e.code === "EXPECTED_INCOMPLETE");
    assert.throws(() => parseMeasurementBody({ finalExposure: "abc" }), (e: { code?: string }) => e.code === "INVALID_FIELD");
    assert.throws(() => parseMeasurementBody({ attributionCategory: "PROBABLE_CONTRIBUTION", attributionEvidenceRef1: "x" }), (e: { code?: string }) => e.code === "ATTRIBUTION_EVIDENCE_KIND_REQUIRED");
  });

  it("every closeout action is a registered board action", () => {
    for (const a of CLOSEOUT_BOARD_ACTIONS) assert.ok((BOARD_ACTIONS as readonly string[]).includes(a), a);
  });
});

describe("Stage 4E board: Completed History is not Closeout Complete (4E-D1)", () => {
  it("an execution-complete candidate is Awaiting Closeout, never in Top Priorities or the Active Action Portfolio; closing moves it to Closed", async () => {
    await withFixture(async (f) => {
      const id = await completedHistoryCandidate(f, { key: "board-1" });
      const before = await buildBoard(f.db, f.ctx, MANAGER, { now: NOW, refreshStatus: refresh() });
      assert.equal(before.closeout.pending.length, 1);
      assert.equal(before.closeout.closed.length, 0);
      const row = before.closeout.pending[0]!;
      assert.equal(row.candidateId, id);
      assert.equal(row.boardStatus, "CLOSEOUT_NOT_STARTED");
      assert.match(row.statusLabel, /Execution Complete/);
      assert.match(row.statusLabel, /Not Started/);
      assert.match(row.href, new RegExp(`/board/candidates/${id}/closeout$`));
      assert.match(before.closeout.note, /not|Execution/i);
      assert.ok(!JSON.stringify(before.topPriorities).includes(id));
      assert.ok(!JSON.stringify(before.portfolio).includes(id));
      assert.equal(before.results.realizedBusinessImpact, null, "no closed candidate yet: nothing formal is claimed");
      assert.equal(before.results.basis, "PRELIMINARY_OPERATIONAL");

      await performBoardAction(f.db, f.ctx, MANAGER, id, "startCloseout", {}, at(29));
      const started = await buildBoard(f.db, f.ctx, MANAGER, { now: NOW, refreshStatus: refresh() });
      assert.equal(started.closeout.pending[0]?.boardStatus, "AWAITING_MEASUREMENT");

      await performBoardAction(f.db, f.ctx, MANAGER, id, "recordMeasurement", measureBody(), at(30));
      const measured = await buildBoard(f.db, f.ctx, MANAGER, { now: NOW, refreshStatus: refresh() });
      assert.equal(measured.closeout.pending[0]?.boardStatus, "AWAITING_MANAGEMENT_CLOSEOUT");

      await performBoardAction(f.db, f.ctx, MANAGER, id, "approveCloseout", { finalStatus: "FULLY_RESOLVED" }, at(31));
      await performBoardAction(f.db, f.ctx, MANAGER, id, "recordLearning", { whatWorked: "Early vendor contact.", evidenceRefs: "ev-final-balance-1" }, at(32));
      await performBoardAction(f.db, f.ctx, MANAGER, id, "completeCloseout", {}, at(33));

      const after = await buildBoard(f.db, f.ctx, MANAGER, { now: at(34), refreshStatus: refresh() });
      assert.equal(after.closeout.pending.length, 0);
      assert.equal(after.closeout.closed.length, 1);
      const closed = after.closeout.closed[0]!;
      assert.equal(closed.finalStatus, "FULLY_RESOLVED");
      assert.match(closed.statusLabel, /Closed/);
      assert.ok(!JSON.stringify(after.topPriorities).includes(id));
      assert.ok(!JSON.stringify(after.portfolio).includes(id));
      const types = await eventTypes(f.db, id);
      for (const t of ["CLOSEOUT_STARTED", "CLOSEOUT_APPROVED", "LEARNING_RECORDED", "CLOSEOUT_COMPLETED"]) assert.ok(types.includes(t), t);
    });
  });

  it("formal Results & Business Impact credit only evidenced, attributed impact, and Working Well uses credited, confident closeouts", async () => {
    await withFixture(async (f) => {
      const a = await completedHistoryCandidate(f, { key: "res-a" });
      const b = await completedHistoryCandidate(f, { key: "res-b" });
      for (const [id, over, status] of [
        [a, {}, "FULLY_RESOLVED"],
        [b, { attributionCategory: "UNCLEAR_INSUFFICIENT_EVIDENCE", attributionEvidenceKind1: "", attributionEvidenceRef1: "", attributionAlternatives: "" }, "PARTIALLY_RESOLVED"],
      ] as const) {
        await performBoardAction(f.db, f.ctx, MANAGER, id, "startCloseout", {}, at(29));
        await performBoardAction(f.db, f.ctx, MANAGER, id, "recordMeasurement", measureBody(over), at(30));
        await performBoardAction(f.db, f.ctx, MANAGER, id, "approveCloseout", { finalStatus: status, overrideReason: "Management judgement on the evidence." }, at(31)).catch(() => undefined);
        await performBoardAction(f.db, f.ctx, MANAGER, id, "recordLearning", { whatWorked: "Vendor contact.", evidenceRefs: "ev-final-balance-1" }, at(32));
        await performBoardAction(f.db, f.ctx, MANAGER, id, "completeCloseout", {}, at(33));
      }
      const board = await buildBoard(f.db, f.ctx, MANAGER, { now: at(34), refreshStatus: refresh() });
      const impact = board.results.realizedBusinessImpact;
      assert.ok(impact);
      assert.equal(board.results.basis, "OPERATIONAL_WITH_FORMAL_CLOSEOUT");
      assert.equal(impact.closedItems.length, 2);
      const attributed = impact.attributedTotals.find((t) => t.unit === "USD");
      assert.equal(attributed?.total, 900, "only the credited (Probable) closeout is counted as attributed impact");
      const notCredited = impact.observedNotAttributedTotals.find((t) => t.unit === "USD");
      assert.equal(notCredited?.total, 900, "the Unclear-attribution actual is shown separately, never added in");
      const good = board.workingWell.items.filter((i) => i.kind === "CLOSEOUT_RESOLVED");
      assert.ok(good.length <= 1, "an Unclear-attribution or partial closeout is never celebrated");
      for (const g of good) assert.ok(JSON.stringify(g).includes(a));
    });
  });
});

describe("Stage 4E board: the dispatcher's access matrix", () => {
  it("owner and viewer cannot approve or complete; contributor records observations only; owner records measurement is refused", async () => {
    await withFixture(async (f) => {
      const id = await completedHistoryCandidate(f, { key: "acc-1", contributors: [CONTRIBUTOR.actorId] });
      await expectCode(performBoardAction(f.db, f.ctx, OWNER_USER, id, "startCloseout", {}), "MANAGEMENT_AUTHORIZATION_REQUIRED");
      await performBoardAction(f.db, f.ctx, MANAGER, id, "startCloseout", {}, at(29));
      await performBoardAction(f.db, f.ctx, OWNER_USER, id, "recordObservation", { observation: "Final PO balance is zero.", evidenceRef: "ev-final-balance-1" }, at(29));
      await performBoardAction(f.db, f.ctx, CONTRIBUTOR, id, "recordObservation", { observation: "Vendor confirmed cancellation." }, at(29));
      await expectCode(performBoardAction(f.db, f.ctx, VIEWER, id, "recordObservation", { observation: "x" }), "CONTRIBUTOR_OR_ABOVE_REQUIRED");
      await expectCode(performBoardAction(f.db, f.ctx, OWNER_USER, id, "recordMeasurement", measureBody()), "SYSTEM_OR_MANAGEMENT_REQUIRED");
      await performBoardAction(f.db, f.ctx, MANAGER, id, "recordMeasurement", measureBody(), at(30));
      await expectCode(performBoardAction(f.db, f.ctx, OWNER_USER, id, "approveCloseout", { finalStatus: "FULLY_RESOLVED" }), "MANAGEMENT_AUTHORIZATION_REQUIRED");
      await expectCode(performBoardAction(f.db, f.ctx, VIEWER, id, "completeCloseout", {}), "MANAGEMENT_AUTHORIZATION_REQUIRED");
      await expectCode(performBoardAction(f.db, f.ctx, MANAGER, id, "approveCloseout", {}), "REASON_REQUIRED");
      await expectCode(performBoardAction(f.db, f.ctx, MANAGER, id, "resolveRecurrenceReview", { decision: "MAYBE", recurrenceId: "x", reason: "y" }), "VOCABULARY_VIOLATION");
    });
  });

  it("the read model never lets a non-manager act, and a closed candidate refuses every active action", async () => {
    await withFixture(async (f) => {
      const id = await completedHistoryCandidate(f, { key: "acc-2" });
      const owner = await readCloseout(f.db, f.ctx, id, OWNER_USER);
      assert.equal(owner.permissions.canApprove, false);
      assert.equal(owner.permissions.canComplete, false);
      assert.equal(owner.permissions.canStart, false);
      const mgr = await readCloseout(f.db, f.ctx, id, MANAGER);
      assert.equal(mgr.permissions.canStart, true);
      await performBoardAction(f.db, f.ctx, MANAGER, id, "startCloseout", {}, at(29));
      await performBoardAction(f.db, f.ctx, MANAGER, id, "recordMeasurement", measureBody(), at(30));
      await performBoardAction(f.db, f.ctx, MANAGER, id, "approveCloseout", { finalStatus: "FULLY_RESOLVED" }, at(31));
      await performBoardAction(f.db, f.ctx, MANAGER, id, "recordLearning", { whatWorked: "Vendor contact." }, at(32));
      await performBoardAction(f.db, f.ctx, MANAGER, id, "completeCloseout", {}, at(33));
      for (const action of ["startAction", "updateProgress", "requestPause", "completeAction", "raiseBlocker", "revisePlan"] as const) {
        await expectCode(performBoardAction(f.db, f.ctx, MANAGER, id, action, { reason: "again", planSummary: "again", actionCompletionPct: "10", toOwnerId: "x" }), "CLOSED_CANDIDATE_NO_REOPEN");
      }
      const closed = await readCloseout(f.db, f.ctx, id, MANAGER);
      assert.equal(closed.permissions.canStart, false);
      assert.equal(closed.permissions.canApprove, false);
    });
  });
});

describe("Stage 4E board: effectiveness for a closeout with learning not applicable", () => {
  it("is segmented from the stored plan / workflow facts, not hidden under Unspecified", async () => {
    await withFixture(async (f) => {
      const id = await completedHistoryCandidate(f, { key: "eff-na", current: 600 });
      await performBoardAction(f.db, f.ctx, MANAGER, id, "startCloseout", {}, at(29));
      await performBoardAction(f.db, f.ctx, MANAGER, id, "recordMeasurement", measureBody({ finalExposure: "600", assessedStatus: "PARTIALLY_RESOLVED", assessmentRationale: "Reduced but a residual remains.", attributionCategory: "UNCLEAR_INSUFFICIENT_EVIDENCE", attributionEvidenceKind1: "", attributionEvidenceRef1: "", attributionAlternatives: "", actual_inventoryDollarsReduced_value: "", actual_inventoryDollarsReduced_unit: "", actual_inventoryDollarsReduced_evidence: "" }), at(30));
      await performBoardAction(f.db, f.ctx, MANAGER, id, "approveCloseout", { finalStatus: "PARTIALLY_RESOLVED", learningNotApplicableReason: "Evidence too thin to draw a lesson." }, at(31));
      await performBoardAction(f.db, f.ctx, MANAGER, id, "completeCloseout", {}, at(32));
      assert.equal(await f.db.iamCoreLearningRecord.count({ where: { candidateId: id } }), 0);
      const eff = await readEffectiveness(f.db, f.ctx, at(33));
      assert.equal(eff.closedCandidates, 1);
      for (const seg of ["actionType", "department", "category", "conditionFamily"] as const) {
        assert.ok(eff.segments[seg].every((g) => g.key !== "Unspecified"), `${seg} must come from the stored facts`);
      }
      assert.equal(eff.segments.attribution[0]?.key, "UNCLEAR_INSUFFICIENT_EVIDENCE");
    });
  });
});

void measurement;
void dateStr;
