import { cashImpactScore } from "@/lib/iam/engine/impact-score";
import {
  confidenceMultiplier,
  readinessFromConfidence,
} from "@/lib/iam/engine/confidence";
import {
  INTERIM_COMPOSITE_WEIGHTS,
  INTERIM_SCORING_PROFILE,
  INTERIM_SCORING_PROFILE_ID,
} from "./profile";
import {
  REVISED_SCORING_CONFIG_VERSION,
  REVISED_SCORING_PROFILE_ID,
  calculateRevisedScore,
  mapDiscoverySignalsToLevels,
  normalizeConfidenceTier,
  type CompanyDenominators,
} from "./revised";
import type { ScoreBreakdown, ScoreExplainability, ScoredRecommendationRow } from "./types";

const TRAPPED_CASH_WEEKS = 26;

export type ScoreableRecommendation = {
  id: string;
  opportunityKey: string;
  generationPath: string;
  lifecycleState: string;
  confidence: string;
  estimatedCashImpact: number | null;
  estimatedFinancialImpact: number | null;
  costOfInaction: number | null;
  explainabilityJson: string | null;
};

export type EvidenceHints = {
  weeksOfSupply: number | null;
  hasRequiredEvidence: boolean;
  serviceRiskScoreHint: number | null;
  backorder?: boolean;
};

export type RevisedScoringContext = {
  denominators: CompanyDenominators;
  /** Net scoreable 13-week cash when known (FinancialImpact). */
  netScoreable13WeekCash: number | null;
  netScoreableProfitability: number | null;
  estimationMethod: string | null;
};

function parsePriorDetail(json: string | null): Record<string, unknown> {
  if (!json) return {};
  try {
    return JSON.parse(json) as Record<string, unknown>;
  } catch {
    return {};
  }
}

function scoreInterim(
  rec: ScoreableRecommendation,
  evidence: EvidenceHints | undefined,
  prior: Record<string, unknown>
): {
  priorityScore: number;
  actionabilitySequenceScore: number;
  breakdown: ScoreBreakdown;
  weeksOfSupply: number | null;
  hasRequired: boolean;
  serviceRiskScore: number;
} {
  const cashImpact =
    rec.estimatedCashImpact ??
    rec.estimatedFinancialImpact ??
    (typeof prior.estimatedCashImpact === "number" ? prior.estimatedCashImpact : 0);

  const cashScore = cashImpactScore(cashImpact);

  let serviceRiskScore =
    evidence?.serviceRiskScoreHint ??
    (typeof prior.serviceRiskScore === "number" ? prior.serviceRiskScore : 0);
  serviceRiskScore = Math.min(100, Math.max(0, serviceRiskScore));

  const weeksOfSupply =
    evidence?.weeksOfSupply ??
    (typeof (prior.detail as { weeksOfSupply?: number } | undefined)?.weeksOfSupply === "number"
      ? (prior.detail as { weeksOfSupply: number }).weeksOfSupply
      : null);

  const inventoryCondition =
    weeksOfSupply != null ? Math.min(100, (weeksOfSupply / TRAPPED_CASH_WEEKS) * 100) : 30;

  const hasRequired = evidence?.hasRequiredEvidence ?? true;
  const actionabilitySequenceScore = hasRequired ? 80 : 40;

  const override =
    serviceRiskScore / Math.max(cashScore, 1) >=
    INTERIM_SCORING_PROFILE.serviceRiskOverrideMinRatio;

  const w = INTERIM_COMPOSITE_WEIGHTS;
  const composite = override
    ? serviceRiskScore * w.serviceOperationalRisk +
      cashScore * w.cashImpact +
      inventoryCondition * w.inventoryCondition
    : cashScore * w.cashImpact +
      serviceRiskScore * w.serviceOperationalRisk +
      inventoryCondition * w.inventoryCondition;

  const confMult = confidenceMultiplier(rec.confidence);
  const priorityScore = composite * confMult;

  return {
    priorityScore,
    actionabilitySequenceScore,
    weeksOfSupply,
    hasRequired,
    serviceRiskScore,
    breakdown: {
      cashImpactScore: cashScore,
      serviceRiskScore,
      inventoryConditionScore: inventoryCondition,
      actionabilitySequenceScore,
      compositeBeforeConfidence: composite,
      confidenceMultiplierApplied: confMult,
      priorityScore,
      serviceOverrideApplied: override,
      weights: { ...w },
    },
  };
}

/**
 * Score one Recommendation.
 * Attempts revised Decision Priority model when context provided; otherwise / on exception
 * retains interim Board priorityScore (transitional — see Pre-Build C-2/C-3).
 */
export function scoreRecommendation(
  rec: ScoreableRecommendation,
  evidence?: EvidenceHints,
  revisedCtx?: RevisedScoringContext
): ScoredRecommendationRow {
  const prior = parsePriorDetail(rec.explainabilityJson);
  const interim = scoreInterim(rec, evidence, prior);
  const readiness = readinessFromConfidence(rec.confidence, interim.hasRequired);

  const levels = mapDiscoverySignalsToLevels({
    serviceRiskScore: interim.serviceRiskScore,
    weeksOfSupply: interim.weeksOfSupply,
    hasRequiredEvidence: interim.hasRequired,
    backorder: evidence?.backorder,
  });

  let revisedScore = revisedCtx
    ? calculateRevisedScore({
        recommendationId: rec.id,
        grossCashImpact: rec.estimatedCashImpact ?? rec.estimatedFinancialImpact,
        netScoreable13WeekCashImpact: revisedCtx.netScoreable13WeekCash,
        cashEstimationMethod:
          revisedCtx.estimationMethod ??
          "gross_from_recommendation_estimated_cash_impact_not_net_recoverable",
        netScoreableProfitabilityImpact: revisedCtx.netScoreableProfitability,
        profitabilityEstimationMethod:
          revisedCtx.netScoreableProfitability != null
            ? (revisedCtx.estimationMethod ?? "financial_impact_record")
            : "not_provided",
        affectedInventoryBookValue: rec.estimatedCashImpact ?? rec.estimatedFinancialImpact,
        denominators: revisedCtx.denominators,
        operationalRiskLevel: levels.operationalRiskLevel,
        customerRevenueLevel: levels.customerRevenueLevel,
        actionWindowDays: levels.actionWindowDays,
        actionabilityLevel: levels.actionabilityLevel,
        confidence: normalizeConfidenceTier(rec.confidence),
        persistence: "first",
        deterioration: "stable",
        crossFunctional: "isolated",
        strategicImportance: "normal",
        executionBurden: "normal",
        benefitUncertainty:
          revisedCtx.netScoreable13WeekCash != null ? "supported" : "significant_assumptions",
      })
    : ({
        ok: false as const,
        scoringProfileId: REVISED_SCORING_PROFILE_ID,
        configVersion: REVISED_SCORING_CONFIG_VERSION,
        calculationException: true as const,
        exceptionCode: "REVISED_CONTEXT_NOT_SUPPLIED",
        exceptionMessage: "Revised scoring context not supplied for this scoring pass.",
        structuredExplanation: ["Revised Decision Priority context was not provided."],
      });

  const revisedOk = revisedScore.ok === true;
  const priorityScore = revisedOk ? revisedScore.governedFinalScore : interim.priorityScore;
  const scoringProfileId = revisedOk ? REVISED_SCORING_PROFILE_ID : INTERIM_SCORING_PROFILE_ID;

  const explainability: ScoreExplainability = {
    scoringProfileId,
    scoringProfileLabel: revisedOk
      ? REVISED_SCORING_CONFIG_VERSION.label
      : INTERIM_SCORING_PROFILE.label,
    scoringProfile: revisedOk ? { ...REVISED_SCORING_CONFIG_VERSION } : INTERIM_SCORING_PROFILE,
    breakdown: interim.breakdown,
    narrativeInputs: {
      generationPath: rec.generationPath,
      confidence: rec.confidence,
      estimatedCashImpact: rec.estimatedCashImpact,
      estimatedFinancialImpact: rec.estimatedFinancialImpact,
      costOfInaction: rec.costOfInaction,
      weeksOfSupply: interim.weeksOfSupply,
      hasRequiredEvidence: interim.hasRequired,
      readinessLabel: readiness,
      note: revisedOk
        ? "Authoritative score from revised Decision Priority model (100-point factor architecture)."
        : "Interim Board score retained. Revised Decision Priority recorded as calculation exception until denominators and net scoreable cash are available.",
    },
    revisedScore,
    authoritativeProfile: revisedOk ? REVISED_SCORING_PROFILE_ID : INTERIM_SCORING_PROFILE_ID,
    transitionalNote: revisedOk
      ? undefined
      : revisedScore.ok === false
        ? revisedScore.exceptionMessage
        : undefined,
  };

  return {
    recommendationId: rec.id,
    opportunityKey: rec.opportunityKey,
    generationPath: rec.generationPath,
    lifecycleState: rec.lifecycleState,
    priorityScore,
    actionabilitySequenceScore: interim.actionabilitySequenceScore,
    scoringProfileId,
    explainability,
  };
}

/** Rank all scored rows — no suppress filter. Prefer revised governed score already on priorityScore. */
export function rankScoredRecommendations(
  rows: ScoredRecommendationRow[]
): ScoredRecommendationRow[] {
  return [...rows].sort((a, b) => {
    if (b.priorityScore !== a.priorityScore) return b.priorityScore - a.priorityScore;
    if (b.actionabilitySequenceScore !== a.actionabilitySequenceScore) {
      return b.actionabilitySequenceScore - a.actionabilitySequenceScore;
    }
    return a.recommendationId.localeCompare(b.recommendationId);
  });
}
