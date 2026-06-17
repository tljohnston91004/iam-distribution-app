/**
 * Controlled enum values — IAM Distribution V1.0
 * Sources: doc 02 §8, IAM Cursor Build Brief v1.3 §8, doc 04 (Stage 2)
 */

/** Weekly IAM run lifecycle */
export const RUN_STATUSES = ["Draft", "Open", "In Review", "Closed", "Archived"] as const;

export const CYCLE_STATUSES = ["Open", "Closed"] as const;

export const READINESS_STATUSES = [
  "Not Ready",
  "Partial",
  "Ready",
  "Blocked",
] as const;

/**
 * Action workflow states — V1 minimum set (Build Brief §8).
 * "Featured" = surfaced for weekly management review (top 2 lane).
 */
export const ACTION_WORKFLOW_STATES = [
  "Candidate",
  "Featured",
  "Approved",
  "Rejected for Cycle",
  "Awaiting Acceptance",
  "Active",
  "Holdover",
  "Paused",
  "Completed",
  "Archived",
  "Suppressed",
] as const;

/** New priorities vs holdovers rank separately (Hard Rule). */
export const PRIORITY_CATEGORIES = [
  "new_priority",
  "holdover",
  "management_priority",
] as const;

export const IAM_ACTION_TYPES = [
  "Reduce / Pause Replenishment Review",
  "Trapped Cash Review",
  "Stock Risk Review",
  "Grouped Business Case",
  "Management-Elevated Review",
  "Other Review Type",
] as const;

export const ACTION_STRENGTHS = [
  "Critical",
  "High",
  "Moderate",
  "Monitor",
  "Watch",
] as const;

export const SOURCE_MODULES = [
  "RSE",
  "IFM",
  "APM",
  "IPM",
  "VPM",
  "PDM",
  "CPM",
  "RPM",
  "IAM",
  "Manual",
] as const;

export const CONFIDENCE_LEVELS = [
  "High Confidence",
  "Medium Confidence",
  "Low Confidence",
  "Unknown",
] as const;

export const USER_ROLES = [
  "management",
  "assigned_owner",
  "reviewer",
  "read_only",
] as const;

export type RunStatus = (typeof RUN_STATUSES)[number];
export type CycleStatus = (typeof CYCLE_STATUSES)[number];
export type ActionWorkflowState = (typeof ACTION_WORKFLOW_STATES)[number];
export type PriorityCategory = (typeof PRIORITY_CATEGORIES)[number];
export type UserRole = (typeof USER_ROLES)[number];

/** Terminal states — completed/archived actions never reopen (Hard Rule). */
export const TERMINAL_WORKFLOW_STATES: readonly ActionWorkflowState[] = [
  "Completed",
  "Archived",
];

/** States visible on Management Dashboard featured lane */
export const FEATURED_WORKFLOW_STATES: readonly ActionWorkflowState[] = [
  "Featured",
  "Approved",
];
