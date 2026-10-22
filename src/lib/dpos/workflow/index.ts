/**
 * Stage 4B workflow domain API (clean service functions; no page, route or session coupling).
 *
 *   evidence -> candidate -> present -> management decision -> department -> task owner -> owner acceptance ->
 *   active action -> progress / condition reduction -> escalation -> completion -> validation -> completed history
 *
 * Every function takes (db, company context, actor, candidateId, input) and runs in one transaction that also writes the
 * Results Return outbox events (Stage 4A producer). Nothing here scores, ranks, recommends or learns (those are later, separately authorized stages).
 */
export * from "./vocab";
export * from "./permissions";
export * from "./grouping";
export * from "./condition-reduction";
export * from "./aging";
export {
  ingestGovernedEvidence,
  createRecurrence,
  attachEvidence,
  presentCandidate,
  listEvidence,
  type GroupDescription,
  type IngestInput,
  type IngestGroupResult,
  type ConditionSignal,
} from "./candidates";
export {
  approveCandidate,
  rejectCandidate,
  riskAcceptCandidate,
  escalateCandidate,
  returnForReview,
  suppressCandidate,
  releaseSuppression,
  signalConditionChange,
  evaluateSuppressions,
  resolveDecisionRequired,
  type ApproveInput,
  type RejectInput,
  type SuppressInput,
  type SuppressionEndTrigger,
} from "./management";
export {
  assignDepartment,
  assignOwner,
  acceptOwnership,
  requestDiscussion,
  declineOwnership,
  reassign,
  setContributors,
  authorizeContributor,
  revokeContributorAuthorization,
  type ReassignInput,
} from "./assignment";
export { revisePlan, type RevisePlanInput } from "./plan-revision";
export {
  startAction,
  updateProgress,
  updateConditionReduction,
  addSupportEntry,
  requestPause,
  decidePause,
  reactivateAction,
  raiseBlocker,
  clearBlocker,
  raiseManagementAttention,
  evaluateAction,
  evaluateAllActions,
  completeAction,
  validateCompletion,
  archiveToHistory,
  type ProgressInput,
  type ConditionReductionInput,
  type PauseRequestInput,
  type PauseDecisionInput,
} from "./action";
export { computeCapacity, listDecisionRequired, listWhatChangedMarkers, readWorkflowView, readRecurrenceChain, listCompletedHistory, type CapacitySnapshot, type CapacityBucket } from "./read";
export type { EmittedEvent, OperationResult } from "./internal";
export type { PlanInput, ContributorInput } from "./shared";
