/**
 * Shared types and helpers for Phase 5 / EEP Decision Board (Recommendation-centric).
 */

export type BoardPersona = "executive" | "operations" | "owner";

export type BoardRecommendation = {
  id: string;
  title: string;
  recommendationType: string;
  skuOrItemId: string | null;
  analysisGrain?: string | null;
  segmentType?: string | null;
  segmentKey?: string | null;
  affectedSkuCount?: number | null;
  lifecycleState: string;
  presentationCategory: string;
  presentationRank: number | null;
  generationPath: string;
  sourceModule: string;
  confidence: string;
  priorityScore: number | null;
  scoringProfileId: string | null;
  estimatedFinancialImpact: number | null;
  estimatedCashImpact: number | null;
  costOfInaction: number | null;
  explainabilityJson: string | null;
  ownerUserId: string | null;
  ownerName: string | null;
  ownerAccepted: boolean;
  storyWhat: string | null;
  storyWhy: string | null;
  storyWhyNow: string | null;
  storyExpectedResult: string | null;
  confidenceNarrative: string | null;
  progressNarrative: string | null;
  blockerNote: string | null;
  lastProgressAt: string | null;
  expectedCompletionAt: string | null;
  updatedAt: string;
  agingAdvisory: string | null;
};

/** Board section order per Blueprint §9.1 (EEP). */
export const LANE_ORDER = [
  "active_priority",
  "emergency",
  "holdover",
  "waiting_activation",
  "deferred",
] as const;

export const LANE_LABELS: Record<(typeof LANE_ORDER)[number], string> = {
  active_priority: "This Week's Active Priorities",
  emergency: "Emergency Priority",
  holdover: "Work in Progress / Holdover",
  waiting_activation: "Waiting for Activation",
  deferred: "Deferred",
};

export function requiredActionHint(lifecycleState: string, presentationCategory: string): string {
  if (presentationCategory === "deferred") return "Review Deferred status or reactivate";
  switch (lifecycleState) {
    case "Identified":
      return "Present for management review";
    case "Management Review":
      return "Approve, Defer, or Reject";
    case "Approved":
      return "Assign primary owner";
    case "Assignment Pending":
    case "Awaiting Acceptance":
      return "Await owner acceptance";
    case "Active":
      return "Execute · Pause or Escalate if needed";
    case "Paused":
      return "Resume when ready";
    case "Escalated":
      return "Resolve escalation · Resume or Complete";
    case "Completed":
      return "Start Outcome Validation";
    case "Outcome Validation":
      return "Pass Outcome Validation to Archive";
    case "Archived":
      return "Archived — history only";
    default:
      return "Review recommendation";
  }
}

/** Single primary CTA label for Active Priorities / decision strip. */
export function primaryCtaLabel(lifecycleState: string, presentationCategory: string): string | null {
  if (presentationCategory === "deferred") return "Reactivate";
  switch (lifecycleState) {
    case "Identified":
      return "Present for review";
    case "Management Review":
      return "Approve";
    case "Approved":
    case "Assignment Pending":
      return "Assign owner";
    case "Awaiting Acceptance":
      return "Accept assignment";
    case "Active":
      return "Update progress";
    case "Paused":
    case "Escalated":
      return "Resume";
    case "Completed":
      return "Validate outcome";
    default:
      return null;
  }
}

export function parseExplainability(json: string | null): Record<string, unknown> {
  if (!json) return {};
  try {
    return JSON.parse(json) as Record<string, unknown>;
  } catch {
    return {};
  }
}
