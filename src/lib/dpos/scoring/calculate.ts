/**
 * Stage 4C: the pure, deterministic scoring calculation for ONE candidate.
 *
 * No database, no clock, no randomness: the same inputs, context and configuration always return the same result. Order of
 * operations (documented, and persisted in every breakdown):
 *
 *   1. seven factor scores from the stored inputs  -> rawCoreScore (sum, max 100)
 *   2. confidence treatment                         -> confidenceAdjustedCoreScore = rawCoreScore x confidenceMultiplier
 *   3. six modifiers, each preserved individually   -> uncapped total, then caps (+15 / -15) -> capped total
 *   4. final domain score = confidence-adjusted core score + capped modifier total, clamped ONLY to 0..100
 *   5. priority band from the score rounded to two decimals; display score = one decimal
 *
 * Scores are held in integer ten-thousandths internally so no floating-point drift can move a score across a band edge.
 */
import {
  CRITICAL_PROTECTED_FLAG,
  SCORING_CONFIG,
  FACTOR_KEYS,
  MODIFIER_KEYS,
  type ActionabilityLevel,
  type ConfidenceLevel,
  type FactorKey,
  type ModifierKey,
  type PriorityBand,
  type RatioBand,
  type ScoringConfig,
  type StrategicLevel,
} from "./config";
import type { ScoringInputs } from "./inputs";

const SCALE = 10_000; // internal score unit = 1/10000 of a point

export interface FactorResult {
  score: number;
  max: number;
  /** The raw values / ratios the score was derived from. */
  raw: Record<string, number | string | boolean | null>;
  rationale: string;
}

export interface ModifierResult {
  key: ModifierKey;
  value: number;
  /** False when the modifier was not applied (and why, in `rationale`). */
  applied: boolean;
  level: string | null;
  rationale: string;
  /** Present when a protection rule reduced the modifier from its approved value. */
  approvedValue?: number;
  limitedBy?: string;
  authorizedBy?: string;
  authorizationReason?: string;
}

export interface CalcContext {
  persistence: { consecutiveQualifiedOccurrences: number; excluded?: "ACTIVE_ACTION" | "SUPPRESSED" | "DUPLICATE" | null };
  /** A management-authorized strategic level (from the governance ledger). Never taken from the inputs. */
  strategic?: { level: StrategicLevel; authorizedBy: string; reason: string } | null;
}

export interface TieBreakValues {
  cashScore: number;
  expectedCash: number;
  timeScore: number;
  operationalRisk: number;
  customerRevenue: number;
  preventableLoss: number;
  /** HIGH 3, MEDIUM 2, LOW 1, INSUFFICIENT 0 */
  confidenceRank: number;
  /** Speed to benefit (the actionability score). */
  benefitSpeed: number;
  /** Magnitude of the execution-burden penalty (lower is better). */
  executionBurden: number;
  persistence: number;
  actionDeadline: string | null;
}

export interface EmergencyEvaluation {
  candidate: boolean;
  /** Trigger codes A–E that fired. */
  triggers: string[];
  reasons: string[];
}

export interface ScoreCalculation {
  scoringVersion: string;
  configVersion: string;
  rankable: boolean;
  notRankableReason: string | null;
  factors: Record<FactorKey, FactorResult>;
  rawCoreScore: number;
  confidence: { level: ConfidenceLevel; multiplier: number | null };
  confidenceAdjustedCoreScore: number | null;
  modifiers: Record<ModifierKey, ModifierResult>;
  uncappedPositive: number;
  uncappedNegative: number;
  uncappedModifierTotal: number;
  cappedPositive: number;
  cappedNegative: number;
  cappedModifierTotal: number;
  capApplied: { positive: boolean; negative: boolean };
  uncappedDomainScore: number | null;
  /** 4C-D4: the score exactly as the mathematics produced it (before Critical protection), 0..100, 4 decimals. */
  mathematicalDomainScore: number | null;
  /** 4C-D4: present when execution burden alone would have demoted a Critical candidate and protection held it at Critical. */
  criticalProtection: { applied: true; flag: string; scoreWithoutBurden: number; mathematicalScore: number; burdenModifier: number; reason: string } | null;
  /** Score flags, e.g. CRITICAL_PROTECTED_FROM_BURDEN_DEMOTION. */
  flags: string[];
  /** Final published 0..100 score (4 decimals): the mathematical score, or the Critical floor when protection applied. Null when not rankable. */
  domainScore: number | null;
  clamped: "FLOOR" | "CEILING" | null;
  /** Score rounded to one decimal, for display and the same-displayed-score tie rule. */
  displayScore: number | null;
  priorityBand: PriorityBand | null;
  overdue: boolean;
  emergency: EmergencyEvaluation;
  tieBreak: TieBreakValues;
  operationOrder: string[];
}

export const OPERATION_ORDER = [
  "factor scores (7) -> rawCoreScore",
  "confidenceAdjustedCoreScore = rawCoreScore x confidenceMultiplier",
  "individual modifiers -> uncapped total -> caps (+15 / -15) -> capped total",
  "domainScore = confidenceAdjustedCoreScore + cappedModifierTotal, clamped to 0..100",
  "priorityBand from the score rounded to 2 decimals; display score = 1 decimal",
];

// ---- exact ratio banding ----------------------------------------------------------------------------------------------

// BigInt literals need ES2020; the project targets lower, so constants are built with BigInt().
const ZERO = BigInt(0);
const TEN_THOUSAND = BigInt(10_000);
const toCents = (v: number): bigint => BigInt(Math.round(v * 100));

export interface RatioResult {
  points: number;
  /** numerator * multiplier / denominator as a plain number, for display. */
  ratio: number;
  bandMinBps: number;
}

/** Highest band whose lower bound is met by numerator*multiplier/denominator, using exact integer arithmetic. */
export function bandRatio(bands: RatioBand[], numerator: number, denominator: number, multiplier = 1): RatioResult {
  const num = toCents(numerator) * BigInt(multiplier);
  const den = toCents(denominator);
  const ratio = den === ZERO ? 0 : Number(num) / Number(den);
  const ordered = [...bands].sort((a, b) => b.minBps - a.minBps);
  for (const b of ordered) {
    if (b.minBps === 0) continue;
    if (num * TEN_THOUSAND >= BigInt(b.minBps) * den) return { points: b.points, ratio, bandMinBps: b.minBps };
  }
  const floor = ordered.find((b) => b.minBps === 0);
  return { points: floor?.points ?? 0, ratio, bandMinBps: 0 };
}

export function bandForScore(score: number, cfg: ScoringConfig = SCORING_CONFIG): PriorityBand {
  const s2 = Math.floor((Math.round(score * SCALE) + 50) / 100); // score rounded half-up to 2 decimals, in hundredths
  for (const b of cfg.bands) if (s2 >= Math.round(b.min * 100)) return b.band;
  return "INFORMATIONAL";
}

/** One-decimal display score (round half up on the 4-decimal score). */
export function displayScoreOf(score: number): number {
  return Math.floor((Math.round(score * SCALE) + 500) / 1000) / 10;
}

const round4 = (n: number) => Math.round(n * SCALE) / SCALE;

// ---- factors ------------------------------------------------------------------------------------------------------------------

function cashFactor(inp: ScoringInputs, cfg: ScoringConfig): FactorResult {
  const c = inp.cash;
  const weeks = cfg.cash.defaultWeeklyRevenueWeeks;
  const usingWeekly = c.averageWeeklyRevenue !== undefined;
  const r = usingWeekly
    ? bandRatio(cfg.cash.bands, c.expected13WeekNetCashImpact, c.averageWeeklyRevenue!)
    : bandRatio(cfg.cash.bands, c.expected13WeekNetCashImpact, c.trailing52WeekRevenue!, weeks);
  return {
    score: r.points,
    max: cfg.factorMax.cash,
    raw: {
      expected13WeekNetCashImpact: c.expected13WeekNetCashImpact,
      averageWeeklyRevenue: usingWeekly ? c.averageWeeklyRevenue! : null,
      trailing52WeekRevenue: usingWeekly ? (c.trailing52WeekRevenue ?? null) : c.trailing52WeekRevenue!,
      weeklyRevenueBasis: usingWeekly ? "SUPPLIED_AVERAGE_WEEKLY_REVENUE" : `TRAILING_52_WEEK_REVENUE_/_${weeks}`,
      ratio: r.ratio,
      ratioPct: r.ratio * 100,
      bandMinBps: r.bandMinBps,
    },
    rationale: `13-week net cash impact is ${(r.ratio * 100).toFixed(2)}% of average weekly revenue.`,
  };
}

function profitabilityFactor(inp: ScoringInputs, cfg: ScoringConfig): FactorResult {
  const p = inp.profitability;
  const r = bandRatio(cfg.profitability.bands, p.netProfitabilityImpact, p.trailing12MonthGrossProfit);
  return {
    score: r.points,
    max: cfg.factorMax.profitability,
    raw: {
      netProfitabilityImpact: p.netProfitabilityImpact,
      trailing12MonthGrossProfit: p.trailing12MonthGrossProfit,
      effectPeriodDays: p.effectPeriodDays ?? null,
      annualizationBasis: p.annualizationBasis ?? null,
      ratio: r.ratio,
      ratioPct: r.ratio * 100,
      bandMinBps: r.bandMinBps,
    },
    rationale: `Net profitability impact is ${(r.ratio * 100).toFixed(3)}% of trailing 12-month gross profit (no annualization applied by the engine).`,
  };
}

function inventoryFactor(inp: ScoringInputs, cfg: ScoringConfig): FactorResult {
  const i = inp.inventoryExposure;
  const r = bandRatio(cfg.inventoryExposure.bands, i.affectedInventoryBookValue, i.totalInventoryBookValue);
  return {
    score: r.points,
    max: cfg.factorMax.inventoryExposure,
    raw: { affectedInventoryBookValue: i.affectedInventoryBookValue, totalInventoryBookValue: i.totalInventoryBookValue, ratio: r.ratio, ratioPct: r.ratio * 100, bandMinBps: r.bandMinBps },
    rationale: `Affected inventory is ${(r.ratio * 100).toFixed(3)}% of total inventory book value.`,
  };
}

function timeFactor(inp: ScoringInputs, cfg: ScoringConfig): { factor: FactorResult; overdue: boolean } {
  const days = inp.timeSensitivity.daysToAction;
  const overdue = inp.timeSensitivity.overdue === true || days < 0;
  let points: number;
  if (overdue) points = Math.min(cfg.timeSensitivity.overduePoints, cfg.factorMax.timeSensitivity);
  else {
    const band = cfg.timeSensitivity.bands.find((b) => b.maxDays === null || days <= b.maxDays);
    points = band ? band.points : 0;
  }
  return {
    overdue,
    factor: {
      score: Math.min(points, cfg.factorMax.timeSensitivity),
      max: cfg.factorMax.timeSensitivity,
      raw: { daysToAction: days, overdue },
      rationale: overdue ? "Overdue: the factor holds at its 10-point maximum and the overdue flag is recorded." : `${days} day(s) to the action deadline.`,
    },
  };
}

// ---- modifiers ---------------------------------------------------------------------------------------------------------------

const MODIFIER_LABELS: Record<ModifierKey, string> = {
  persistence: "Persistence",
  deterioration: "Deterioration",
  crossFunctional: "Cross-functional",
  strategic: "Strategic",
  executionBurden: "Execution burden",
  benefitUncertainty: "Benefit uncertainty",
};

function modifiers(inp: ScoringInputs, ctx: CalcContext, cfg: ScoringConfig): Record<ModifierKey, ModifierResult> {
  const m = inp.modifiers ?? {};
  const out = {} as Record<ModifierKey, ModifierResult>;

  // persistence
  {
    const n = Math.max(1, Math.floor(ctx.persistence.consecutiveQualifiedOccurrences));
    const excluded = ctx.persistence.excluded ?? m.persistenceExclusion ?? null;
    if (excluded) {
      out.persistence = { key: "persistence", value: 0, applied: false, level: `OCCURRENCE_${n}`, rationale: `Persistence does not apply (${excluded}); occurrence count ${n} recorded.` };
    } else {
      const value = Math.min(n - 1, cfg.persistence.maxPoints);
      out.persistence = { key: "persistence", value, applied: true, level: `OCCURRENCE_${n}`, rationale: `Consecutive qualified occurrence ${n}: +${value}.` };
    }
  }
  // deterioration (never inferred without comparative evidence)
  {
    const d = m.deterioration;
    if (!d) out.deterioration = { key: "deterioration", value: 0, applied: false, level: null, rationale: "No comparative evidence supplied; deterioration is not inferred." };
    else if (d.level !== "STABLE" && !d.comparativeEvidenceRef) {
      out.deterioration = { key: "deterioration", value: 0, applied: false, level: d.level, rationale: `${d.level} was asserted without comparative evidence; deterioration is not inferred, so no modifier is applied.` };
    } else {
      out.deterioration = { key: "deterioration", value: cfg.deterioration[d.level], applied: true, level: d.level, rationale: `${d.level}${d.comparativeEvidenceRef ? ` (evidence ${d.comparativeEvidenceRef})` : ""}.` };
    }
  }
  // cross-functional
  {
    const l = m.crossFunctional ?? "ISOLATED";
    out.crossFunctional = { key: "crossFunctional", value: cfg.crossFunctional[l], applied: m.crossFunctional !== undefined, level: l, rationale: m.crossFunctional ? `${l}.` : "Not supplied: treated as isolated (0)." };
  }
  // strategic (management authorization only)
  {
    const s = ctx.strategic;
    if (!s || s.level === "NORMAL") out.strategic = { key: "strategic", value: 0, applied: false, level: "NORMAL", rationale: "No management strategic authorization on record." };
    else {
      out.strategic = { key: "strategic", value: cfg.strategic[s.level], applied: true, level: s.level, rationale: `${s.level} authorized by ${s.authorizedBy}.`, authorizedBy: s.authorizedBy, authorizationReason: s.reason };
    }
  }
  // execution burden
  {
    const l = m.executionBurden ?? "NORMAL";
    out.executionBurden = { key: "executionBurden", value: cfg.executionBurden[l], applied: m.executionBurden !== undefined, level: l, rationale: m.executionBurden ? `${l}.` : "Not supplied: treated as normal (0)." };
  }
  // benefit uncertainty
  {
    const l = m.benefitUncertainty ?? "SUPPORTED";
    out.benefitUncertainty = { key: "benefitUncertainty", value: cfg.benefitUncertainty[l], applied: m.benefitUncertainty !== undefined, level: l, rationale: m.benefitUncertainty ? `${l}.` : "Not supplied: treated as supported (0)." };
  }
  return out;
}

function sumSplit(mods: Record<ModifierKey, ModifierResult>) {
  let pos = 0;
  let neg = 0;
  for (const k of MODIFIER_KEYS) {
    const v = mods[k].value;
    if (v > 0) pos += v;
    else neg += v;
  }
  return { pos: round4(pos), neg: round4(neg) };
}

// ---- emergency review candidate triggers (A–E) ------------------------------------------------------------------------------

export function evaluateEmergencyTriggers(inp: ScoringInputs, factors: Record<FactorKey, FactorResult>, cfg: ScoringConfig = SCORING_CONFIG): EmergencyEvaluation {
  const op = factors.operationalRisk.score;
  const cu = factors.customerRevenue.score;
  const ts = factors.timeSensitivity.score;
  const e = cfg.emergency;
  const triggers: string[] = [];
  const reasons: string[] = [];
  if (op >= e.triggerA.operationalRisk && ts >= e.triggerA.timeSensitivity) {
    triggers.push("A");
    reasons.push(`A: Operational Risk = ${op} and Time Sensitivity = ${ts} (>= ${e.triggerA.timeSensitivity}).`);
  }
  if (cu >= e.triggerB.customerRevenue && ts >= e.triggerB.timeSensitivity) {
    triggers.push("B");
    reasons.push(`B: Customer & Revenue Impact = ${cu} and Time Sensitivity = ${ts} (>= ${e.triggerB.timeSensitivity}).`);
  }
  if (op >= e.triggerC.operationalRisk && cu >= e.triggerC.customerRevenue && ts >= e.triggerC.timeSensitivity) {
    triggers.push("C");
    reasons.push(`C: Operational Risk ${op} >= ${e.triggerC.operationalRisk}, Customer & Revenue ${cu} >= ${e.triggerC.customerRevenue}, Time Sensitivity ${ts} >= ${e.triggerC.timeSensitivity}.`);
  }
  const win = inp.emergency?.actionWindowDays ?? inp.timeSensitivity.daysToAction;
  if (inp.emergency?.irreversibleMaterialPreventableLoss === true && win <= e.triggerD.maxActionWindowDays) {
    triggers.push("D");
    reasons.push(`D: irreversible material preventable loss with an action window of ${win} day(s) (<= ${e.triggerD.maxActionWindowDays}).`);
  }
  const vt = inp.emergency?.verifiedThreat;
  if (vt) {
    triggers.push("E");
    reasons.push(`E: verified ${vt.category} threat (verified by ${vt.verifiedBy}; evidence ${vt.evidenceRef}).`);
  }
  return { candidate: triggers.length > 0, triggers, reasons };
}

// ---- the calculation -----------------------------------------------------------------------------------------------------------

const CONFIDENCE_RANK: Record<ConfidenceLevel, number> = { HIGH: 3, MEDIUM: 2, LOW: 1, INSUFFICIENT: 0 };

export function calculateScore(inputs: ScoringInputs, ctx: CalcContext, cfg: ScoringConfig = SCORING_CONFIG): ScoreCalculation {
  const time = timeFactor(inputs, cfg);
  const factors: Record<FactorKey, FactorResult> = {
    cash: cashFactor(inputs, cfg),
    profitability: profitabilityFactor(inputs, cfg),
    inventoryExposure: inventoryFactor(inputs, cfg),
    operationalRisk: {
      score: cfg.operationalRisk[inputs.operationalRisk],
      max: cfg.factorMax.operationalRisk,
      raw: { level: inputs.operationalRisk },
      rationale: `Operational risk: ${inputs.operationalRisk}.`,
    },
    customerRevenue: {
      score: cfg.customerRevenue[inputs.customerRevenue],
      max: cfg.factorMax.customerRevenue,
      raw: { level: inputs.customerRevenue },
      rationale: `Customer & revenue impact: ${inputs.customerRevenue}.`,
    },
    timeSensitivity: time.factor,
    actionability: {
      score: cfg.actionability[inputs.actionability as ActionabilityLevel],
      max: cfg.factorMax.actionability,
      raw: { level: inputs.actionability },
      rationale: `Actionability / speed to benefit: ${inputs.actionability}.`,
    },
  };
  let raw = 0;
  for (const k of FACTOR_KEYS) raw += factors[k].score;
  raw = round4(raw);

  const level = inputs.dataConfidence;
  const multiplier = level === "INSUFFICIENT" ? null : cfg.confidenceMultiplier[level];
  const mods = modifiers(inputs, ctx, cfg);
  const emergency = evaluateEmergencyTriggers(inputs, factors, cfg);

  const tie: TieBreakValues = {
    cashScore: factors.cash.score,
    expectedCash: inputs.cash.expected13WeekNetCashImpact,
    timeScore: factors.timeSensitivity.score,
    operationalRisk: factors.operationalRisk.score,
    customerRevenue: factors.customerRevenue.score,
    preventableLoss: inputs.preventableLoss ?? 0,
    confidenceRank: CONFIDENCE_RANK[level],
    benefitSpeed: factors.actionability.score,
    executionBurden: Math.abs(Math.min(0, mods.executionBurden.value)),
    persistence: ctx.persistence.consecutiveQualifiedOccurrences,
    actionDeadline: inputs.actionDeadline ?? null,
  };

  const base = {
    scoringVersion: cfg.scoringVersion,
    configVersion: cfg.configVersion,
    factors,
    rawCoreScore: raw,
    confidence: { level, multiplier },
    overdue: time.overdue,
    emergency,
    operationOrder: OPERATION_ORDER,
  };

  if (multiplier === null) {
    // Insufficient evidence: never a misleading ranked score. The factors and modifiers stay visible for the investigation.
    const split = sumSplit(mods);
    return {
      ...base,
      rankable: false,
      notRankableReason: "INSUFFICIENT_DATA_CONFIDENCE",
      confidenceAdjustedCoreScore: null,
      modifiers: mods,
      uncappedPositive: split.pos,
      uncappedNegative: split.neg,
      uncappedModifierTotal: round4(split.pos + split.neg),
      cappedPositive: Math.min(split.pos, cfg.modifierCaps.positive),
      cappedNegative: Math.max(split.neg, cfg.modifierCaps.negative),
      cappedModifierTotal: round4(Math.min(split.pos, cfg.modifierCaps.positive) + Math.max(split.neg, cfg.modifierCaps.negative)),
      capApplied: { positive: split.pos > cfg.modifierCaps.positive, negative: split.neg < cfg.modifierCaps.negative },
      uncappedDomainScore: null,
      mathematicalDomainScore: null,
      criticalProtection: null,
      flags: [],
      domainScore: null,
      clamped: null,
      displayScore: null,
      priorityBand: null,
      tieBreak: tie,
    };
  }

  // raw (whole points) x multiplier (in 1/10000) is an exact integer count of 1/10000 points.
  const confidenceAdjusted = Math.round(raw * Math.round(multiplier * SCALE)) / SCALE;

  let split = sumSplit(mods);
  let cappedPos = Math.min(split.pos, cfg.modifierCaps.positive);
  let cappedNeg = Math.max(split.neg, cfg.modifierCaps.negative);

  const uncappedTotal = round4(split.pos + split.neg);
  const cappedTotal = round4(cappedPos + cappedNeg);
  const uncappedDomain = round4(confidenceAdjusted + uncappedTotal);
  const preClamp = round4(confidenceAdjusted + cappedTotal);
  const mathematical = Math.min(100, Math.max(0, preClamp));

  // 4C-D4 Critical protection: execution burden ALONE must not demote an otherwise Critical candidate below Critical. The burden modifier,
  // the totals and the mathematical score all stay exactly as calculated; only the published final score is held at the Critical floor,
  // under an explicit flag. Protection is specific to burden-driven demotion: if the candidate would not be Critical even without the
  // burden (other inputs genuinely lower it), nothing is protected.
  let domain = mathematical;
  let protection: ScoreCalculation["criticalProtection"] = null;
  const critMin = cfg.bands.find((b) => b.band === "CRITICAL")!.min;
  if (cfg.executionBurdenCriticalProtection && mods.executionBurden.value < 0 && bandForScore(mathematical, cfg) !== "CRITICAL") {
    const withoutBurden = sumSplit({ ...mods, executionBurden: { ...mods.executionBurden, value: 0 } });
    const cappedWithout = round4(Math.min(withoutBurden.pos, cfg.modifierCaps.positive) + Math.max(withoutBurden.neg, cfg.modifierCaps.negative));
    const scoreWithoutBurden = Math.min(100, Math.max(0, round4(confidenceAdjusted + cappedWithout)));
    if (bandForScore(scoreWithoutBurden, cfg) === "CRITICAL") {
      domain = critMin;
      protection = {
        applied: true,
        flag: CRITICAL_PROTECTED_FLAG,
        scoreWithoutBurden,
        mathematicalScore: mathematical,
        burdenModifier: mods.executionBurden.value,
        reason: `Without the execution burden (${mods.executionBurden.value}) the score is ${scoreWithoutBurden.toFixed(2)} (Critical); with it the mathematical score is ${mathematical.toFixed(2)}. Execution burden alone does not demote a Critical candidate, so the published score is held at the Critical minimum of ${critMin}.`,
      };
    }
  }
  return {
    ...base,
    rankable: true,
    notRankableReason: null,
    confidenceAdjustedCoreScore: confidenceAdjusted,
    modifiers: mods,
    uncappedPositive: split.pos,
    uncappedNegative: split.neg,
    uncappedModifierTotal: uncappedTotal,
    cappedPositive: cappedPos,
    cappedNegative: cappedNeg,
    cappedModifierTotal: cappedTotal,
    capApplied: { positive: split.pos > cfg.modifierCaps.positive, negative: split.neg < cfg.modifierCaps.negative },
    uncappedDomainScore: uncappedDomain,
    mathematicalDomainScore: mathematical,
    criticalProtection: protection,
    flags: protection ? [CRITICAL_PROTECTED_FLAG] : [],
    domainScore: domain,
    clamped: preClamp < 0 ? "FLOOR" : preClamp > 100 ? "CEILING" : null,
    displayScore: displayScoreOf(domain),
    priorityBand: bandForScore(domain, cfg),
    tieBreak: tie,
  };
}

export { MODIFIER_LABELS };
