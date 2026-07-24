/**
 * IAM-007B Lifecycle States (LS-01–LS-11).
 * Exact names from IAM_07B_Lifecycle_and_State_Transition_Architecture_v1.0.
 * Deferred / Rejected are governance outcomes — not members of this set.
 */

export const LIFECYCLE_STATES = [
  "Identified",
  "Management Review",
  "Approved",
  "Assignment Pending",
  "Awaiting Acceptance",
  "Active",
  "Paused",
  "Escalated",
  "Completed",
  "Outcome Validation",
  "Archived",
] as const;

export type LifecycleState = (typeof LIFECYCLE_STATES)[number];

export const LS = {
  LS_01: "Identified",
  LS_02: "Management Review",
  LS_03: "Approved",
  LS_04: "Assignment Pending",
  LS_05: "Awaiting Acceptance",
  LS_06: "Active",
  LS_07: "Paused",
  LS_08: "Escalated",
  LS_09: "Completed",
  LS_10: "Outcome Validation",
  LS_11: "Archived",
} as const satisfies Record<string, LifecycleState>;

export function isLifecycleState(value: string): value is LifecycleState {
  return (LIFECYCLE_STATES as readonly string[]).includes(value);
}

/** Forbidden as lifecycleState values (clarifications + Implementation Plan). */
export const NON_LIFECYCLE_OUTCOMES = ["Deferred", "Rejected", "Holdover", "Featured"] as const;
