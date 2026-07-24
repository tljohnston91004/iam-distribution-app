/**
 * Decision Priority revised scoring configuration (version-controlled).
 * Thresholds/weights from IAM Actions Revised Scoring Instruction — do not change without reporting.
 */

export const REVISED_SCORING_PROFILE_ID = "revised_v1_decision_priority" as const;

export const REVISED_SCORING_CONFIG_VERSION = {
  id: REVISED_SCORING_PROFILE_ID,
  label: "Decision Priority Scoring Architecture v1 (July 2026)",
  effectiveDate: "2026-07-01",
  approvalAuthority: "Project Owner — IAM Actions Revised Scoring Instruction v1.0",
  changeReason: "Replace interim cash-led composite with approved 100-point factor model",
  active: true,
} as const;

/** Factor maxima (sum = 100). */
export const FACTOR_MAX = {
  cashImpact: 30,
  profitabilityImpact: 15,
  inventoryExposure: 15,
  operationalRisk: 15,
  customerRevenueImpact: 10,
  timeSensitivity: 10,
  actionability: 5,
} as const;

/** Inclusive lower bound enters the higher band (exact threshold → higher points). */
export const CASH_IMPACT_BANDS: { minRatioInclusive: number; points: number }[] = [
  { minRatioInclusive: 0.3, points: 30 },
  { minRatioInclusive: 0.15, points: 24 },
  { minRatioInclusive: 0.07, points: 18 },
  { minRatioInclusive: 0.03, points: 12 },
  { minRatioInclusive: 0.01, points: 6 },
  { minRatioInclusive: 0, points: 0 },
];

export const PROFITABILITY_BANDS: { minRatioInclusive: number; points: number }[] = [
  { minRatioInclusive: 0.01, points: 15 },
  { minRatioInclusive: 0.006, points: 12 },
  { minRatioInclusive: 0.003, points: 9 },
  { minRatioInclusive: 0.0015, points: 6 },
  { minRatioInclusive: 0.0005, points: 3 },
  { minRatioInclusive: 0, points: 0 },
];

export const INVENTORY_EXPOSURE_BANDS: { minRatioInclusive: number; points: number }[] = [
  { minRatioInclusive: 0.05, points: 15 },
  { minRatioInclusive: 0.02, points: 12 },
  { minRatioInclusive: 0.01, points: 9 },
  { minRatioInclusive: 0.005, points: 6 },
  { minRatioInclusive: 0.0025, points: 3 },
  { minRatioInclusive: 0, points: 0 },
];

export const OPERATIONAL_RISK_POINTS = {
  none: 0,
  low: 3,
  moderate: 6,
  significant: 9,
  severe: 12,
  critical: 15,
} as const;

export const CUSTOMER_REVENUE_POINTS = {
  none: 0,
  low: 2,
  moderate: 4,
  significant: 6,
  severe: 8,
  critical: 10,
} as const;

/** Action window → time sensitivity (days remaining). Exact day at boundary uses higher urgency band. */
export const TIME_SENSITIVITY_BANDS: { maxDaysInclusive: number; points: number }[] = [
  { maxDaysInclusive: 7, points: 10 },
  { maxDaysInclusive: 14, points: 8 },
  { maxDaysInclusive: 30, points: 6 },
  { maxDaysInclusive: 60, points: 4 },
  { maxDaysInclusive: 90, points: 2 },
  { maxDaysInclusive: Number.POSITIVE_INFINITY, points: 0 },
];

export const ACTIONABILITY_POINTS = {
  unclear: 0,
  difficult: 1,
  limited: 2,
  moderate: 3,
  strong: 4,
  immediate: 5,
} as const;

export const CONFIDENCE_MULTIPLIER = {
  high: 1.0,
  medium: 0.95,
  low: 0.85,
  insufficient: null as number | null, // not normally rankable
} as const;

export const MODIFIER_CAPS = { positive: 15, negative: 15 } as const;

export const PRIORITY_BANDS: { minInclusive: number; band: string }[] = [
  { minInclusive: 85, band: "Critical" },
  { minInclusive: 70, band: "High" },
  { minInclusive: 55, band: "Moderate" },
  { minInclusive: 40, band: "Watch" },
  { minInclusive: 0, band: "Informational" },
];

export const TOP2_MIN_FINAL_SCORE = 70;

export const DUPLICATE_SCOPE_OVERLAP_DEFAULT = 0.8;

export const OVERRIDE_RANGES = {
  minorPromotion: { min: 1, max: 5 },
  materialPromotion: { min: 6, max: 10 },
  strategicPromotion: { min: 1, max: 6 },
  minorDemotion: { min: -5, max: -1 },
  materialDemotion: { min: -10, max: -6 },
} as const;

export type RiskLevel = keyof typeof OPERATIONAL_RISK_POINTS;
export type CustomerLevel = keyof typeof CUSTOMER_REVENUE_POINTS;
export type ActionabilityLevel = keyof typeof ACTIONABILITY_POINTS;
export type ConfidenceTier = keyof typeof CONFIDENCE_MULTIPLIER;

export type PersistenceLevel = "first" | "second" | "third" | "fourth" | "fifth_or_later";
export type DeteriorationLevel =
  | "improving_materially"
  | "stable"
  | "worsening_moderately"
  | "worsening_materially"
  | "accelerating_toward_critical";
export type CrossFunctionalLevel = "isolated" | "two" | "several" | "broad";
export type StrategicLevel = "normal" | "important" | "highly_important" | "enterprise_critical";
export type ExecutionBurdenLevel = "normal" | "meaningful_coordination" | "high_cost_difficult" | "major_barriers";
export type BenefitUncertaintyLevel =
  | "supported"
  | "reasonably_supported"
  | "significant_assumptions"
  | "highly_uncertain";

export const PERSISTENCE_POINTS: Record<PersistenceLevel, number> = {
  first: 0,
  second: 1,
  third: 2,
  fourth: 3,
  fifth_or_later: 4,
};

export const DETERIORATION_POINTS: Record<DeteriorationLevel, number> = {
  improving_materially: -2,
  stable: 0,
  worsening_moderately: 2,
  worsening_materially: 4,
  accelerating_toward_critical: 6,
};

export const CROSS_FUNCTIONAL_POINTS: Record<CrossFunctionalLevel, number> = {
  isolated: 0,
  two: 1,
  several: 2,
  broad: 3,
};

export const STRATEGIC_POINTS: Record<StrategicLevel, number> = {
  normal: 0,
  important: 2,
  highly_important: 4,
  enterprise_critical: 6,
};

export const EXECUTION_BURDEN_POINTS: Record<ExecutionBurdenLevel, number> = {
  normal: 0,
  meaningful_coordination: -1,
  high_cost_difficult: -2,
  major_barriers: -4,
};

export const BENEFIT_UNCERTAINTY_POINTS: Record<BenefitUncertaintyLevel, number> = {
  supported: 0,
  reasonably_supported: -1,
  significant_assumptions: -2,
  highly_uncertain: -4,
};
