/**
 * Stage 4E: the board's closeout operations. Each is the existing closeout service operation (so permissions, state rules, audit,
 * immutability and outbox events are the service's own); this module only turns the flat form body into the service input.
 * Nothing here scores, recalculates Health, changes RSE policy or edits a recommendation.
 */
import type { PrismaClient } from "@prisma/client";
import {
  ATTRIBUTION_EVIDENCE_KINDS,
  EXPECTED_KEYS,
  IMPACT_MEASURES,
  approveCloseout,
  completeCloseout,
  recordLearning,
  recordMeasurement,
  recordObservation,
  resolveRecurrenceReview,
  startCloseout,
  type ExpectedVsActualInput,
  type RecordMeasurementInput,
} from "../closeout";
import { EXPECTED_TO_IMPACT } from "../closeout/measure";
import { DposError } from "../errors";
import type { WorkflowActor } from "../workflow";

export const CLOSEOUT_BOARD_ACTIONS = ["startCloseout", "recordObservation", "recordMeasurement", "approveCloseout", "recordLearning", "completeCloseout", "resolveRecurrenceReview"] as const;
export type CloseoutBoardAction = (typeof CLOSEOUT_BOARD_ACTIONS)[number];

export const CLOSEOUT_ACTION_LABELS: Record<CloseoutBoardAction, string> = {
  startCloseout: "Start formal closeout",
  recordObservation: "Record outcome observation",
  recordMeasurement: "Record outcome measurement",
  approveCloseout: "Approve closeout",
  recordLearning: "Record learning",
  completeCloseout: "Complete closeout",
  resolveRecurrenceReview: "Decide recurrence review",
};

type Body = Record<string, unknown>;
type Ctx = { dposCompanyId: string };

const text = (b: Body, k: string): string | undefined => {
  const v = b[k];
  if (v === undefined || v === null) return undefined;
  if (typeof v !== "string") throw new DposError("INVALID_FIELD", `${k} must be text.`, 400, { field: k });
  const t = v.trim();
  return t ? t : undefined;
};
const need = (b: Body, k: string, label: string): string => {
  const v = text(b, k);
  if (!v) throw new DposError("REASON_REQUIRED", `${label} is required.`, 400, { field: k });
  return v;
};
const num = (b: Body, k: string): number | undefined => {
  const v = b[k];
  if (v === undefined || v === null || v === "") return undefined;
  const n = typeof v === "number" ? v : Number(v);
  if (!Number.isFinite(n)) throw new DposError("INVALID_FIELD", `${k} must be a number.`, 400, { field: k });
  return n;
};
const lines = (b: Body, k: string): string[] | undefined => {
  const t = text(b, k);
  if (!t) return undefined;
  const out = t
    .split(/\r?\n|;/)
    .map((s) => s.trim())
    .filter(Boolean);
  return out.length ? out : undefined;
};

/** The flat measurement form body -> the service input. Empty fields stay undefined (nothing is defaulted to look better). */
export function parseMeasurementBody(b: Body): RecordMeasurementInput {
  const input: RecordMeasurementInput = {};
  const set = <K extends keyof RecordMeasurementInput>(k: K, v: RecordMeasurementInput[K] | undefined) => {
    if (v !== undefined) input[k] = v;
  };
  set("baselineExposure", num(b, "baselineExposure"));
  set("baselineChangeReason", text(b, "baselineChangeReason"));
  set("finalExposure", num(b, "finalExposure"));
  set("exposureUnit", text(b, "exposureUnit"));
  set("measurementStart", text(b, "measurementStart"));
  set("measurementEnd", text(b, "measurementEnd"));
  set("evidenceCurrentThrough", text(b, "evidenceCurrentThrough"));
  set("nextMeasurementDate", text(b, "nextMeasurementDate"));
  set("notYetMeasuredReason", text(b, "notYetMeasuredReason"));
  set("requiredEvidence", lines(b, "requiredEvidence"));
  set("assessedStatus", text(b, "assessedStatus"));
  set("assessmentRationale", text(b, "assessmentRationale"));
  set("outcomeConfidence", text(b, "outcomeConfidence"));
  set("outcomeConfidenceRationale", text(b, "outcomeConfidenceRationale"));
  set("recurrenceRisk", text(b, "recurrenceRisk"));
  set("recurrenceRiskRationale", text(b, "recurrenceRiskRationale"));
  set("followUpRecommendation", text(b, "followUpRecommendation"));
  set("dataLimitations", lines(b, "dataLimitations"));
  set("evidenceRefs", lines(b, "evidenceRefs"));
  set("observationRefs", lines(b, "observationRefs"));
  set("revisionReason", text(b, "revisionReason"));

  const residual: Array<{ type: string; value: number; unit: string }> = [];
  for (const i of ["", "2"]) {
    const value = num(b, `residualValue${i}`);
    const type = text(b, `residualType${i}`);
    const unit = text(b, `residualUnit${i}`);
    if (value === undefined && !type && !unit) continue;
    if (value === undefined || !type || !unit) throw new DposError("RESIDUAL_INCOMPLETE", "A residual exposure needs a type, a value and a unit (units are never assumed).", 400);
    residual.push({ type, value, unit });
  }
  if (residual.length) input.residual = residual;

  const category = text(b, "attributionCategory");
  if (category) {
    const evidence: Array<{ kind: string; ref?: string; note?: string }> = [];
    for (const i of ["1", "2", "3"]) {
      const kind = text(b, `attributionEvidenceKind${i}`);
      const ref = text(b, `attributionEvidenceRef${i}`);
      const note = text(b, `attributionEvidenceNote${i}`);
      if (!kind && !ref && !note) continue;
      if (!kind) throw new DposError("ATTRIBUTION_EVIDENCE_KIND_REQUIRED", `Attribution evidence ${i} needs a kind (${ATTRIBUTION_EVIDENCE_KINDS.join(", ")}).`, 400);
      evidence.push({ kind, ...(ref ? { ref } : {}), ...(note ? { note } : {}) });
    }
    input.attribution = {
      category,
      rationale: text(b, "attributionRationale") ?? "",
      ...(text(b, "attributionConfidence") ? { confidence: text(b, "attributionConfidence") } : {}),
      evidence,
      alternatives: lines(b, "attributionAlternatives") ?? [],
    };
  }

  const eva: ExpectedVsActualInput = {};
  const expected: NonNullable<ExpectedVsActualInput["expected"]> = {};
  for (const k of EXPECTED_KEYS) {
    const value = num(b, `expected_${k}_value`);
    const unit = text(b, `expected_${k}_unit`);
    if (value === undefined && !unit) continue;
    if (value === undefined || !unit) throw new DposError("EXPECTED_INCOMPLETE", `Expected ${k} needs both a value and a unit.`, 400);
    expected[k] = { value, unit };
  }
  const actual: NonNullable<ExpectedVsActualInput["actual"]> = {};
  for (const m of IMPACT_MEASURES) {
    const value = num(b, `actual_${m}_value`);
    const unit = text(b, `actual_${m}_unit`);
    const evidenceRef = text(b, `actual_${m}_evidence`);
    if (value === undefined && !unit && !evidenceRef) continue;
    if (value === undefined || !unit) throw new DposError("ACTUAL_INCOMPLETE", `Actual ${m} needs a value and a unit.`, 400);
    actual[m] = { value, unit, evidenceRef: evidenceRef ?? "" };
  }
  if (Object.keys(expected).length) eva.expected = expected;
  if (Object.keys(actual).length) eva.actual = actual;
  const etd = text(b, "expectedTargetDate");
  const ard = text(b, "actualResolvedDate");
  if (etd) eva.expectedTargetDate = etd;
  if (ard) {
    eva.actualResolvedDate = ard;
    eva.actualResolvedEvidenceRef = text(b, "actualResolvedEvidenceRef") ?? "";
  }
  if (Object.keys(eva).length) input.expectedVsActual = eva;
  return input;
}

export const impactFieldNames = () => ({ expected: EXPECTED_KEYS.map((k) => ({ key: k, measure: EXPECTED_TO_IMPACT[k] })) });

export async function performCloseoutAction(db: PrismaClient, ctx: Ctx, actor: WorkflowActor, candidateId: string, action: CloseoutBoardAction, body: Body, at?: Date): Promise<unknown> {
  switch (action) {
    case "startCloseout":
      return startCloseout(db, ctx, actor, candidateId, { note: text(body, "note"), at });
    case "recordObservation":
      return recordObservation(db, ctx, actor, candidateId, {
        observation: need(body, "observation", "An observation"),
        evidenceRef: text(body, "evidenceRef") ?? null,
        observedValue: num(body, "observedValue") ?? null,
        unit: text(body, "unit") ?? null,
        observedAt: text(body, "observedAt") ?? null,
        at,
      });
    case "recordMeasurement":
      return recordMeasurement(db, ctx, actor, candidateId, { ...parseMeasurementBody(body), at });
    case "approveCloseout":
      return approveCloseout(db, ctx, actor, candidateId, {
        closeoutVersion: num(body, "closeoutVersion"),
        finalStatus: need(body, "finalStatus", "The final resolution status"),
        overrideReason: text(body, "overrideReason") ?? null,
        note: text(body, "note") ?? null,
        learningNotApplicableReason: text(body, "learningNotApplicableReason") ?? null,
        at,
      });
    case "recordLearning": {
      const assumptions: Array<{ assumption: string; held: string; evidenceRef?: string }> = [];
      for (const i of ["1", "2"]) {
        const assumption = text(body, `assumption${i}`);
        if (!assumption) continue;
        const held = text(body, `assumptionHeld${i}`) ?? "UNKNOWN";
        const evidenceRef = text(body, `assumptionEvidence${i}`);
        assumptions.push({ assumption, held, ...(evidenceRef ? { evidenceRef } : {}) });
      }
      return recordLearning(db, ctx, actor, candidateId, {
        managementResponse: text(body, "managementResponse") ?? null,
        conditionFamily: text(body, "conditionFamily") ?? null,
        whatWorked: text(body, "whatWorked") ?? null,
        whatDidNotWork: text(body, "whatDidNotWork") ?? null,
        barriers: lines(body, "barriers") ?? null,
        assumptions: assumptions.length ? assumptions : null,
        dependencies: lines(body, "dependencies") ?? null,
        futureHandling: text(body, "futureHandling") ?? null,
        dataLimitations: lines(body, "dataLimitations") ?? null,
        evidenceRefs: lines(body, "evidenceRefs") ?? null,
        at,
      });
    }
    case "completeCloseout":
      return completeCloseout(db, ctx, actor, candidateId, { note: text(body, "note") ?? null, learningNotApplicableReason: text(body, "learningNotApplicableReason") ?? null, at });
    case "resolveRecurrenceReview": {
      const decision = text(body, "decision")?.toUpperCase();
      if (decision !== "CONFIRM" && decision !== "DECLINE") throw new DposError("VOCABULARY_VIOLATION", "decision must be CONFIRM or DECLINE.", 400, { field: "decision" });
      return resolveRecurrenceReview(db, ctx, actor, need(body, "recurrenceId", "The recurrence review"), { decision, reason: need(body, "reason", "A decision reason"), at });
    }
  }
}
