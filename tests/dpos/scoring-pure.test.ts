/**
 * Stage 4C pure-engine tests: factors, thresholds, confidence, modifiers, caps, final score, bands, tie-break, Top 2,
 * rank locks, emergency triggers, event choice. No database: the engine is a pure function of inputs + configuration.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  FACTOR_KEYS,
  MODIFIER_KEYS,
  CRITICAL_PROTECTED_FLAG,
  SCORING_CONFIG,
  SCORING_CONFIG_VERSION,
  SCORING_VERSION,
  applyRankLocks,
  assertStableUserId,
  bandForScore,
  bandRatio,
  calculateScore,
  canonicalJson,
  chooseEvent,
  compareTieBreak,
  configHash,
  displayScoreOf,
  occurrenceNumber,
  operatingWeekOf,
  orderItems,
  overrideMagnitude,
  scoreAtLeast,
  selectTop2,
  validateScoringInputs,
  TIE_LEVELS,
  type CalcContext,
  type PublishedState,
  type ScoringConfig,
  type ScoringInputs,
} from "../../src/lib/dpos/scoring";
import { MAX, P41, P80, P86, P89, ZERO, fromPoints, pts, rankItem, sum, tieValues, type FactorPoints } from "./scoring-helpers";

const CTX: CalcContext = { persistence: { consecutiveQualifiedOccurrences: 1 } };
const calc = (inp: ScoringInputs, ctx: CalcContext = CTX, cfg: ScoringConfig = SCORING_CONFIG) => calculateScore(inp, ctx, cfg);
const score = (p: FactorPoints, over: Partial<ScoringInputs> = {}, ctx: CalcContext = CTX) => calc(fromPoints(p, over), ctx);

// ---- helpers for exact-boundary inputs ------------------------------------------------------------------------------------------
const cashAt = (impact: number): ScoringInputs => ({ ...fromPoints(ZERO), cash: { expected13WeekNetCashImpact: impact, averageWeeklyRevenue: 10_000 } });
const profitAt = (impact: number): ScoringInputs => ({ ...fromPoints(ZERO), profitability: { netProfitabilityImpact: impact, trailing12MonthGrossProfit: 1_000_000 } });
const invAt = (affected: number): ScoringInputs => ({ ...fromPoints(ZERO), inventoryExposure: { affectedInventoryBookValue: affected, totalInventoryBookValue: 1_000_000 } });

// =====================================================================================================================
describe("SCORING MODEL: identity and configuration", () => {
  it("has the approved version, a stable configuration hash and canonical (key-order independent) JSON", () => {
    assert.equal(SCORING_VERSION, "IAM_PRIORITY_SCORING_V1");
    assert.equal(SCORING_CONFIG_VERSION, "IAM_PRIORITY_CONFIG_V1");
    assert.equal(SCORING_CONFIG.scoringVersion, SCORING_VERSION);
    assert.equal(configHash(), configHash(JSON.parse(JSON.stringify(SCORING_CONFIG))));
    assert.match(configHash(), /^[0-9a-f]{64}$/);
    assert.equal(canonicalJson({ b: 1, a: { d: 2, c: 3 } }), canonicalJson({ a: { c: 3, d: 2 }, b: 1 }));
    const changed = { ...SCORING_CONFIG, top2: { threshold: 71, slots: 2 } };
    assert.notEqual(configHash(changed), configHash(), "a changed number is a different configuration (a new version)");
  });

  it("the seven factor maxima are 30/15/15/15/10/10/5 and add up to exactly 100", () => {
    assert.deepEqual(SCORING_CONFIG.factorMax, { cash: 30, profitability: 15, inventoryExposure: 15, operationalRisk: 15, customerRevenue: 10, timeSensitivity: 10, actionability: 5 });
    assert.equal(Object.values(SCORING_CONFIG.factorMax).reduce((a, b) => a + b, 0), 100);
    assert.deepEqual([...FACTOR_KEYS], ["cash", "profitability", "inventoryExposure", "operationalRisk", "customerRevenue", "timeSensitivity", "actionability"]);
  });
});

// =====================================================================================================================
describe("CORE FACTORS: every approved threshold (below / at / above)", () => {
  const CASH: Array<[number, number]> = [[100, 6], [300, 12], [700, 18], [1500, 24], [3000, 30]]; // [bps, points] with weekly revenue 10,000
  it("Cash: ratio of 13-week net cash impact to average weekly revenue", () => {
    assert.equal(calc(cashAt(0)).factors.cash.score, 0);
    assert.equal(calc(cashAt(-500)).factors.cash.score, 0, "a negative net cash impact earns nothing");
    for (const [bps, points] of CASH) {
      const below = Math.round(bps * 100 - 1) / 100;
      assert.equal(calc(cashAt(below)).factors.cash.score, points === 6 ? 0 : points - 6, `just below ${bps / 100}%`);
      assert.equal(calc(cashAt(bps)).factors.cash.score, points, `exactly ${bps / 100}%`);
      assert.equal(calc(cashAt(bps + 0.01)).factors.cash.score, points, `just above ${bps / 100}%`);
    }
    assert.equal(calc(cashAt(1_000_000)).factors.cash.score, 30, "far above the top band is still 30");
  });

  it("Cash: defaults to trailing-52-week revenue / 52 when no weekly figure is supplied; a supplied weekly figure wins", () => {
    const base = fromPoints(ZERO);
    const viaYear = { ...base, cash: { expected13WeekNetCashImpact: 100, trailing52WeekRevenue: 520_000 } }; // weekly = 10,000 -> 1%
    const r = calc(viaYear);
    assert.equal(r.factors.cash.score, 6);
    assert.equal(r.factors.cash.raw.weeklyRevenueBasis, "TRAILING_52_WEEK_REVENUE_/_52");
    const both = { ...base, cash: { expected13WeekNetCashImpact: 100, averageWeeklyRevenue: 1_000_000, trailing52WeekRevenue: 520_000 } };
    assert.equal(calc(both).factors.cash.score, 0, "the supplied average weekly revenue is used, not the trailing-52 default");
    assert.equal(calc(both).factors.cash.raw.weeklyRevenueBasis, "SUPPLIED_AVERAGE_WEEKLY_REVENUE");
  });

  const PROFIT: Array<[number, number]> = [[5, 3], [15, 6], [30, 9], [60, 12], [100, 15]]; // bps of trailing-12-month gross profit
  it("Profitability: ratio to trailing-12-month gross profit", () => {
    assert.equal(calc(profitAt(0)).factors.profitability.score, 0);
    for (const [bps, points] of PROFIT) {
      const exact = bps * 100; // gross profit 1,000,000 -> 1 bp = 100
      assert.equal(calc(profitAt(exact - 0.01)).factors.profitability.score, points - 3, `just below ${bps / 100}%`);
      assert.equal(calc(profitAt(exact)).factors.profitability.score, points, `exactly ${bps / 100}%`);
      assert.equal(calc(profitAt(exact + 0.01)).factors.profitability.score, points, `just above ${bps / 100}%`);
    }
  });

  const INV: Array<[number, number]> = [[25, 3], [50, 6], [100, 9], [200, 12], [500, 15]];
  it("Inventory Exposure: affected inventory / total inventory book value", () => {
    assert.equal(calc(invAt(0)).factors.inventoryExposure.score, 0);
    for (const [bps, points] of INV) {
      const exact = bps * 100;
      assert.equal(calc(invAt(exact - 0.01)).factors.inventoryExposure.score, points - 3, `just below ${bps / 100}%`);
      assert.equal(calc(invAt(exact)).factors.inventoryExposure.score, points, `exactly ${bps / 100}%`);
      assert.equal(calc(invAt(exact + 0.01)).factors.inventoryExposure.score, points, `just above ${bps / 100}%`);
    }
    assert.equal(calc(invAt(1_000_000)).factors.inventoryExposure.score, 15, "100% of inventory is the maximum");
  });

  it("ratio banding is exact integer arithmetic: a value exactly on a boundary never drifts", () => {
    // 0.07 / 0.01 is 6.999999999999999 in floating point; the engine must still band it as exactly 7%.
    assert.equal(bandRatio(SCORING_CONFIG.cash.bands, 700, 10_000).points, 18);
    assert.equal(bandRatio(SCORING_CONFIG.cash.bands, 7, 100).points, 18);
    assert.equal(bandRatio(SCORING_CONFIG.cash.bands, 0.07, 1).points, 18);
    assert.equal(bandRatio(SCORING_CONFIG.cash.bands, 0.03, 1).points, 12);
    assert.equal(bandRatio(SCORING_CONFIG.cash.bands, 0.15, 1).points, 24);
    assert.equal(bandRatio(SCORING_CONFIG.cash.bands, 6.99, 100).points, 12);
    assert.equal(bandRatio(SCORING_CONFIG.inventoryExposure.bands, 25, 10_000).points, 3);
    assert.equal(bandRatio(SCORING_CONFIG.profitability.bands, 5, 10_000).points, 3);
  });

  it("Operational Risk 0/3/6/9/12/15 and Customer & Revenue 0/2/4/6/8/10", () => {
    const sev = ["NONE", "LOW", "MODERATE", "SIGNIFICANT", "SEVERE", "CRITICAL"] as const;
    sev.forEach((lvl, i) => {
      assert.equal(calc({ ...fromPoints(ZERO), operationalRisk: lvl }).factors.operationalRisk.score, i * 3);
      assert.equal(calc({ ...fromPoints(ZERO), customerRevenue: lvl }).factors.customerRevenue.score, i * 2);
    });
  });

  it("Time Sensitivity by days to the action deadline: >90 0, 61-90 2, 31-60 4, 15-30 6, 8-14 8, <=7 10; overdue = 10 + flag", () => {
    const t = (days: number, overdue?: boolean) => calc({ ...fromPoints(ZERO), timeSensitivity: { daysToAction: days, ...(overdue !== undefined ? { overdue } : {}) } });
    const table: Array<[number, number]> = [[365, 0], [91, 0], [90, 2], [61, 2], [60, 4], [31, 4], [30, 6], [15, 6], [14, 8], [8, 8], [7, 10], [1, 10], [0, 10]];
    for (const [days, points] of table) {
      const r = t(days);
      assert.equal(r.factors.timeSensitivity.score, points, `${days} day(s)`);
      assert.equal(r.overdue, false);
    }
    const late = t(-3);
    assert.equal(late.factors.timeSensitivity.score, 10, "overdue stays at the 10-point maximum");
    assert.equal(late.overdue, true, "and the overdue flag is recorded");
    const flagged = t(40, true);
    assert.equal(flagged.factors.timeSensitivity.score, 10);
    assert.equal(flagged.overdue, true);
  });

  it("Actionability: Unclear 0, Difficult 1, Limited 2, Moderate 3, Strong 4, Immediate 5", () => {
    (["UNCLEAR", "DIFFICULT", "LIMITED", "MODERATE", "STRONG", "IMMEDIATE"] as const).forEach((lvl, i) => {
      assert.equal(calc({ ...fromPoints(ZERO), actionability: lvl }).factors.actionability.score, i);
    });
  });

  it("the maximum core score is exactly 100 and no factor can exceed its own maximum", () => {
    const r = score(MAX);
    assert.equal(sum(MAX), 100);
    assert.equal(r.rawCoreScore, 100);
    assert.equal(r.domainScore, 100);
    for (const k of FACTOR_KEYS) assert.ok(r.factors[k].score <= r.factors[k].max, `${k} within its maximum`);
    assert.equal(FACTOR_KEYS.reduce((a, k) => a + r.factors[k].max, 0), 100);
    // absurdly large facts do not exceed the maximum
    const huge = calc({ ...fromPoints(MAX), cash: { expected13WeekNetCashImpact: 1e12, averageWeeklyRevenue: 1 }, profitability: { netProfitabilityImpact: 1e12, trailing12MonthGrossProfit: 1 } });
    assert.equal(huge.rawCoreScore, 100);
  });

  it("there is no hidden factor: only the seven named factors exist and unknown inputs are refused", () => {
    const r = score(P80);
    assert.deepEqual(Object.keys(r.factors).sort(), [...FACTOR_KEYS].sort());
    assert.deepEqual(Object.keys(r.modifiers).sort(), [...MODIFIER_KEYS].sort());
    const ok = fromPoints(P80);
    assert.equal(validateScoringInputs(ok).ok, true);
    for (const bad of [{ ...ok, mood: "great" }, { ...ok, cash: { ...ok.cash, bonus: 5 } }, { ...ok, modifiers: { strategic: "ENTERPRISE_CRITICAL" } }, { ...ok, timeSensitivity: { daysToAction: 4, urgencyBoost: 3 } }]) {
      const v = validateScoringInputs(bad);
      assert.equal(v.ok, false);
      assert.ok(v.issues.some((i) => /unknown field/.test(i)), v.issues.join("; "));
    }
  });

  it("facts that are only tie-break or reference data never change the score", () => {
    const a = score(P80);
    const b = calc(fromPoints(P80, { preventableLoss: 1e6, actionDeadline: "2026-11-01", sourceRefs: ["run-1", "run-2"] }));
    assert.equal(b.domainScore, a.domainScore);
    assert.equal(b.rawCoreScore, a.rawCoreScore);
  });

  it("invalid facts are refused with every issue listed; short-period effects are never silently annualized", () => {
    const v = validateScoringInputs({ ...fromPoints(P80), inventoryExposure: { affectedInventoryBookValue: 10, totalInventoryBookValue: 5 }, operationalRisk: "HUGE", cash: { expected13WeekNetCashImpact: 1, averageWeeklyRevenue: 0 } });
    assert.equal(v.ok, false);
    assert.ok(v.issues.length >= 3);
    const p80 = fromPoints(P80);
    const attrib100 = [...p80.economicAttribution.filter((a) => a.scoringHome !== "profitability"), { evidenceRef: "p1", impactType: "PROFIT_IMPACT" as const, scoringHome: "profitability" as const, amount: 100 }];
    const shortPeriod = validateScoringInputs({ ...p80, economicAttribution: attrib100, profitability: { netProfitabilityImpact: 100, trailing12MonthGrossProfit: 1000, effectPeriodDays: 30 } });
    assert.equal(shortPeriod.ok, false);
    assert.ok(shortPeriod.issues.some((i) => /never annualizes/.test(i)));
    const stated = validateScoringInputs({ ...p80, economicAttribution: attrib100, profitability: { netProfitabilityImpact: 100, trailing12MonthGrossProfit: 1000, effectPeriodDays: 30, annualizationBasis: "Producer restated on a 12-month basis" } });
    assert.equal(stated.ok, true);
    const stored = calc(stated.value!);
    assert.equal(stored.factors.profitability.raw.ratio, 0.1, "the engine scores the stated 12-month-basis impact as given; it never multiplies it");
    const dupBase = fromPoints(P80);
    const dup = validateScoringInputs({ ...dupBase, economicAttribution: [...dupBase.economicAttribution, dupBase.economicAttribution[0]!] });
    assert.equal(dup.ok, false);
    assert.ok(dup.issues.some((i) => /ONE scoring home/.test(i)));
    const noThreat = validateScoringInputs({ ...fromPoints(P80), emergency: { verifiedThreat: { category: "SAFETY", verifiedBy: "", verifiedAt: "2026-10-01", evidenceRef: "" } } });
    assert.equal(noThreat.ok, false, "a threat is only a trigger when it is verified, by whom, with evidence");
  });
});

// =====================================================================================================================
describe("DATA CONFIDENCE", () => {
  it("High 1.00, Medium 0.95, Low 0.85 multiply the raw core score exactly", () => {
    const high = score(P80, { dataConfidence: "HIGH" });
    const med = score(P80, { dataConfidence: "MEDIUM" });
    const low = score(P80, { dataConfidence: "LOW" });
    assert.equal(high.confidence.multiplier, 1);
    assert.equal(med.confidence.multiplier, 0.95);
    assert.equal(low.confidence.multiplier, 0.85);
    assert.equal(high.confidenceAdjustedCoreScore, 80);
    assert.equal(med.confidenceAdjustedCoreScore, 76);
    assert.equal(low.confidenceAdjustedCoreScore, 68);
    assert.equal(med.rawCoreScore, 80, "the raw core score is preserved beside the adjusted one");
    assert.equal(med.domainScore, 76);
  });

  it("is exact: 89 x 0.95 = 84.55 and 89 x 0.85 = 75.65 with no floating-point residue", () => {
    assert.equal(score(P89, { dataConfidence: "MEDIUM" }).domainScore, 84.55);
    assert.equal(score(P89, { dataConfidence: "LOW" }).domainScore, 75.65);
    assert.equal(score(P89, { dataConfidence: "MEDIUM" }).priorityBand, "HIGH");
  });

  it("Insufficient confidence is not normally rankable: no ranked score, factors stay visible for the investigation", () => {
    const r = score(P80, { dataConfidence: "INSUFFICIENT" });
    assert.equal(r.rankable, false);
    assert.equal(r.notRankableReason, "INSUFFICIENT_DATA_CONFIDENCE");
    assert.equal(r.domainScore, null);
    assert.equal(r.priorityBand, null);
    assert.equal(r.displayScore, null);
    assert.equal(r.confidence.multiplier, null);
    assert.equal(r.rawCoreScore, 80, "no misleading ranked score, but the facts remain visible");
    assert.equal(r.factors.cash.score, 30);
  });

  it("low-confidence material issues stay visible: a Low-confidence 95 is still a ranked High issue", () => {
    const strong: FactorPoints = { cash: 30, prof: 15, inv: 15, op: 12, cu: 10, time: 8, act: 5 }; // 95
    const r = score(strong, { dataConfidence: "LOW" });
    assert.equal(r.rawCoreScore, 95);
    assert.equal(r.domainScore, 80.75);
    assert.equal(r.priorityBand, "HIGH");
    assert.equal(r.rankable, true);
  });
});

// =====================================================================================================================
describe("MODIFIERS: each value, exclusions, evidence rules, caps", () => {
  it("persistence: first occurrence 0, then +1/+2/+3/+4 and no more than +4", () => {
    const values = [1, 2, 3, 4, 5, 6, 12].map((n) => score(P80, {}, { persistence: { consecutiveQualifiedOccurrences: n } }).modifiers.persistence.value);
    assert.deepEqual(values, [0, 1, 2, 3, 4, 4, 4]);
  });

  it("persistence does not apply to assigned/active, suppressed, duplicate, seasonal or already-controlled conditions", () => {
    for (const excluded of ["ACTIVE_ACTION", "SUPPRESSED", "DUPLICATE"] as const) {
      const m = score(P80, {}, { persistence: { consecutiveQualifiedOccurrences: 5, excluded } }).modifiers.persistence;
      assert.equal(m.value, 0, excluded);
      assert.equal(m.applied, false);
    }
    for (const persistenceExclusion of ["ORDINARY_SEASONAL", "ALREADY_CONTROLLED"] as const) {
      const m = score(P80, { modifiers: { persistenceExclusion } }, { persistence: { consecutiveQualifiedOccurrences: 5 } }).modifiers.persistence;
      assert.equal(m.value, 0, persistenceExclusion);
      assert.equal(m.applied, false);
    }
  });

  it("deterioration -2/0/+2/+4/+6 and needs comparative evidence", () => {
    const table: Array<["IMPROVING_MATERIALLY" | "STABLE" | "WORSENING_MODERATELY" | "WORSENING_MATERIALLY" | "ACCELERATING_CRITICAL", number]> = [
      ["IMPROVING_MATERIALLY", -2],
      ["STABLE", 0],
      ["WORSENING_MODERATELY", 2],
      ["WORSENING_MATERIALLY", 4],
      ["ACCELERATING_CRITICAL", 6],
    ];
    for (const [level, value] of table) {
      const m = score(P80, { modifiers: { deterioration: { level, comparativeEvidenceRef: "snap-2026-w42" } } }).modifiers.deterioration;
      assert.equal(m.value, value, level);
    }
    for (const [level] of table.filter(([l]) => l !== "STABLE")) {
      const m = score(P80, { modifiers: { deterioration: { level } } }).modifiers.deterioration;
      assert.equal(m.value, 0, `${level} without comparative evidence is not inferred`);
      assert.equal(m.applied, false);
      assert.match(m.rationale, /not inferred/);
    }
    assert.equal(score(P80).modifiers.deterioration.value, 0, "no evidence at all: nothing inferred");
  });

  it("cross-functional 0/+1/+2/+3, execution burden 0/-1/-2/-4, benefit uncertainty 0/-1/-2/-4", () => {
    (["ISOLATED", "TWO_FUNCTIONS_OR_LOCATIONS", "SEVERAL", "BROAD"] as const).forEach((l, i) => assert.equal(score(P41, { modifiers: { crossFunctional: l } }).modifiers.crossFunctional.value, i));
    const neg = [0, -1, -2, -4];
    (["NORMAL", "MEANINGFUL_COORDINATION", "HIGH_COST_DIFFICULT", "MAJOR_BARRIERS"] as const).forEach((l, i) => assert.equal(score(P41, { modifiers: { executionBurden: l } }).modifiers.executionBurden.value, neg[i]));
    (["SUPPORTED", "REASONABLY_SUPPORTED", "SIGNIFICANT_ASSUMPTIONS", "HIGHLY_UNCERTAIN"] as const).forEach((l, i) => assert.equal(score(P41, { modifiers: { benefitUncertainty: l } }).modifiers.benefitUncertainty.value, neg[i]));
  });

  it("strategic 0/+2/+4/+6 comes ONLY from a management authorization, preserving who and why", () => {
    assert.equal(score(P80).modifiers.strategic.value, 0);
    const table: Array<["IMPORTANT" | "HIGHLY_IMPORTANT" | "ENTERPRISE_CRITICAL", number]> = [["IMPORTANT", 2], ["HIGHLY_IMPORTANT", 4], ["ENTERPRISE_CRITICAL", 6]];
    for (const [level, value] of table) {
      const m = calc(fromPoints(P80), { ...CTX, strategic: { level, authorizedBy: "mgr-1", reason: "Board priority" } }).modifiers.strategic;
      assert.equal(m.value, value);
      assert.equal(m.authorizedBy, "mgr-1");
      assert.equal(m.authorizationReason, "Board priority");
    }
  });

  it("every modifier is preserved individually, and the positive cap (+15) preserves the uncapped total", () => {
    const r = calc(
      fromPoints(P41, { modifiers: { deterioration: { level: "ACCELERATING_CRITICAL", comparativeEvidenceRef: "e1" }, crossFunctional: "BROAD" } }),
      { persistence: { consecutiveQualifiedOccurrences: 9 }, strategic: { level: "ENTERPRISE_CRITICAL", authorizedBy: "mgr-1", reason: "x" } },
    );
    assert.equal(r.modifiers.persistence.value, 4);
    assert.equal(r.modifiers.deterioration.value, 6);
    assert.equal(r.modifiers.crossFunctional.value, 3);
    assert.equal(r.modifiers.strategic.value, 6);
    assert.equal(r.uncappedPositive, 19);
    assert.equal(r.cappedPositive, 15);
    assert.equal(r.uncappedModifierTotal, 19);
    assert.equal(r.cappedModifierTotal, 15);
    assert.equal(r.capApplied.positive, true);
    assert.equal(r.uncappedDomainScore, 41 + 19);
    assert.equal(r.domainScore, 41 + 15, "the capped total is what is scored; the uncapped one is preserved beside it");
  });

  it("the negative cap (-15) applies and preserves the uncapped negative total", () => {
    const cfg: ScoringConfig = { ...SCORING_CONFIG, modifierCaps: { positive: 15, negative: -5 } };
    const r = calc(
      fromPoints(P41, { modifiers: { executionBurden: "MAJOR_BARRIERS", benefitUncertainty: "HIGHLY_UNCERTAIN", deterioration: { level: "IMPROVING_MATERIALLY", comparativeEvidenceRef: "e1" } } }),
      CTX,
      cfg,
    );
    assert.equal(r.uncappedNegative, -10);
    assert.equal(r.cappedNegative, -5);
    assert.equal(r.capApplied.negative, true);
    assert.equal(r.domainScore, 36);
    assert.equal(SCORING_CONFIG.modifierCaps.negative, -15);
    assert.equal(SCORING_CONFIG.modifierCaps.positive, 15);
  });

  describe("4C-D4 Critical protection: execution burden alone never demotes a Critical candidate", () => {
    it("A-C: mathematically Critical before burden; burden alone would drop it below 85; protection keeps it Critical", () => {
      const withoutBurden = score(P86);
      assert.equal(withoutBurden.priorityBand, "CRITICAL", "A: Critical before the burden");
      const r = score(P86, { modifiers: { executionBurden: "MAJOR_BARRIERS" } });
      assert.equal(r.mathematicalDomainScore, 82, "B: the burden alone would take it to 82, below 85");
      assert.equal(r.domainScore, 85, "C: the published score is held at the Critical minimum");
      assert.equal(r.priorityBand, "CRITICAL");
    });
    it("D: the mathematical score, burden modifier, uncapped and capped totals and both core scores are preserved untouched", () => {
      const r = score(P86, { modifiers: { executionBurden: "MAJOR_BARRIERS" } });
      assert.equal(r.rawCoreScore, 86);
      assert.equal(r.confidenceAdjustedCoreScore, 86);
      assert.equal(r.modifiers.executionBurden.value, -4, "the burden modifier is NOT limited or rewritten");
      assert.equal(r.modifiers.executionBurden.limitedBy, undefined);
      assert.equal(r.uncappedModifierTotal, -4);
      assert.equal(r.cappedModifierTotal, -4);
      assert.equal(r.uncappedDomainScore, 82);
      assert.equal(r.mathematicalDomainScore, 82);
    });
    it("E: the flag and the reason are visible", () => {
      const r = score(P86, { modifiers: { executionBurden: "MAJOR_BARRIERS" } });
      assert.deepEqual(r.flags, ["CRITICAL_PROTECTED_FROM_BURDEN_DEMOTION"]);
      assert.equal(r.flags[0], CRITICAL_PROTECTED_FLAG);
      assert.equal(r.criticalProtection?.applied, true);
      assert.equal(r.criticalProtection?.scoreWithoutBurden, 86);
      assert.equal(r.criticalProtection?.mathematicalScore, 82);
      assert.match(r.criticalProtection!.reason, /Execution burden alone does not demote a Critical candidate/);
    });
    it("F: other negative modifiers stay explainable and still lower the score - protection is only for BURDEN-driven demotion", () => {
      const other = score(P86, { modifiers: { benefitUncertainty: "HIGHLY_UNCERTAIN", executionBurden: "MAJOR_BARRIERS" } });
      assert.equal(other.mathematicalDomainScore, 78);
      assert.equal(other.domainScore, 78, "without the burden it is 82 - not Critical - so nothing is protected");
      assert.equal(other.priorityBand, "HIGH");
      assert.deepEqual(other.flags, []);
      assert.equal(other.criticalProtection, null);
      assert.equal(other.modifiers.benefitUncertainty.value, -4);
      assert.equal(other.modifiers.executionBurden.value, -4);
      const mixed = score(P89, { modifiers: { benefitUncertainty: "HIGHLY_UNCERTAIN", executionBurden: "MAJOR_BARRIERS" } });
      assert.equal(mixed.mathematicalDomainScore, 81);
      assert.equal(mixed.domainScore, 85, "without the burden it is 85 (Critical): the burden alone caused the demotion, so it is protected");
      assert.equal(mixed.modifiers.benefitUncertainty.value, -4, "the other negative modifier is still applied and explainable");
      assert.equal(mixed.cappedModifierTotal, -8);
    });
    it("a non-Critical candidate takes the full burden; a Critical one that stays Critical is not flagged", () => {
      const notCritical = score(P80, { modifiers: { executionBurden: "MAJOR_BARRIERS" } });
      assert.equal(notCritical.modifiers.executionBurden.value, -4);
      assert.equal(notCritical.domainScore, 76);
      assert.deepEqual(notCritical.flags, []);
      const stillCritical = score(P89, { modifiers: { executionBurden: "MAJOR_BARRIERS" } });
      assert.equal(stillCritical.domainScore, 85);
      assert.equal(stillCritical.mathematicalDomainScore, 85);
      assert.deepEqual(stillCritical.flags, [], "burden did not demote it, so no protection is recorded");
    });
  });
});

// =====================================================================================================================
describe("FINAL SCORE: confidence-adjusted core + capped modifiers, clamped 0..100, reproducible", () => {
  it("is the confidence-adjusted core score plus the capped modifier total", () => {
    const r = calc(fromPoints(P80, { dataConfidence: "MEDIUM", modifiers: { crossFunctional: "SEVERAL", benefitUncertainty: "REASONABLY_SUPPORTED" } }));
    assert.equal(r.confidenceAdjustedCoreScore, 76);
    assert.equal(r.cappedModifierTotal, 1);
    assert.equal(r.domainScore, 77);
  });

  it("the floor is 0 and the ceiling is 100, and the unclamped value is preserved", () => {
    const floor = calc(fromPoints(ZERO, { modifiers: { executionBurden: "MAJOR_BARRIERS", benefitUncertainty: "HIGHLY_UNCERTAIN" } }));
    assert.equal(floor.domainScore, 0);
    assert.equal(floor.clamped, "FLOOR");
    assert.equal(floor.uncappedDomainScore, -8);
    assert.equal(floor.priorityBand, "INFORMATIONAL");
    const ceiling = calc(fromPoints(MAX, { modifiers: { crossFunctional: "BROAD", deterioration: { level: "ACCELERATING_CRITICAL", comparativeEvidenceRef: "e" } } }), { persistence: { consecutiveQualifiedOccurrences: 6 } });
    assert.equal(ceiling.domainScore, 100);
    assert.equal(ceiling.clamped, "CEILING");
    assert.equal(ceiling.uncappedDomainScore, 113);
  });

  it("is reproducible: the same inputs, context and configuration give byte-identical results", () => {
    const inp = fromPoints(P89, { dataConfidence: "MEDIUM", modifiers: { crossFunctional: "SEVERAL" }, preventableLoss: 10 });
    const a = JSON.stringify(calc(inp));
    const b = JSON.stringify(calc(JSON.parse(JSON.stringify(inp))));
    assert.equal(a, b);
  });

  it("displays one decimal (round half up) while keeping the 4-decimal calculated score", () => {
    assert.equal(displayScoreOf(76.95), 77);
    assert.equal(displayScoreOf(75.65), 75.7);
    assert.equal(displayScoreOf(75.64), 75.6);
    assert.equal(displayScoreOf(84.95), 85);
    const r = score(P89, { dataConfidence: "LOW" });
    assert.equal(r.domainScore, 75.65);
    assert.equal(r.displayScore, 75.7);
  });

  it("records the operation order in every calculation", () => {
    assert.equal(score(P80).operationOrder.length, 5);
    assert.match(score(P80).operationOrder[1]!, /confidence/);
  });
});

// =====================================================================================================================
describe("PRIORITY BANDS: exact edges", () => {
  it("Critical 85-100, High 70-84.99, Moderate 55-69.99, Watch 40-54.99, Informational <40", () => {
    const cases: Array<[number, string]> = [
      [100, "CRITICAL"], [85, "CRITICAL"], [84.995, "CRITICAL"], [84.99, "HIGH"], [84.9949, "HIGH"],
      [70, "HIGH"], [69.995, "HIGH"], [69.99, "MODERATE"],
      [55, "MODERATE"], [54.995, "MODERATE"], [54.99, "WATCH"],
      [40, "WATCH"], [39.995, "WATCH"], [39.99, "INFORMATIONAL"], [0, "INFORMATIONAL"],
    ];
    for (const [s, band] of cases) assert.equal(bandForScore(s), band, String(s));
  });

  it("scoreAtLeast uses the same rounding as the bands (so the Top 2 threshold and the High band agree)", () => {
    assert.equal(scoreAtLeast(70, 70), true);
    assert.equal(scoreAtLeast(69.99, 70), false);
    assert.equal(scoreAtLeast(69.995, 70), true);
    for (const s of [69.99, 69.995, 70, 70.01]) assert.equal(scoreAtLeast(s, 70), bandForScore(s) === "HIGH" || bandForScore(s) === "CRITICAL");
  });
});

// =====================================================================================================================
describe("EMERGENCY REVIEW CANDIDATE triggers A-E (candidate only, never a score change)", () => {
  const triggers = (p: FactorPoints, over: Partial<ScoringInputs> = {}) => score(p, over).emergency;

  it("A: Operational Risk 15 and Time Sensitivity >= 8", () => {
    assert.deepEqual(triggers(pts(ZERO, { op: 15, time: 8 })).triggers, ["A"]);
    assert.deepEqual(triggers(pts(ZERO, { op: 15, time: 10 })).triggers, ["A"]);
    assert.equal(triggers(pts(ZERO, { op: 15, time: 6 })).candidate, false);
    assert.equal(triggers(pts(ZERO, { op: 12, time: 10 })).candidate, false);
  });

  it("B: Customer & Revenue 10 and Time Sensitivity >= 8", () => {
    assert.deepEqual(triggers(pts(ZERO, { cu: 10, time: 8 })).triggers, ["B"]);
    assert.equal(triggers(pts(ZERO, { cu: 8, time: 10 })).candidate, false);
    assert.equal(triggers(pts(ZERO, { cu: 10, time: 6 })).candidate, false);
  });

  it("C: Operational Risk >= 12, Customer & Revenue >= 8 and Time Sensitivity >= 6", () => {
    assert.deepEqual(triggers(pts(ZERO, { op: 12, cu: 8, time: 6 })).triggers, ["C"]);
    assert.equal(triggers(pts(ZERO, { op: 9, cu: 8, time: 6 })).candidate, false);
    assert.equal(triggers(pts(ZERO, { op: 12, cu: 6, time: 6 })).candidate, false);
    assert.equal(triggers(pts(ZERO, { op: 12, cu: 8, time: 4 })).candidate, false);
  });

  it("D: irreversible material preventable loss with an action window of 14 days or less", () => {
    const d = (win: number | undefined, irreversible = true) => triggers(pts(ZERO, { time: 4 }), { emergency: { irreversibleMaterialPreventableLoss: irreversible, ...(win !== undefined ? { actionWindowDays: win } : {}) } });
    assert.deepEqual(d(14).triggers, ["D"]);
    assert.deepEqual(d(3).triggers, ["D"]);
    assert.equal(d(15).candidate, false);
    assert.equal(d(14, false).candidate, false);
    assert.equal(d(undefined).candidate, false, "defaults to the time-sensitivity window (45 days)");
  });

  it("E: a VERIFIED legal, regulatory, safety or business-continuity threat", () => {
    for (const category of ["LEGAL", "REGULATORY", "SAFETY", "BUSINESS_CONTINUITY"] as const) {
      const e = triggers(P41, { emergency: { verifiedThreat: { category, verifiedBy: "mgr-1", verifiedAt: "2026-10-20T12:00:00Z", evidenceRef: "doc-1" } } });
      assert.deepEqual(e.triggers, ["E"], category);
    }
    assert.equal(triggers(P41).candidate, false);
  });

  it("several triggers can fire together, and an emergency trigger never changes the score (no score inflation)", () => {
    const base = score(pts(ZERO, { op: 15, cu: 10, time: 10 }));
    assert.deepEqual(base.emergency.triggers, ["A", "B", "C"]);
    const withThreat = score(pts(ZERO, { op: 15, cu: 10, time: 10 }), { emergency: { verifiedThreat: { category: "SAFETY", verifiedBy: "m", verifiedAt: "2026-10-20", evidenceRef: "d" } } });
    assert.deepEqual(withThreat.emergency.triggers, ["A", "B", "C", "E"]);
    assert.equal(withThreat.domainScore, base.domainScore);
    assert.ok(base.emergency.reasons.every((r) => r.length > 10), "every trigger carries a readable reason");
  });
});

// =====================================================================================================================
describe("TIE-BREAK: the approved 12-step sequence, manual step and deterministic fallback", () => {
  const A = (over: Parameters<typeof tieValues>[0] = {}, extra: Partial<ReturnType<typeof rankItem>> = {}) => rankItem("a", 75, over, extra);
  const B = (over: Parameters<typeof tieValues>[0] = {}, extra: Partial<ReturnType<typeof rankItem>> = {}) => rankItem("b", 75, over, extra);

  const LEVEL_CASES: Array<[number, string, Parameters<typeof tieValues>[0], Parameters<typeof tieValues>[0]]> = [
    [1, "higher Cash Impact score", { cashScore: 18 }, { cashScore: 12 }],
    [2, "larger expected 13-week cash impact", { expectedCash: 2000 }, { expectedCash: 1000 }],
    [3, "higher Time Sensitivity", { timeScore: 8 }, { timeScore: 6 }],
    [4, "higher Operational Risk", { operationalRisk: 12 }, { operationalRisk: 9 }],
    [5, "higher Customer & Revenue Impact", { customerRevenue: 8 }, { customerRevenue: 6 }],
    [6, "greater preventable loss", { preventableLoss: 900 }, { preventableLoss: 500 }],
    [7, "higher data confidence", { confidenceRank: 3 }, { confidenceRank: 2 }],
    [8, "faster benefit realization", { benefitSpeed: 5 }, { benefitSpeed: 3 }],
    [9, "lower execution burden", { executionBurden: 0 }, { executionBurden: 2 }],
    [10, "longer persistence", { persistence: 4 }, { persistence: 1 }],
    [11, "earlier action deadline", { actionDeadline: "2026-11-01" }, { actionDeadline: "2026-12-01" }],
  ];
  for (const [level, label, better, worse] of LEVEL_CASES) {
    it(`level ${level}: ${label} ranks first (and the decision names level ${level})`, () => {
      const r1 = compareTieBreak(A(better), B(worse));
      assert.ok(r1.order < 0, "a ranks ahead");
      assert.equal(r1.level, level);
      assert.equal(TIE_LEVELS[r1.level - 1], TIE_LEVELS[level - 1]);
      const r2 = compareTieBreak(B(worse), A(better));
      assert.ok(r2.order > 0, "and it is symmetric");
      assert.equal(r2.level, level);
    });
  }

  it("level 11: a candidate with no deadline ranks after one with a deadline", () => {
    assert.ok(compareTieBreak(A({ actionDeadline: "2026-12-30" }), B({ actionDeadline: null })).order < 0);
    assert.equal(compareTieBreak(A({ actionDeadline: "2026-12-30" }), B({ actionDeadline: null })).level, 11);
  });

  it("level 12: the earlier creation timestamp ranks first", () => {
    const r = compareTieBreak(A({}, { createdAt: "2026-09-01T00:00:00.000Z" }), B({}, { createdAt: "2026-10-01T00:00:00.000Z" }));
    assert.ok(r.order < 0);
    assert.equal(r.level, 12);
  });

  it("level 13: when steps 1-12 leave the candidates level, the explicit manual management tie-break decides", () => {
    const manualBFirst = compareTieBreak(A(), B(), [["b", "a"]]);
    assert.ok(manualBFirst.order > 0, "b is placed ahead by management");
    assert.equal(manualBFirst.level, 13);
    assert.ok(compareTieBreak(A(), B(), [["a", "b"]]).order < 0);
  });

  it("level 14: with no manual decision the lowest candidate id is a deterministic, flagged last resort", () => {
    const r = compareTieBreak(A(), B());
    assert.ok(r.order < 0);
    assert.equal(r.level, 14);
    assert.equal(TIE_LEVELS[13], "DETERMINISTIC_ID_FALLBACK");
    assert.equal(TIE_LEVELS.length, 14);
  });

  it("an earlier level always wins even when every later level favours the other candidate", () => {
    const a = A({ cashScore: 18, expectedCash: 1, timeScore: 0, operationalRisk: 0, persistence: 0 });
    const b = B({ cashScore: 12, expectedCash: 9e9, timeScore: 10, operationalRisk: 15, persistence: 9 });
    const r = compareTieBreak(a, b);
    assert.ok(r.order < 0);
    assert.equal(r.level, 1);
  });

  it("tie = same displayed one-decimal score OR within 0.5 points: those are ordered by the sequence, others by score", () => {
    const x = rankItem("x", 76.0, { cashScore: 12 });
    const y = rankItem("y", 75.65, { cashScore: 18 }); // 0.35 apart: tied, y has the higher cash score
    const z = rankItem("z", 74.4, { cashScore: 30 }); // 1.6 below the leader: not tied, lower score ranks lower even with the best cash score
    const o = orderItems([z, x, y], (i) => i.domainScore);
    assert.deepEqual(o.order, ["y", "x", "z"]);
    assert.equal(o.notes.get("y")!.separatedFromNextAt, 1);
    assert.equal(o.notes.get("y")!.levelNames.next, "CASH_IMPACT_SCORE");
    assert.equal(o.notes.has("z"), false, "z is not in a tie cluster");
  });

  it("the same displayed score is a tie even though the calculated scores differ", () => {
    const hi = rankItem("hi", 76.04, { cashScore: 12 });
    const lo = rankItem("lo", 75.96, { cashScore: 18 });
    assert.equal(displayScoreOf(76.04), displayScoreOf(75.96));
    assert.deepEqual(orderItems([hi, lo], (i) => i.domainScore).order, ["lo", "hi"]);
  });

  it("exactly 0.5 apart is a tie; just over 0.5 is not", () => {
    const lead = rankItem("lead", 80, { cashScore: 12 });
    assert.deepEqual(orderItems([lead, rankItem("t", 79.5, { cashScore: 18 })], (i) => i.domainScore).order, ["t", "lead"]);
    assert.deepEqual(orderItems([lead, rankItem("t", 79.4999, { cashScore: 18 })], (i) => i.domainScore).order, ["lead", "t"]);
  });

  it("tie clusters are anchored to the cluster leader (80.0, 79.6 tied; 79.2 is not tied with the leader)", () => {
    const a = rankItem("a", 80.0, { cashScore: 6 });
    const b = rankItem("b", 79.6, { cashScore: 18 });
    const c = rankItem("c", 79.2, { cashScore: 30 });
    assert.deepEqual(orderItems([c, a, b], (i) => i.domainScore).order, ["b", "a", "c"]);
  });

  it("ordering is deterministic and does not depend on the order the candidates are supplied in", () => {
    const items = ["m", "k", "q", "c", "z"].map((id, i) => rankItem(id, 70 + (i % 2) * 0.2, { persistence: i }));
    const first = orderItems(items, (i) => i.domainScore).order;
    for (const perm of [[...items].reverse(), [items[2]!, items[0]!, items[4]!, items[1]!, items[3]!]]) assert.deepEqual(orderItems(perm, (i) => i.domainScore).order, first);
  });

  it("records which levels were used, the manual step and the deterministic fallback", () => {
    const manual = orderItems([rankItem("a", 75), rankItem("b", 75)], (i) => i.domainScore, [["b", "a"]]);
    assert.deepEqual(manual.order, ["b", "a"]);
    assert.equal(manual.notes.get("b")!.usedManualTieBreak, true);
    const fallback = orderItems([rankItem("a", 75), rankItem("b", 75)], (i) => i.domainScore);
    assert.equal(fallback.notes.get("a")!.usedDeterministicFallback, true);
  });
});

// =====================================================================================================================
describe("TOP 2: new, qualified candidates only, never filled", () => {
  const byId = (items: ReturnType<typeof rankItem>[]) => new Map(items.map((i) => [i.candidateId, i]));
  const top2 = (items: ReturnType<typeof rankItem>[]) => selectTop2(items.map((i) => i.candidateId), byId(items));

  it("two candidates at or above 70 fill the two slots in displayed order", () => {
    assert.deepEqual(top2([rankItem("a", 90), rankItem("b", 80), rankItem("c", 75)]), ["a", "b"]);
  });

  it("one qualified candidate gives a Top 2 of one (the second slot is NOT filled with a lower candidate)", () => {
    assert.deepEqual(top2([rankItem("a", 72), rankItem("b", 69.99), rankItem("c", 50)]), ["a"]);
  });

  it("no candidate at or above 70 gives an empty Top 2", () => {
    assert.deepEqual(top2([rankItem("a", 69.99), rankItem("b", 60)]), []);
  });

  it("the threshold is exactly 70", () => {
    assert.deepEqual(top2([rankItem("a", 70), rankItem("b", 69.99)]), ["a"]);
  });

  it("assigned/active actions (ineligible) are excluded and the next qualified NEW candidate takes the slot", () => {
    const items = [rankItem("active", 95, {}, { eligibleForTop2: false }), rankItem("a", 88), rankItem("b", 77), rankItem("c", 71)];
    assert.deepEqual(top2(items), ["a", "b"]);
    assert.deepEqual(top2([rankItem("active", 99, {}, { eligibleForTop2: false })]), []);
  });

  it("uses the effective (management) score, so a governed demotion below 70 removes a candidate", () => {
    const demoted = rankItem("a", 72, {}, { effectiveScore: 68 });
    assert.deepEqual(top2([demoted, rankItem("b", 71)]), ["b"]);
  });
});

// =====================================================================================================================
describe("RANK LOCK and override guidance", () => {
  const when = new Date("2026-10-26T00:00:00Z");
  it("holds a locked candidate at its rank while the others keep their order around it", () => {
    const r = applyRankLocks(["a", "b", "c", "d"], [{ candidateId: "d", rank: 1, effectiveAt: when, governanceId: "g1" }]);
    assert.deepEqual(r.displayed, ["d", "a", "b", "c"]);
    assert.deepEqual(r.applied, [{ candidateId: "d", rank: 1 }]);
    const mid = applyRankLocks(["a", "b", "c", "d"], [{ candidateId: "a", rank: 3, effectiveAt: when, governanceId: "g1" }]);
    assert.deepEqual(mid.displayed, ["b", "c", "a", "d"]);
  });

  it("two locks on the same rank: the earlier lock wins and the other is recorded as ignored", () => {
    const r = applyRankLocks(["a", "b", "c"], [
      { candidateId: "c", rank: 1, effectiveAt: new Date(when.getTime() + 5), governanceId: "g2" },
      { candidateId: "b", rank: 1, effectiveAt: when, governanceId: "g1" },
    ]);
    assert.deepEqual(r.displayed, ["b", "a", "c"]);
    assert.equal(r.ignored.length, 1);
    assert.equal(r.ignored[0]!.candidateId, "c");
  });

  it("a lock on a candidate that is not ranked in this run is ignored (never invented)", () => {
    const r = applyRankLocks(["a", "b"], [{ candidateId: "zz", rank: 1, effectiveAt: when, governanceId: "g" }]);
    assert.deepEqual(r.displayed, ["a", "b"]);
    assert.equal(r.ignored[0]!.reason, "CANDIDATE_NOT_RANKED_IN_THIS_RUN");
  });

  it("override guidance: minor +/-1..5, material +/-6..10, anything else refused (an emergency is a separate state)", () => {
    for (const p of [1, 3, 5, -1, -5]) assert.equal(overrideMagnitude(p), "MINOR", String(p));
    for (const p of [6, 10, -6, -10]) assert.equal(overrideMagnitude(p), "MATERIAL", String(p));
    for (const p of [0, 0.5, 11, -11, 25, Number.NaN, Number.POSITIVE_INFINITY]) assert.equal(overrideMagnitude(p), null, String(p));
  });
});

// =====================================================================================================================
describe("PERSISTENCE across company-local operating weeks (4C-D1)", () => {
  const TZ = "America/Chicago";
  // Local Sunday-Saturday weeks. 2026-10-26 15:00Z is Monday 10:00 in Chicago (the week that started Sunday 2026-10-25).
  const wk = (n: number) => new Date(Date.UTC(2026, 9, 26 + 7 * n, 15));
  const cur = (n: number, tz = TZ) => operatingWeekOf(wk(n), tz);
  it("the operating week is Sunday-Saturday in the company time zone", () => {
    assert.equal(cur(0), "2026-10-25");
    assert.equal(operatingWeekOf(new Date("2026-10-31T23:30:00-05:00"), TZ), "2026-10-25", "Saturday 23:30 local is still that week");
    assert.equal(operatingWeekOf(new Date("2026-11-01T00:30:00-05:00"), TZ), "2026-11-01", "Sunday 00:30 local starts the next week");
  });
  it("counts one occurrence per consecutive weekly cycle; extra runs in the same week add nothing", () => {
    assert.equal(occurrenceNumber([], cur(0), TZ), 1);
    assert.equal(occurrenceNumber([{ scoredAt: wk(0), qualified: true }], cur(1), TZ), 2);
    assert.equal(occurrenceNumber([{ scoredAt: wk(0), qualified: true }, { scoredAt: wk(1), qualified: true }], cur(2), TZ), 3);
    assert.equal(occurrenceNumber([{ scoredAt: wk(0), qualified: true }, { scoredAt: new Date(wk(0).getTime() + 86_400_000), qualified: true }], cur(1), TZ), 2, "two runs in week 0 are one occurrence");
    assert.equal(occurrenceNumber([{ scoredAt: wk(1), qualified: true }], operatingWeekOf(new Date(wk(1).getTime() + 3_600_000), TZ), TZ), 1, "a re-run in the same week is the same occurrence");
  });
  it("a prior week that was excluded or below the qualifying minimum breaks the streak", () => {
    assert.equal(occurrenceNumber([{ scoredAt: wk(0), qualified: true }, { scoredAt: wk(1), qualified: false }], cur(2), TZ), 1);
    assert.equal(occurrenceNumber([{ scoredAt: wk(0), qualified: false }, { scoredAt: wk(1), qualified: true }, { scoredAt: wk(2), qualified: true }], cur(3), TZ), 3);
  });
  it("SKIPPED-WEEK RULE: a week with no scoring cycle is neutral (neither counts nor breaks)", () => {
    assert.equal(occurrenceNumber([{ scoredAt: wk(0), qualified: true }, { scoredAt: wk(2), qualified: true }], cur(3), TZ), 3, "week 1 had no cycle: the streak continues across it");
    assert.equal(occurrenceNumber([{ scoredAt: wk(0), qualified: true }], cur(3), TZ), 2, "two idle weeks do not add occurrences");
  });
  it("UTC boundary: a local Saturday-night run and the next local Sunday run are DIFFERENT weeks, though one UTC calendar day apart is irrelevant", () => {
    const satNight = new Date("2026-10-31T23:30:00-05:00"); // 2026-11-01T04:30Z - already Sunday in UTC
    const sunMorning = new Date("2026-11-01T09:00:00-06:00"); // CST after the DST change
    assert.equal(operatingWeekOf(satNight, TZ), "2026-10-25");
    assert.equal(operatingWeekOf(sunMorning, TZ), "2026-11-01");
    assert.equal(occurrenceNumber([{ scoredAt: satNight, qualified: true }], operatingWeekOf(sunMorning, TZ), TZ), 2, "consecutive local weeks increment");
    assert.equal(occurrenceNumber([{ scoredAt: satNight, qualified: true }], operatingWeekOf(new Date("2026-10-31T23:50:00-05:00"), TZ), TZ), 1, "no false persistence inside the same local week");
  });
  it("daylight saving does not change week identity (US fall-back 2026-11-01 and spring-forward 2027-03-14)", () => {
    const days = ["2026-10-31T12:00:00Z", "2026-11-01T04:30:00Z", "2026-11-01T12:00:00Z", "2026-11-07T20:00:00Z"].map((d) => new Date(d));
    assert.deepEqual(days.map((d) => operatingWeekOf(d, TZ)), ["2026-10-25", "2026-10-25", "2026-11-01", "2026-11-01"]);
    assert.equal(operatingWeekOf(new Date("2027-03-13T23:00:00-06:00"), TZ), "2027-03-07");
    assert.equal(operatingWeekOf(new Date("2027-03-14T03:00:00-05:00"), TZ), "2027-03-14");
  });
  it("two companies in different time zones can be in different weeks at the same UTC instant", () => {
    const instant = new Date("2026-11-01T03:30:00Z"); // Sat 22:30 Chicago (CDT) but Sun 12:30 Auckland
    assert.equal(operatingWeekOf(instant, "America/Chicago"), "2026-10-25");
    assert.equal(operatingWeekOf(instant, "Pacific/Auckland"), "2026-11-01");
    assert.notEqual(operatingWeekOf(instant, "America/Chicago"), operatingWeekOf(instant, "Pacific/Auckland"));
  });
});
// =====================================================================================================================
describe("PUBLICATION: which Results Return event a result needs", () => {
  const s = (over: Partial<PublishedState> = {}): PublishedState => ({
    domainScore: 80, calculatedRank: 1, displayedRank: 1, priorityBand: "HIGH", top2Qualified: true, emergencyReviewCandidate: false,
    criticalOutsideTop2: false, forcedReviewRequired: false, overridePoints: null, rankLockRank: null, ...over,
  });
  it("first score => CANDIDATE_SCORED; nothing changed => no event", () => {
    assert.equal(chooseEvent(null, s()), "CANDIDATE_SCORED");
    assert.equal(chooseEvent(s(), s()), null);
    assert.equal(chooseEvent(null, s({ domainScore: null, priorityBand: null })), null);
  });
  it("a changed score, calculated rank or band => CANDIDATE_SCORED", () => {
    assert.equal(chooseEvent(s(), s({ domainScore: 81 })), "CANDIDATE_SCORED");
    assert.equal(chooseEvent(s(), s({ calculatedRank: 2 })), "CANDIDATE_SCORED");
    assert.equal(chooseEvent(s(), s({ priorityBand: "CRITICAL" })), "CANDIDATE_SCORED");
  });
  it("only a displayed-priority change (rank lock, override, flags, displayed rank) => DOMAIN_PRIORITY_CHANGED", () => {
    assert.equal(chooseEvent(s(), s({ displayedRank: 2 })), "DOMAIN_PRIORITY_CHANGED");
    assert.equal(chooseEvent(s(), s({ rankLockRank: 1 })), "DOMAIN_PRIORITY_CHANGED");
    assert.equal(chooseEvent(s(), s({ overridePoints: 4 })), "DOMAIN_PRIORITY_CHANGED");
    assert.equal(chooseEvent(s(), s({ emergencyReviewCandidate: true })), "DOMAIN_PRIORITY_CHANGED");
    assert.equal(chooseEvent(s(), s({ forcedReviewRequired: true })), "DOMAIN_PRIORITY_CHANGED");
    assert.equal(chooseEvent(s(), s({ top2Qualified: false })), "DOMAIN_PRIORITY_CHANGED");
  });
});

// =====================================================================================================================
describe("STABLE USER IDENTITY (4C-D5)", () => {
  it("accepts a stable DPOS user id and the system actor; refuses names and emails", () => {
    assertStableUserId({ actorId: "usr_01HZX9", role: "MANAGER" }, "op");
    assertStableUserId({ actorId: "mgr-1", role: "MANAGER" }, "op");
    assertStableUserId({ actorId: "iam-system", role: "SYSTEM" }, "op");
    for (const bad of ["Morgan Manager", "morgan@example.com", " mgr-1", "a b"]) {
      assert.throws(() => assertStableUserId({ actorId: bad, role: "MANAGER" }, "op"), (e: { code?: string }) => e.code === "STABLE_USER_ID_REQUIRED", bad);
    }
  });
});
