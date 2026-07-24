import type { PresentationCategory } from "@/lib/iam/inbound/types";
import { FEATURED_PRIORITY_COUNT } from "@/lib/iam/constants";

/** Presentation lanes are Board categories — never lifecycle states. */
export const PRESENTATION_LANES = [
  "active_priority",
  "waiting_activation",
  "emergency",
  "holdover",
  "deferred",
  "managed_backlog",
  "completed_presentation",
  "archived_history",
  "top_2", // legacy alias
] as const satisfies readonly PresentationCategory[];

/**
 * Lifecycle states treated as open execution / carry-forward → Holdover lane.
 * Holdover is a presentation lane only (IAM-007B clarification).
 * Includes Paused for visibility; OEC consumption excludes Paused (PO 2026-07-21).
 */
export const HOLDOVER_LIFECYCLE_STATES = new Set([
  "Approved",
  "Assignment Pending",
  "Awaiting Acceptance",
  "Active",
  "Paused",
  "Escalated",
  "Completed",
  "Outcome Validation",
]);

/**
 * States that consume Organizational Execution Capability.
 * Paused deliberately excluded (PO Q-015 / 2026-07-21).
 */
export const OEC_CONSUMING_LIFECYCLE_STATES = new Set([
  "Approved",
  "Assignment Pending",
  "Awaiting Acceptance",
  "Active",
  "Escalated",
  "Completed",
  "Outcome Validation",
]);

/** Categories presentation service must not overwrite. */
export const PRESERVED_PRESENTATION = new Set<PresentationCategory>([
  "completed_presentation",
  "archived_history",
]);

/**
 * Emergency Priority (SD-2 unresolved).
 * Until SD-2 closes, Emergency lane is never auto-assigned by scoring.
 */
export const EMERGENCY_ASSIGNMENT_ENABLED = false;

/** Default OEC when company has not configured a value (legacy Top-2 capacity). */
export const DEFAULT_OEC = FEATURED_PRIORITY_COUNT;

/** @deprecated Prefer company OEC + active_priority promotion. Kept for interim validation labels. */
export const TOP_2_COUNT = FEATURED_PRIORITY_COUNT;

export function normalizePresentationCategory(cat: string): PresentationCategory {
  if (cat === "top_2") return "active_priority";
  if (cat === "managed_backlog") return "waiting_activation";
  return cat as PresentationCategory;
}

export function isActivePriorityCategory(cat: string): boolean {
  return cat === "active_priority" || cat === "top_2";
}

export function isWaitingCategory(cat: string): boolean {
  return cat === "waiting_activation" || cat === "managed_backlog";
}
