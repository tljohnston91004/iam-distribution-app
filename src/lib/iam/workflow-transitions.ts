import type { ActionWorkflowState } from "./enums";
import { canTransition } from "./workflow-states";

const TRANSITION_LABELS: Partial<Record<ActionWorkflowState, string>> = {
  Approved: "Approve",
  "Rejected for Cycle": "Reject for cycle",
  "Awaiting Acceptance": "Assign — awaiting acceptance",
  Active: "Mark active",
  Holdover: "Move to holdover",
  Paused: "Pause",
  Completed: "Mark completed",
  Archived: "Archive",
};

export function getAllowedTransitions(from: ActionWorkflowState): { state: ActionWorkflowState; label: string }[] {
  const all: ActionWorkflowState[] = [
    "Approved",
    "Rejected for Cycle",
    "Awaiting Acceptance",
    "Active",
    "Holdover",
    "Paused",
    "Completed",
    "Archived",
  ];
  return all
    .filter((to) => canTransition(from, to))
    .map((state) => ({
      state,
      label: TRANSITION_LABELS[state] ?? state,
    }));
}
