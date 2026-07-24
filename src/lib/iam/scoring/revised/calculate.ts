/**
 * Revised Decision Priority score calculation (§7–§17).
 * Does not invent financial recovery rates. Missing denominators → calculation exception.
 */

import { clamp, pointsFromAscendingMinBands, priorityBandFromScore, timeSensitivityPoints } from "./bands";
import {
  ACTIONABILITY_POINTS,
  BENEFIT_UNCERTAINTY_POINTS,
  CASH_IMPACT_BANDS,
  CONFIDENCE_MULTIPLIER,
  CROSS_FUNCTIONAL_POINTS,
  DETERIORATION_POINTS,
  EXECUTION_BURDEN_POINTS,
  FACTOR_MAX,
  INVENTORY_EXPOSURE_BANDS,
  MODIFIER_CAPS,
  PERSISTENCE_POINTS,
  PRIORITY_BANDS,
  PROFITABILITY_BANDS,
  REVISED_SCORING_CONFIG_VERSION,
  REVISED_SCORING_PROFILE_ID,
  STRATEGIC_POINTS,
  TIME_SENSITIVITY_BANDS,
  type ActionabilityLevel,
  type BenefitUncertaintyLevel,
  type ConfidenceTier,
  type CrossFunctionalLevel,
  type CustomerLevel,
  type DeteriorationLevel,
  type ExecutionBurdenLevel,
  type PersistenceLevel,
  type RiskLevel,
  type StrategicLevel,
} from "./config";
import { evaluateEmergencyTests } from "./emergency";
import { CUSTOMER_REVENUE_POINTS, OPERATIONAL_RISK_POINTS } from "./config";

export type CompanyDenominators = {
  trailing52WeekRevenue: number | null;
  trailing12MonthGrossProfit: number | null;
  totalInventoryBookValue: number | null;
};

export type RevisedScoreInput = {
  recommendationId: string;
  /** Gross cash exposure (may equal book value — not automatically recoverable). */
  grossCashImpact: number | null;
  /** Net scoreable 13-week cash impact when known. */
  netScoreable13WeekCashImpact: number | null;
  cashEstimationMethod: string;
  /** Net scoreable profitability improvement/protection. */
  netScoreableProfitabilityImpact: number | null;
  profitabilityEstimationMethod: string;
  affectedInventoryBookValue: number | null;
  denominators: CompanyDenominators;
  operationalRiskLevel: RiskLevel;
  customerRevenueLevel: CustomerLevel;
  actionWindowDays: number | null;
  actionabilityLevel: ActionabilityLevel;
  confidence: ConfidenceTier;
  persistence: PersistenceLevel;
  deterioration: DeteriorationLevel;
  crossFunctional: CrossFunctionalLevel;
  strategicImportance: StrategicLevel;
  executionBurden: ExecutionBurdenLevel;
  benefitUncertainty: BenefitUncertaintyLevel;
  overrideAdjustment?: number;
  irreversibleMaterialLossLikely?: boolean;
  verifiedCriticalThreat?: boolean;
  expectedPreventableLoss?: number | null;
};

export type RevisedScoreResult =
  | {
      ok: true;
      scoringProfileId: typeof REVISED_SCORING_PROFILE_ID;
      configVersion: typeof REVISED_SCORING_CONFIG_VERSION;
      factors: {
        cashImpactScore: number;
        cashImpactRatio: number | null;
        profitabilityImpactScore: number;
        profitabilityImpactRatio: number | null;
        inventoryExposureScore: number;
        inventoryExposureRatio: number | null;
        operationalRiskScore: number;
        customerRevenueImpactScore: number;
        timeSensitivityScore: number;
        actionabilityScore: number;
      };
      financial: {
        grossCashImpact: number | null;
        netScoreable13WeekCashImpact: number | null;
        cashEstimationMethod: string;
        averageWeeklyRevenue: number | null;
        netScoreableProfitabilityImpact: number | null;
        profitabilityEstimationMethod: string;
        affectedInventoryBookValue: number | null;
        note: string;
      };
      basePriorityScore: number;
      confidenceMultiplier: number;
      confidenceAdjustedScore: number;
      modifiers: {
        persistence: number;
        deterioration: number;
        crossFunctional: number;
        strategicImportance: number;
        executionBurden: number;
        benefitUncertainty: number;
        positiveUncapped: number;
        negativeUncapped: number;
        positiveCapped: number;
        negativeCapped: number;
      };
      preliminaryFinalScore: number;
      overrideAdjustment: number;
      governedFinalScore: number;
      priorityBand: string;
      emergency: ReturnType<typeof evaluateEmergencyTests>;
      normallyRankable: boolean;
      structuredExplanation: string[];
    }
  | {
      ok: false;
      scoringProfileId: typeof REVISED_SCORING_PROFILE_ID;
      configVersion: typeof REVISED_SCORING_CONFIG_VERSION;
      calculationException: true;
      exceptionCode: string;
      exceptionMessage: string;
      structuredExplanation: string[];
    };

function mapConfidence(raw: string): ConfidenceTier {
  const s = raw.toLowerCase();
  if (s.includes("insufficient")) return "insufficient";
  if (s.includes("low")) return "low";
  if (s.includes("high")) return "high";
  return "medium";
}

export function normalizeConfidenceTier(raw: string): ConfidenceTier {
  return mapConfidence(raw);
}

export function calculateRevisedScore(input: RevisedScoreInput): RevisedScoreResult {
  const awr =
    input.denominators.trailing52WeekRevenue != null &&
    input.denominators.trailing52WeekRevenue > 0
      ? input.denominators.trailing52WeekRevenue / 52
      : null;
  const gp = input.denominators.trailing12MonthGrossProfit;
  const totalInv = input.denominators.totalInventoryBookValue;

  const missing: string[] = [];
  if (awr == null) missing.push("averageWeeklyRevenue (trailing 52-week revenue ÷ 52)");
  if (gp == null || gp <= 0) missing.push("trailing12MonthGrossProfit");
  if (totalInv == null || totalInv <= 0) missing.push("totalInventoryBookValue");

  if (missing.length) {
    return {
      ok: false,
      scoringProfileId: REVISED_SCORING_PROFILE_ID,
      configVersion: REVISED_SCORING_CONFIG_VERSION,
      calculationException: true,
      exceptionCode: "MISSING_DENOMINATORS",
      exceptionMessage: `Cannot compute Decision Priority ratios without: ${missing.join("; ")}. No fabricated score.`,
      structuredExplanation: [
        "Calculation exception: required company denominators are missing.",
        ...missing.map((m) => `Missing: ${m}`),
      ],
    };
  }

  const netCash = input.netScoreable13WeekCashImpact;
  const cashForRatio =
    netCash != null && Number.isFinite(netCash)
      ? Math.max(0, netCash)
      : null;

  // Without net scoreable cash, do not treat book value as recoverable cash (§8).
  if (cashForRatio == null) {
    return {
      ok: false,
      scoringProfileId: REVISED_SCORING_PROFILE_ID,
      configVersion: REVISED_SCORING_CONFIG_VERSION,
      calculationException: true,
      exceptionCode: "MISSING_NET_SCOREABLE_CASH",
      exceptionMessage:
        "Net scoreable 13-week cash impact is required. Inventory book value is not automatically recoverable cash.",
      structuredExplanation: [
        "Calculation exception: net scoreable 13-week cash impact not provided.",
        `Gross exposure on record: ${input.grossCashImpact ?? "n/a"} (${input.cashEstimationMethod}).`,
      ],
    };
  }

  const cashRatio = cashForRatio / awr!;
  const cashImpactScore = pointsFromAscendingMinBands(cashRatio, CASH_IMPACT_BANDS);

  const netProfit = Math.max(0, input.netScoreableProfitabilityImpact ?? 0);
  const profitRatio = netProfit / gp!;
  const profitabilityImpactScore = pointsFromAscendingMinBands(profitRatio, PROFITABILITY_BANDS);

  const affected = Math.max(0, input.affectedInventoryBookValue ?? 0);
  const exposureRatio = affected / totalInv!;
  const inventoryExposureScore = pointsFromAscendingMinBands(exposureRatio, INVENTORY_EXPOSURE_BANDS);

  const operationalRiskScore = OPERATIONAL_RISK_POINTS[input.operationalRiskLevel];
  const customerRevenueImpactScore = CUSTOMER_REVENUE_POINTS[input.customerRevenueLevel];
  const timeSensitivityScore = timeSensitivityPoints(input.actionWindowDays, TIME_SENSITIVITY_BANDS);
  const actionabilityScore = ACTIONABILITY_POINTS[input.actionabilityLevel];

  const basePriorityScore =
    cashImpactScore +
    profitabilityImpactScore +
    inventoryExposureScore +
    operationalRiskScore +
    customerRevenueImpactScore +
    timeSensitivityScore +
    actionabilityScore;

  const confMult = CONFIDENCE_MULTIPLIER[input.confidence];
  if (confMult == null) {
    return {
      ok: false,
      scoringProfileId: REVISED_SCORING_PROFILE_ID,
      configVersion: REVISED_SCORING_CONFIG_VERSION,
      calculationException: true,
      exceptionCode: "INSUFFICIENT_CONFIDENCE",
      exceptionMessage:
        "Insufficient Data Confidence is not normally rankable. Route to Data Investigation / management exception.",
      structuredExplanation: [
        `Base Priority Score before confidence gate: ${basePriorityScore.toFixed(2)} (max ${Object.values(FACTOR_MAX).reduce((a, b) => a + b, 0)}).`,
        "Confidence = Insufficient → not normally rankable.",
      ],
    };
  }

  const confidenceAdjustedScore = basePriorityScore * confMult;

  const persistence = PERSISTENCE_POINTS[input.persistence];
  const deterioration = DETERIORATION_POINTS[input.deterioration];
  const crossFunctional = CROSS_FUNCTIONAL_POINTS[input.crossFunctional];
  const strategicImportance = STRATEGIC_POINTS[input.strategicImportance];
  const executionBurden = EXECUTION_BURDEN_POINTS[input.executionBurden];
  const benefitUncertainty = BENEFIT_UNCERTAINTY_POINTS[input.benefitUncertainty];

  const allMods = [
    persistence,
    deterioration,
    crossFunctional,
    strategicImportance,
    executionBurden,
    benefitUncertainty,
  ];
  const positiveUncapped = allMods.filter((n) => n > 0).reduce((s, n) => s + n, 0);
  const negativeUncapped = allMods.filter((n) => n < 0).reduce((s, n) => s + n, 0);
  const positiveCapped = Math.min(MODIFIER_CAPS.positive, positiveUncapped);
  const negativeCapped = Math.max(-MODIFIER_CAPS.negative, negativeUncapped);

  const preliminaryFinalScore = confidenceAdjustedScore + positiveCapped + negativeCapped;
  const overrideAdjustment = input.overrideAdjustment ?? 0;
  const governedFinalScore = preliminaryFinalScore + overrideAdjustment;
  const priorityBand = priorityBandFromScore(governedFinalScore, PRIORITY_BANDS);

  const emergency = evaluateEmergencyTests({
    operationalRiskScore,
    customerRevenueImpactScore,
    timeSensitivityScore,
    actionWindowDays: input.actionWindowDays,
    irreversibleMaterialLossLikely: input.irreversibleMaterialLossLikely,
    verifiedCriticalThreat: input.verifiedCriticalThreat,
  });

  const structuredExplanation = [
    `Base Priority Score = ${basePriorityScore.toFixed(2)} (Cash ${cashImpactScore} + Profit ${profitabilityImpactScore} + Exposure ${inventoryExposureScore} + OpRisk ${operationalRiskScore} + Customer ${customerRevenueImpactScore} + Time ${timeSensitivityScore} + Actionability ${actionabilityScore}).`,
    `Confidence (${input.confidence}) multiplier ${confMult} → Confidence-Adjusted Score ${confidenceAdjustedScore.toFixed(2)}.`,
    `Modifiers capped +${positiveCapped} / ${negativeCapped} (uncapped +${positiveUncapped} / ${negativeUncapped}).`,
    `Preliminary Final ${preliminaryFinalScore.toFixed(2)}; override ${overrideAdjustment}; Governed Final ${governedFinalScore.toFixed(2)} → band ${priorityBand}.`,
    `Cash: net scoreable 13-week ${cashForRatio} ÷ AWR ${awr!.toFixed(2)} = ratio ${(cashRatio * 100).toFixed(2)}% → ${cashImpactScore} pts. Method: ${input.cashEstimationMethod}.`,
    `Inventory exposure: affected ${affected} ÷ total ${totalInv} = ${(exposureRatio * 100).toFixed(2)}% → ${inventoryExposureScore} pts.`,
    emergency.anyTriggered
      ? `Emergency Review Candidate: tests ${emergency.tests
          .filter((t) => t.triggered)
          .map((t) => t.testId)
          .join(", ")} triggered (management confirmation required — not auto-confirmed).`
      : "No automatic Emergency Review test triggered.",
  ];

  return {
    ok: true,
    scoringProfileId: REVISED_SCORING_PROFILE_ID,
    configVersion: REVISED_SCORING_CONFIG_VERSION,
    factors: {
      cashImpactScore,
      cashImpactRatio: cashRatio,
      profitabilityImpactScore,
      profitabilityImpactRatio: profitRatio,
      inventoryExposureScore,
      inventoryExposureRatio: exposureRatio,
      operationalRiskScore,
      customerRevenueImpactScore,
      timeSensitivityScore,
      actionabilityScore,
    },
    financial: {
      grossCashImpact: input.grossCashImpact,
      netScoreable13WeekCashImpact: cashForRatio,
      cashEstimationMethod: input.cashEstimationMethod,
      averageWeeklyRevenue: awr,
      netScoreableProfitabilityImpact: netProfit,
      profitabilityEstimationMethod: input.profitabilityEstimationMethod,
      affectedInventoryBookValue: affected,
      note: "Inventory book value is not automatically recoverable cash.",
    },
    basePriorityScore,
    confidenceMultiplier: confMult,
    confidenceAdjustedScore,
    modifiers: {
      persistence,
      deterioration,
      crossFunctional,
      strategicImportance,
      executionBurden,
      benefitUncertainty,
      positiveUncapped,
      negativeUncapped,
      positiveCapped,
      negativeCapped,
    },
    preliminaryFinalScore,
    overrideAdjustment,
    governedFinalScore,
    priorityBand,
    emergency,
    normallyRankable: true,
    structuredExplanation,
  };
}

/** Heuristic mapping from interim discovery signals → revised levels (documented; not new policy). */
export function mapDiscoverySignalsToLevels(input: {
  serviceRiskScore: number | null;
  weeksOfSupply: number | null;
  hasRequiredEvidence: boolean;
  backorder?: boolean;
}): {
  operationalRiskLevel: RiskLevel;
  customerRevenueLevel: CustomerLevel;
  actionWindowDays: number | null;
  actionabilityLevel: ActionabilityLevel;
} {
  const s = input.serviceRiskScore ?? 0;
  let operationalRiskLevel: RiskLevel = "none";
  if (s >= 95) operationalRiskLevel = "critical";
  else if (s >= 80) operationalRiskLevel = "severe";
  else if (s >= 65) operationalRiskLevel = "significant";
  else if (s >= 45) operationalRiskLevel = "moderate";
  else if (s >= 25) operationalRiskLevel = "low";

  const customerRevenueLevel: CustomerLevel = input.backorder ? "significant" : s >= 70 ? "moderate" : "none";

  let actionWindowDays: number | null = 45;
  if (input.weeksOfSupply != null && input.weeksOfSupply <= 2) actionWindowDays = 7;
  else if (input.weeksOfSupply != null && input.weeksOfSupply >= 52) actionWindowDays = 30;
  else if (input.weeksOfSupply != null && input.weeksOfSupply >= 26) actionWindowDays = 60;

  const actionabilityLevel: ActionabilityLevel = input.hasRequiredEvidence ? "moderate" : "unclear";

  return { operationalRiskLevel, customerRevenueLevel, actionWindowDays, actionabilityLevel };
}

export { clamp };
