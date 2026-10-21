/**
 * Stage 4B workflow vocabulary, policy defaults and the explicit mappings to the shared Results Return contract.
 *
 * Nothing here scores, ranks, recommends or learns. It only names the workflow states, decisions and statuses and says
 * how each one is expressed in the already-approved `IAM_RESULTS_RETURN_V1` vocabulary (no contract change is made).
 */
import type { IamActionStatus, IamLifecycleState } from "../contract/iam-results-return";

// ---- Candidate workflow (approved lifecycle + management branch states) -------------------------------------------

/**
 * Approved lifecycle: New Candidate -> Presented for Management Decision -> Approved and Assigned -> Pending Owner
 * Acceptance -> Active Action -> Completed and Validated -> Completed History.
 * "Holdover" is deliberately NOT a state (it belongs to the later Active Action Portfolio concept).
 */
export const WORKFLOW_PATH_STATES = [
  "NEW_CANDIDATE",
  "PRESENTED",
  "APPROVED_ASSIGNED",
  "PENDING_OWNER_ACCEPTANCE",
  "ACTIVE_ACTION",
  "COMPLETED_VALIDATED",
  "COMPLETED_HISTORY",
] as const;
/** Management branch outcomes that sit beside the approved path. */
export const WORKFLOW_BRANCH_STATES = ["REJECTED", "SUPPRESSED", "ESCALATED", "RISK_ACCEPTED"] as const;
export const WORKFLOW_STATES = [...WORKFLOW_PATH_STATES, ...WORKFLOW_BRANCH_STATES] as const;
export type WorkflowState = (typeof WORKFLOW_STATES)[number];

/** Human labels (the approved lifecycle wording). */
export const WORKFLOW_STATE_LABELS: Record<WorkflowState, string> = {
  NEW_CANDIDATE: "New Candidate",
  PRESENTED: "Presented for Management Decision",
  APPROVED_ASSIGNED: "Approved and Assigned",
  PENDING_OWNER_ACCEPTANCE: "Pending Owner Acceptance",
  ACTIVE_ACTION: "Active Action",
  COMPLETED_VALIDATED: "Completed and Validated",
  COMPLETED_HISTORY: "Completed History",
  REJECTED: "Rejected",
  SUPPRESSED: "Suppressed",
  ESCALATED: "Escalated",
  RISK_ACCEPTED: "Risk Accepted",
};

/** States in which a candidate has reached a terminal outcome: the candidate row is CLOSED and never reopened. */
export const TERMINAL_WORKFLOW_STATES: readonly WorkflowState[] = ["COMPLETED_HISTORY", "REJECTED", "RISK_ACCEPTED"];

/**
 * Explicit mapping from the Stage 4B workflow state to the shared contract lifecycle state carried on the Stage 4A
 * candidate row and in Results Return events. (Presenting a candidate does not change the Data Hub state: it is still a
 * CANDIDATE there.)
 */
export const WORKFLOW_TO_CONTRACT_LIFECYCLE: Record<WorkflowState, IamLifecycleState> = {
  NEW_CANDIDATE: "CANDIDATE",
  PRESENTED: "CANDIDATE",
  APPROVED_ASSIGNED: "APPROVED",
  PENDING_OWNER_ACCEPTANCE: "APPROVED",
  ACTIVE_ACTION: "ACTIVE",
  COMPLETED_VALIDATED: "COMPLETED",
  // Completed History is NOT formal closeout (4B-D4): execution is complete (contract lifecycle COMPLETED) while the candidate stays
  // open for the later outcome / closeout workflow, which alone produces CLOSEOUT_COMPLETED.
  COMPLETED_HISTORY: "COMPLETED",
  REJECTED: "REJECTED",
  SUPPRESSED: "SUPPRESSED",
  ESCALATED: "ESCALATED",
  RISK_ACCEPTED: "RISK_ACCEPTED",
};

// ---- Management decisions -------------------------------------------------------------------------------------------

export const MANAGEMENT_DECISION_TYPES = [
  "APPROVE",
  "REJECT",
  "SUPPRESS",
  "ESCALATE",
  "RISK_ACCEPT",
  "RETURN_FOR_REVIEW",
  "RELEASE_SUPPRESSION",
  "PAUSE_APPROVED",
  "PAUSE_DENIED",
  "COMPLETION_VALIDATED",
  "DECISION_RESOLVED",
  "REASSIGN",
  "PLAN_REVISED",
] as const;
export type ManagementDecisionType = (typeof MANAGEMENT_DECISION_TYPES)[number];

// ---- Action status model ----------------------------------------------------------------------------------------------

/** Normalized operational statuses (Stage 4B instruction 12). NOT_STARTED is a governed contract status (4B-D3). */
export const ACTION_STATUSES = ["NOT_STARTED", "ON_TRACK", "ATTENTION", "AT_RISK", "OVERDUE", "PAUSED", "BLOCKED", "COMPLETED"] as const;
export type ActionStatus = (typeof ACTION_STATUSES)[number];

export const ACTION_STATUS_LABELS: Record<ActionStatus, string> = {
  NOT_STARTED: "Not Started",
  ON_TRACK: "On Track",
  ATTENTION: "Attention",
  AT_RISK: "At Risk",
  OVERDUE: "Overdue",
  PAUSED: "Paused",
  BLOCKED: "Blocked",
  COMPLETED: "Completed",
};

/**
 * Data Hub expression of each IAM status. Since the Stage 4B closeout (4B-D3) the governed contract includes NOT_STARTED, so every
 * operational state has a contract status and null is never used to stand for a legitimate operational state.
 */
export const ACTION_STATUS_TO_CONTRACT: Record<ActionStatus, IamActionStatus> = {
  NOT_STARTED: "NOT_STARTED",
  ON_TRACK: "ON_TRACK",
  ATTENTION: "ATTENTION",
  AT_RISK: "AT_RISK",
  OVERDUE: "OVERDUE",
  PAUSED: "PAUSED",
  BLOCKED: "BLOCKED",
  COMPLETED: "COMPLETED",
};

/** Statuses that must create a Management Decision Required flag and a What-Changed marker. */
export const ESCALATING_STATUSES: readonly ActionStatus[] = ["AT_RISK", "OVERDUE", "BLOCKED"];

/**
 * Valid status transitions. COMPLETED is terminal. PAUSED is entered only through an approved pause and left only through
 * reactivation. NOT_STARTED is only a valid target while the action has not been started (see isValidStatusTransition).
 */
export const ACTION_STATUS_TRANSITIONS: Record<ActionStatus, readonly ActionStatus[]> = {
  NOT_STARTED: ["ON_TRACK", "ATTENTION", "AT_RISK", "OVERDUE", "PAUSED", "BLOCKED"],
  ON_TRACK: ["ATTENTION", "AT_RISK", "OVERDUE", "PAUSED", "BLOCKED", "COMPLETED"],
  ATTENTION: ["NOT_STARTED", "ON_TRACK", "AT_RISK", "OVERDUE", "PAUSED", "BLOCKED", "COMPLETED"],
  AT_RISK: ["NOT_STARTED", "ON_TRACK", "ATTENTION", "OVERDUE", "PAUSED", "BLOCKED", "COMPLETED"],
  OVERDUE: ["NOT_STARTED", "ON_TRACK", "ATTENTION", "AT_RISK", "PAUSED", "BLOCKED", "COMPLETED"],
  PAUSED: ["NOT_STARTED", "ON_TRACK", "ATTENTION", "AT_RISK", "OVERDUE", "BLOCKED"],
  BLOCKED: ["NOT_STARTED", "ON_TRACK", "ATTENTION", "AT_RISK", "OVERDUE", "PAUSED", "COMPLETED"],
  COMPLETED: [],
};

export function isValidStatusTransition(from: ActionStatus, to: ActionStatus, started = true): boolean {
  if (to === "NOT_STARTED" && started) return false;
  if (from === "COMPLETED") return false;
  return from === to || ACTION_STATUS_TRANSITIONS[from].includes(to);
}

/**
 * Explicit mapping of the V1.5 (legacy) review-cycle action workflow states to the Stage 4B workflow, for READING legacy
 * data only. Legacy rows are never converted (4A-D5): this table documents how a human or a future, separately
 * approved promotion step would interpret them. "Holdover" is a portfolio concept, not a state, in Stage 4B.
 */
export const LEGACY_WORKFLOW_STATE_MAP: Record<string, { workflowState: WorkflowState | null; note: string }> = {
  Candidate: { workflowState: "NEW_CANDIDATE", note: "Legacy candidate is history only; never auto-promoted." },
  Featured: { workflowState: "PRESENTED", note: "Surfaced for weekly management review." },
  Approved: { workflowState: "APPROVED_ASSIGNED", note: "" },
  "Rejected for Cycle": { workflowState: "REJECTED", note: "A legacy cycle rejection is not a qualified Stage 4B rejection." },
  "Awaiting Acceptance": { workflowState: "PENDING_OWNER_ACCEPTANCE", note: "" },
  Active: { workflowState: "ACTIVE_ACTION", note: "" },
  Holdover: { workflowState: "ACTIVE_ACTION", note: "Holdover is not a lifecycle state; it is an Active Action Portfolio concept." },
  Paused: { workflowState: "ACTIVE_ACTION", note: "Pause is an action status (PAUSED), not a workflow state." },
  Completed: { workflowState: "COMPLETED_VALIDATED", note: "" },
  Archived: { workflowState: "COMPLETED_HISTORY", note: "" },
  Suppressed: { workflowState: "SUPPRESSED", note: "" },
};

/** V1.5 lifecycle LS-01..LS-11 mapped to the Stage 4B workflow (reading only). */
export const LEGACY_LIFECYCLE_STATE_MAP: Record<string, { workflowState: WorkflowState; actionStatus?: ActionStatus }> = {
  Identified: { workflowState: "NEW_CANDIDATE" },
  "Management Review": { workflowState: "PRESENTED" },
  Approved: { workflowState: "APPROVED_ASSIGNED" },
  "Assignment Pending": { workflowState: "APPROVED_ASSIGNED" },
  "Awaiting Acceptance": { workflowState: "PENDING_OWNER_ACCEPTANCE" },
  Active: { workflowState: "ACTIVE_ACTION" },
  Paused: { workflowState: "ACTIVE_ACTION", actionStatus: "PAUSED" },
  Escalated: { workflowState: "ESCALATED" },
  Completed: { workflowState: "COMPLETED_VALIDATED", actionStatus: "COMPLETED" },
  "Outcome Validation": { workflowState: "COMPLETED_VALIDATED", actionStatus: "COMPLETED" },
  Archived: { workflowState: "COMPLETED_HISTORY", actionStatus: "COMPLETED" },
};

// ---- Resolution status (workflow support only; attribution and final outcome are a later stage) -------------------

export const RESOLUTION_STATUSES = [
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
export type ResolutionStatus = (typeof RESOLUTION_STATUSES)[number];
/** In-flight resolution statuses an owner may report while the action is active. */
export const IN_FLIGHT_RESOLUTION_STATUSES: readonly ResolutionStatus[] = ["NOT_YET_MEASURED", "IMPROVING", "ON_TARGET"];
/** Final resolution statuses (the shared contract vocabulary) usable only at completion / completed history. */
export const FINAL_RESOLUTION_STATUSES: readonly ResolutionStatus[] = [
  "FULLY_RESOLVED",
  "SUBSTANTIALLY_RESOLVED",
  "PARTIALLY_RESOLVED",
  "CONTROLLED_BUT_CONTINUING",
  "UNSUCCESSFUL",
  "NO_LONGER_APPLICABLE",
];

// ---- Management Decision Required reasons -----------------------------------------------------------------------------

export const DECISION_REQUIRED_REASONS = [
  "AT_RISK",
  "OVERDUE",
  "BLOCKED",
  "PAUSE_REQUEST",
  "OWNER_DISCUSSION",
  "MATERIAL_DEPENDENCY",
  "MATERIAL_PLAN_DEVIATION",
  "ESCALATION_REQUEST",
  "COMPLETION_VALIDATION",
  "PAUSE_REVIEW_DUE",
  "CONDITION_WORSENED",
] as const;
export type DecisionRequiredReason = (typeof DECISION_REQUIRED_REASONS)[number];

// ---- Evidence --------------------------------------------------------------------------------------------------------

export const EVIDENCE_KINDS = ["SKU", "VENDOR", "CATEGORY", "PURCHASE_ORDER", "CUSTOMER_BACKORDER", "OTHER"] as const;
export type EvidenceKind = (typeof EVIDENCE_KINDS)[number];

// ---- Policy (defaults; parameters, never hidden factors) ---------------------------------------------------------------

export const WORKFLOW_POLICY = {
  /** Approved governance rule: after this many qualified rejections of the same recurring condition, require senior review. */
  repeatedRejectionThreshold: 3,
  /** Default suppression maximum, in weekly cycles. */
  suppressionMaxCycles: 4,
  /** Days in one suppression cycle (the operating week is Sunday-Saturday). */
  suppressionCycleDays: 7,
  /** A progress / condition-reduction change smaller than this (percentage points) is recorded but sends no event. */
  materialChangePoints: 5,
  /** Default review window for an approved pause that gave no expected duration. */
  pauseDefaultReviewDays: 14,
} as const;

/** Parameters of the deterministic action-status evaluation (see aging.ts). */
export const AGING_POLICY = {
  /** Completion or condition-reduction behind the expected value by at least this many points => ATTENTION. */
  attentionGapPoints: 10,
  /** ... by at least this many points => AT_RISK. */
  atRiskGapPoints: 25,
  /** Within this many days of the target with completion below atRiskCompletionPct => AT_RISK. */
  atRiskDaysToTarget: 7,
  atRiskCompletionPct: 80,
  /** No owner update for this many days on a started, unfinished action => ATTENTION. */
  staleUpdateDays: 14,
} as const;

export type AgingPolicy = { -readonly [K in keyof typeof AGING_POLICY]: number };
export type WorkflowPolicy = { -readonly [K in keyof typeof WORKFLOW_POLICY]: number };

/** Version string carried as `source.iamSourceVersion` on Stage 4B events. */
export const WORKFLOW_SOURCE_VERSION = "iam-stage-4b-workflow";
