/**
 * Phase 4 interim scoring profile (A-005 / SD-1 waiver).
 * Full COI/weights remain open under SD-1 — this profile is explicitly non-final.
 */

import { SERVICE_RISK_OVERRIDE_MIN_RATIO } from "@/lib/iam/constants";

/** Stable id stamped on every scored Recommendation. */
export const INTERIM_SCORING_PROFILE_ID = "interim_v1_cash_led" as const;

export const INTERIM_SCORING_PROFILE_LABEL =
  "Interim scoring profile (SD-1 open; A-005 waiver) — cash-led V1 weights without actionability in composite" as const;

/**
 * Composite weights for interim profile.
 * Actionability removed from composite (SD-14 default: sequencing only until SD-14 closes).
 * Relative cash/service/inventory proportions preserved from V1 (0.45 / 0.35 / 0.12 → renormalized).
 */
export const INTERIM_COMPOSITE_WEIGHTS = {
  cashImpact: 0.45 / 0.92,
  serviceOperationalRisk: 0.35 / 0.92,
  inventoryCondition: 0.12 / 0.92,
} as const;

/** Retained for sequencing / tie-break only — not in composite priority. */
export const ACTIONABILITY_SEQUENCING_WEIGHT = 0.08;

export const INTERIM_SCORING_PROFILE = {
  id: INTERIM_SCORING_PROFILE_ID,
  label: INTERIM_SCORING_PROFILE_LABEL,
  weights: INTERIM_COMPOSITE_WEIGHTS,
  actionabilityRole: "sequencing_only" as const,
  confidenceRole: "narrative_and_soft_factor" as const,
  suppressByConfidence: false,
  serviceRiskOverrideMinRatio: SERVICE_RISK_OVERRIDE_MIN_RATIO,
  sd1Status: "open" as const,
  assumptionId: "A-005",
} as const;

export type InterimScoringProfile = typeof INTERIM_SCORING_PROFILE;
