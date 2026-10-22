/**
 * Stage 4D pure tests: Health Score composition, renormalization, labels, and every component calculator
 * (Position & Balance, Efficiency, Slow / Nonmoving, Customer Shortage / Backorder, Action Resolution), natural sell-through
 * protection and evidence validation. No database.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  COMPONENT_KEYS,
  HEALTH_CONFIG,
  HEALTH_CURVE_STATUS,
  HEALTH_VERSION,
  available,
  calcActionResolution,
  calcEfficiency,
  calcPositionBalance,
  calcShortage,
  calcSlowNonmoving,
  composeHealth,
  labelFor,
  residualAfterNaturalSellThrough,
  unavailable,
  validateEvidence,
  type ActionFact,
  type BackorderLine,
  type ComponentResult,
} from "../../src/lib/dpos/health";

const ASOF = new Date("2026-10-26T15:00:00.000Z");

function allAvailable(scores: [number, number, number, number, number]): ComponentResult[] {
  return COMPONENT_KEYS.map((k, i) => available(k, scores[i]! * 100, { drivers: [], evidenceRefs: [], detail: {} }));
}

describe("Health Score composition (IAM_HEALTH_SCORE_V1)", () => {
  it("carries the locked version, the locked 40/20/15/15/10 weights, and flags the curves as PROVISIONAL", () => {
    assert.equal(HEALTH_VERSION, "IAM_HEALTH_SCORE_V1");
    assert.deepEqual(HEALTH_CONFIG.weights, { POSITION_BALANCE: 40, EFFICIENCY: 20, SLOW_NONMOVING: 15, SHORTAGE_BACKORDER: 15, ACTION_RESOLUTION: 10 });
    assert.equal(HEALTH_CONFIG.weights.POSITION_BALANCE + HEALTH_CONFIG.weights.EFFICIENCY + HEALTH_CONFIG.weights.SLOW_NONMOVING + HEALTH_CONFIG.weights.SHORTAGE_BACKORDER + HEALTH_CONFIG.weights.ACTION_RESOLUTION, 100);
    assert.equal(HEALTH_CURVE_STATUS, "PROVISIONAL", "the curves are not silently finalized");
  });

  it("combines five available components with the nominal weights, exactly", () => {
    const r = composeHealth(allAvailable([80, 60, 40, 100, 50]));
    // 80*40 + 60*20 + 40*15 + 100*15 + 50*10 = 7000 over 100
    assert.equal(r.status, "CALCULATED");
    assert.equal(r.score, 70);
    assert.equal(r.label, "WATCH");
    assert.equal(r.availableComponents, 5);
    assert.deepEqual(r.components.map((c) => c.effectiveWeight), [40, 20, 15, 15, 10]);
    assert.deepEqual(r.components.map((c) => c.key), [...COMPONENT_KEYS]);
  });

  it("labels at the exact boundaries: 90 Strong, 75 Healthy, 60 Watch, below 60 Needs Attention", () => {
    assert.equal(labelFor(10000), "STRONG");
    assert.equal(labelFor(9000), "STRONG");
    assert.equal(labelFor(8999), "HEALTHY"); // 89.99
    assert.equal(labelFor(7500), "HEALTHY");
    assert.equal(labelFor(7499), "WATCH"); // 74.99
    assert.equal(labelFor(6000), "WATCH");
    assert.equal(labelFor(5999), "NEEDS_ATTENTION"); // 59.99
    assert.equal(labelFor(0), "NEEDS_ATTENTION");
  });

  it("derives the label from the two-decimal rounded score (round half up)", () => {
    // (9000*40 + 8999*20) / 60 = 8999.67 -> 90.00 -> Strong
    const r = composeHealth([
      available("POSITION_BALANCE", 9000, { drivers: [], evidenceRefs: [], detail: {} }),
      available("EFFICIENCY", 8999, { drivers: [], evidenceRefs: [], detail: {} }),
      unavailable("SLOW_NONMOVING", "n/a"),
      unavailable("SHORTAGE_BACKORDER", "n/a"),
      unavailable("ACTION_RESOLUTION", "n/a"),
    ]);
    assert.equal(r.score, 90);
    assert.equal(r.label, "STRONG");
  });

  it("an unavailable component is never scored as zero: the available weights are renormalized to 100%", () => {
    const comps = allAvailable([80, 60, 40, 100, 50]);
    comps[2] = unavailable("SLOW_NONMOVING", "no governed result");
    comps[4] = unavailable("ACTION_RESOLUTION", "no actions in scope");
    const r = composeHealth(comps);
    // available: 80@40, 60@20, 100@15 => (3200+1200+1500)/75 = 78.6667 -> 78.67
    assert.equal(r.score, 78.67);
    assert.equal(r.availableComponents, 3);
    assert.deepEqual(r.components.map((c) => c.effectiveWeight), [53.3333, 26.6667, null, 20, null]);
    const asZero = allAvailable([80, 60, 0, 100, 0]);
    assert.notEqual(composeHealth(asZero).score, r.score, "treating unavailable as zero would give a different (wrong) score");
    assert.ok(r.components[2]!.unavailableReason, "the reason is kept");
    assert.equal(r.components[2]!.score, null);
    const effectiveSum = r.components.reduce((a, c) => a + (c.effectiveWeight ?? 0), 0);
    assert.ok(Math.abs(effectiveSum - 100) < 0.001, "effective weights sum to 100");
  });

  it("with no available component there is no score and no label (nothing invented)", () => {
    const r = composeHealth(COMPONENT_KEYS.map((k) => unavailable(k, "none")));
    assert.equal(r.status, "NO_COMPONENT_AVAILABLE");
    assert.equal(r.score, null);
    assert.equal(r.label, null);
    assert.equal(r.availableComponents, 0);
  });

  it("is deterministic: the same components always give the same composite", () => {
    const a = composeHealth(allAvailable([71.23, 88.01, 12.5, 100, 63.99]));
    const b = composeHealth(allAvailable([71.23, 88.01, 12.5, 100, 63.99]));
    assert.deepEqual(a, b);
  });
});

describe("Position & Balance: consumes governed values, never recreates Min/Max", () => {
  const ev = { totalInventoryBookValue: 1000, belowMinExposureValue: 50, aboveMaxExcessValue: 150 };
  it("scores the out-of-balance share of inventory book value against the curve", () => {
    const c = calcPositionBalance(ev, ["rse-run-1"]);
    // 200 / 1000 = 20% of a 40% zero point => 50.00
    assert.equal(c.score, 50);
    assert.deepEqual(c.evidenceRefs, ["rse-run-1"]);
    assert.ok(c.drivers.some((d) => d.code === "OUT_OF_BALANCE_SHARE"));
    assert.equal((c.detail as { outOfBalanceValue: number }).outOfBalanceValue, 200);
  });
  it("a perfectly balanced position scores 100 and a badly out-of-balance one 0", () => {
    assert.equal(calcPositionBalance({ ...ev, belowMinExposureValue: 0, aboveMaxExcessValue: 0 }, []).score, 100);
    assert.equal(calcPositionBalance({ ...ev, belowMinExposureValue: 400, aboveMaxExcessValue: 100 }, []).score, 0);
  });
  it("is unavailable (not zero) without a governed result", () => {
    const c = calcPositionBalance(null, []);
    assert.equal(c.available, false);
    assert.equal(c.score, null);
    assert.match(String(c.unavailableReason), /RSE remains authoritative/);
  });
});

describe("Efficiency: judged against the company's governed targets", () => {
  it("uses the company turns target (a different target gives a different score)", () => {
    const e = { inventoryTurns: 3 };
    // ratio .75 with full credit at 1.0 and zero at .5 => 50
    assert.equal(calcEfficiency(e, { turnsTarget: 4 }, []).score, 50);
    assert.equal(calcEfficiency(e, { turnsTarget: 3 }, []).score, 100);
    assert.equal(calcEfficiency(e, { turnsTarget: 6 }, []).score, 0);
    assert.equal(calcEfficiency({ inventoryTurns: 8 }, { turnsTarget: 4 }, []).score, 100, "beating the target earns full credit, not more");
  });
  it("averages turns and GMROI when the company governs both targets", () => {
    const c = calcEfficiency({ inventoryTurns: 4, gmroi: 1.5 }, { turnsTarget: 4, gmroiTarget: 2 }, []);
    assert.equal(c.score, 75); // (100 + 50) / 2
  });
  it("is unavailable without a governed company target (no invented benchmark) or without a result", () => {
    const noTarget = calcEfficiency({ inventoryTurns: 5 }, null, []);
    assert.equal(noTarget.available, false);
    assert.match(String(noTarget.unavailableReason), /target/);
    assert.equal(calcEfficiency({ inventoryTurns: 5 }, { averageWeeklyRevenue: 1000 }, []).available, false, "facts without a turns target do not help");
    assert.equal(calcEfficiency(null, { turnsTarget: 4 }, []).available, false);
  });
});

describe("Slow / Nonmoving: 90-day natural sell-through protection and residual exposure", () => {
  const base = { totalInventoryBookValue: 1000, slowMovingValue: 100, nonMovingValue: 100 };
  it("without sell-through evidence the full exposure counts (nothing is inferred)", () => {
    const c = calcSlowNonmoving(base, []);
    assert.equal(c.score, 33.33); // 200/1000 = 20% of a 30% zero point
    assert.equal((c.detail as { naturalSellThroughApplied: boolean }).naturalSellThroughApplied, false);
    assert.ok(c.drivers.some((d) => d.code === "NATURAL_SELL_THROUGH" && /inferred/.test(d.text)));
  });
  it("evidenced natural sell-through within 90 days protects that part; only the residual degrades the component", () => {
    const c = calcSlowNonmoving({ ...base, naturalSellThrough: { protectedValue: 120, horizonDays: 90, evidenceRef: "demand-history-9" } }, []);
    assert.equal((c.detail as { residualExposure: number }).residualExposure, 80);
    assert.equal(c.score, 73.33); // 80/1000 = 8% of 30%
    assert.ok(c.evidenceRefs.includes("demand-history-9"));
  });
  it("protection never exceeds the exposure, and a fully protected exposure scores 100", () => {
    const c = calcSlowNonmoving({ ...base, naturalSellThrough: { protectedValue: 5000, horizonDays: 60, evidenceRef: "d" } }, []);
    assert.equal(c.score, 100);
    assert.equal((c.detail as { protectedByNaturalSellThrough: number }).protectedByNaturalSellThrough, 200);
  });
  it("evidence beyond the 90-day window is not applied", () => {
    const c = calcSlowNonmoving({ ...base, naturalSellThrough: { protectedValue: 200, horizonDays: 120, evidenceRef: "d" } }, []);
    assert.equal((c.detail as { naturalSellThroughApplied: boolean }).naturalSellThroughApplied, false);
    assert.equal(c.score, 33.33);
  });
  it("excess already counted as above-Max in Position & Balance is not counted again", () => {
    const c = calcSlowNonmoving({ ...base, overlapWithAboveMaxValue: 50 }, []);
    assert.equal((c.detail as { residualExposure: number }).residualExposure, 150);
    assert.equal(c.score, 50); // 15% of 30%
  });
  it("is unavailable without a governed classification result", () => {
    assert.equal(calcSlowNonmoving(null, []).available, false);
  });
  it("the pure rule: unreferenced, invalid or over-horizon evidence applies no protection", () => {
    assert.equal(residualAfterNaturalSellThrough(100, null).residual, 100);
    assert.equal(residualAfterNaturalSellThrough(100, { protectedValue: 50, horizonDays: 90, evidenceRef: " " }).residual, 100);
    assert.equal(residualAfterNaturalSellThrough(100, { protectedValue: -5, horizonDays: 90, evidenceRef: "x" }).residual, 100);
    assert.equal(residualAfterNaturalSellThrough(100, { protectedValue: 50, horizonDays: 91, evidenceRef: "x" }).residual, 100);
    assert.equal(residualAfterNaturalSellThrough(100, { protectedValue: 50, horizonDays: 90, evidenceRef: "x" }).residual, 50);
  });
});

describe("Customer Shortage / Backorder: severity, aging and recurrence; parent and child preserved", () => {
  const line = (over: Partial<BackorderLine> = {}): BackorderLine => ({
    orderRef: "T-1",
    parentSku: "SKU-1",
    childPartOrVariant: "10.0",
    locationRef: "Main",
    quantity: 5,
    value: 1000,
    originalOrderDate: "2026-10-25",
    promisedDate: null,
    ...over,
  });
  const input = (lines: BackorderLine[]) => ({ lines, asOf: ASOF, sourceRefs: ["datahub:CUSTOMER_BACKORDER_LINE:batch-1"] });
  const facts = { averageWeeklyRevenue: 100000 };

  it("a current feed with no open backorders scores 100", () => {
    const c = calcShortage(input([]), null, null);
    assert.equal(c.score, 100);
    assert.ok(c.drivers.some((d) => d.code === "NO_OPEN_BACKORDERS"));
  });

  it("weights value by age band: a young backorder costs less than an old one of the same value", () => {
    const young = calcShortage(input([line({ originalOrderDate: "2026-10-25" })]), facts, null); // 1 day => x0.5
    const old = calcShortage(input([line({ originalOrderDate: "2026-08-01" })]), facts, null); // 86 days => x2
    // young: 500 / 100000 = 0.5% of 25% => 98.00 ; old: 2000 => 2% => 92.00
    assert.equal(young.score, 98);
    assert.equal(old.score, 92);
    assert.ok(old.score! < young.score!);
  });

  it("preserves parentSku (Stck#) and childPartOrVariant (Class) as distinct identities", () => {
    const c = calcShortage(input([line({ orderRef: "T-1", childPartOrVariant: "10.0" }), line({ orderRef: "T-2", childPartOrVariant: "9.00" }), line({ orderRef: "T-3", childPartOrVariant: null })]), facts, null);
    const top = (c.detail as { topContributors: Array<{ parentSku: string; childPartOrVariant: string | null }> }).topContributors;
    assert.equal(top.length, 3, "three distinct parent/child identities, never collapsed into the parent SKU");
    assert.deepEqual(top.map((t) => t.childPartOrVariant).sort(), [null, "10.0", "9.00"].sort());
    assert.ok(top.every((t) => t.parentSku === "SKU-1"));
  });

  it("recurrence: the same parent + child on several open orders is weighted up", () => {
    const one = calcShortage(input([line({ orderRef: "T-1" })]), facts, null);
    const two = calcShortage(input([line({ orderRef: "T-1" }), line({ orderRef: "T-2" })]), facts, null);
    const w1 = (one.detail as { weightedValue: number }).weightedValue; // 500
    const w2 = (two.detail as { weightedValue: number }).weightedValue; // 2 x 500 x 1.25
    assert.equal(w1, 500);
    assert.equal(w2, 1250);
    // a different child under the same parent is a different part: no recurrence uplift
    const diff = calcShortage(input([line({ orderRef: "T-1", childPartOrVariant: "10.0" }), line({ orderRef: "T-2", childPartOrVariant: "9.00" })]), facts, null);
    assert.equal((diff.detail as { weightedValue: number }).weightedValue, 1000);
  });

  it("is unavailable, never zero or perfect, when the feed is unavailable, unpriced, or has no revenue basis", () => {
    const feedDown = calcShortage(null, facts, "The Customer Backorder feed is NOT_SUPPLIED in the Data Hub.");
    assert.equal(feedDown.available, false);
    assert.match(String(feedDown.unavailableReason), /NOT_SUPPLIED/);
    const unpriced = calcShortage(input([line({ value: null }), line({ orderRef: "T-2", value: null })]), facts, null);
    assert.equal(unpriced.available, false);
    assert.match(String(unpriced.unavailableReason), /no priced value/);
    const noBasis = calcShortage(input([line()]), null, null);
    assert.equal(noBasis.available, false);
    assert.match(String(noBasis.unavailableReason), /revenue basis/);
  });

  it("tolerates a small share of unpriced lines and discloses it", () => {
    const lines = Array.from({ length: 40 }, (_, i) => line({ orderRef: `T-${i}`, parentSku: `S-${i}`, value: i === 0 ? null : 100 }));
    const c = calcShortage(input(lines), facts, null);
    assert.equal(c.available, true);
    assert.ok(c.drivers.some((d) => d.code === "UNPRICED_LINES"));
  });

  it("annual revenue is a valid revenue basis (divided by 52)", () => {
    const c = calcShortage(input([line()]), { annualRevenue: 5_200_000 }, null);
    assert.equal((c.detail as { weeklyRevenue: number }).weeklyRevenue, 100000);
  });

  it("breaks out the open backorder by location for the board's Location filter", () => {
    const c = calcShortage(input([line({ locationRef: "Main" }), line({ orderRef: "T-2", parentSku: "S-2", locationRef: "East" })]), facts, null);
    const byLoc = (c.detail as { byLocation: Record<string, { lines: number }> }).byLocation;
    assert.deepEqual(Object.keys(byLoc).sort(), ["East", "Main"]);
  });
});

describe("Action Resolution: completion is not condition reduction", () => {
  const act = (over: Partial<ActionFact> = {}): ActionFact => ({
    candidateId: "c-1",
    groupedConditionKey: "K-1",
    actionStatus: "COMPLETED",
    completedAt: new Date("2026-10-20T12:00:00.000Z"),
    targetResolution: new Date("2026-10-25T00:00:00.000Z"),
    actionCompletionPct: 100,
    conditionReductionPct: 40,
    conditionReductionStatus: "MEASURED",
    ...over,
  });

  it("credit follows the measured condition reduction, not the 100% action completion", () => {
    assert.equal(calcActionResolution([act({ conditionReductionPct: 40 })], ASOF).score, 40);
    assert.equal(calcActionResolution([act({ conditionReductionPct: 100 })], ASOF).score, 100);
    assert.equal(calcActionResolution([act({ conditionReductionPct: 0 })], ASOF).score, 0, "100% completed, nothing reduced: no credit");
  });

  it("a worsened condition (negative reduction) earns zero, not negative credit", () => {
    assert.equal(calcActionResolution([act({ conditionReductionPct: -20 })], ASOF).score, 0);
  });

  it("completed-but-unmeasured actions earn nothing and are reported as awaiting measurement (never rewarded for mere completion)", () => {
    const unmeasured = act({ candidateId: "c-2", groupedConditionKey: "K-2", conditionReductionPct: null, conditionReductionStatus: "NOT_YET_MEASURED" });
    const alone = calcActionResolution([unmeasured], ASOF);
    assert.equal(alone.available, false);
    assert.match(String(alone.unavailableReason), /awaiting condition-reduction measurement/);
    const mixed = calcActionResolution([act({ conditionReductionPct: 60 }), unmeasured], ASOF);
    assert.equal(mixed.score, 60, "the unmeasured action is not counted as a success or a failure");
    assert.equal((mixed.detail as { awaitingMeasurement: number }).awaitingMeasurement, 1);
  });

  it("active At Risk / Overdue / Blocked actions count against the component", () => {
    const c = calcActionResolution([act({ conditionReductionPct: 80 }), act({ candidateId: "c-3", actionStatus: "OVERDUE", completedAt: null, conditionReductionPct: null, conditionReductionStatus: "NOT_YET_MEASURED" })], ASOF);
    assert.equal(c.score, 40); // (0.8 + 0) / 2
    assert.ok(c.drivers.some((d) => d.code === "PROBLEM_ACTIONS"));
  });

  it("applies the late-completion and recurrence factors, and ignores completions outside the lookback window", () => {
    const late = act({ completedAt: new Date("2026-10-26T00:00:00.000Z"), conditionReductionPct: 50 });
    assert.equal(calcActionResolution([late], ASOF).score, 40); // 50 x 0.8
    const recurred = [act({ candidateId: "a", conditionReductionPct: 100 }), act({ candidateId: "b", conditionReductionPct: 100 })];
    assert.equal(calcActionResolution(recurred, ASOF).score, 75); // each x 0.75
    const old = act({ completedAt: new Date("2026-05-01T00:00:00.000Z") });
    assert.equal(calcActionResolution([old], ASOF).available, false);
  });

  it("is unavailable when nothing is in scope", () => {
    assert.equal(calcActionResolution([], ASOF).available, false);
    assert.equal(calcActionResolution([act({ actionStatus: "ON_TRACK", completedAt: null })], ASOF).available, false);
  });
});

describe("Health evidence validation", () => {
  it("refuses non-finite, negative and impossible values instead of silently using them", () => {
    assert.equal(validateEvidence("POSITION_BALANCE", { totalInventoryBookValue: 0, belowMinExposureValue: 1, aboveMaxExcessValue: 1 }).ok, false);
    assert.equal(validateEvidence("POSITION_BALANCE", { totalInventoryBookValue: 100, belowMinExposureValue: -1, aboveMaxExcessValue: 1 }).ok, false);
    assert.equal(validateEvidence("POSITION_BALANCE", { totalInventoryBookValue: 100, belowMinExposureValue: Number.NaN, aboveMaxExcessValue: 1 }).ok, false);
    assert.equal(validateEvidence("EFFICIENCY", { inventoryTurns: "4" }).ok, false);
    assert.equal(validateEvidence("SLOW_NONMOVING", { totalInventoryBookValue: 100, slowMovingValue: 80, nonMovingValue: 40 }).ok, false, "classified value cannot exceed inventory");
    assert.equal(validateEvidence("COMPANY_FACTS", {}).ok, false);
  });
  it("requires an evidence reference for sell-through (never inferred)", () => {
    const v = validateEvidence("SLOW_NONMOVING", { totalInventoryBookValue: 100, slowMovingValue: 10, nonMovingValue: 10, naturalSellThrough: { protectedValue: 5, horizonDays: 90 } });
    assert.equal(v.ok, false);
    assert.match(v.issues.join(" "), /evidenceRef/);
  });
  it("accepts valid governed values", () => {
    assert.equal(validateEvidence("POSITION_BALANCE", { totalInventoryBookValue: 100, belowMinExposureValue: 5, aboveMaxExcessValue: 10 }).ok, true);
    assert.equal(validateEvidence("COMPANY_FACTS", { turnsTarget: 4, averageWeeklyRevenue: 1000 }).ok, true);
  });
});
