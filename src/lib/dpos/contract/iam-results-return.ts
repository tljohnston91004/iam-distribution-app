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

/** Contract versions this build can validate and interpret. Additive evolution only: add, never remove. */
export const IAM_RESULTS_RETURN_SUPPORTED_VERSIONS = ["1.0"] as const;
export type IamResultsReturnVersion = (typeof IAM_RESULTS_RETURN_SUPPORTED_VERSIONS)[number];

export const IAM_EVENT_TYPES = [
  // Lifecycle
  "CANDIDATE_CREATED",
  "CANDIDATE_RECALCULATED",
  "DOMAIN_PRIORITY_CHANGED",
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
  "ACTION_PAUSED",
  "ACTION_REACTIVATED",
  "ACTION_BLOCKED",
  "ACTION_COMPLETED",
  // Closure and recurrence
  "OUTCOME_VALIDATED",
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
/** IAM Functional Specification section 8.1 Standard Execution Status. */
export const IAM_ACTION_STATUSES = [
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
/** IAM Functional Specification section 15: High, Moderate, Low or Not Measurable. */
export const IAM_ATTRIBUTION_CONFIDENCES = ["HIGH", "MODERATE", "LOW", "NOT_MEASURABLE"] as const;
export const IAM_REFRESH_KINDS = ["LIFECYCLE_EVENT", "SCHEDULED_WEEKLY", "MANUAL_REFRESH"] as const;

export type IamLifecycleState = (typeof IAM_LIFECYCLE_STATES)[number];
export type IamActionStatus = (typeof IAM_ACTION_STATUSES)[number];

type FieldType =
  | "string"
  | "longString"
  | "datetime"
  | "date"
  | "percent"
  | "number"
  | "nonNegNumber"
  | "positiveInt"
  | "boolean"
  | "stringArray"
  | "stringMap"
  | "enum";
export type IamFieldSpec = { type: FieldType; values?: readonly string[] };

const S: IamFieldSpec = { type: "string" };
const LS: IamFieldSpec = { type: "longString" };
const DT: IamFieldSpec = { type: "datetime" };
const D: IamFieldSpec = { type: "date" };
const PCT: IamFieldSpec = { type: "percent" };
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
    targetDate: D,
    ownerResponseAt: DT,
    discussionNote: LS,
  },
  progress: {
    actionStatus: E(IAM_ACTION_STATUSES),
    actionCompletionPct: PCT,
    conditionReductionPct: PCT,
    remainingExposure: NN,
    remainingExposureUnit: S,
    startedAt: DT,
    completedAt: DT,
    statusReason: LS,
    blockedReason: LS,
    reactivationCondition: LS,
    decisionRequiredReason: LS,
  },
  plan: {
    approvedPlanStatus: E(IAM_PLAN_STATUSES),
    approvedPlanRef: S,
    planSummary: LS,
    planApprovedAt: DT,
    planApprovedBy: S,
    deviatesFromSystemRecommendation: B,
    deviationReason: LS,
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
    conditionReductionPct: PCT,
    measuredBusinessImpact: NUM,
    measuredBusinessImpactUnit: S,
    residualExposure: NN,
    finalResolutionStatus: E(IAM_FINAL_RESOLUTION_STATES),
    attributionConfidence: E(IAM_ATTRIBUTION_CONFIDENCES),
    lessonsLearnedRef: S,
    influenceFutureRecommendations: B,
    closeoutAt: DT,
  },
  recurrence: { priorCandidateId: S, priorActionRef: S, recurrenceReason: LS },
  learning: {
    actionType: S,
    normalizedOutcome: S,
    resultSummary: LS,
    confidence: E(IAM_ATTRIBUTION_CONFIDENCES),
    contextIdentifiers: SM,
    lineageRefs: SA,
    recurrenceHistoryRefs: SA,
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
      "recommendation.domainScore",
      "recommendation.domainRank",
    ],
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
  DOMAIN_PRIORITY_CHANGED: {
    family: "LIFECYCLE",
    sections: ["recommendation"],
    required: ["source.iamSourceRunId", "recommendation.domainRank"],
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
    sections: ["assignment"],
    required: ["assignment.taskOwner", "assignment.ownerResponseAt"],
    impliedLifecycleState: "ACTIVE",
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
    required: ["progress.conditionReductionPct"],
  },
  MANAGEMENT_DECISION_REQUIRED: {
    family: "ACTION_PROGRESS",
    sections: ["progress"],
    required: ["progress.decisionRequiredReason"],
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
    sections: ["outcome", "learning"],
    required: ["outcome.outcomeState", "outcome.validatedAt"],
    impliedLifecycleState: "OUTCOME_VALIDATED",
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
    case "number": {
      if (typeof raw !== "number" || !Number.isFinite(raw)) return bad("INVALID_TYPE", `${path} must be a finite number`);
      return { keep: true, value: raw };
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
