/**
 * Stage 4E closeout vocabulary and labels.
 *
 * The nine resolution statuses, the six attribution categories, the outcome-confidence levels and the closeout phases are the
 * governed vocabulary of the shared Results Return contract (revision 1.0-r4e) and of the database triggers of the Stage 4E
 * migration. Nothing here scores, ranks, recommends or learns: it only names things.
 */
import {
  IAM_ATTRIBUTION_CATEGORIES,
  IAM_ATTRIBUTION_CONFIDENCES,
  IAM_CLOSEOUT_RESOLUTION_STATUSES,
  IAM_DATA_CONFIDENCE_LEVELS,
  IAM_MANAGEMENT_RESPONSES,
  IAM_RECURRENCE_RISKS,
} from "../contract/iam-results-return";
import { FINAL_RESOLUTION_STATUSES, RESOLUTION_STATUSES, type ResolutionStatus } from "../workflow/vocab";

export { FINAL_RESOLUTION_STATUSES, RESOLUTION_STATUSES, type ResolutionStatus };

/** Closeout case phases (header status). */
export const CLOSEOUT_STATUSES = ["STARTED", "MEASURED", "APPROVED", "CLOSED"] as const;
export type CloseoutStatus = (typeof CLOSEOUT_STATUSES)[number];

/** The nine statuses, exactly (the contract and the workflow vocabulary agree). */
export const NINE_RESOLUTION_STATUSES = IAM_CLOSEOUT_RESOLUTION_STATUSES;
export const INTERIM_RESOLUTION_STATUSES: readonly ResolutionStatus[] = ["NOT_YET_MEASURED", "IMPROVING", "ON_TARGET"];

export const RESOLUTION_LABELS: Record<ResolutionStatus, string> = {
  NOT_YET_MEASURED: "Not Yet Measured",
  IMPROVING: "Improving",
  ON_TARGET: "On Target",
  FULLY_RESOLVED: "Fully Resolved",
  SUBSTANTIALLY_RESOLVED: "Substantially Resolved",
  PARTIALLY_RESOLVED: "Partially Resolved",
  CONTROLLED_BUT_CONTINUING: "Controlled but Continuing",
  UNSUCCESSFUL: "Unsuccessful",
  NO_LONGER_APPLICABLE: "No Longer Applicable",
};

export const ATTRIBUTION_CATEGORIES = IAM_ATTRIBUTION_CATEGORIES;
export type AttributionCategory = (typeof ATTRIBUTION_CATEGORIES)[number];
export const ATTRIBUTION_LABELS: Record<AttributionCategory, string> = {
  CONFIRMED_CONTRIBUTION: "Confirmed Contribution",
  PROBABLE_CONTRIBUTION: "Probable Contribution",
  POSSIBLE_CONTRIBUTION: "Possible Contribution",
  UNCLEAR_INSUFFICIENT_EVIDENCE: "Unclear / Insufficient Evidence",
  UNRELATED_EXTERNAL_CAUSE: "Unrelated / External Cause",
  NEGATIVE_COUNTERPRODUCTIVE_EFFECT: "Negative / Counterproductive Effect",
};
/** Categories whose outcome may be reported as IAM-attributed value. Possible / Unclear / External are never counted as IAM results. */
export const ATTRIBUTED_CATEGORIES: readonly AttributionCategory[] = ["CONFIRMED_CONTRIBUTION", "PROBABLE_CONTRIBUTION"];

export const ATTRIBUTION_CONFIDENCES = IAM_ATTRIBUTION_CONFIDENCES;
export type AttributionConfidence = (typeof ATTRIBUTION_CONFIDENCES)[number];

export const OUTCOME_CONFIDENCES = IAM_DATA_CONFIDENCE_LEVELS;
export type OutcomeConfidence = (typeof OUTCOME_CONFIDENCES)[number];
export const CONFIDENCE_RANK: Record<OutcomeConfidence, number> = { INSUFFICIENT: 0, LOW: 1, MEDIUM: 2, HIGH: 3 };

export const RECURRENCE_RISKS = IAM_RECURRENCE_RISKS;
export type RecurrenceRisk = (typeof RECURRENCE_RISKS)[number];

export const MANAGEMENT_RESPONSES = IAM_MANAGEMENT_RESPONSES;
export type ManagementResponse = (typeof MANAGEMENT_RESPONSES)[number];
export const MANAGEMENT_RESPONSE_LABELS: Record<ManagementResponse, string> = {
  FOLLOWED: "Followed the recommendation",
  MODIFIED: "Modified the recommendation",
  SELECTED_ALTERNATIVE: "Selected an alternative",
  REJECTED_THEN_APPROVED: "Rejected, then approved",
  DELAYED: "Delayed before approval",
  SUPPRESSED_THEN_APPROVED: "Suppressed, then approved",
};

/** Kinds of evidence an attribution may cite. TIMING alone is never enough to claim a contribution. */
export const ATTRIBUTION_EVIDENCE_KINDS = [
  "TIMING",
  "ACTION_COMPLETION",
  "TREND",
  "EVIDENCE",
  "MECHANISM",
  "EXTERNAL_CHANGE",
  "MANAGEMENT_NOTE",
  "SUPPLIER_CUSTOMER_EVENT",
  "RSE",
  "HEALTH_HISTORY",
  "SCORING_HISTORY",
] as const;
export type AttributionEvidenceKind = (typeof ATTRIBUTION_EVIDENCE_KINDS)[number];
/** Evidence kinds that on their own only show sequence in time or a Health movement, never a cause. */
export const NON_CAUSAL_ONLY_KINDS: readonly AttributionEvidenceKind[] = ["TIMING", "ACTION_COMPLETION", "HEALTH_HISTORY", "SCORING_HISTORY"];
/** Kinds that can support a mechanism / direct-evidence claim. */
export const MECHANISM_KINDS: readonly AttributionEvidenceKind[] = ["MECHANISM", "EVIDENCE", "SUPPLIER_CUSTOMER_EVENT", "RSE"];

/** Business-impact measures an actual outcome may report (each needs a value, a unit and an evidence reference). */
export const IMPACT_MEASURES = ["cashReleased", "inventoryDollarsReduced", "shortageReduced", "marginProtected"] as const;
export type ImpactMeasure = (typeof IMPACT_MEASURES)[number];
export const IMPACT_LABELS: Record<ImpactMeasure, string> = {
  cashReleased: "Cash released",
  inventoryDollarsReduced: "Inventory dollars reduced",
  shortageReduced: "Shortage reduced",
  marginProtected: "Margin protected",
};

export const CLOSEOUT_ORIGIN = { source: "IAM_CLOSEOUT_STAGE_4E", keyPrefix: "co4e" } as const;
export const CLOSEOUT_SOURCE_VERSION = "iam-stage-4e-closeout";

/** Closeout state shown on the board's Completed History section (execution complete is NOT closeout complete). */
export type CloseoutBoardStatus =
  | "CLOSEOUT_NOT_STARTED"
  | "AWAITING_MEASUREMENT"
  | "AWAITING_MANAGEMENT_CLOSEOUT"
  | "APPROVED_AWAITING_FINALIZATION"
  | "CLOSED";

export const CLOSEOUT_BOARD_LABELS: Record<CloseoutBoardStatus, string> = {
  CLOSEOUT_NOT_STARTED: "Execution Complete — Closeout Not Started",
  AWAITING_MEASUREMENT: "Awaiting Measurement",
  AWAITING_MANAGEMENT_CLOSEOUT: "Awaiting Management Closeout",
  APPROVED_AWAITING_FINALIZATION: "Closeout Approved — Awaiting Finalization",
  CLOSED: "Closed",
};

export function closeoutBoardLabel(status: CloseoutBoardStatus, finalStatus?: string | null): string {
  if (status === "CLOSED" && finalStatus) return `Closed — ${RESOLUTION_LABELS[finalStatus as ResolutionStatus] ?? finalStatus}`;
  return CLOSEOUT_BOARD_LABELS[status];
}
