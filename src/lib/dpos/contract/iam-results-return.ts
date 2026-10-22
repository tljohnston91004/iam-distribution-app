/**
 * IAM Stage 3 - IAM -> Data Hub Results Return contract (IAM_RESULTS_RETURN_V1).
 *
 * Pure, dependency-free contract definition shared by Data Hub (receiver) and IAM (producer):
 *   - contract identity and independent versioning (additive evolution; historical versions stay readable),
 *   - the normalized event taxonomy and event-type-specific validation,
 *   - the deterministic acknowledgement shape and failure classification,
 *   - the IAM-side sync-status record and its state transitions,
 *   - Sunday-Saturday operating-period helpers.
 *
 * This module contains NO IAM business logic: it does not generate candidates, score, rank, recommend, plan, measure
 * effectiveness or learn. It only describes, validates and classifies what IAM returns.
 */

export const IAM_RESULTS_RETURN_V1 = "IAM_RESULTS_RETURN_V1" as const;
export const IAM_RESULTS_RETURN_CONTRACT_VERSION = "1.0" as const;
export const IAM_ORIGINATING_MODULE = "IAM" as const;
export const IAM_PROVENANCE_CONTRACT_FAMILY = "IAM_RESULTS_RETURN" as const;
/**
 * Additive revision within contract version 1.0 (Stage 4B state-contract closeout, 4B-D1..D4/D6). Every earlier event stays valid:
 *   - action status NOT_STARTED, event MANAGEMENT_DECISION_RESOLVED and the progress.managementDecisionRequired /
 *     decisionRequiredCategory / decisionResolution fields are new (additive);
 *   - CANDIDATE_CREATED no longer requires domainScore / domainRank (scoring and ranking belong to a later stage; a later
 *     stage may still send them);
 *   - OWNER_ACCEPTED may carry a progress section (actionStatus NOT_STARTED).
 */
/**
 * Revision 1.0-r4c (Stage 4C, additive on top of 1.0-r4b; every earlier event stays valid):
 *   - scoring and ranking publication: event CANDIDATE_SCORED (first score and every re-score from a finalized IAM scoring run) and
 *     the existing DOMAIN_PRIORITY_CHANGED for governed priority changes; the recommendation section carries the score version, scoring
 *     run, score breakdown totals, band, emergency-review / Top 2 / forced-review flags, displayed (management) rank and override facts;
 *   - dedicated governance events PLAN_REVISED, RETURNED_FOR_REVIEW, PAUSE_REQUESTED, PAUSE_APPROVED, PAUSE_DENIED (4C-D6);
 *   - condition reduction may be NEGATIVE (4C-D7): signed percent, plus an explicit NOT_MEASURABLE state;
 *   - assignment events may carry stable user identity ids (4C-D5): taskOwnerId / previousTaskOwnerId.
 *   - explicit current scoring state (Stage 4C closeout 4C-D7): event SCORING_STATE_CHANGED publishes UNSCORED / NOT_RANKABLE (with a
 *     mandatory reason) when a previously scored candidate stops being rankable, so a consumer never keeps showing an old score or rank as
 *     current. CANDIDATE_SCORED publishes SCORED again. Historical score events are never edited.
 *   - transparency fields (closeout 4C-D4 / 4C-D5): mathematicalDomainScore + scoreFlags (CRITICAL_PROTECTED_FROM_BURDEN_DEMOTION),
 *     additionalEmergencyReviewRequired + emergencyTriggers, rankLockActive.
 * IAM owns domainScore / domainRank. A consumer (DPOS) may add a separate enterprise rank but never overwrite these.
 */
/**
 * Revision 1.0-r4e (Stage 4E formal closeout, outcome attribution, recurrence and learning; additive on top of 1.0-r4c, every earlier event stays valid):
 *   - existing closure events are reused where they already mean the same thing: OUTCOME_VALIDATED carries a measured outcome / closeout
 *     version (the "outcome measured" step), CLOSEOUT_COMPLETED is the permanent closure, RECURRENCE_LINKED is the new linked candidate;
 *   - new events: CLOSEOUT_STARTED, CLOSEOUT_APPROVED (management approval of one closeout version) and LEARNING_RECORDED;
 *   - the closeout / outcome / recurrence / learning sections gain optional fields (closeout identity and version, system-recommended vs
 *     management-approved resolution, nine-status resolution vocabulary, attribution category and rationale, outcome confidence,
 *     measurement window, residual exposure unit, recurrence risk and context). No earlier required field changes.
 * Execution completion (ACTION_COMPLETED) is still NOT formal closeout; only CLOSEOUT_COMPLETED closes a candidate and a closed
 * candidate never reopens (a returning condition is a new candidate linked by RECURRENCE_LINKED).
 */
export const IAM_RESULTS_RETURN_CONTRACT_REVISION = "1.0-r4e" as const;

/** Contract versions this build can validate and interpret. Additive evolution only: add, never remove. */
export const IAM_RESULTS_RETURN_SUPPORTED_VERSIONS = ["1.0"] as const;
export type IamResultsReturnVersion = (typeof IAM_RESULTS_RETURN_SUPPORTED_VERSIONS)[number];

export const IAM_EVENT_TYPES = [
  // Lifecycle
  "CANDIDATE_CREATED",
  "CANDIDATE_RECALCULATED",
  "CANDIDATE_SCORED",
  "SCORING_STATE_CHANGED",
  "DOMAIN_PRIORITY_CHANGED",
  "PLAN_REVISED",
  "RETURNED_FOR_REVIEW",
  "MANAGEMENT_APPROVED",
  "MANAGEMENT_REJECTED",
  "SUPPRESSED",
  "SUPPRESSION_RELEASED",
  "ESCALATED",
  "RISK_ACCEPTED",
  // Assignment / ownership
  "DEPARTMENT_ASSIGNED",
  "TASK_OWNER_ASSIGNED",
  "OWNER_ACCEPTED",
  "OWNER_DISCUSSION_REQUESTED",
  // Action progress
  "ACTION_STARTED",
  "ACTION_STATUS_CHANGED",
  "PROGRESS_UPDATED",
  "CONDITION_REDUCTION_UPDATED",
  "MANAGEMENT_DECISION_REQUIRED",
  "MANAGEMENT_DECISION_RESOLVED",
  "PAUSE_REQUESTED",
  "PAUSE_APPROVED",
  "PAUSE_DENIED",
  "ACTION_PAUSED",
  "ACTION_REACTIVATED",
  "ACTION_BLOCKED",
  "ACTION_COMPLETED",
  // Closure and recurrence
  "OUTCOME_VALIDATED",
  "CLOSEOUT_STARTED",
  "CLOSEOUT_APPROVED",
  "LEARNING_RECORDED",
  "CLOSEOUT_COMPLETED",
  "RECURRENCE_LINKED",
] as const;
export type IamEventType = (typeof IAM_EVENT_TYPES)[number];

export type IamEventFamily = "LIFECYCLE" | "ASSIGNMENT" | "ACTION_PROGRESS" | "CLOSURE_RECURRENCE";

/** Management / lifecycle position of a candidate. Normalized enum names. */
export const IAM_LIFECYCLE_STATES = [
  "CANDIDATE",
  "APPROVED",
  "REJECTED",
  "SUPPRESSED",
  "ESCALATED",
  "RISK_ACCEPTED",
  "ACTIVE",
  "COMPLETED",
  "OUTCOME_VALIDATED",
  "CLOSED",
] as const;
/**
 * IAM Functional Specification section 8.1 Standard Execution Status, plus NOT_STARTED (4B-D3): the action is approved /
 * assigned / accepted but execution has not begun. Historical events without this status stay valid.
 */
export const IAM_ACTION_STATUSES = [
  "NOT_STARTED",
  "ON_TRACK",
  "ATTENTION",
  "AT_RISK",
  "OVERDUE",
  "PAUSED",
  "BLOCKED",
  "COMPLETED",
] as const;
export const IAM_PLAN_STATUSES = ["NOT_PLANNED", "PROPOSED", "APPROVED", "REJECTED", "SUPERSEDED"] as const;
/** IAM Functional Specification section 15.2 Final Resolution Status. */
export const IAM_FINAL_RESOLUTION_STATES = [
  "FULLY_RESOLVED",
  "SUBSTANTIALLY_RESOLVED",
  "PARTIALLY_RESOLVED",
  "CONTROLLED_BUT_CONTINUING",
  "UNSUCCESSFUL",
  "NO_LONGER_APPLICABLE",
] as const;
export const IAM_OUTCOME_STATES = ["MEASURED", "VALIDATED", "NOT_MEASURABLE"] as const;
/** Stage 4E: the nine closeout resolution statuses (the six final statuses plus the three interim ones). Only the six final ones can close a candidate. */
export const IAM_CLOSEOUT_RESOLUTION_STATUSES = [
  "NOT_YET_MEASURED",
  "IMPROVING",
  "ON_TARGET",
  "FULLY_RESOLVED",
  "SUBSTANTIALLY_RESOLVED",
  "PARTIALLY_RESOLVED",
  "CONTROLLED_BUT_CONTINUING",
  "UNSUCCESSFUL",
  "NO_LONGER_APPLICABLE",
] as const;
/** Stage 4E attribution: how far an action can be credited with the outcome. Always separate from the outcome itself. */
export const IAM_ATTRIBUTION_CATEGORIES = [
  "CONFIRMED_CONTRIBUTION",
  "PROBABLE_CONTRIBUTION",
  "POSSIBLE_CONTRIBUTION",
  "UNCLEAR_INSUFFICIENT_EVIDENCE",
  "UNRELATED_EXTERNAL_CAUSE",
  "NEGATIVE_COUNTERPRODUCTIVE_EFFECT",
] as const;
export const IAM_CLOSEOUT_PHASES = ["STARTED", "MEASURED", "APPROVED", "COMPLETED"] as const;
export const IAM_RECURRENCE_RISKS = ["LOW", "MEDIUM", "HIGH", "UNKNOWN"] as const;
export const IAM_RECURRENCE_MATCH_STATUSES = ["LINKED", "REQUIRES_REVIEW", "REVIEW_CONFIRMED", "REVIEW_DECLINED"] as const;
export const IAM_MANAGEMENT_RESPONSES = ["FOLLOWED", "MODIFIED", "SELECTED_ALTERNATIVE", "REJECTED_THEN_APPROVED", "DELAYED", "SUPPRESSED_THEN_APPROVED"] as const;
/** IAM Functional Specification section 15: High, Moderate, Low or Not Measurable. */
export const IAM_ATTRIBUTION_CONFIDENCES = ["HIGH", "MODERATE", "LOW", "NOT_MEASURABLE"] as const;
/** Analysis data confidence of a scored candidate (IAM scoring model). INSUFFICIENT is normally not rankable. */
export const IAM_DATA_CONFIDENCE_LEVELS = ["HIGH", "MEDIUM", "LOW", "INSUFFICIENT"] as const;
/** Current scoring state of a candidate (4C-D7). Only SCORED carries a current score and rank. */
export const IAM_SCORING_STATES = ["SCORED", "UNSCORED", "NOT_RANKABLE"] as const;
export const IAM_CONDITION_REDUCTION_STATES = ["MEASURED", "NOT_MEASURABLE"] as const;
export const IAM_REFRESH_KINDS = ["LIFECYCLE_EVENT", "SCHEDULED_WEEKLY", "MANUAL_REFRESH"] as const;

export type IamLifecycleState = (typeof IAM_LIFECYCLE_STATES)[number];
export type IamActionStatus = (typeof IAM_ACTION_STATUSES)[number];

type FieldType =
  | "string"
  | "longString"
  | "datetime"
  | "date"
  | "percent"
  | "signedPercent"
  | "number"
  | "nonNegNumber"
  | "positiveInt"
  | "boolean"
  | "stringArray"
  | "stringMap"
  | "numberMap"
  | "enum";
export type IamFieldSpec = { type: FieldType; values?: readonly string[] };

const S: IamFieldSpec = { type: "string" };
const LS: IamFieldSpec = { type: "longString" };
const DT: IamFieldSpec = { type: "datetime" };
const D: IamFieldSpec = { type: "date" };
const PCT: IamFieldSpec = { type: "percent" };
const SPCT: IamFieldSpec = { type: "signedPercent" };
const NM: IamFieldSpec = { type: "numberMap" };
const NUM: IamFieldSpec = { type: "number" };
const NN: IamFieldSpec = { type: "nonNegNumber" };
const PI: IamFieldSpec = { type: "positiveInt" };
const B: IamFieldSpec = { type: "boolean" };
const SA: IamFieldSpec = { type: "stringArray" };
const SM: IamFieldSpec = { type: "stringMap" };
const E = (values: readonly string[]): IamFieldSpec => ({ type: "enum", values });

export const IAM_PAYLOAD_SECTIONS = [
  "envelope",
  "subject",
  "source",
  "recommendation",
  "management",
  "assignment",
  "progress",
  "plan",
  "outcome",
  "closeout",
  "recurrence",
  "learning",
  "auditReceipt",
] as const;
export type IamPayloadSection = (typeof IAM_PAYLOAD_SECTIONS)[number];

/** Allow-list per section. Anything else is stripped before hashing/persisting (same rule as Step 10). */
export const IAM_AUTHORIZED_FIELDS: Record<IamPayloadSection, Record<string, IamFieldSpec>> = {
  envelope: {
    contractId: S,
    contractVersion: S,
    eventType: S,
    producerEventId: S,
    originatingModule: S,
    companyId: S,
    producerEventAt: DT,
    producerVersion: S,
    relatedProducerEventId: S,
  },
  subject: { candidateId: S, domainKey: S, candidateKind: S, title: S, recommendationVersion: PI },
  source: {
    iamSourceRunId: S,
    iamSourceVersion: S,
    hubSnapshotId: S,
    hubPackageHash: S,
    evidenceRefs: SA,
    refreshKind: E(IAM_REFRESH_KINDS),
    operatingPeriodStart: D,
    operatingPeriodEnd: D,
  },
  recommendation: {
    title: S,
    recommendedAction: LS,
    recommendationSummary: LS,
    domainScore: PCT,
    uncappedDomainScore: NUM,
    domainRank: PI,
    previousDomainRank: PI,
    priorityBand: S,
    emergencyPriority: B,
    expectedImpact: NUM,
    expectedImpactUnit: S,
    // ---- Stage 4C scoring and ranking publication (r4c). IAM is authoritative; none of this is ever inferred by a consumer.
    scoringRunId: S,
    scoreVersion: S,
    scoredAt: DT,
    rawCoreScore: PCT,
    dataConfidence: E(IAM_DATA_CONFIDENCE_LEVELS),
    confidenceMultiplier: NN,
    confidenceAdjustedCoreScore: PCT,
    uncappedModifierTotal: NUM,
    cappedModifierTotal: NUM,
    /** Seven approved factor scores (cash, profitability, inventoryExposure, operationalRisk, customerRevenue, timeSensitivity, actionability). */
    factorScores: NM,
    /** The individual modifiers (persistence, deterioration, crossFunctional, strategic, executionBurden, benefitUncertainty). */
    modifierValues: NM,
    /** domainRank above is the calculated (system) rank; the displayed / management rank is separate and never overwrites it. */
    displayedDomainRank: PI,
    emergencyReviewCandidate: B,
    emergencyReviewReasons: SA,
    top2Qualified: B,
    criticalOutsideTop2: B,
    forcedReviewRequired: B,
    forcedReviewReason: LS,
    priorityOverrideType: S,
    priorityOverrideBy: S,
    priorityOverrideReason: LS,
    priorityOverrideAt: DT,
    rankLockedUntil: DT,
    /** false = the rank lock ended or was released; consumers then clear rankLockedUntil. */
    rankLockActive: B,
    // ---- closeout 4C-D7: explicit current scoring state. UNSCORED / NOT_RANKABLE carry a reason and NO current score or rank.
    scoringState: E(IAM_SCORING_STATES),
    notRankableReason: LS,
    /** Optional pointer to the last valid score (history stays immutable in the event log; this is convenience metadata only). */
    lastValidDomainScore: PCT,
    lastValidDomainRank: PI,
    lastValidScoredAt: DT,
    lastValidScoringRunId: S,
    // ---- closeout 4C-D4: the mathematical score and the governance flags that explain a displayed band.
    mathematicalDomainScore: PCT,
    scoreFlags: SA,
    // ---- closeout 4C-D5: every qualifying trigger is preserved; an additional emergency candidate is flagged for forced review.
    emergencyTriggers: SA,
    additionalEmergencyReviewRequired: B,
  },
  management: {
    lifecycleState: E(IAM_LIFECYCLE_STATES),
    decidedBy: S,
    decidedAt: DT,
    decisionReason: LS,
    escalatedTo: S,
    suppressedUntil: D,
  },
  assignment: {
    responsibleDepartment: S,
    previousResponsibleDepartment: S,
    taskOwner: S,
    previousTaskOwner: S,
    /** Stable DPOS user identity ids (4C-D5); names above are display text only. */
    taskOwnerId: S,
    previousTaskOwnerId: S,
    targetDate: D,
    ownerResponseAt: DT,
    discussionNote: LS,
  },
  progress: {
    actionStatus: E(IAM_ACTION_STATUSES),
    actionCompletionPct: PCT,
    /** Signed (4C-D7): negative means the condition got worse than its baseline. */
    conditionReductionPct: SPCT,
    /** NOT_MEASURABLE when the baseline is zero or unavailable; no percentage is then supplied. */
    conditionReductionState: E(IAM_CONDITION_REDUCTION_STATES),
    remainingExposure: NN,
    remainingExposureUnit: S,
    startedAt: DT,
    completedAt: DT,
    statusReason: LS,
    blockedReason: LS,
    reactivationCondition: LS,
    decisionRequiredReason: LS,
    /** Explicit active flag (4B-D2). Only MANAGEMENT_DECISION_REQUIRED (true) and MANAGEMENT_DECISION_RESOLVED (false) carry it. */
    managementDecisionRequired: B,
    /** Short machine category of the requirement (for example AT_RISK, OVERDUE, BLOCKED, PAUSE_REQUEST, OWNER_DISCUSSION). */
    decisionRequiredCategory: S,
    /** How the requirement was resolved (MANAGEMENT_DECISION_RESOLVED). */
    decisionResolution: LS,
    // ---- pause governance (4C-D6): PAUSE_REQUESTED / PAUSE_APPROVED / PAUSE_DENIED
    pauseReason: LS,
    pauseRequestedBy: S,
    pauseRequestedAt: DT,
    expectedPauseDurationDays: PI,
    pauseReviewDueAt: DT,
  },
  plan: {
    approvedPlanStatus: E(IAM_PLAN_STATUSES),
    approvedPlanRef: S,
    planSummary: LS,
    planApprovedAt: DT,
    planApprovedBy: S,
    deviatesFromSystemRecommendation: B,
    deviationReason: LS,
    // ---- plan revision (4C-D6): PLAN_REVISED
    planVersion: PI,
    previousPlanVersion: PI,
    revisionReason: LS,
    revisedBy: S,
    revisedAt: DT,
  },
  outcome: {
    outcomeState: E(IAM_OUTCOME_STATES),
    finalResolutionState: E(IAM_FINAL_RESOLUTION_STATES),
    measuredImprovement: NUM,
    naturalBaselineImprovement: NUM,
    iamAttributedIncrementalImprovement: NUM,
    uncertainMixedAttribution: NUM,
    residualExposure: NN,
    improvementUnit: S,
    attributionConfidence: E(IAM_ATTRIBUTION_CONFIDENCES),
    observationPeriodStart: D,
    observationPeriodEnd: D,
    validatedAt: DT,
  },
  closeout: {
    originalProblem: LS,
    originalRecommendationRef: S,
    approvedPlanRef: S,
    expectedResult: LS,
    actualResult: LS,
    targetCompletionDate: D,
    actualCompletionDate: D,
    actionCompletionPct: PCT,
    conditionReductionPct: SPCT,
    measuredBusinessImpact: NUM,
    measuredBusinessImpactUnit: S,
    residualExposure: NN,
    finalResolutionStatus: E(IAM_FINAL_RESOLUTION_STATES),
    attributionConfidence: E(IAM_ATTRIBUTION_CONFIDENCES),
    lessonsLearnedRef: S,
    influenceFutureRecommendations: B,
    closeoutAt: DT,
    // ---- Stage 4E (r4e), all optional: versioned closeout, system vs management resolution, attribution, confidence, window.
    closeoutId: S,
    closeoutVersion: PI,
    closeoutPhase: E(IAM_CLOSEOUT_PHASES),
    /** The system's definitional guidance (absent when management judgement is required). Never replaces the approved status. */
    recommendedResolutionStatus: E(IAM_CLOSEOUT_RESOLUTION_STATUSES),
    /** The resolution status assessed on a measured version (the nine-status vocabulary; finalResolutionStatus stays the six final ones). */
    assessedResolutionStatus: E(IAM_CLOSEOUT_RESOLUTION_STATUSES),
    managementOverrideReason: LS,
    approvedBy: S,
    approvedAt: DT,
    approvedVersion: PI,
    outcomeConfidence: E(IAM_DATA_CONFIDENCE_LEVELS),
    attributionCategory: E(IAM_ATTRIBUTION_CATEGORIES),
    attributionRationale: LS,
    conditionReductionState: E(IAM_CONDITION_REDUCTION_STATES),
    baselineExposure: NN,
    finalExposure: NN,
    residualExposureUnit: S,
    measurementPeriodStart: D,
    measurementPeriodEnd: D,
    evidenceCurrentThrough: DT,
    nextMeasurementDate: D,
    notYetMeasuredReason: LS,
    recurrenceRisk: E(IAM_RECURRENCE_RISKS),
    learningRecordId: S,
    learningNotApplicableReason: LS,
    dataLimitations: SA,
    evidenceRefs: SA,
  },
  recurrence: {
    priorCandidateId: S,
    priorActionRef: S,
    recurrenceReason: LS,
    // ---- Stage 4E (r4e), optional
    recurrenceSequence: PI,
    recurrenceCount: PI,
    matchStatus: E(IAM_RECURRENCE_MATCH_STATUSES),
    priorFinalResolutionStatus: E(IAM_CLOSEOUT_RESOLUTION_STATUSES),
    priorCloseoutAt: DT,
    priorPlanSummary: LS,
  },
  learning: {
    actionType: S,
    normalizedOutcome: S,
    resultSummary: LS,
    confidence: E(IAM_ATTRIBUTION_CONFIDENCES),
    contextIdentifiers: SM,
    lineageRefs: SA,
    recurrenceHistoryRefs: SA,
    // ---- Stage 4E (r4e), optional. A learning record is evidence only; it never changes scoring, Health, RSE policy or recommendations.
    learningRecordId: S,
    managementResponse: E(IAM_MANAGEMENT_RESPONSES),
    timeToResultDays: NN,
    recurrenceSequence: PI,
    evidenceOnly: B,
  },
  auditReceipt: { originatingActor: S, originatingSource: S, authorizationProvenance: S },
};

const COMMON_SECTIONS: readonly IamPayloadSection[] = ["envelope", "subject", "source", "auditReceipt"];

export type IamEventSpec = {
  family: IamEventFamily;
  /** Sections accepted in addition to the common ones. A non-empty section outside this set is rejected. */
  sections: readonly IamPayloadSection[];
  /** "section.field" paths that must be present for this event type. */
  required: readonly string[];
  /** Lifecycle state implied by the event type (explicit management.lifecycleState must agree). */
  impliedLifecycleState?: IamLifecycleState;
  /** Action status implied by the event type (explicit progress.actionStatus must agree). */
  impliedActionStatus?: IamActionStatus;
  /** Statuses an explicit progress.actionStatus may take on this event type (when narrower than all of them). */
  allowedActionStatuses?: readonly IamActionStatus[];
  /** Explicit management-decision-required flag implied by the event type (4B-D2). */
  impliedManagementDecisionRequired?: boolean;
  /** Groups of "section.field" paths of which at least ONE path in each group must be present. */
  requiredOneOf?: readonly (readonly string[])[];
};

export const IAM_EVENT_SPECS: Record<IamEventType, IamEventSpec> = {
  CANDIDATE_CREATED: {
    family: "LIFECYCLE",
    sections: ["recommendation"],
    required: [
      "subject.domainKey",
      "source.iamSourceRunId",
      "source.iamSourceVersion",
      "recommendation.title",
    ],
    // domainScore / domainRank are optional (4B-D6): scoring and ranking are a later stage; nothing synthesizes placeholders.
    impliedLifecycleState: "CANDIDATE",
  },
  CANDIDATE_RECALCULATED: {
    family: "LIFECYCLE",
    sections: ["recommendation"],
    required: [
      "source.iamSourceRunId",
      "source.iamSourceVersion",
      "source.refreshKind",
      "recommendation.domainScore",
      "recommendation.domainRank",
    ],
  },
  // Stage 4C: one event per candidate per finalized IAM scoring run in which the published score, rank, band or review flags
  // changed (and the first time a candidate is scored). Historical score events are immutable; current state reflects the latest.
  CANDIDATE_SCORED: {
    family: "LIFECYCLE",
    sections: ["recommendation"],
    required: [
      "source.iamSourceRunId",
      "source.iamSourceVersion",
      "recommendation.domainScore",
      "recommendation.domainRank",
      "recommendation.priorityBand",
      "recommendation.scoreVersion",
      "recommendation.scoringRunId",
      "recommendation.scoredAt",
    ],
  },
  // Explicit current scoring state (4C-D7): a previously scored candidate is no longer rankable. Carries a reason and no score or rank.
  SCORING_STATE_CHANGED: {
    family: "LIFECYCLE",
    sections: ["recommendation"],
    required: [
      "source.iamSourceRunId",
      "source.iamSourceVersion",
      "recommendation.scoringState",
      "recommendation.notRankableReason",
      "recommendation.scoringRunId",
      "recommendation.scoredAt",
    ],
  },
  // A governed change of the displayed priority without a new calculation (override, rank lock, emergency confirmation,
  // manual tie-break) or a rank-only change. From revision 1.0-r4c a calculated rank is no longer mandatory because an
  // emergency designation can apply to a candidate that is not ranked.
  DOMAIN_PRIORITY_CHANGED: {
    family: "LIFECYCLE",
    sections: ["recommendation"],
    required: ["source.iamSourceRunId"],
  },
  PLAN_REVISED: {
    family: "LIFECYCLE",
    sections: ["plan"],
    required: ["plan.planVersion", "plan.revisionReason", "plan.revisedBy"],
  },
  RETURNED_FOR_REVIEW: {
    family: "LIFECYCLE",
    sections: ["management"],
    required: ["management.decidedBy", "management.decidedAt", "management.decisionReason"],
    impliedLifecycleState: "CANDIDATE",
  },
  MANAGEMENT_APPROVED: {
    family: "LIFECYCLE",
    sections: ["management", "plan"],
    required: ["management.decidedBy", "management.decidedAt"],
    impliedLifecycleState: "APPROVED",
  },
  MANAGEMENT_REJECTED: {
    family: "LIFECYCLE",
    sections: ["management", "plan"],
    required: ["management.decidedBy", "management.decidedAt", "management.decisionReason"],
    impliedLifecycleState: "REJECTED",
  },
  SUPPRESSED: {
    family: "LIFECYCLE",
    sections: ["management"],
    required: ["management.decisionReason"],
    impliedLifecycleState: "SUPPRESSED",
  },
  SUPPRESSION_RELEASED: {
    family: "LIFECYCLE",
    sections: ["management"],
    // The state restored after release is the producer's fact; Data Hub does not infer it.
    required: ["management.lifecycleState"],
  },
  ESCALATED: {
    family: "LIFECYCLE",
    sections: ["management"],
    required: ["management.escalatedTo"],
    impliedLifecycleState: "ESCALATED",
  },
  RISK_ACCEPTED: {
    family: "LIFECYCLE",
    sections: ["management", "plan"],
    required: ["management.decidedBy", "management.decidedAt", "management.decisionReason"],
    impliedLifecycleState: "RISK_ACCEPTED",
  },
  DEPARTMENT_ASSIGNED: {
    family: "ASSIGNMENT",
    sections: ["assignment"],
    required: ["assignment.responsibleDepartment"],
  },
  TASK_OWNER_ASSIGNED: { family: "ASSIGNMENT", sections: ["assignment"], required: ["assignment.taskOwner"] },
  OWNER_ACCEPTED: {
    family: "ASSIGNMENT",
    sections: ["assignment", "progress"],
    required: ["assignment.taskOwner", "assignment.ownerResponseAt"],
    impliedLifecycleState: "ACTIVE",
    // An accepted action that has not begun is NOT_STARTED (4B-D3).
    allowedActionStatuses: ["NOT_STARTED"],
  },
  OWNER_DISCUSSION_REQUESTED: {
    family: "ASSIGNMENT",
    sections: ["assignment"],
    required: ["assignment.taskOwner", "assignment.discussionNote"],
  },
  ACTION_STARTED: {
    family: "ACTION_PROGRESS",
    sections: ["progress", "assignment"],
    required: ["progress.startedAt"],
    impliedLifecycleState: "ACTIVE",
  },
  ACTION_STATUS_CHANGED: {
    family: "ACTION_PROGRESS",
    sections: ["progress"],
    required: ["progress.actionStatus"],
  },
  PROGRESS_UPDATED: {
    family: "ACTION_PROGRESS",
    sections: ["progress"],
    required: ["progress.actionCompletionPct"],
  },
  CONDITION_REDUCTION_UPDATED: {
    family: "ACTION_PROGRESS",
    sections: ["progress"],
    // A percentage (negative = deterioration, 4C-D7) or the explicit NOT_MEASURABLE state.
    required: [],
    requiredOneOf: [["progress.conditionReductionPct", "progress.conditionReductionState"]],
  },
  MANAGEMENT_DECISION_REQUIRED: {
    family: "ACTION_PROGRESS",
    sections: ["progress"],
    required: ["progress.decisionRequiredReason"],
    impliedManagementDecisionRequired: true,
  },
  MANAGEMENT_DECISION_RESOLVED: {
    family: "ACTION_PROGRESS",
    sections: ["progress"],
    required: ["progress.decisionResolution"],
    impliedManagementDecisionRequired: false,
  },
  PAUSE_REQUESTED: {
    family: "ACTION_PROGRESS",
    sections: ["progress"],
    required: ["progress.pauseReason", "progress.pauseRequestedBy"],
  },
  PAUSE_APPROVED: {
    family: "ACTION_PROGRESS",
    sections: ["progress", "management"],
    required: ["management.decidedBy", "management.decidedAt", "management.decisionReason"],
  },
  PAUSE_DENIED: {
    family: "ACTION_PROGRESS",
    sections: ["progress", "management"],
    required: ["management.decidedBy", "management.decidedAt", "management.decisionReason"],
  },
  ACTION_PAUSED: {
    family: "ACTION_PROGRESS",
    sections: ["progress"],
    required: ["progress.statusReason"],
    impliedActionStatus: "PAUSED",
  },
  ACTION_REACTIVATED: {
    family: "ACTION_PROGRESS",
    sections: ["progress"],
    required: [],
    impliedLifecycleState: "ACTIVE",
  },
  ACTION_BLOCKED: {
    family: "ACTION_PROGRESS",
    sections: ["progress"],
    required: ["progress.blockedReason"],
    impliedActionStatus: "BLOCKED",
  },
  ACTION_COMPLETED: {
    family: "ACTION_PROGRESS",
    sections: ["progress", "learning"],
    required: ["progress.actionCompletionPct", "progress.completedAt"],
    impliedLifecycleState: "COMPLETED",
    impliedActionStatus: "COMPLETED",
  },
  OUTCOME_VALIDATED: {
    family: "CLOSURE_RECURRENCE",
    sections: ["outcome", "closeout", "learning"],
    required: ["outcome.outcomeState", "outcome.validatedAt"],
    impliedLifecycleState: "OUTCOME_VALIDATED",
  },
  // Stage 4E: formal closeout review opened on an execution-complete candidate. The candidate stays COMPLETED (not closed).
  CLOSEOUT_STARTED: {
    family: "CLOSURE_RECURRENCE",
    sections: ["closeout"],
    required: ["closeout.closeoutId", "closeout.closeoutVersion", "closeout.closeoutPhase"],
  },
  // Stage 4E: management approved one closeout version (system recommendation and approved status are both kept). Not yet closed.
  CLOSEOUT_APPROVED: {
    family: "CLOSURE_RECURRENCE",
    sections: ["closeout", "outcome"],
    required: ["closeout.closeoutId", "closeout.closeoutVersion", "closeout.finalResolutionStatus", "closeout.approvedBy", "closeout.approvedAt", "closeout.attributionCategory"],
  },
  // Stage 4E: a descriptive learning record was captured (evidence only).
  LEARNING_RECORDED: {
    family: "CLOSURE_RECURRENCE",
    sections: ["learning", "closeout"],
    required: ["learning.learningRecordId", "closeout.closeoutId"],
  },
  CLOSEOUT_COMPLETED: {
    family: "CLOSURE_RECURRENCE",
    sections: ["closeout", "outcome", "learning"],
    required: ["closeout.closeoutAt", "closeout.finalResolutionStatus"],
    impliedLifecycleState: "CLOSED",
  },
  RECURRENCE_LINKED: {
    family: "CLOSURE_RECURRENCE",
    sections: ["recurrence", "learning"],
    required: ["recurrence.priorCandidateId"],
  },
};

export function iamEventSections(eventType: IamEventType): readonly IamPayloadSection[] {
  return [...COMMON_SECTIONS, ...IAM_EVENT_SPECS[eventType].sections];
}

export type IamIssueCode =
  | "INVALID_BODY"
  | "CONTRACT_ID_MISMATCH"
  | "UNSUPPORTED_CONTRACT_VERSION"
  | "UNSUPPORTED_EVENT_TYPE"
  | "WRONG_ORIGINATING_MODULE"
  | "REQUIRED_FIELD_MISSING"
  | "INVALID_TYPE"
  | "INVALID_ENUM"
  | "OUT_OF_RANGE"
  | "INVALID_DATE"
  | "SECTION_NOT_ALLOWED_FOR_EVENT_TYPE"
  | "STATE_CONFLICT"
  | "OPERATING_PERIOD_INVALID"
  | "RECURRENCE_SELF_REFERENCE";

export type IamValidationIssue = { path: string; code: IamIssueCode; message: string };

export type IamAuthorizedDocument = Record<IamPayloadSection, Record<string, unknown>>;

export type IamValidationResult =
  | {
      ok: true;
      eventType: IamEventType;
      contractVersion: IamResultsReturnVersion;
      producerEventId: string;
      candidateId: string;
      producerEventAt: Date;
      authorized: IamAuthorizedDocument;
    }
  | { ok: false; issues: IamValidationIssue[]; producerEventId: string | null; eventType: string | null };

const MAX_SHORT = 500;
const MAX_LONG = 4000;
const MAX_ARRAY = 100;

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function parseIsoDate(value: string): Date | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const d = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== value) return null;
  return d;
}

function coerceField(
  path: string,
  spec: IamFieldSpec,
  raw: unknown,
  issues: IamValidationIssue[]
): { keep: boolean; value?: unknown } {
  if (raw === undefined || raw === null) return { keep: false };
  const bad = (code: IamIssueCode, message: string) => {
    issues.push({ path, code, message });
    return { keep: false };
  };
  switch (spec.type) {
    case "string":
    case "longString": {
      if (typeof raw !== "string") return bad("INVALID_TYPE", `${path} must be a string`);
      const v = raw.trim();
      if (!v) return { keep: false };
      const max = spec.type === "string" ? MAX_SHORT : MAX_LONG;
      if (v.length > max) return bad("OUT_OF_RANGE", `${path} exceeds ${max} characters`);
      return { keep: true, value: v };
    }
    case "enum": {
      if (typeof raw !== "string") return bad("INVALID_TYPE", `${path} must be a string`);
      const v = raw.trim().toUpperCase().replace(/[\s-]+/g, "_");
      if (!v) return { keep: false };
      if (!spec.values!.includes(v)) {
        return bad("INVALID_ENUM", `${path} must be one of ${spec.values!.join(", ")}`);
      }
      return { keep: true, value: v };
    }
    case "datetime": {
      if (typeof raw !== "string") return bad("INVALID_TYPE", `${path} must be an ISO-8601 date-time string`);
      const v = raw.trim();
      if (!v) return { keep: false };
      const t = /^\d{4}-\d{2}-\d{2}T/.test(v) ? new Date(v) : null;
      if (!t || Number.isNaN(t.getTime())) return bad("INVALID_DATE", `${path} must be an ISO-8601 date-time`);
      return { keep: true, value: t.toISOString() };
    }
    case "date": {
      if (typeof raw !== "string") return bad("INVALID_TYPE", `${path} must be a YYYY-MM-DD date string`);
      const v = raw.trim();
      if (!v) return { keep: false };
      if (!parseIsoDate(v)) return bad("INVALID_DATE", `${path} must be a valid YYYY-MM-DD date`);
      return { keep: true, value: v };
    }
    case "percent": {
      if (typeof raw !== "number" || !Number.isFinite(raw)) return bad("INVALID_TYPE", `${path} must be a finite number`);
      if (raw < 0 || raw > 100) return bad("OUT_OF_RANGE", `${path} must be between 0 and 100`);
      return { keep: true, value: raw };
    }
    case "signedPercent": {
      if (typeof raw !== "number" || !Number.isFinite(raw)) return bad("INVALID_TYPE", `${path} must be a finite number`);
      if (raw > 100) return bad("OUT_OF_RANGE", `${path} must not exceed 100 (a negative value means the condition worsened)`);
      return { keep: true, value: raw };
    }
    case "number": {
      if (typeof raw !== "number" || !Number.isFinite(raw)) return bad("INVALID_TYPE", `${path} must be a finite number`);
      return { keep: true, value: raw };
    }
    case "numberMap": {
      if (!isPlainObject(raw)) return bad("INVALID_TYPE", `${path} must be an object of numbers`);
      const keys = Object.keys(raw);
      if (keys.length > MAX_ARRAY) return bad("OUT_OF_RANGE", `${path} exceeds ${MAX_ARRAY} entries`);
      const out: Record<string, number> = {};
      for (const key of keys.sort()) {
        const v = raw[key];
        if (typeof v !== "number" || !Number.isFinite(v)) return bad("INVALID_TYPE", `${path}.${key} must be a finite number`);
        out[key] = v;
      }
      return Object.keys(out).length ? { keep: true, value: out } : { keep: false };
    }
    case "nonNegNumber": {
      if (typeof raw !== "number" || !Number.isFinite(raw)) return bad("INVALID_TYPE", `${path} must be a finite number`);
      if (raw < 0) return bad("OUT_OF_RANGE", `${path} must not be negative`);
      return { keep: true, value: raw };
    }
    case "positiveInt": {
      if (typeof raw !== "number" || !Number.isInteger(raw)) return bad("INVALID_TYPE", `${path} must be an integer`);
      if (raw < 1) return bad("OUT_OF_RANGE", `${path} must be 1 or greater`);
      return { keep: true, value: raw };
    }
    case "boolean": {
      if (typeof raw !== "boolean") return bad("INVALID_TYPE", `${path} must be true or false`);
      return { keep: true, value: raw };
    }
    case "stringArray": {
      if (!Array.isArray(raw)) return bad("INVALID_TYPE", `${path} must be an array of strings`);
      if (raw.length > MAX_ARRAY) return bad("OUT_OF_RANGE", `${path} exceeds ${MAX_ARRAY} entries`);
      const out: string[] = [];
      for (const entry of raw) {
        if (typeof entry !== "string") return bad("INVALID_TYPE", `${path} must contain only strings`);
        const v = entry.trim();
        if (v.length > MAX_SHORT) return bad("OUT_OF_RANGE", `${path} entries must not exceed ${MAX_SHORT} characters`);
        if (v) out.push(v);
      }
      return out.length ? { keep: true, value: out } : { keep: false };
    }
    case "stringMap": {
      if (!isPlainObject(raw)) return bad("INVALID_TYPE", `${path} must be an object of strings`);
      const keys = Object.keys(raw);
      if (keys.length > MAX_ARRAY) return bad("OUT_OF_RANGE", `${path} exceeds ${MAX_ARRAY} entries`);
      const out: Record<string, string> = {};
      for (const key of keys.sort()) {
        const v = raw[key];
        if (typeof v !== "string") return bad("INVALID_TYPE", `${path}.${key} must be a string`);
        const t = v.trim();
        if (t.length > MAX_SHORT) return bad("OUT_OF_RANGE", `${path}.${key} exceeds ${MAX_SHORT} characters`);
        if (t) out[key] = t;
      }
      return Object.keys(out).length ? { keep: true, value: out } : { keep: false };
    }
  }
}

function emptyDocument(): IamAuthorizedDocument {
  const doc = {} as IamAuthorizedDocument;
  for (const section of IAM_PAYLOAD_SECTIONS) doc[section] = {};
  return doc;
}

// ---------------------------------------------------------------------------------------------------------------
// Company-local weekly operating period and Sunday authoritative refresh (Stage 3 decision S3-D5)
//
// Rule: the authoritative IAM refresh runs at 02:00 company-local time on Sunday, after Saturday close.
//  - The company time zone is an IANA identifier (for example "America/Chicago"). UTC is never assumed: a missing,
//    invalid or unavailable time zone yields NO schedule (status MISSING / INVALID / UNAVAILABLE), never a fallback.
//  - The operating week is Sunday-Saturday in the company-local calendar.
//  - DST: a local time that does not exist (spring-forward gap, 02:00 in most US zones on the changeover Sunday)
//    runs at the first instant after the gap (for example 03:00 local); a local time that occurs twice (fall back)
//    runs at its first occurrence. Both rules are deterministic and covered by tests.
//  - The hour is a parameter (default 2) so it can become per-company configuration later.
// ---------------------------------------------------------------------------------------------------------------

export const IAM_REFRESH_DEFAULT_LOCAL_HOUR = 2;
export const IAM_REFRESH_DAY_OF_WEEK = "SUNDAY" as const;

const IANA_SHAPE = /^[A-Za-z][A-Za-z0-9_+\-]*(\/[A-Za-z0-9_+\-]+)*$/;

/** True for a time zone identifier the runtime's IANA database recognizes (offsets such as "+05:00" are rejected). */
export function isValidIanaTimeZone(value: unknown): value is string {
  if (typeof value !== "string") return false;
  const tz = value.trim();
  if (!tz || tz !== value || !IANA_SHAPE.test(tz)) return false;
  try {
    return Boolean(new Intl.DateTimeFormat("en-US", { timeZone: tz }).resolvedOptions().timeZone);
  } catch {
    return false;
  }
}

type LocalParts = { year: number; month: number; day: number; hour: number; minute: number; second: number; weekday: number };

const WEEKDAY_INDEX: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
const formatterCache = new Map<string, Intl.DateTimeFormat>();

function localParts(ms: number, timeZone: string): LocalParts {
  let f = formatterCache.get(timeZone);
  if (!f) {
    f = new Intl.DateTimeFormat("en-US", {
      timeZone,
      hourCycle: "h23",
      weekday: "short",
      year: "numeric",
      month: "numeric",
      day: "numeric",
      hour: "numeric",
      minute: "numeric",
      second: "numeric",
    });
    formatterCache.set(timeZone, f);
  }
  const out: Record<string, string> = {};
  for (const p of f.formatToParts(new Date(ms))) out[p.type] = p.value;
  return {
    year: Number(out.year),
    month: Number(out.month),
    day: Number(out.day),
    hour: Number(out.hour) % 24,
    minute: Number(out.minute),
    second: Number(out.second),
    weekday: WEEKDAY_INDEX[out.weekday!]!,
  };
}

function wallClockMs(p: LocalParts): number {
  return Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
}

function offsetMs(ms: number, timeZone: string): number {
  return wallClockMs(localParts(ms, timeZone)) - Math.floor(ms / 1000) * 1000;
}

/** UTC instant of a company-local wall-clock time, with the documented DST gap and overlap rules. */
function zonedLocalToUtcMs(year: number, month: number, day: number, hour: number, minute: number, timeZone: string): number {
  const naive = Date.UTC(year, month - 1, day, hour, minute, 0);
  const offsets = new Set([offsetMs(naive - 36 * 3_600_000, timeZone), offsetMs(naive + 36 * 3_600_000, timeZone), offsetMs(naive, timeZone)]);
  const valid: number[] = [];
  for (const off of offsets) {
    const candidate = naive - off;
    if (wallClockMs(localParts(candidate, timeZone)) === naive) valid.push(candidate);
  }
  if (valid.length > 0) return Math.min(...valid); // overlap: first occurrence
  // Gap: the requested wall-clock time does not exist. Use the first instant after the gap.
  let lo = naive - Math.max(...offsets); // wall clock < naive (before the gap)
  let hi = naive - Math.min(...offsets); // wall clock > naive (after the gap)
  while (hi - lo > 1000) {
    const mid = Math.floor((lo + hi) / 2);
    if (wallClockMs(localParts(mid, timeZone)) >= naive) hi = mid;
    else lo = mid;
  }
  return Math.ceil(hi / 60_000) * 60_000;
}

const isoDateOf = (ms: number) => new Date(ms).toISOString().slice(0, 10);

/** Sunday-Saturday operating week containing `at`, as company-local calendar dates. */
export function iamOperatingPeriodFor(at: Date, timeZone: string): { start: string; end: string } {
  if (!isValidIanaTimeZone(timeZone)) throw new RangeError(`Invalid IANA time zone: ${String(timeZone)}`);
  const p = localParts(at.getTime(), timeZone);
  const start = Date.UTC(p.year, p.month - 1, p.day - p.weekday);
  return { start: isoDateOf(start), end: isoDateOf(start + 6 * 86_400_000) };
}

export function isIamOperatingWeek(start: string, end: string): boolean {
  const s = parseIsoDate(start);
  const e = parseIsoDate(end);
  if (!s || !e) return false;
  return s.getUTCDay() === 0 && e.getTime() - s.getTime() === 6 * 86_400_000;
}

/**
 * First authoritative weekly refresh instant strictly after `at`: Sunday at `hourLocal`:00 in the company's time
 * zone (after Saturday close). Throws RangeError for an invalid time zone or hour (callers resolve the schedule first).
 */
export function nextIamAuthoritativeRefreshAfter(at: Date, timeZone: string, hourLocal: number = IAM_REFRESH_DEFAULT_LOCAL_HOUR): Date {
  if (!isValidIanaTimeZone(timeZone)) throw new RangeError(`Invalid IANA time zone: ${String(timeZone)}`);
  if (!Number.isInteger(hourLocal) || hourLocal < 0 || hourLocal > 23) throw new RangeError(`Invalid local refresh hour: ${String(hourLocal)}`);
  const p = localParts(at.getTime(), timeZone);
  const daysToSunday = (7 - p.weekday) % 7;
  for (const extra of [0, 7]) {
    const day = new Date(Date.UTC(p.year, p.month - 1, p.day + daysToSunday + extra));
    const instant = zonedLocalToUtcMs(day.getUTCFullYear(), day.getUTCMonth() + 1, day.getUTCDate(), hourLocal, 0, timeZone);
    if (instant > at.getTime()) return new Date(instant);
  }
  throw new Error("unreachable: a Sunday refresh always exists within the next 14 days");
}

export type IamRefreshSchedule = {
  timeZone: string;
  refreshDayOfWeek: typeof IAM_REFRESH_DAY_OF_WEEK;
  refreshHourLocal: number;
  refreshMinuteLocal: 0;
};

export type IamRefreshScheduleResolution =
  | { ok: true; schedule: IamRefreshSchedule }
  | { ok: false; status: "MISSING" | "INVALID" | "UNAVAILABLE"; reason: string };

/** Explicit, documented rule for the company time zone: no silent UTC fallback. */
export function resolveIamRefreshSchedule(input: {
  timeZoneStatus: "OK" | "MISSING" | "UNAVAILABLE";
  timeZone?: string | null;
  hourLocal?: number;
}): IamRefreshScheduleResolution {
  if (input.timeZoneStatus === "UNAVAILABLE") {
    return { ok: false, status: "UNAVAILABLE", reason: "The company time zone could not be read; no refresh schedule is calculated (UTC is not assumed)" };
  }
  if (input.timeZoneStatus === "MISSING" || input.timeZone === undefined || input.timeZone === null || input.timeZone === "") {
    return { ok: false, status: "MISSING", reason: "No company time zone is configured; no refresh schedule is calculated (UTC is not assumed)" };
  }
  if (!isValidIanaTimeZone(input.timeZone)) {
    return { ok: false, status: "INVALID", reason: `"${String(input.timeZone)}" is not a recognized IANA time zone; no refresh schedule is calculated` };
  }
  const hour = input.hourLocal ?? IAM_REFRESH_DEFAULT_LOCAL_HOUR;
  if (!Number.isInteger(hour) || hour < 0 || hour > 23) {
    return { ok: false, status: "INVALID", reason: `Local refresh hour ${String(hour)} is not an integer from 0 to 23` };
  }
  return { ok: true, schedule: { timeZone: input.timeZone, refreshDayOfWeek: IAM_REFRESH_DAY_OF_WEEK, refreshHourLocal: hour, refreshMinuteLocal: 0 } };
}

/**
 * Validate and normalize one IAM Results Return payload. Pure: no I/O, no clock, no persistence.
 * Unknown sections/fields are stripped; the returned `authorized` document is what is hashed and stored.
 */
export function validateIamResultsReturn(body: unknown): IamValidationResult {
  const issues: IamValidationIssue[] = [];
  if (!isPlainObject(body)) {
    return {
      ok: false,
      issues: [{ path: "$", code: "INVALID_BODY", message: "Request body must be a JSON object" }],
      producerEventId: null,
      eventType: null,
    };
  }
  const authorized = emptyDocument();
  const nonEmptySections = new Set<IamPayloadSection>();
  for (const section of IAM_PAYLOAD_SECTIONS) {
    const rawSection = body[section];
    if (rawSection === undefined || rawSection === null) continue;
    if (!isPlainObject(rawSection)) {
      issues.push({ path: section, code: "INVALID_TYPE", message: `${section} must be an object` });
      continue;
    }
    const fields = IAM_AUTHORIZED_FIELDS[section];
    for (const key of Object.keys(fields)) {
      const coerced = coerceField(`${section}.${key}`, fields[key]!, rawSection[key], issues);
      if (coerced.keep) {
        authorized[section][key] = coerced.value;
        nonEmptySections.add(section);
      }
    }
  }

  const env = authorized.envelope;
  const producerEventId = typeof env.producerEventId === "string" ? env.producerEventId : null;
  const rawEventType = typeof env.eventType === "string" ? env.eventType.trim().toUpperCase() : null;

  if (!producerEventId) {
    issues.push({ path: "envelope.producerEventId", code: "REQUIRED_FIELD_MISSING", message: "envelope.producerEventId is required" });
  }
  if (!env.contractId) {
    issues.push({ path: "envelope.contractId", code: "REQUIRED_FIELD_MISSING", message: "envelope.contractId is required" });
  } else if (env.contractId !== IAM_RESULTS_RETURN_V1) {
    issues.push({
      path: "envelope.contractId",
      code: "CONTRACT_ID_MISMATCH",
      message: `envelope.contractId must be ${IAM_RESULTS_RETURN_V1}`,
    });
  }
  if (!env.contractVersion) {
    issues.push({ path: "envelope.contractVersion", code: "REQUIRED_FIELD_MISSING", message: "envelope.contractVersion is required" });
  } else if (!(IAM_RESULTS_RETURN_SUPPORTED_VERSIONS as readonly string[]).includes(String(env.contractVersion))) {
    issues.push({
      path: "envelope.contractVersion",
      code: "UNSUPPORTED_CONTRACT_VERSION",
      message: `Unsupported contract version ${String(env.contractVersion)}; supported: ${IAM_RESULTS_RETURN_SUPPORTED_VERSIONS.join(", ")}`,
    });
  }
  if (!env.originatingModule) {
    issues.push({ path: "envelope.originatingModule", code: "REQUIRED_FIELD_MISSING", message: "envelope.originatingModule is required" });
  } else if (String(env.originatingModule).toUpperCase() !== IAM_ORIGINATING_MODULE) {
    issues.push({
      path: "envelope.originatingModule",
      code: "WRONG_ORIGINATING_MODULE",
      message: `envelope.originatingModule must be ${IAM_ORIGINATING_MODULE}`,
    });
  }
  for (const path of ["envelope.producerEventAt", "envelope.producerVersion", "subject.candidateId"]) {
    const [section, field] = path.split(".") as [IamPayloadSection, string];
    if (authorized[section][field] === undefined) {
      issues.push({ path, code: "REQUIRED_FIELD_MISSING", message: `${path} is required` });
    }
  }

  let eventType: IamEventType | null = null;
  if (!rawEventType) {
    issues.push({ path: "envelope.eventType", code: "REQUIRED_FIELD_MISSING", message: "envelope.eventType is required" });
  } else if (!(IAM_EVENT_TYPES as readonly string[]).includes(rawEventType)) {
    issues.push({
      path: "envelope.eventType",
      code: "UNSUPPORTED_EVENT_TYPE",
      message: `Unsupported eventType ${rawEventType}`,
    });
  } else {
    eventType = rawEventType as IamEventType;
    authorized.envelope.eventType = eventType;
  }

  if (eventType) {
    const spec = IAM_EVENT_SPECS[eventType];
    const allowed = new Set(iamEventSections(eventType));
    for (const section of nonEmptySections) {
      if (!allowed.has(section)) {
        issues.push({
          path: section,
          code: "SECTION_NOT_ALLOWED_FOR_EVENT_TYPE",
          message: `Section ${section} is not accepted on ${eventType}`,
        });
      }
    }
    for (const path of spec.required) {
      const [section, field] = path.split(".") as [IamPayloadSection, string];
      if (authorized[section][field] === undefined) {
        issues.push({ path, code: "REQUIRED_FIELD_MISSING", message: `${path} is required for ${eventType}` });
      }
    }
    for (const group of spec.requiredOneOf ?? []) {
      if (!group.some((path) => { const [s, fld] = path.split(".") as [IamPayloadSection, string]; return authorized[s][fld] !== undefined; })) {
        issues.push({ path: group.join(" | "), code: "REQUIRED_FIELD_MISSING", message: `${eventType} requires at least one of: ${group.join(", ")}` });
      }
    }
    const scoringState = authorized.recommendation.scoringState;
    if (eventType === "SCORING_STATE_CHANGED" && scoringState !== undefined && scoringState !== "UNSCORED" && scoringState !== "NOT_RANKABLE") {
      issues.push({ path: "recommendation.scoringState", code: "STATE_CONFLICT", message: "SCORING_STATE_CHANGED publishes UNSCORED or NOT_RANKABLE; a candidate that is scored again is published by CANDIDATE_SCORED" });
    }
    if (eventType === "SCORING_STATE_CHANGED") {
      for (const field of ["domainScore", "domainRank", "priorityBand", "displayedDomainRank", "uncappedDomainScore"]) {
        if (authorized.recommendation[field] !== undefined) {
          issues.push({ path: `recommendation.${field}`, code: "STATE_CONFLICT", message: `An UNSCORED / NOT_RANKABLE candidate carries no current ${field}; never fabricate one (use the lastValid* metadata for history)` });
        }
      }
    }
    if (eventType === "CANDIDATE_SCORED" && scoringState !== undefined && scoringState !== "SCORED") {
      issues.push({ path: "recommendation.scoringState", code: "STATE_CONFLICT", message: "CANDIDATE_SCORED publishes a SCORED candidate" });
    }
    if (authorized.progress.conditionReductionState === "NOT_MEASURABLE" && authorized.progress.conditionReductionPct !== undefined) {
      issues.push({
        path: "progress.conditionReductionPct",
        code: "STATE_CONFLICT",
        message: "A NOT_MEASURABLE condition reduction carries no percentage; never fabricate one",
      });
    }
    const lifecycle = authorized.management.lifecycleState;
    if (spec.impliedLifecycleState && lifecycle !== undefined && lifecycle !== spec.impliedLifecycleState) {
      issues.push({
        path: "management.lifecycleState",
        code: "STATE_CONFLICT",
        message: `${eventType} implies lifecycle state ${spec.impliedLifecycleState}, not ${String(lifecycle)}`,
      });
    }
    const actionStatus = authorized.progress.actionStatus;
    if (spec.impliedActionStatus && actionStatus !== undefined && actionStatus !== spec.impliedActionStatus) {
      issues.push({
        path: "progress.actionStatus",
        code: "STATE_CONFLICT",
        message: `${eventType} implies action status ${spec.impliedActionStatus}, not ${String(actionStatus)}`,
      });
    }
    if (spec.allowedActionStatuses && actionStatus !== undefined && !spec.allowedActionStatuses.includes(actionStatus as IamActionStatus)) {
      issues.push({
        path: "progress.actionStatus",
        code: "STATE_CONFLICT",
        message: `${eventType} accepts only action status ${spec.allowedActionStatuses.join(", ")}, not ${String(actionStatus)}`,
      });
    }
    const decisionFlag = authorized.progress.managementDecisionRequired;
    if (spec.impliedManagementDecisionRequired !== undefined) {
      if (decisionFlag !== undefined && decisionFlag !== spec.impliedManagementDecisionRequired) {
        issues.push({
          path: "progress.managementDecisionRequired",
          code: "STATE_CONFLICT",
          message: `${eventType} implies managementDecisionRequired=${String(spec.impliedManagementDecisionRequired)}, not ${String(decisionFlag)}`,
        });
      }
    } else {
      for (const field of ["managementDecisionRequired", "decisionRequiredCategory", "decisionResolution"]) {
        if (authorized.progress[field] !== undefined) {
          issues.push({
            path: `progress.${field}`,
            code: "STATE_CONFLICT",
            message: `progress.${field} is accepted only on MANAGEMENT_DECISION_REQUIRED / MANAGEMENT_DECISION_RESOLVED, not on ${eventType}`,
          });
        }
      }
    }
    if (authorized.closeout.conditionReductionState === "NOT_MEASURABLE" && authorized.closeout.conditionReductionPct !== undefined) {
      issues.push({
        path: "closeout.conditionReductionPct",
        code: "STATE_CONFLICT",
        message: "A NOT_MEASURABLE closeout condition reduction carries no percentage; never fabricate one",
      });
    }
    const phase = authorized.closeout.closeoutPhase;
    const phaseByEvent: Partial<Record<IamEventType, string>> = { CLOSEOUT_STARTED: "STARTED", CLOSEOUT_APPROVED: "APPROVED", CLOSEOUT_COMPLETED: "COMPLETED" };
    if (phase !== undefined && phaseByEvent[eventType] !== undefined && phase !== phaseByEvent[eventType]) {
      issues.push({ path: "closeout.closeoutPhase", code: "STATE_CONFLICT", message: `${eventType} implies closeoutPhase ${phaseByEvent[eventType]}, not ${String(phase)}` });
    }
    if (eventType === "RECURRENCE_LINKED" && authorized.recurrence.priorCandidateId === authorized.subject.candidateId) {
      issues.push({
        path: "recurrence.priorCandidateId",
        code: "RECURRENCE_SELF_REFERENCE",
        message: "A recurrence must create a new candidate identity; it cannot reference itself",
      });
    }
  }

  const src = authorized.source;
  const start = src.operatingPeriodStart as string | undefined;
  const end = src.operatingPeriodEnd as string | undefined;
  if (src.refreshKind === "SCHEDULED_WEEKLY" && (!start || !end)) {
    issues.push({
      path: "source.operatingPeriodStart",
      code: "OPERATING_PERIOD_INVALID",
      message: "SCHEDULED_WEEKLY refresh requires operatingPeriodStart and operatingPeriodEnd (Sunday-Saturday)",
    });
  } else if ((start || end) && !(start && end && isIamOperatingWeek(start, end))) {
    issues.push({
      path: "source.operatingPeriodStart",
      code: "OPERATING_PERIOD_INVALID",
      message: "Operating period must be one Sunday-Saturday week (start on Sunday, end on the following Saturday)",
    });
  }

  if (issues.length > 0 || !eventType || !producerEventId) {
    return { ok: false, issues, producerEventId, eventType: rawEventType };
  }
  return {
    ok: true,
    eventType,
    contractVersion: String(env.contractVersion) as IamResultsReturnVersion,
    producerEventId,
    candidateId: String(authorized.subject.candidateId),
    producerEventAt: new Date(String(env.producerEventAt)),
    authorized,
  };
}

// ---------------------------------------------------------------------------------------------------------------
// Acknowledgement, failure classification and IAM-side sync status
// ---------------------------------------------------------------------------------------------------------------

export const IAM_FAILURE_CATEGORIES = ["TEMPORARY_TECHNICAL", "DATA_VALIDATION", "CONFIGURATION_SYSTEM"] as const;
export type IamFailureCategory = (typeof IAM_FAILURE_CATEGORIES)[number];

export const IAM_RETRY_GUIDANCE = [
  /** Accepted; nothing to retry. */
  "NONE",
  /** Temporary technical failure: retry automatically with the same producerEventId and payload. */
  "RETRY_AUTOMATIC",
  /** Data/validation failure: do not retry blindly; correct the event, then resubmit. */
  "CORRECT_THEN_RESUBMIT",
  /** Configuration/system failure: an administrator must act; then retry the preserved event. */
  "ADMIN_ACTION_THEN_RETRY",
] as const;
export type IamRetryGuidance = (typeof IAM_RETRY_GUIDANCE)[number];

export type IamProcessingResult = "ACCEPTED" | "IDEMPOTENT_REPLAY" | "REJECTED";

export type IamRejection = {
  category: IamFailureCategory;
  reasonCode: string;
  message: string;
  issues?: IamValidationIssue[];
};

/** Deterministic acknowledgement. Contains no internal identifiers beyond the event/ack ids the producer needs. */
export type IamResultsReturnAcknowledgement = {
  accepted: boolean;
  processingResult: IamProcessingResult;
  /** True when this is a safe replay of an already accepted event (no second write). */
  duplicate: boolean;
  producerEventId: string | null;
  eventType: string | null;
  contractId: string;
  contractVersion: string | null;
  resultsReturnEventId: string | null;
  acknowledgementId: string | null;
  payloadHash: string | null;
  receivedAt: string | null;
  rejection: IamRejection | null;
  retryGuidance: IamRetryGuidance;
};

export function iamAcknowledgementHttpStatus(ack: IamResultsReturnAcknowledgement): number {
  if (ack.processingResult === "ACCEPTED") return 201;
  if (ack.processingResult === "IDEMPOTENT_REPLAY") return 200;
  const rejection = ack.rejection;
  if (!rejection) return 500;
  if (rejection.category === "TEMPORARY_TECHNICAL") return 503;
  if (rejection.category === "CONFIGURATION_SYSTEM") return 409;
  if (rejection.reasonCode === "PAYLOAD_CONFLICT" || rejection.reasonCode.startsWith("CANDIDATE_")) return 409;
  return 422;
}

export function retryGuidanceFor(category: IamFailureCategory): IamRetryGuidance {
  switch (category) {
    case "TEMPORARY_TECHNICAL":
      return "RETRY_AUTOMATIC";
    case "DATA_VALIDATION":
      return "CORRECT_THEN_RESUBMIT";
    case "CONFIGURATION_SYSTEM":
      return "ADMIN_ACTION_THEN_RETRY";
  }
}

export const IAM_SYNC_STATES = [
  /** Preserved locally, not yet attempted. */
  "PENDING",
  /** Accepted by Data Hub. */
  "SYNCED",
  /** Temporary failure: automatic retry scheduled. UI label: "Data Hub Sync Pending". */
  "SYNC_PENDING_RETRY",
  /** Data/validation failure: blind retry stopped. UI label: "Correction required". */
  "REJECTED_CORRECTION_REQUIRED",
  /** Configuration/system failure: administrator alerted, event preserved. */
  "BLOCKED_ADMIN_ACTION",
] as const;
export type IamSyncState = (typeof IAM_SYNC_STATES)[number];

export const IAM_SYNC_STATE_LABELS: Record<IamSyncState, string> = {
  PENDING: "Data Hub Sync Pending",
  SYNCED: "Synced to Data Hub",
  SYNC_PENDING_RETRY: "Data Hub Sync Pending",
  REJECTED_CORRECTION_REQUIRED: "Correction required",
  BLOCKED_ADMIN_ACTION: "Administrator action required",
};

export type IamSubmissionOutcome = {
  syncState: IamSyncState;
  failureCategory: IamFailureCategory | null;
  failureReasonCode: string | null;
  failureReason: string | null;
  retryGuidance: IamRetryGuidance;
  /** Producer must keep the event and retry on its own schedule. */
  automaticRetry: boolean;
  manualCorrectionNeeded: boolean;
  adminAlertRequired: boolean;
};

/**
 * Classify the result of one submission attempt. The acknowledgement category is authoritative when present;
 * otherwise the transport outcome decides (network error/timeout/5xx/429 => temporary; 401/403 => configuration;
 * other 4xx => data/validation). Never returns "discard": every failure keeps the event.
 */
export function classifyIamSubmissionResult(input: {
  httpStatus?: number | null;
  networkError?: boolean;
  timedOut?: boolean;
  acknowledgement?: Pick<IamResultsReturnAcknowledgement, "accepted" | "rejection"> | null;
}): IamSubmissionOutcome {
  const ack = input.acknowledgement ?? null;
  if (ack?.accepted) {
    return {
      syncState: "SYNCED",
      failureCategory: null,
      failureReasonCode: null,
      failureReason: null,
      retryGuidance: "NONE",
      automaticRetry: false,
      manualCorrectionNeeded: false,
      adminAlertRequired: false,
    };
  }
  let category: IamFailureCategory;
  let reasonCode: string;
  let reason: string;
  if (ack?.rejection) {
    category = ack.rejection.category;
    reasonCode = ack.rejection.reasonCode;
    reason = ack.rejection.message;
  } else if (input.networkError || input.timedOut) {
    category = "TEMPORARY_TECHNICAL";
    reasonCode = input.timedOut ? "TIMEOUT" : "NETWORK_ERROR";
    reason = input.timedOut ? "Data Hub did not respond in time" : "Data Hub could not be reached";
  } else {
    const status = input.httpStatus ?? 0;
    if (status === 401 || status === 403) {
      category = "CONFIGURATION_SYSTEM";
      reasonCode = status === 401 ? "NOT_AUTHENTICATED" : "NOT_AUTHORIZED";
      reason = "The IAM service identity is not authenticated or authorized for Data Hub Results Return";
    } else if (status === 408 || status === 429 || status >= 500 || status === 0) {
      category = "TEMPORARY_TECHNICAL";
      reasonCode = status === 0 ? "NO_RESPONSE" : `HTTP_${status}`;
      reason = "Data Hub is temporarily unavailable";
    } else {
      category = "DATA_VALIDATION";
      reasonCode = `HTTP_${status}`;
      reason = "Data Hub rejected the event";
    }
  }
  const retryGuidance = retryGuidanceFor(category);
  return {
    syncState:
      category === "TEMPORARY_TECHNICAL"
        ? "SYNC_PENDING_RETRY"
        : category === "DATA_VALIDATION"
          ? "REJECTED_CORRECTION_REQUIRED"
          : "BLOCKED_ADMIN_ACTION",
    failureCategory: category,
    failureReasonCode: reasonCode,
    failureReason: reason,
    retryGuidance,
    automaticRetry: category === "TEMPORARY_TECHNICAL",
    manualCorrectionNeeded: category === "DATA_VALIDATION",
    adminAlertRequired: category === "CONFIGURATION_SYSTEM",
  };
}

/** IAM-side retained record, one per producer event. Model for the later Sync drill-down UI (no UI here). */
export type IamSyncRecord = {
  producerEventId: string;
  eventType: string;
  candidateId: string | null;
  firstAttemptAt: string;
  lastAttemptAt: string;
  attemptCount: number;
  syncState: IamSyncState;
  /** accepted | rejected | pending */
  disposition: "ACCEPTED" | "REJECTED" | "PENDING";
  failureCategory: IamFailureCategory | null;
  failureReasonCode: string | null;
  failureReason: string | null;
  retryState: "NONE" | "AUTOMATIC_RETRY_SCHEDULED" | "STOPPED_PENDING_CORRECTION" | "STOPPED_PENDING_ADMIN";
  manualCorrectionNeeded: boolean;
  adminAlertRaised: boolean;
  eventualAcceptedAt: string | null;
};

export function newIamSyncRecord(input: { producerEventId: string; eventType: string; candidateId?: string | null; at: string }): IamSyncRecord {
  return {
    producerEventId: input.producerEventId,
    eventType: input.eventType,
    candidateId: input.candidateId ?? null,
    firstAttemptAt: input.at,
    lastAttemptAt: input.at,
    attemptCount: 0,
    syncState: "PENDING",
    disposition: "PENDING",
    failureCategory: null,
    failureReasonCode: null,
    failureReason: null,
    retryState: "AUTOMATIC_RETRY_SCHEDULED",
    manualCorrectionNeeded: false,
    adminAlertRaised: false,
    eventualAcceptedAt: null,
  };
}

/** Apply one attempt outcome to the retained record. Pure; the record is never dropped or deleted. */
export function applyIamSubmissionAttempt(prev: IamSyncRecord, outcome: IamSubmissionOutcome, attemptAt: string): IamSyncRecord {
  const accepted = outcome.syncState === "SYNCED";
  return {
    ...prev,
    lastAttemptAt: attemptAt,
    attemptCount: prev.attemptCount + 1,
    syncState: outcome.syncState,
    disposition: accepted ? "ACCEPTED" : outcome.syncState === "SYNC_PENDING_RETRY" ? "PENDING" : "REJECTED",
    failureCategory: outcome.failureCategory,
    failureReasonCode: outcome.failureReasonCode,
    failureReason: outcome.failureReason,
    retryState: accepted
      ? "NONE"
      : outcome.automaticRetry
        ? "AUTOMATIC_RETRY_SCHEDULED"
        : outcome.manualCorrectionNeeded
          ? "STOPPED_PENDING_CORRECTION"
          : "STOPPED_PENDING_ADMIN",
    manualCorrectionNeeded: outcome.manualCorrectionNeeded,
    adminAlertRaised: prev.adminAlertRaised || outcome.adminAlertRequired,
    eventualAcceptedAt: accepted ? (prev.eventualAcceptedAt ?? attemptAt) : prev.eventualAcceptedAt,
  };
}
