export {
  REVISED_SCORING_PROFILE_ID,
  REVISED_SCORING_CONFIG_VERSION,
  FACTOR_MAX,
  TOP2_MIN_FINAL_SCORE,
  DUPLICATE_SCOPE_OVERLAP_DEFAULT,
  OVERRIDE_RANGES,
} from "./config";
export { calculateRevisedScore, mapDiscoverySignalsToLevels, normalizeConfidenceTier } from "./calculate";
export { evaluateEmergencyTests } from "./emergency";
export { resolveTie } from "./tie-break";
export type { RevisedScoreInput, RevisedScoreResult, CompanyDenominators } from "./calculate";
export type { TieBreakComparable } from "./tie-break";
