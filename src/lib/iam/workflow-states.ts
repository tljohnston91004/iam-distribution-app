import {
  ACTION_WORKFLOW_STATES,
  TERMINAL_WORKFLOW_STATES,
  type ActionWorkflowState,
} from "./enums";

/** Allowed workflow transitions for V1 validation build (doc 02 §8, Build Brief §8). */
const TRANSITIONS: Partial<Record<ActionWorkflowState, readonly ActionWorkflowState[]>> = {
  Candidate: ["Featured", "Suppressed"],
  Featured: ["Approved", "Rejected for Cycle", "Holdover"],
  Approved: ["Awaiting Acceptance", "Active"],
  "Rejected for Cycle": [], // returns to future cycle evaluation as new Candidate — no same-cycle backfill
  "Awaiting Acceptance": ["Active", "Holdover"],
  Active: ["Holdover", "Paused", "Completed"],
  Holdover: ["Active", "Paused", "Completed"],
  Paused: ["Active", "Holdover", "Completed"],
  Completed: ["Archived"],
  Archived: [],
  Suppressed: [],
};

export function canTransition(from: ActionWorkflowState, to: ActionWorkflowState): boolean {
  if (TERMINAL_WORKFLOW_STATES.includes(from) && to !== "Archived") {
    return false; // completed/archived never reopen
  }
  if (from === "Archived") return false;
  const allowed = TRANSITIONS[from];
  return allowed?.includes(to) ?? false;
}

export function assertTransition(from: ActionWorkflowState, to: ActionWorkflowState): void {
  if (!canTransition(from, to)) {
    throw new Error(`Invalid IAM workflow transition: ${from} → ${to}`);
  }
}

export function isTerminalState(state: ActionWorkflowState): boolean {
  return TERMINAL_WORKFLOW_STATES.includes(state) || state === "Archived";
}

export { ACTION_WORKFLOW_STATES };
