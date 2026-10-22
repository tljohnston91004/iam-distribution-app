/**
 * Stage 4C domain scoring and ranking API (clean service functions; no page, route or session coupling).
 *
 *   recordScoringInputs -> runScoring (score, rank, Top 2, emergency review, forced reviews, publish)
 *   governance: overrides, rank lock, manual tie-break, strategic authorization, emergency decisions, forced-review resolution
 *
 * Scoring applies to canonical integrated candidates only. It never scores legacy V1.5 records, never implements the
 * Inventory Management Health Score, and never changes RSE/PRE business logic.
 */
export * from "./config";
export * from "./inputs";
export * from "./calculate";
export * from "./ranking";
export * from "./publish";
export { refreshDisplayedPriority, latestDisplayStates, type DisplayRefreshResult } from "./display-refresh";
export { POOL_STATES, TOP2_STATES, assertStableUserId } from "./ledger";
export { recordScoringInputs, runScoring, getScoringRun, explainScore, occurrenceNumber, operatingWeekOf, type RunScoringInput, type ScoringRunSummary, type RankedSummary, type RecordInputsResult, type PriorOccurrence } from "./service";
export {
  setPriorityOverride,
  revokePriorityOverride,
  lockRank,
  unlockRank,
  recordManualTieBreak,
  authorizeStrategic,
  revokeStrategic,
  confirmEmergency,
  declineEmergency,
  clearEmergency,
  routeToDataInvestigation,
  resolveForcedReview,
  FORCED_REVIEW_RESOLUTION_BASES,
  type OverrideInput,
  type RankLockInput as RankLockRequest,
  type ForcedReviewResolutionBasis,
} from "./governance";
