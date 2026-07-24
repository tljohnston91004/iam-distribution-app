import type { GenerationPath } from "@/lib/iam/inbound/types";
import type { InterimScoringProfile } from "./profile";
import type { RevisedScoreResult } from "./revised";

export interface ScoreBreakdown {
  cashImpactScore: number;
  serviceRiskScore: number;
  inventoryConditionScore: number;
  /** Sequencing helper only — excluded from composite (SD-14). */
  actionabilitySequenceScore: number;
  compositeBeforeConfidence: number;
  confidenceMultiplierApplied: number;
  priorityScore: number;
  serviceOverrideApplied: boolean;
  weights: {
    cashImpact: number;
    serviceOperationalRisk: number;
    inventoryCondition: number;
  };
}

export interface ScoreExplainability {
  scoringProfileId: string;
  scoringProfileLabel: string;
  scoringProfile: InterimScoringProfile | Record<string, unknown>;
  breakdown: ScoreBreakdown;
  narrativeInputs: {
    generationPath: GenerationPath | string;
    confidence: string;
    estimatedCashImpact: number | null;
    estimatedFinancialImpact: number | null;
    costOfInaction: number | null;
    weeksOfSupply: number | null;
    hasRequiredEvidence: boolean;
    readinessLabel: string;
    note: string;
  };
  /** Revised Decision Priority score (or calculation exception). */
  revisedScore?: RevisedScoreResult;
  /** When revised cannot authoritatively rank, interim remains Board priorityScore. */
  authoritativeProfile?: "revised_v1_decision_priority" | "interim_v1_cash_led";
  transitionalNote?: string;
}

export interface ScoredRecommendationRow {
  recommendationId: string;
  opportunityKey: string;
  generationPath: string;
  lifecycleState: string;
  priorityScore: number;
  actionabilitySequenceScore: number;
  scoringProfileId: string;
  explainability: ScoreExplainability;
}
