/**
 * Stage 4E closeout measurement, resolution guidance, confidence ceilings, attribution validation, residual exposure and
 * expected-vs-actual (all pure; no I/O, no clock, no database).
 *
 * Principles (Product Owner locks 4E-D1..D8):
 *   - condition reduction = (baseline - final) / baseline x 100, SIGNED and never clamped (100 -> 80 = +20, 100 -> 100 = 0,
 *     100 -> 120 = -20). A zero or missing baseline, or a missing final value, has NO percentage: it is Not Yet Measured.
 *   - the resolution status GUIDANCE is definitional only: exposure eliminated, or no improvement. Everything in between needs
 *     explicit management judgement with a rationale. No percentage threshold is invented.
 *   - attribution is separate from the outcome and never inferred from the order of events alone.
 *   - residual exposure keeps its units and is never summed across types or units.
 *   - an actual result is only recorded with an evidence reference; nothing is estimated or defaulted to look good.
 */
import { createHash } from "node:crypto";
import { DposError } from "../errors";
import { computeConditionReduction } from "../workflow/condition-reduction";
import {
  ATTRIBUTION_CATEGORIES,
  ATTRIBUTION_CONFIDENCES,
  ATTRIBUTION_EVIDENCE_KINDS,
  CONFIDENCE_RANK,
  FINAL_RESOLUTION_STATUSES,
  IMPACT_LABELS,
  IMPACT_MEASURES,
  MECHANISM_KINDS,
  NON_CAUSAL_ONLY_KINDS,
  OUTCOME_CONFIDENCES,
  RESOLUTION_STATUSES,
  type AttributionCategory,
  type AttributionConfidence,
  type AttributionEvidenceKind,
  type ImpactMeasure,
  type OutcomeConfidence,
  type ResolutionStatus,
} from "./vocab";

const bad = (code: string, message: string, details?: Record<string, unknown>): never => {
  throw new DposError(code, message, 400, details);
};
const conflict = (code: string, message: string, details?: Record<string, unknown>): never => {
  throw new DposError(code, message, 409, details);
};

// ---- measurement ------------------------------------------------------------------------------------------------------------

export interface ConditionMeasurement {
  state: "MEASURED" | "NOT_MEASURABLE";
  baseline: number | null;
  final: number | null;
  unit: string | null;
  /** Signed, unclamped, two decimals; null whenever the state is NOT_MEASURABLE. */
  pct: number | null;
  worseThanBaseline: boolean;
  reason: string | null;
}

export function measureCondition(baseline: number | null | undefined, final: number | null | undefined, unit: string | null | undefined): ConditionMeasurement {
  const r = computeConditionReduction(baseline ?? null, final ?? null);
  const base = { baseline: typeof baseline === "number" && Number.isFinite(baseline) ? baseline : null, final: typeof final === "number" && Number.isFinite(final) ? final : null, unit: unit?.trim() || null };
  if (r.status === "MEASURED") return { state: "MEASURED", ...base, pct: r.pct, worseThanBaseline: r.worseThanBaseline, reason: null };
  return { state: "NOT_MEASURABLE", ...base, pct: null, worseThanBaseline: false, reason: r.reason };
}

// ---- measurement window ------------------------------------------------------------------------------------------------------

export interface MeasurementWindow {
  actionCompletedAt: Date | null;
  measurementStart: Date | null;
  measurementEnd: Date | null;
  evidenceCurrentThrough: Date | null;
}

export interface WindowAssessment {
  adequate: boolean;
  reason: string;
}

/**
 * The window is adequate only when the evidence is current through the end of the stated measurement period and the period does not
 * start before the action was completed. A missing date means it cannot be shown to be adequate (never assumed).
 */
export function assessWindow(w: MeasurementWindow): WindowAssessment {
  if (!w.measurementStart || !w.measurementEnd) return { adequate: false, reason: "No measurement period (start and end) was recorded." };
  if (w.measurementEnd.getTime() < w.measurementStart.getTime()) return bad("MEASUREMENT_WINDOW_INVALID", "The measurement period ends before it starts.");
  if (w.actionCompletedAt && w.measurementStart.getTime() < Math.floor(w.actionCompletedAt.getTime() / 86_400_000) * 86_400_000) {
    return bad("MEASUREMENT_WINDOW_BEFORE_COMPLETION", "The measurement period cannot start before the action was completed.");
  }
  if (!w.evidenceCurrentThrough) return { adequate: false, reason: "The date the evidence is current through was not recorded." };
  if (w.evidenceCurrentThrough.getTime() < w.measurementEnd.getTime()) return { adequate: false, reason: "The evidence is not yet current through the end of the measurement period." };
  return { adequate: true, reason: "The evidence is current through the end of the measurement period." };
}

// ---- resolution guidance -----------------------------------------------------------------------------------------------------

export interface ResolutionGuidance {
  /** The system's definitional guidance. Null when management judgement is required. */
  recommendedStatus: ResolutionStatus | null;
  judgementRequired: boolean;
  windowAdequate: boolean;
  /** Human-readable basis, always populated (the recommendation can be audited from it). */
  basis: { rule: string; explanation: string; conditionReductionPct: number | null; windowReason: string };
}

export function resolutionGuidance(m: ConditionMeasurement, w: WindowAssessment): ResolutionGuidance {
  const common = { windowAdequate: w.adequate, conditionReductionPct: m.pct, windowReason: w.reason };
  if (m.state === "NOT_MEASURABLE") {
    return { recommendedStatus: "NOT_YET_MEASURED", judgementRequired: false, windowAdequate: w.adequate, basis: { rule: "NOT_MEASURABLE", explanation: `${m.reason ?? "No measurable condition reduction."} No percentage is produced and the outcome stays Not Yet Measured until it can be measured (or management records a No Longer Applicable justification).`, ...common } };
  }
  const pct = m.pct as number;
  if (!w.adequate) {
    if (pct > 0) return { recommendedStatus: "IMPROVING", judgementRequired: false, windowAdequate: false, basis: { rule: "IMPROVING_WINDOW_OPEN", explanation: `The condition is reduced by ${pct}% but the measurement window is not yet adequate, so the result is Improving, not final.`, ...common } };
    return { recommendedStatus: "NOT_YET_MEASURED", judgementRequired: false, windowAdequate: false, basis: { rule: "WINDOW_OPEN_NO_IMPROVEMENT", explanation: `The measured change is ${pct}% and the measurement window is not yet adequate; the outcome is not yet established.`, ...common } };
  }
  if (m.final === 0) return { recommendedStatus: "FULLY_RESOLVED", judgementRequired: false, windowAdequate: true, basis: { rule: "EXPOSURE_ELIMINATED", explanation: "The remaining exposure is zero over an adequate measurement window.", ...common } };
  if (pct <= 0) return { recommendedStatus: "UNSUCCESSFUL", judgementRequired: false, windowAdequate: true, basis: { rule: "NO_IMPROVEMENT", explanation: pct === 0 ? "The exposure is unchanged from the baseline over an adequate measurement window." : `The exposure is worse than the baseline (${pct}%) over an adequate measurement window.`, ...common } };
  return {
    recommendedStatus: null,
    judgementRequired: true,
    windowAdequate: true,
    basis: { rule: "JUDGEMENT_REQUIRED", explanation: `The condition is reduced by ${pct}% but not eliminated. No threshold is defined for Substantially / Partially Resolved or Controlled but Continuing, so management must choose a status and state the rationale.`, ...common },
  };
}

const SUCCESS_STATUSES: readonly ResolutionStatus[] = ["FULLY_RESOLVED", "SUBSTANTIALLY_RESOLVED", "PARTIALLY_RESOLVED"];

/**
 * Check a status a person (or the system) asserts for a version against what was measured. Contradictions are refused; a status that
 * differs from the system guidance needs a rationale.
 */
export function validateAssertedStatus(
  status: string,
  ctx: { measurement: ConditionMeasurement; guidance: ResolutionGuidance; rationale: string | null; evidenceRefs: readonly string[]; field: string },
): ResolutionStatus {
  if (!(RESOLUTION_STATUSES as readonly string[]).includes(status)) return bad("VOCABULARY_VIOLATION", `${ctx.field} must be one of ${RESOLUTION_STATUSES.join(", ")}.`, { field: ctx.field });
  const s = status as ResolutionStatus;
  const { measurement: m, guidance: g } = ctx;
  if (m.state === "MEASURED") {
    const pct = m.pct as number;
    if (SUCCESS_STATUSES.includes(s) && pct <= 0) return conflict("STATUS_CONTRADICTS_MEASUREMENT", `${s} cannot be asserted when the measured condition reduction is ${pct}% (no improvement or worse).`, { status: s, conditionReductionPct: pct });
    if (s === "FULLY_RESOLVED" && m.final !== null && m.final > 0 && !ctx.rationale) {
      return bad("RATIONALE_REQUIRED", "Fully Resolved with a non-zero measured residual needs an explicit management rationale.", { status: s });
    }
    if (s === "NOT_YET_MEASURED") return conflict("STATUS_CONTRADICTS_MEASUREMENT", "A measured version cannot be Not Yet Measured.", { status: s });
    if (s === "NO_LONGER_APPLICABLE" && !ctx.rationale) return bad("RATIONALE_REQUIRED", "No Longer Applicable needs a justification.", { status: s });
  } else if (s !== "NOT_YET_MEASURED") {
    if (!ctx.rationale) return bad("RATIONALE_REQUIRED", `${s} on an outcome that could not be measured needs an explicit management rationale.`, { status: s });
    if (ctx.evidenceRefs.length === 0 && s !== "NO_LONGER_APPLICABLE") return bad("EVIDENCE_REQUIRED", `${s} on an outcome that could not be measured needs at least one evidence reference.`, { status: s });
  }
  if (g.recommendedStatus !== s && !ctx.rationale && !(m.state === "NOT_MEASURABLE" && s === "NOT_YET_MEASURED")) {
    return bad("RATIONALE_REQUIRED", g.recommendedStatus === null ? `Management judgement is required: state the rationale for ${s}.` : `${s} differs from the system guidance (${g.recommendedStatus}); state the rationale.`, { status: s, recommended: g.recommendedStatus });
  }
  return s;
}

export const isFinalStatus = (s: string): boolean => (FINAL_RESOLUTION_STATUSES as readonly string[]).includes(s);

// ---- outcome confidence --------------------------------------------------------------------------------------------------------

export interface ConfidenceResult {
  confidence: OutcomeConfidence;
  rationale: string;
  capped: boolean;
}

/** Ceilings: an unmeasured outcome or one with no evidence is INSUFFICIENT; an inadequate window is at most LOW. Low and Insufficient stay visible. */
export function capOutcomeConfidence(
  requested: string | null | undefined,
  ctx: { measured: boolean; evidenceRefs: readonly string[]; windowAdequate: boolean; requestedRationale?: string | null },
): ConfidenceResult {
  if (requested !== null && requested !== undefined && !(OUTCOME_CONFIDENCES as readonly string[]).includes(requested)) {
    return bad("VOCABULARY_VIOLATION", `outcomeConfidence must be one of ${OUTCOME_CONFIDENCES.join(", ")}.`);
  }
  const wanted: OutcomeConfidence = (requested as OutcomeConfidence | null | undefined) ?? (ctx.measured && ctx.windowAdequate && ctx.evidenceRefs.length > 0 ? "MEDIUM" : "LOW");
  const note = ctx.requestedRationale?.trim() || null;
  if (!ctx.measured) return { confidence: "INSUFFICIENT", rationale: [note, "Not measured: confidence is Insufficient."].filter(Boolean).join(" "), capped: wanted !== "INSUFFICIENT" };
  if (ctx.evidenceRefs.length === 0) return { confidence: "INSUFFICIENT", rationale: [note, "No evidence reference supports the measurement: confidence is Insufficient."].filter(Boolean).join(" "), capped: wanted !== "INSUFFICIENT" };
  if (!ctx.windowAdequate && CONFIDENCE_RANK[wanted] > CONFIDENCE_RANK.LOW) return { confidence: "LOW", rationale: [note, "The measurement window is not adequate: confidence is capped at Low."].filter(Boolean).join(" "), capped: true };
  return { confidence: wanted, rationale: note ?? (requested ? "Stated by the recorder." : "Default for an adequately measured, evidenced outcome (Medium) or an inadequately measured one (Low)."), capped: false };
}

// ---- attribution --------------------------------------------------------------------------------------------------------------------

export interface AttributionEvidenceInput {
  kind: string;
  ref?: string | null;
  note?: string | null;
}

export interface AttributionInput {
  category: string;
  rationale: string;
  confidence?: string | null;
  evidence?: AttributionEvidenceInput[] | null;
  alternatives?: string[] | null;
}

export interface Attribution {
  category: AttributionCategory;
  rationale: string;
  confidence: AttributionConfidence;
  evidence: Array<{ kind: AttributionEvidenceKind; ref: string | null; note: string | null }>;
  alternatives: string[];
  confidenceDefaulted: boolean;
}

const DEFAULT_ATTRIBUTION_CONFIDENCE: Record<AttributionCategory, AttributionConfidence> = {
  CONFIRMED_CONTRIBUTION: "HIGH",
  PROBABLE_CONTRIBUTION: "MODERATE",
  POSSIBLE_CONTRIBUTION: "LOW",
  UNCLEAR_INSUFFICIENT_EVIDENCE: "NOT_MEASURABLE",
  UNRELATED_EXTERNAL_CAUSE: "MODERATE",
  NEGATIVE_COUNTERPRODUCTIVE_EFFECT: "MODERATE",
};

export function validateAttribution(
  input: AttributionInput | null | undefined,
  ctx: { measurement: ConditionMeasurement; outcomeConfidence: OutcomeConfidence },
): Attribution {
  if (!input) return bad("ATTRIBUTION_REQUIRED", "An attribution assessment is required for every closeout version (use Unclear / Insufficient Evidence when the evidence cannot support more).");
  if (!(ATTRIBUTION_CATEGORIES as readonly string[]).includes(input.category)) return bad("VOCABULARY_VIOLATION", `attribution.category must be one of ${ATTRIBUTION_CATEGORIES.join(", ")}.`);
  const category = input.category as AttributionCategory;
  const rationale = (input.rationale ?? "").trim();
  if (!rationale) return bad("ATTRIBUTION_RATIONALE_REQUIRED", "An attribution rationale is required.");
  if (rationale.length > 4000) return bad("TEXT_TOO_LONG", "The attribution rationale exceeds 4000 characters.");
  const evidence = (input.evidence ?? []).map((e, i) => {
    if (!(ATTRIBUTION_EVIDENCE_KINDS as readonly string[]).includes(e.kind)) return bad("VOCABULARY_VIOLATION", `attribution.evidence[${i}].kind must be one of ${ATTRIBUTION_EVIDENCE_KINDS.join(", ")}.`);
    return { kind: e.kind as AttributionEvidenceKind, ref: e.ref?.trim() || null, note: e.note?.trim() || null };
  });
  const alternatives = (input.alternatives ?? []).map((a) => String(a).trim()).filter(Boolean);
  let confidence: AttributionConfidence;
  let defaulted = false;
  if (input.confidence === null || input.confidence === undefined || input.confidence === "") {
    confidence = DEFAULT_ATTRIBUTION_CONFIDENCE[category];
    defaulted = true;
  } else if (!(ATTRIBUTION_CONFIDENCES as readonly string[]).includes(input.confidence)) {
    return bad("VOCABULARY_VIOLATION", `attribution.confidence must be one of ${ATTRIBUTION_CONFIDENCES.join(", ")}.`);
  } else confidence = input.confidence as AttributionConfidence;

  const m = ctx.measurement;
  const causalKinds = evidence.filter((e) => !NON_CAUSAL_ONLY_KINDS.includes(e.kind));
  const mechanismKinds = evidence.filter((e) => MECHANISM_KINDS.includes(e.kind));
  const credit = category === "CONFIRMED_CONTRIBUTION" || category === "PROBABLE_CONTRIBUTION";
  if (credit) {
    if (m.state !== "MEASURED") return conflict("ATTRIBUTION_NEEDS_MEASUREMENT", `${category} cannot be asserted when the outcome was not measured.`, { category });
    if ((m.pct as number) <= 0) return conflict("ATTRIBUTION_CONTRADICTS_MEASUREMENT", `${category} cannot be asserted when the measured condition reduction is ${m.pct}%.`, { category, conditionReductionPct: m.pct });
    if (ctx.outcomeConfidence === "INSUFFICIENT") return conflict("ATTRIBUTION_NEEDS_CONFIDENCE", `${category} cannot be asserted when the outcome confidence is Insufficient.`, { category });
    if (causalKinds.length === 0) return conflict("TEMPORAL_SEQUENCE_ONLY", `${category} cannot rest on timing, completion, Health or scoring movement alone: a sequence in time is not a cause. Cite a mechanism, evidence, a trend with a cause, or a supplier / customer event.`, { category });
  }
  if (category === "CONFIRMED_CONTRIBUTION") {
    if (mechanismKinds.length === 0) return conflict("ATTRIBUTION_NEEDS_MECHANISM", "Confirmed Contribution needs mechanism or direct evidence (MECHANISM, EVIDENCE, SUPPLIER_CUSTOMER_EVENT or RSE).", { category });
    if (alternatives.length === 0) return conflict("ATTRIBUTION_NEEDS_ALTERNATIVES", "Confirmed Contribution needs the alternative explanations that were considered.", { category });
    if (confidence !== "HIGH" && confidence !== "MODERATE") return conflict("ATTRIBUTION_CONFIDENCE_INCONSISTENT", "Confirmed Contribution cannot carry Low or Not Measurable attribution confidence.", { confidence });
  }
  if (category === "POSSIBLE_CONTRIBUTION" && evidence.length === 0 && alternatives.length === 0) {
    return bad("ATTRIBUTION_NEEDS_EVIDENCE", "Possible Contribution needs at least one evidence item or an alternative explanation (otherwise use Unclear / Insufficient Evidence).");
  }
  if (category === "UNCLEAR_INSUFFICIENT_EVIDENCE" && confidence !== "LOW" && confidence !== "NOT_MEASURABLE") {
    return conflict("ATTRIBUTION_CONFIDENCE_INCONSISTENT", "Unclear / Insufficient Evidence must carry Low or Not Measurable attribution confidence.", { confidence });
  }
  if (category === "UNRELATED_EXTERNAL_CAUSE") {
    const external = evidence.some((e) => e.kind === "EXTERNAL_CHANGE" || e.kind === "SUPPLIER_CUSTOMER_EVENT");
    if (!external && alternatives.length === 0) return bad("ATTRIBUTION_NEEDS_EXTERNAL_EVIDENCE", "Unrelated / External Cause needs external-change evidence or the alternative explanation that accounts for the outcome.");
  }
  if (category === "NEGATIVE_COUNTERPRODUCTIVE_EFFECT") {
    const worse = m.state === "MEASURED" && (m.pct as number) < 0;
    if (!worse && causalKinds.length === 0) return bad("ATTRIBUTION_NEEDS_EVIDENCE", "Negative / Counterproductive Effect needs a measured deterioration or non-timing evidence that the action harmed the result.");
  }
  return { category, rationale, confidence, evidence, alternatives, confidenceDefaulted: defaulted };
}

// ---- residual exposure ----------------------------------------------------------------------------------------------------------------

export interface ResidualItemInput {
  type: string;
  value: number;
  unit: string;
}

export interface ResidualExposure {
  items: ResidualItemInput[];
  /** The single item when exactly one exists; the contract's one `residualExposure` number is only sent in that case. */
  single: ResidualItemInput | null;
  note: string;
}

export function normalizeResidual(items: readonly ResidualItemInput[] | null | undefined, fallback?: { value: number | null; unit: string | null }): ResidualExposure | null {
  const list: ResidualItemInput[] = [];
  for (const [i, it] of (items ?? []).entries()) {
    const type = (it.type ?? "").trim();
    const unit = (it.unit ?? "").trim();
    if (!type) return bad("RESIDUAL_TYPE_REQUIRED", `residual[${i}].type is required.`);
    if (!unit) return bad("UNIT_REQUIRED", `residual[${i}].unit is required: units are preserved and never assumed.`);
    if (typeof it.value !== "number" || !Number.isFinite(it.value) || it.value < 0) return bad("OUT_OF_RANGE", `residual[${i}].value must be a finite number that is not negative.`);
    if (list.some((x) => x.type.toLowerCase() === type.toLowerCase() && x.unit.toLowerCase() === unit.toLowerCase())) return bad("RESIDUAL_DUPLICATE", `residual[${i}] repeats ${type} in ${unit}.`);
    list.push({ type, value: it.value, unit });
  }
  if (list.length === 0 && fallback && fallback.value !== null && fallback.unit) list.push({ type: "CONDITION_EXPOSURE", value: fallback.value, unit: fallback.unit });
  if (list.length === 0) return null;
  const units = new Set(list.map((x) => x.unit.toLowerCase()));
  const types = new Set(list.map((x) => x.type.toLowerCase()));
  return {
    items: list,
    single: list.length === 1 ? list[0]! : null,
    note: list.length === 1 ? "A single residual exposure." : `${list.length} residual exposures across ${types.size} type(s) and ${units.size} unit(s): they are listed separately and never summed.`,
  };
}

// ---- expected vs actual / business impact ------------------------------------------------------------------------------------------------

export const EXPECTED_KEYS = ["cash", "profitability", "inventoryReduction", "shortageReduction"] as const;
export type ExpectedKey = (typeof EXPECTED_KEYS)[number];
export const EXPECTED_TO_IMPACT: Record<ExpectedKey, ImpactMeasure> = {
  cash: "cashReleased",
  profitability: "marginProtected",
  inventoryReduction: "inventoryDollarsReduced",
  shortageReduction: "shortageReduced",
};
const EXPECTED_LABELS: Record<ExpectedKey, string> = { cash: "Cash", profitability: "Profitability", inventoryReduction: "Inventory reduction", shortageReduction: "Shortage reduction" };

export interface ExpectedInput {
  value: number;
  unit: string;
  source?: string | null;
}
export interface ActualInput {
  value: number;
  unit: string;
  evidenceRef: string;
}

export interface ExpectedVsActualInput {
  expected?: Partial<Record<ExpectedKey, ExpectedInput | null>> | null;
  actual?: Partial<Record<ImpactMeasure, ActualInput | null>> | null;
  expectedTargetDate?: string | null;
  actualResolvedDate?: string | null;
  actualResolvedEvidenceRef?: string | null;
}

export const normalizeUnit = (u: string): string => {
  const t = u.trim();
  if (/^(usd|\$|us\$|dollars?|us dollars?)$/i.test(t)) return "USD";
  return t;
};

export interface ExpectedVsActualRow {
  key: ExpectedKey;
  measure: ImpactMeasure;
  label: string;
  expected: { value: number; unit: string; source: string | null } | null;
  actual: { value: number; unit: string; evidenceRef: string } | null;
  /** actual - expected, only when both exist in the SAME unit; otherwise null (never converted, never guessed). */
  variance: number | null;
  note: string;
}

export interface ExpectedVsActual {
  rows: ExpectedVsActualRow[];
  timeframe: { expectedTargetDate: string | null; actualResolvedDate: string | null; actualResolvedEvidenceRef: string | null; varianceDays: number | null; note: string };
}

const ymd = /^\d{4}-\d{2}-\d{2}$/;

export function buildExpectedVsActual(input: ExpectedVsActualInput | null | undefined, defaults: { expected?: Partial<Record<ExpectedKey, ExpectedInput>>; expectedTargetDate?: string | null } = {}): ExpectedVsActual {
  const rows: ExpectedVsActualRow[] = EXPECTED_KEYS.map((key) => {
    const measure = EXPECTED_TO_IMPACT[key];
    const rawExp = input?.expected?.[key] ?? defaults.expected?.[key] ?? null;
    let expected: ExpectedVsActualRow["expected"] = null;
    if (rawExp) {
      if (typeof rawExp.value !== "number" || !Number.isFinite(rawExp.value)) return bad("OUT_OF_RANGE", `expected.${key}.value must be a finite number.`);
      if (!rawExp.unit?.trim()) return bad("UNIT_REQUIRED", `expected.${key}.unit is required.`);
      expected = { value: rawExp.value, unit: normalizeUnit(rawExp.unit), source: rawExp.source?.trim() || null };
    }
    const rawAct = input?.actual?.[measure] ?? null;
    let actual: ExpectedVsActualRow["actual"] = null;
    if (rawAct) {
      if (typeof rawAct.value !== "number" || !Number.isFinite(rawAct.value)) return bad("OUT_OF_RANGE", `actual.${measure}.value must be a finite number.`);
      if (!rawAct.unit?.trim()) return bad("UNIT_REQUIRED", `actual.${measure}.unit is required.`);
      if (!rawAct.evidenceRef?.trim()) return bad("ACTUAL_REQUIRES_EVIDENCE", `actual.${measure} needs an evidence reference: an actual outcome is never recorded without evidence.`, { measure });
      actual = { value: rawAct.value, unit: normalizeUnit(rawAct.unit), evidenceRef: rawAct.evidenceRef.trim() };
    }
    let variance: number | null = null;
    let note: string;
    if (expected && actual) {
      if (expected.unit.toLowerCase() === actual.unit.toLowerCase()) {
        variance = Math.round((actual.value - expected.value) * 100) / 100;
        note = "Actual minus expected, same unit.";
      } else note = `Expected (${expected.unit}) and actual (${actual.unit}) are in different units: no variance is computed.`;
    } else if (expected) note = "No evidenced actual result has been recorded.";
    else if (actual) note = "No expected value exists for this measure.";
    else note = "Neither an expected value nor an evidenced actual result exists.";
    return { key, measure, label: `${EXPECTED_LABELS[key]} (${IMPACT_LABELS[measure]})`, expected, actual, variance, note };
  });
  const expectedTargetDate = input?.expectedTargetDate ?? defaults.expectedTargetDate ?? null;
  const actualResolvedDate = input?.actualResolvedDate ?? null;
  const evidence = input?.actualResolvedEvidenceRef?.trim() || null;
  if (expectedTargetDate && !ymd.test(expectedTargetDate)) bad("INVALID_DATE", "expectedTargetDate must be YYYY-MM-DD.");
  if (actualResolvedDate && !ymd.test(actualResolvedDate)) bad("INVALID_DATE", "actualResolvedDate must be YYYY-MM-DD.");
  if (actualResolvedDate && !evidence) bad("ACTUAL_REQUIRES_EVIDENCE", "actualResolvedDate needs an evidence reference.");
  let varianceDays: number | null = null;
  let note = "No evidenced actual resolution date has been recorded.";
  if (expectedTargetDate && actualResolvedDate) {
    varianceDays = Math.round((Date.parse(`${actualResolvedDate}T00:00:00Z`) - Date.parse(`${expectedTargetDate}T00:00:00Z`)) / 86_400_000);
    note = varianceDays > 0 ? `${varianceDays} day(s) after the target date.` : varianceDays < 0 ? `${-varianceDays} day(s) before the target date.` : "On the target date.";
  } else if (actualResolvedDate) note = "No target date exists to compare with.";
  return { rows, timeframe: { expectedTargetDate, actualResolvedDate, actualResolvedEvidenceRef: evidence, varianceDays, note } };
}

/** The evidenced actuals of a version as a flat list (each keeps its own unit; never summed across measures). */
export function actualImpacts(eva: ExpectedVsActual | null | undefined): Array<{ measure: ImpactMeasure; value: number; unit: string; evidenceRef: string }> {
  return (eva?.rows ?? []).filter((r) => r.actual).map((r) => ({ measure: r.measure, ...r.actual! }));
}

export const IMPACT_MEASURE_LIST = IMPACT_MEASURES;

// ---- hashing ------------------------------------------------------------------------------------------------------------------------------

/** Deterministic JSON (sorted keys) for content hashes. */
export function stableJson(value: unknown): string {
  const norm = (v: unknown): unknown => {
    if (Array.isArray(v)) return v.map(norm);
    if (v && typeof v === "object") {
      if (v instanceof Date) return v.toISOString();
      return Object.fromEntries(Object.entries(v as Record<string, unknown>).filter(([, x]) => x !== undefined).sort(([a], [b]) => a.localeCompare(b)).map(([k, x]) => [k, norm(x)]));
    }
    return v;
  };
  return JSON.stringify(norm(value));
}
export const contentHash = (value: unknown): string => createHash("sha256").update(stableJson(value)).digest("hex");
