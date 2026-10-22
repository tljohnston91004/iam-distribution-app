/**
 * Stage 4C: the approved IAM 100-point priority scoring model, expressed as DATA.
 *
 * Every number the engine uses lives here and nowhere else (no hidden factors, no constants buried in code). The whole
 * configuration is snapshotted into every scoring run (`iam_core_scoring_runs.config_json`) together with its SHA-256, so
 * the same stored inputs plus the same stored configuration always reproduce the same score. A future model change is a NEW
 * scoring version (for example IAM_PRIORITY_SCORING_V2); it never rewrites how a historical score is interpreted.
 *
 * Ratio thresholds are expressed in basis points (1% = 100 bps) and compared with exact integer arithmetic (see factors.ts),
 * so a value exactly on a boundary is always banded the same way (no floating-point drift).
 */
import { createHash } from "node:crypto";

export const SCORING_VERSION = "IAM_PRIORITY_SCORING_V1";
export const SCORING_CONFIG_VERSION = "IAM_PRIORITY_CONFIG_V1";

export const FACTOR_KEYS = ["cash", "profitability", "inventoryExposure", "operationalRisk", "customerRevenue", "timeSensitivity", "actionability"] as const;
export type FactorKey = (typeof FACTOR_KEYS)[number];

export const MODIFIER_KEYS = ["persistence", "deterioration", "crossFunctional", "strategic", "executionBurden", "benefitUncertainty"] as const;
export type ModifierKey = (typeof MODIFIER_KEYS)[number];

export const SEVERITY_LEVELS = ["NONE", "LOW", "MODERATE", "SIGNIFICANT", "SEVERE", "CRITICAL"] as const;
export type SeverityLevel = (typeof SEVERITY_LEVELS)[number];
export const ACTIONABILITY_LEVELS = ["UNCLEAR", "DIFFICULT", "LIMITED", "MODERATE", "STRONG", "IMMEDIATE"] as const;
export type ActionabilityLevel = (typeof ACTIONABILITY_LEVELS)[number];
export const CONFIDENCE_LEVELS = ["HIGH", "MEDIUM", "LOW", "INSUFFICIENT"] as const;
export type ConfidenceLevel = (typeof CONFIDENCE_LEVELS)[number];
export const PRIORITY_BANDS = ["CRITICAL", "HIGH", "MODERATE", "WATCH", "INFORMATIONAL"] as const;
export type PriorityBand = (typeof PRIORITY_BANDS)[number];

export const DETERIORATION_LEVELS = ["IMPROVING_MATERIALLY", "STABLE", "WORSENING_MODERATELY", "WORSENING_MATERIALLY", "ACCELERATING_CRITICAL"] as const;
export type DeteriorationLevel = (typeof DETERIORATION_LEVELS)[number];
export const CROSS_FUNCTIONAL_LEVELS = ["ISOLATED", "TWO_FUNCTIONS_OR_LOCATIONS", "SEVERAL", "BROAD"] as const;
export type CrossFunctionalLevel = (typeof CROSS_FUNCTIONAL_LEVELS)[number];
export const STRATEGIC_LEVELS = ["NORMAL", "IMPORTANT", "HIGHLY_IMPORTANT", "ENTERPRISE_CRITICAL"] as const;
export type StrategicLevel = (typeof STRATEGIC_LEVELS)[number];
export const EXECUTION_BURDEN_LEVELS = ["NORMAL", "MEANINGFUL_COORDINATION", "HIGH_COST_DIFFICULT", "MAJOR_BARRIERS"] as const;
export type ExecutionBurdenLevel = (typeof EXECUTION_BURDEN_LEVELS)[number];
export const BENEFIT_UNCERTAINTY_LEVELS = ["SUPPORTED", "REASONABLY_SUPPORTED", "SIGNIFICANT_ASSUMPTIONS", "HIGHLY_UNCERTAIN"] as const;
export type BenefitUncertaintyLevel = (typeof BENEFIT_UNCERTAINTY_LEVELS)[number];
export const PERSISTENCE_EXCLUSIONS = ["ORDINARY_SEASONAL", "ALREADY_CONTROLLED"] as const;
export type PersistenceExclusion = (typeof PERSISTENCE_EXCLUSIONS)[number];
export const EMERGENCY_THREAT_CATEGORIES = ["LEGAL", "REGULATORY", "SAFETY", "BUSINESS_CONTINUITY"] as const;
export type EmergencyThreatCategory = (typeof EMERGENCY_THREAT_CATEGORIES)[number];

/**
 * 4C-D2: explicit economic-impact attribution. A quantified economic amount used in scoring is identified by its evidence reference
 * and impact type (its "economic key") and has exactly ONE scoring home. Related evidence may still inform severity, context, root
 * cause or qualitative risk through `contextualEvidence`, but never earns the same dollars, units, margin, cash or customer exposure
 * a second time.
 */
export const IMPACT_TYPES = ["CASH_IMPACT", "LOST_MARGIN", "PROFIT_IMPACT", "INVENTORY_VALUE", "UNITS", "CUSTOMER_EXPOSURE"] as const;
export type ImpactType = (typeof IMPACT_TYPES)[number];
export const SCORING_HOMES = ["cash", "profitability", "inventoryExposure", "customerRevenue"] as const;
export type ScoringHome = (typeof SCORING_HOMES)[number];
/** Which scoring homes an impact type may be used in. */
export const HOMES_BY_IMPACT: Record<ImpactType, readonly ScoringHome[]> = {
  CASH_IMPACT: ["cash"],
  LOST_MARGIN: ["profitability"],
  PROFIT_IMPACT: ["profitability"],
  INVENTORY_VALUE: ["inventoryExposure"],
  UNITS: ["inventoryExposure"],
  CUSTOMER_EXPOSURE: ["customerRevenue"],
};
/** Dollar impact types whose amounts must add up to the scalar amount of their scoring home (the scalar IS the sum of its attributions). */
export const SUMMED_HOME_BY_IMPACT: Partial<Record<ImpactType, "cash" | "profitability" | "inventoryExposure">> = {
  CASH_IMPACT: "cash",
  LOST_MARGIN: "profitability",
  PROFIT_IMPACT: "profitability",
  INVENTORY_VALUE: "inventoryExposure",
};
export const CONTEXT_INFLUENCES = ["SEVERITY", "CONTEXT", "ROOT_CAUSE", "QUALITATIVE_RISK"] as const;
export type ContextInfluence = (typeof CONTEXT_INFLUENCES)[number];

/** 4C-D4: published/stored flag when Critical protection prevented execution burden alone from demoting a Critical candidate. */
export const CRITICAL_PROTECTED_FLAG = "CRITICAL_PROTECTED_FROM_BURDEN_DEMOTION";

export interface RatioBand {
  /** Inclusive lower bound of the band, in basis points of the ratio (1% = 100). */
  minBps: number;
  points: number;
}

export interface ScoringConfig {
  scoringVersion: string;
  configVersion: string;
  factorMax: Record<FactorKey, number>;
  /** Cash: expected 13-week net scoreable cash impact / average weekly revenue (default trailing 52-week revenue / 52). */
  cash: { bands: RatioBand[]; defaultWeeklyRevenueWeeks: number };
  profitability: { bands: RatioBand[] };
  inventoryExposure: { bands: RatioBand[] };
  operationalRisk: Record<SeverityLevel, number>;
  customerRevenue: Record<SeverityLevel, number>;
  /** Time sensitivity by days to the action deadline: first band whose maxDays >= days wins; null = no upper bound. */
  timeSensitivity: { bands: Array<{ maxDays: number | null; points: number }>; overduePoints: number };
  actionability: Record<ActionabilityLevel, number>;
  confidenceMultiplier: Record<Exclude<ConfidenceLevel, "INSUFFICIENT">, number>;
  /**
   * 4C-D1: one qualified occurrence per COMPANY-LOCAL operating week (Sunday-Saturday in the company IANA time zone). A week in which
   * no scoring cycle ran for the company is neutral: it neither counts nor breaks the streak. A week in which a cycle ran but the
   * candidate was not qualified (excluded, or below the qualifying minimum) breaks it.
   */
  persistence: { maxPoints: number; qualifyingMinScore: number; operatingWeek: "COMPANY_LOCAL_SUNDAY_TO_SATURDAY"; skippedWeek: "NEUTRAL" };
  deterioration: Record<DeteriorationLevel, number>;
  crossFunctional: Record<CrossFunctionalLevel, number>;
  strategic: Record<StrategicLevel, number>;
  executionBurden: Record<ExecutionBurdenLevel, number>;
  benefitUncertainty: Record<BenefitUncertaintyLevel, number>;
  modifierCaps: { positive: number; negative: number };
  /**
   * 4C-D4: execution burden alone must not demote an otherwise Critical candidate below Critical. The burden modifier and the
   * mathematical score stay visible; the band holds at Critical under the CRITICAL_PROTECTED_FROM_BURDEN_DEMOTION flag.
   */
  executionBurdenCriticalProtection: boolean;
  /** Band lower bounds on the final domain score rounded to two decimals (85–100, 70–84.99, 55–69.99, 40–54.99, <40). */
  bands: Array<{ band: PriorityBand; min: number }>;
  top2: { threshold: number; slots: number };
  tie: { withinPoints: number };
  emergency: {
    triggerA: { operationalRisk: number; timeSensitivity: number };
    triggerB: { customerRevenue: number; timeSensitivity: number };
    triggerC: { operationalRisk: number; customerRevenue: number; timeSensitivity: number };
    triggerD: { maxActionWindowDays: number };
    maxPublishedEmergencies: number;
  };
  override: { minorMax: number; materialMax: number };
  rankLock: { maxDays: number };
  suppressionReReview: { scoreIncrease: number };
  repeatedRejection: { threshold: number };
}

export const SCORING_CONFIG: ScoringConfig = {
  scoringVersion: SCORING_VERSION,
  configVersion: SCORING_CONFIG_VERSION,
  factorMax: { cash: 30, profitability: 15, inventoryExposure: 15, operationalRisk: 15, customerRevenue: 10, timeSensitivity: 10, actionability: 5 },
  cash: {
    defaultWeeklyRevenueWeeks: 52,
    bands: [
      { minBps: 0, points: 0 },
      { minBps: 100, points: 6 },
      { minBps: 300, points: 12 },
      { minBps: 700, points: 18 },
      { minBps: 1500, points: 24 },
      { minBps: 3000, points: 30 },
    ],
  },
  profitability: {
    bands: [
      { minBps: 0, points: 0 },
      { minBps: 5, points: 3 },
      { minBps: 15, points: 6 },
      { minBps: 30, points: 9 },
      { minBps: 60, points: 12 },
      { minBps: 100, points: 15 },
    ],
  },
  inventoryExposure: {
    bands: [
      { minBps: 0, points: 0 },
      { minBps: 25, points: 3 },
      { minBps: 50, points: 6 },
      { minBps: 100, points: 9 },
      { minBps: 200, points: 12 },
      { minBps: 500, points: 15 },
    ],
  },
  operationalRisk: { NONE: 0, LOW: 3, MODERATE: 6, SIGNIFICANT: 9, SEVERE: 12, CRITICAL: 15 },
  customerRevenue: { NONE: 0, LOW: 2, MODERATE: 4, SIGNIFICANT: 6, SEVERE: 8, CRITICAL: 10 },
  timeSensitivity: {
    overduePoints: 10,
    bands: [
      { maxDays: 7, points: 10 },
      { maxDays: 14, points: 8 },
      { maxDays: 30, points: 6 },
      { maxDays: 60, points: 4 },
      { maxDays: 90, points: 2 },
      { maxDays: null, points: 0 },
    ],
  },
  actionability: { UNCLEAR: 0, DIFFICULT: 1, LIMITED: 2, MODERATE: 3, STRONG: 4, IMMEDIATE: 5 },
  confidenceMultiplier: { HIGH: 1.0, MEDIUM: 0.95, LOW: 0.85 },
  persistence: { maxPoints: 4, qualifyingMinScore: 40, operatingWeek: "COMPANY_LOCAL_SUNDAY_TO_SATURDAY", skippedWeek: "NEUTRAL" },
  deterioration: { IMPROVING_MATERIALLY: -2, STABLE: 0, WORSENING_MODERATELY: 2, WORSENING_MATERIALLY: 4, ACCELERATING_CRITICAL: 6 },
  crossFunctional: { ISOLATED: 0, TWO_FUNCTIONS_OR_LOCATIONS: 1, SEVERAL: 2, BROAD: 3 },
  strategic: { NORMAL: 0, IMPORTANT: 2, HIGHLY_IMPORTANT: 4, ENTERPRISE_CRITICAL: 6 },
  executionBurden: { NORMAL: 0, MEANINGFUL_COORDINATION: -1, HIGH_COST_DIFFICULT: -2, MAJOR_BARRIERS: -4 },
  benefitUncertainty: { SUPPORTED: 0, REASONABLY_SUPPORTED: -1, SIGNIFICANT_ASSUMPTIONS: -2, HIGHLY_UNCERTAIN: -4 },
  modifierCaps: { positive: 15, negative: -15 },
  executionBurdenCriticalProtection: true,
  bands: [
    { band: "CRITICAL", min: 85 },
    { band: "HIGH", min: 70 },
    { band: "MODERATE", min: 55 },
    { band: "WATCH", min: 40 },
    { band: "INFORMATIONAL", min: 0 },
  ],
  top2: { threshold: 70, slots: 2 },
  tie: { withinPoints: 0.5 },
  emergency: {
    triggerA: { operationalRisk: 15, timeSensitivity: 8 },
    triggerB: { customerRevenue: 10, timeSensitivity: 8 },
    triggerC: { operationalRisk: 12, customerRevenue: 8, timeSensitivity: 6 },
    triggerD: { maxActionWindowDays: 14 },
    maxPublishedEmergencies: 1,
  },
  override: { minorMax: 5, materialMax: 10 },
  rankLock: { maxDays: 7 },
  suppressionReReview: { scoreIncrease: 10 },
  repeatedRejection: { threshold: 3 },
};

/** Canonical JSON (sorted keys) used for hashes and the run snapshot. */
export function canonicalJson(value: unknown): string {
  const norm = (v: unknown): unknown => {
    if (Array.isArray(v)) return v.map(norm);
    if (v && typeof v === "object") {
      return Object.fromEntries(
        Object.keys(v as Record<string, unknown>)
          .sort()
          .map((k) => [k, norm((v as Record<string, unknown>)[k])]),
      );
    }
    return v;
  };
  return JSON.stringify(norm(value));
}

export function configHash(cfg: ScoringConfig = SCORING_CONFIG): string {
  return createHash("sha256").update(canonicalJson(cfg)).digest("hex");
}

export const sha256Json = (value: unknown): string => createHash("sha256").update(canonicalJson(value)).digest("hex");
