/**
 * IAM-007B valid lifecycle edges (LS states only).
 * Deferred / Rejected are handled as governance outcomes, not edges to LS states.
 */

import type { LifecycleState } from "./states";

/** Allowed next LS states from each current LS state (IAM-007B §4). */
export const LIFECYCLE_TRANSITIONS: Record<LifecycleState, readonly LifecycleState[]> = {
  Identified: ["Management Review"],
  "Management Review": ["Approved"], // Deferred/Rejected = governance outcomes (not LS)
  Approved: ["Assignment Pending"],
  "Assignment Pending": ["Awaiting Acceptance"],
  "Awaiting Acceptance": ["Active"],
  Active: ["Paused", "Escalated", "Completed"],
  Paused: ["Active"],
  Escalated: ["Active", "Completed"],
  Completed: ["Outcome Validation"],
  "Outcome Validation": ["Archived"],
  Archived: [],
};

export function assertLifecycleTransition(from: LifecycleState, to: LifecycleState): void {
  const allowed = LIFECYCLE_TRANSITIONS[from] ?? [];
  if (!allowed.includes(to)) {
    throw new LifecycleTransitionError(
      `Invalid lifecycle transition: ${from} → ${to}`,
      "INVALID_TRANSITION"
    );
  }
}

export class LifecycleTransitionError extends Error {
  constructor(
    message: string,
    public readonly code:
      | "INVALID_TRANSITION"
      | "NOT_FOUND"
      | "CYCLE_LOCKED"
      | "VALIDATION"
      | "GOVERNANCE_BLOCK" = "VALIDATION"
  ) {
    super(message);
    this.name = "LifecycleTransitionError";
  }
}
