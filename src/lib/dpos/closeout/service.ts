/**
 * Stage 4E formal closeout service.
 *
 *   Active Action -> Action Completed -> Completed History (execution done, NOT closeout, 4E-D1)
 *     -> Formal Closeout Review (startCloseout) -> Outcome Measurement (recordMeasurement, immutable versions)
 *     -> Resolution Classification + Attribution + Residual Exposure -> Management Approval (approveCloseout)
 *     -> Learning Record (recordLearning, evidence only) -> Candidate Permanently Closed (completeCloseout).
 *
 * Every operation is ONE transaction (business rows, closeout history, audit and Results Return outbox events together). Closing
 * is the last write of the closing transaction; afterwards database triggers refuse any change to the candidate, the closeout,
 * its versions, approvals, history and learning. A returning condition is a NEW candidate linked as a recurrence (recurrence.ts).
 *
 * Nothing here scores, ranks, recommends, calculates Health or learns: the learning record is evidence capture only (4E principle).
 */
import type { PrismaClient } from "@prisma/client";
import { DposError } from "../errors";
import {
  assertWorkflowState,
  latestApprovedPlan,
  latestRecommendation,
  loadTracking,
  optionalText,
  ownershipFacts,
  parseJson,
  requireText,
  runOperation,
  toJson,
  closeCandidate,
  type Ctx,
  type OperationResult,
  type Tx,
} from "../workflow/internal";
import { isManagement, requireContributorOrAbove, requireManagement, requireSystemOrManagement, type WorkflowActor } from "../workflow/permissions";
import { readHealthContext, readPlanAndCoi, readScoringHistory, buildCoiVsActual } from "./context";
import {
  assessWindow,
  buildExpectedVsActual,
  capOutcomeConfidence,
  contentHash,
  isFinalStatus,
  measureCondition,
  normalizeResidual,
  resolutionGuidance,
  validateAssertedStatus,
  validateAttribution,
  actualImpacts,
  type AttributionInput,
  type ConditionMeasurement,
  type ExpectedVsActual,
  type ExpectedVsActualInput,
  type ResidualExposure,
  type ResidualItemInput,
} from "./measure";
import { appendHistory, clip, clipList, isoDay, isoTs, parseInstant, requireCloseout, uniqueStrings, currentVersion, type CloseoutRow, type CloseoutVersionRow } from "./shared";
import { CLOSEOUT_ORIGIN, RECURRENCE_RISKS, RESOLUTION_LABELS, type ResolutionStatus } from "./vocab";

type Op<T> = Promise<OperationResult<T>>;

// ---- start -------------------------------------------------------------------------------------------------------------------------

/**
 * Open the formal closeout review of an execution-complete candidate. Only management can start it, only from Completed History (a
 * Completed and Validated candidate must first be archived), and only once per candidate. The candidate stays open: this is NOT closing.
 */
export async function startCloseout(db: PrismaClient, ctx: Ctx, actor: WorkflowActor, candidateId: string, input: { note?: string; at?: Date } = {}): Op<{ closeoutId: string; status: string }> {
  return runOperation(db, ctx, actor, candidateId, { operation: "CLOSEOUT_STARTED", at: input.at, origin: CLOSEOUT_ORIGIN }, async (env) => {
    const { tx, wf, em, at } = env;
    requireManagement(actor, "Starting formal closeout");
    if (wf.workflowState === "COMPLETED_VALIDATED") {
      throw new DposError("CLOSEOUT_REQUIRES_COMPLETED_HISTORY", "Move the validated completion to Completed History before starting formal closeout (execution complete is not closeout).", 409, { state: wf.workflowState });
    }
    assertWorkflowState(wf, ["COMPLETED_HISTORY"], "Starting formal closeout");
    const t = await loadTracking(tx, candidateId);
    if (t.actionStatus !== "COMPLETED") throw new DposError("ACTION_NOT_COMPLETED", "Formal closeout can start only after the action's execution is complete.", 409);
    if (await tx.iamCoreCloseout.findUnique({ where: { candidateId } })) throw new DposError("CLOSEOUT_ALREADY_STARTED", "Formal closeout has already been started for this candidate.", 409);
    const note = optionalText(input.note, "note");
    const plan = await latestApprovedPlan(tx, candidateId);
    const rec = await latestRecommendation(tx, candidateId);
    const co = await tx.iamCoreCloseout.create({
      data: {
        candidateId,
        dposCompanyId: ctx.dposCompanyId,
        groupedConditionKey: env.candidate.groupedConditionKey,
        status: "STARTED",
        currentVersion: 0,
        planVersion: plan?.planVersion ?? null,
        recommendationVersion: rec?.recommendationVersion ?? null,
        startedAt: at,
        startedBy: actor.actorId,
        startedByRole: actor.role,
      },
    });
    await appendHistory(tx, ctx, co, wf, { operation: "CLOSEOUT_STARTED", from: null, to: "STARTED", actor, at, reason: note, detail: { planVersion: plan?.planVersion ?? null, recommendationVersion: rec?.recommendationVersion ?? null } });
    await em.emit(
      "CLOSEOUT_STARTED",
      {
        closeout: {
          closeoutId: co.closeoutId,
          closeoutVersion: 1,
          closeoutPhase: "STARTED",
          actionCompletionPct: t.actionCompletionPct ?? undefined,
          actualCompletionDate: isoDay(t.completedAt),
          originalRecommendationRef: rec ? `recommendation:${rec.recommendationVersion}` : undefined,
          approvedPlanRef: plan ? `plan:${plan.planVersion}` : undefined,
        },
      },
      co.closeoutId,
    );
    return { closeoutId: co.closeoutId, status: co.status };
  });
}

// ---- owner / contributor observation ---------------------------------------------------------------------------------------------

export interface ObservationInput {
  observation: string;
  evidenceRef?: string | null;
  /** An observed exposure value (owner / authorized / manager only; a contributor adds notes and evidence only). */
  observedValue?: number | null;
  unit?: string | null;
  observedAt?: string | null;
  at?: Date;
}

/**
 * The task owner provides final execution evidence and outcome observations; a contributor adds notes and evidence. This NEVER sets the
 * official measurement, approves, or closes anything: the owner alone cannot permanently close (management measures and approves).
 */
export async function recordObservation(db: PrismaClient, ctx: Ctx, actor: WorkflowActor, candidateId: string, input: ObservationInput): Op<{ historyRecorded: true }> {
  return runOperation(db, ctx, actor, candidateId, { operation: "CLOSEOUT_OBSERVATION", at: input.at, origin: CLOSEOUT_ORIGIN }, async (env) => {
    const { tx, wf, at } = env;
    const { facts } = await ownershipFacts(tx, candidateId);
    const relation = requireContributorOrAbove(actor, facts, "Recording a closeout observation");
    const co = await requireCloseout(tx, candidateId, "Recording an observation");
    const text = requireText(input.observation, "observation");
    const hasValue = input.observedValue !== null && input.observedValue !== undefined;
    if (hasValue && relation === "CONTRIBUTOR") {
      throw new DposError("CONTRIBUTOR_NOT_AUTHORIZED", "Contributors may add notes and evidence but cannot record observed values unless management authorizes them.", 403);
    }
    if (hasValue && (typeof input.observedValue !== "number" || !Number.isFinite(input.observedValue) || input.observedValue < 0)) throw new DposError("OUT_OF_RANGE", "observedValue must be a finite number that is not negative.", 400);
    if (hasValue && !input.unit?.trim()) throw new DposError("UNIT_REQUIRED", "An observed value needs its unit.", 400);
    await appendHistory(tx, ctx, co, wf, {
      operation: "CLOSEOUT_OBSERVATION",
      actor,
      at,
      reason: text,
      detail: { relation, evidenceRef: input.evidenceRef?.trim() || null, observedValue: hasValue ? input.observedValue : null, unit: input.unit?.trim() || null, observedAt: input.observedAt ?? null },
    });
    return { historyRecorded: true as const };
  });
}

// ---- measurement ------------------------------------------------------------------------------------------------------------------------

export interface RecordMeasurementInput {
  baselineExposure?: number | null;
  /** Required when the baseline differs from the recorded action baseline. */
  baselineChangeReason?: string | null;
  finalExposure?: number | null;
  exposureUnit?: string | null;
  measurementStart?: string | null;
  measurementEnd?: string | null;
  evidenceCurrentThrough?: string | null;
  // Not Yet Measured handling
  nextMeasurementDate?: string | null;
  notYetMeasuredReason?: string | null;
  requiredEvidence?: string[] | null;
  residual?: ResidualItemInput[] | null;
  expectedVsActual?: ExpectedVsActualInput | null;
  /** The status this version asserts. Omit to take the system guidance; required (with a rationale) when guidance needs judgement or you differ from it. */
  assessedStatus?: string | null;
  assessmentRationale?: string | null;
  outcomeConfidence?: string | null;
  outcomeConfidenceRationale?: string | null;
  attribution?: AttributionInput | null;
  recurrenceRisk?: string | null;
  recurrenceRiskRationale?: string | null;
  followUpRecommendation?: string | null;
  dataLimitations?: string[] | null;
  evidenceRefs?: string[] | null;
  observationRefs?: string[] | null;
  /** Required when this version revises an earlier one. */
  revisionReason?: string | null;
  at?: Date;
}

function measurementFromVersion(v: CloseoutVersionRow): ConditionMeasurement {
  return { state: v.conditionReductionState as ConditionMeasurement["state"], baseline: v.baselineExposure, final: v.finalExposure, unit: v.exposureUnit, pct: v.conditionReductionPct, worseThanBaseline: (v.conditionReductionPct ?? 0) < 0, reason: null };
}

/**
 * Record one immutable measurement / assessment version. A later version supersedes (never edits) the earlier one until the final lock;
 * an approval of a superseded version no longer counts. Management or the IAM system records measurements; the owner only observes.
 */
export async function recordMeasurement(db: PrismaClient, ctx: Ctx, actor: WorkflowActor, candidateId: string, input: RecordMeasurementInput): Op<{ closeoutId: string; closeoutVersion: number; assessedStatus: string; recommendedStatus: string | null; judgementRequired: boolean; assessmentKind: string; conditionReductionPct: number | null; conditionReductionState: string; outcomeConfidence: string; attributionCategory: string }> {
  return runOperation(db, ctx, actor, candidateId, { operation: "CLOSEOUT_MEASUREMENT", at: input.at, origin: CLOSEOUT_ORIGIN }, async (env) => {
    const { tx, wf, em, at } = env;
    requireSystemOrManagement(actor, "Recording a closeout measurement");
    const co = await requireCloseout(tx, candidateId, "Recording a measurement");
    const t = await loadTracking(tx, candidateId);
    const prior = await currentVersion(tx, co);
    const revisionReason = optionalText(input.revisionReason, "revisionReason");
    if (prior && !revisionReason) throw new DposError("REVISION_REASON_REQUIRED", "A new closeout version revises an earlier one: state why (the earlier version is preserved).", 400);

    // ---- facts (units preserved, nothing defaulted to look better)
    const baseline = input.baselineExposure ?? t.baselineExposure ?? null;
    const baselineChanged = input.baselineExposure !== null && input.baselineExposure !== undefined && t.baselineExposure !== null && input.baselineExposure !== t.baselineExposure;
    const baselineChangeReason = optionalText(input.baselineChangeReason, "baselineChangeReason");
    if (baselineChanged && !baselineChangeReason) throw new DposError("BASELINE_CHANGE_REASON_REQUIRED", "The baseline differs from the recorded action baseline: state the reason (the original baseline stays in the action ledger).", 400, { recorded: t.baselineExposure, supplied: input.baselineExposure });
    const unit = input.exposureUnit?.trim() || t.exposureUnit || null;
    const measurement = measureCondition(baseline, input.finalExposure ?? null, unit);
    if (measurement.state === "MEASURED" && !unit) throw new DposError("UNIT_REQUIRED", "A measured exposure needs its unit.", 400);
    const windowInput = {
      actionCompletedAt: t.completedAt,
      measurementStart: parseInstant(input.measurementStart, "measurementStart"),
      measurementEnd: parseInstant(input.measurementEnd, "measurementEnd"),
      evidenceCurrentThrough: parseInstant(input.evidenceCurrentThrough, "evidenceCurrentThrough"),
    };
    const window = assessWindow(windowInput);
    const guidance = resolutionGuidance(measurement, window);
    const evidenceRefs = uniqueStrings(input.evidenceRefs, "evidenceRefs");
    const observationRefs = uniqueStrings(input.observationRefs, "observationRefs");
    const rationale = optionalText(input.assessmentRationale, "assessmentRationale");

    // ---- the status this version asserts
    let assessed: ResolutionStatus;
    if (input.assessedStatus) {
      assessed = validateAssertedStatus(input.assessedStatus, { measurement, guidance, rationale, evidenceRefs, field: "assessedStatus" });
      if (assessed !== guidance.recommendedStatus && !isManagement(actor)) throw new DposError("MANAGEMENT_AUTHORIZATION_REQUIRED", "Only management can assert a status that differs from the system guidance.", 403);
    } else if (guidance.recommendedStatus) assessed = guidance.recommendedStatus;
    else throw new DposError("MANAGEMENT_JUDGEMENT_REQUIRED", guidance.basis.explanation, 400, { rule: guidance.basis.rule, conditionReductionPct: measurement.pct });
    const kind = measurement.state === "MEASURED" ? "MEASUREMENT" : "NOT_YET_MEASURED";

    // ---- Not Yet Measured handling (never closes prematurely): next date, reason and the evidence still required
    const nextMeasurementDate = parseInstant(input.nextMeasurementDate, "nextMeasurementDate");
    const notYetReason = optionalText(input.notYetMeasuredReason, "notYetMeasuredReason");
    const requiredEvidence = uniqueStrings(input.requiredEvidence, "requiredEvidence");
    if (assessed === "NOT_YET_MEASURED" || assessed === "IMPROVING" || assessed === "ON_TARGET") {
      if (assessed === "NOT_YET_MEASURED" && (!notYetReason || !nextMeasurementDate || requiredEvidence.length === 0)) {
        throw new DposError("NOT_YET_MEASURED_DETAILS_REQUIRED", "A Not Yet Measured version records why, the next measurement date and the evidence still required.", 400, { notYetMeasuredReason: !!notYetReason, nextMeasurementDate: !!nextMeasurementDate, requiredEvidence: requiredEvidence.length });
      }
      if (assessed !== "NOT_YET_MEASURED" && !nextMeasurementDate) {
        throw new DposError("NEXT_MEASUREMENT_REQUIRED", `${RESOLUTION_LABELS[assessed]} is an interim status: record the next measurement date.`, 400);
      }
    }

    const conf = capOutcomeConfidence(input.outcomeConfidence, { measured: measurement.state === "MEASURED" || (assessed === "NO_LONGER_APPLICABLE" && evidenceRefs.length > 0), evidenceRefs, windowAdequate: window.adequate, requestedRationale: input.outcomeConfidenceRationale });
    const attribution = validateAttribution(input.attribution, { measurement, outcomeConfidence: conf.confidence });
    const residual: ResidualExposure | null = normalizeResidual(input.residual, measurement.state === "MEASURED" ? { value: measurement.final, unit: measurement.unit } : undefined);
    const risk = input.recurrenceRisk ?? "UNKNOWN";
    if (!(RECURRENCE_RISKS as readonly string[]).includes(risk)) throw new DposError("VOCABULARY_VIOLATION", `recurrenceRisk must be one of ${RECURRENCE_RISKS.join(", ")}.`, 400);

    // ---- read-only context (scoring history, Health history, plan, COI): captured, never recomputed
    const pc = await readPlanAndCoi(tx, ctx, candidateId, actor, at);
    const eva: ExpectedVsActual = buildExpectedVsActual(input.expectedVsActual, {
      expected: {
        ...(pc.scoringExpected.cash !== null ? { cash: { value: pc.scoringExpected.cash, unit: "USD", source: "Scoring input: expected 13-week net cash impact" } } : {}),
        ...(pc.scoringExpected.profitability !== null ? { profitability: { value: pc.scoringExpected.profitability, unit: "USD", source: "Scoring input: net profitability impact" } } : {}),
      },
      expectedTargetDate: pc.plan.targetResolution,
    });
    const scoring = await readScoringHistory(tx, candidateId, at);
    const health = await readHealthContext(tx, ctx, { candidateCreatedAt: env.candidate.originalCreatedAt, actionStartedAt: t.startedAt, closeoutAt: at });
    const coiVs = buildCoiVsActual(pc.coi, eva, residual);

    const version = co.currentVersion + 1;
    const dataLimitations = uniqueStrings(input.dataLimitations, "dataLimitations");
    if (!window.adequate) dataLimitations.push(`Measurement window: ${window.reason}`);
    if (conf.capped) dataLimitations.push(`Outcome confidence capped to ${conf.confidence}: ${conf.rationale}`);
    if (baselineChanged) dataLimitations.push(`Baseline changed from ${t.baselineExposure} to ${input.baselineExposure}: ${baselineChangeReason}`);
    const core = {
      closeoutId: co.closeoutId,
      candidateId,
      closeoutVersion: version,
      supersedesVersion: prior?.closeoutVersion ?? null,
      assessmentKind: kind,
      recordedAt: at,
      recordedBy: actor.actorId,
      recordedByRole: actor.role,
      measurement,
      window: windowInput,
      guidance,
      assessed,
      rationale,
      confidence: conf,
      attribution,
      residual,
      eva,
      risk,
      evidenceRefs,
      observationRefs,
    };
    const created = await tx.iamCoreCloseoutVersion.create({
      data: {
        closeoutId: co.closeoutId,
        candidateId,
        dposCompanyId: ctx.dposCompanyId,
        closeoutVersion: version,
        supersedesVersion: prior?.closeoutVersion ?? null,
        assessmentKind: kind,
        recordedAt: at,
        recordedBy: actor.actorId,
        recordedByRole: actor.role,
        actionCompletedAt: t.completedAt,
        actionCompletionPct: t.actionCompletionPct,
        measurementStart: windowInput.measurementStart,
        measurementEnd: windowInput.measurementEnd,
        evidenceCurrentThrough: windowInput.evidenceCurrentThrough,
        nextMeasurementDate,
        notYetMeasuredReason: notYetReason,
        requiredEvidenceJson: requiredEvidence.length ? toJson(requiredEvidence) : null,
        baselineExposure: measurement.baseline,
        finalExposure: measurement.final,
        exposureUnit: measurement.unit,
        conditionReductionPct: measurement.pct,
        conditionReductionState: measurement.state,
        residualJson: residual ? toJson(residual) : null,
        expectedVsActualJson: toJson(eva),
        businessImpactJson: toJson(actualImpacts(eva)),
        recommendedStatus: guidance.recommendedStatus,
        judgementRequired: guidance.judgementRequired,
        recommendationBasisJson: toJson(guidance.basis) as string,
        assessedStatus: assessed,
        assessmentOverrideReason: rationale,
        outcomeConfidence: conf.confidence,
        outcomeConfidenceRationale: conf.rationale,
        attributionCategory: attribution.category,
        attributionRationale: attribution.rationale,
        attributionConfidence: attribution.confidence,
        attributionEvidenceJson: toJson(attribution.evidence),
        alternativesJson: toJson(attribution.alternatives),
        recurrenceRisk: risk,
        recurrenceRiskRationale: optionalText(input.recurrenceRiskRationale, "recurrenceRiskRationale"),
        followUpRecommendation: optionalText(input.followUpRecommendation, "followUpRecommendation"),
        dataLimitationsJson: dataLimitations.length ? toJson(dataLimitations) : null,
        evidenceRefsJson: evidenceRefs.length ? toJson(evidenceRefs) : null,
        observationRefsJson: observationRefs.length ? toJson(observationRefs) : null,
        scoringContextJson: toJson(scoring),
        healthContextJson: toJson(health),
        planContextJson: toJson({ ...pc.plan, revisionReason, baselineChangeReason }),
        coiJson: toJson(coiVs),
        contentHash: contentHash(core),
      },
    });

    const superseded = co.approvedVersion !== null && co.approvedVersion !== undefined;
    const interim = !isFinalStatus(assessed);
    await tx.iamCoreCloseout.update({
      where: { closeoutId: co.closeoutId },
      data: {
        currentVersion: version,
        status: kind === "MEASUREMENT" || !interim ? "MEASURED" : "STARTED",
        approvedVersion: null,
        approvedAt: null,
        approvedBy: null,
        planVersion: pc.plan.planVersion,
        recommendationVersion: pc.plan.recommendationVersion,
      },
    });
    await appendHistory(tx, ctx, co, wf, {
      operation: prior ? "CLOSEOUT_VERSION_REVISED" : "CLOSEOUT_MEASURED",
      from: co.status,
      to: kind === "MEASUREMENT" || !interim ? "MEASURED" : "STARTED",
      version,
      actor,
      at,
      reason: revisionReason ?? rationale,
      detail: { assessedStatus: assessed, recommendedStatus: guidance.recommendedStatus, judgementRequired: guidance.judgementRequired, conditionReductionPct: measurement.pct, outcomeConfidence: conf.confidence, attributionCategory: attribution.category, assessmentKind: kind, contentHash: created.contentHash },
    });
    if (superseded) {
      await appendHistory(tx, ctx, co, wf, { operation: "CLOSEOUT_APPROVAL_SUPERSEDED", version: co.approvedVersion, actor, at, reason: `Version ${version} supersedes the approved version ${co.approvedVersion}; management must approve again before the lock.` });
    }
    if (kind === "MEASUREMENT") {
      await tx.iamCoreCandidate.update({ where: { candidateId }, data: { lifecycleState: "OUTCOME_VALIDATED" } });
      const single = residual?.single ?? null;
      await em.emit(
        "OUTCOME_VALIDATED",
        {
          outcome: {
            outcomeState: "MEASURED",
            ...(measurement.baseline !== null && measurement.final !== null && measurement.unit ? { measuredImprovement: Math.round((measurement.baseline - measurement.final) * 100) / 100, improvementUnit: measurement.unit } : {}),
            ...(single ? { residualExposure: single.value } : {}),
            attributionConfidence: attribution.confidence,
            observationPeriodStart: isoDay(windowInput.measurementStart),
            observationPeriodEnd: isoDay(windowInput.measurementEnd),
            validatedAt: at.toISOString(),
          },
          closeout: closeoutSection(co, created, { phase: "MEASURED", residual }),
        },
        `${co.closeoutId}:v${version}`,
      );
    }
    return {
      closeoutId: co.closeoutId,
      closeoutVersion: version,
      assessedStatus: assessed,
      recommendedStatus: guidance.recommendedStatus,
      judgementRequired: guidance.judgementRequired,
      assessmentKind: kind,
      conditionReductionPct: measurement.pct,
      conditionReductionState: measurement.state,
      outcomeConfidence: conf.confidence,
      attributionCategory: attribution.category,
    };
  });
}

/** The contract `closeout` section describing one version (additive r4e fields). */
export function closeoutSection(co: Pick<CloseoutRow, "closeoutId">, v: CloseoutVersionRow, o: { phase: "MEASURED" | "APPROVED" | "COMPLETED"; residual: ResidualExposure | null; approvedBy?: string | null; approvedAt?: Date | null; approvedVersion?: number | null; finalStatus?: string | null; overrideReason?: string | null; closeoutAt?: Date | null; learningRecordId?: string | null; learningNotApplicableReason?: string | null }) {
  const single = o.residual?.single ?? null;
  const limits = parseJson<string[]>(v.dataLimitationsJson, []);
  const refs = parseJson<string[]>(v.evidenceRefsJson, []);
  return {
    closeoutId: co.closeoutId,
    closeoutVersion: v.closeoutVersion,
    closeoutPhase: o.phase,
    ...(v.recommendedStatus ? { recommendedResolutionStatus: v.recommendedStatus } : {}),
    assessedResolutionStatus: v.assessedStatus,
    ...(o.finalStatus ? { finalResolutionStatus: o.finalStatus } : {}),
    ...(o.overrideReason ? { managementOverrideReason: clip(o.overrideReason) } : {}),
    ...(o.approvedBy ? { approvedBy: o.approvedBy } : {}),
    ...(o.approvedAt ? { approvedAt: o.approvedAt.toISOString() } : {}),
    ...(o.approvedVersion ? { approvedVersion: o.approvedVersion } : {}),
    ...(o.closeoutAt ? { closeoutAt: o.closeoutAt.toISOString() } : {}),
    outcomeConfidence: v.outcomeConfidence,
    attributionCategory: v.attributionCategory,
    attributionRationale: clip(v.attributionRationale),
    attributionConfidence: v.attributionConfidence,
    conditionReductionState: v.conditionReductionState,
    ...(v.conditionReductionPct !== null ? { conditionReductionPct: v.conditionReductionPct } : {}),
    ...(v.baselineExposure !== null ? { baselineExposure: v.baselineExposure } : {}),
    ...(v.finalExposure !== null ? { finalExposure: v.finalExposure } : {}),
    ...(single ? { residualExposure: single.value, residualExposureUnit: single.unit } : v.exposureUnit && v.finalExposure !== null ? { residualExposureUnit: v.exposureUnit } : {}),
    ...(v.actionCompletionPct !== null ? { actionCompletionPct: v.actionCompletionPct } : {}),
    ...(v.actionCompletedAt ? { actualCompletionDate: isoDay(v.actionCompletedAt) } : {}),
    ...(v.measurementStart ? { measurementPeriodStart: isoDay(v.measurementStart) } : {}),
    ...(v.measurementEnd ? { measurementPeriodEnd: isoDay(v.measurementEnd) } : {}),
    ...(v.evidenceCurrentThrough ? { evidenceCurrentThrough: isoTs(v.evidenceCurrentThrough) } : {}),
    ...(v.nextMeasurementDate ? { nextMeasurementDate: isoDay(v.nextMeasurementDate) } : {}),
    ...(v.notYetMeasuredReason ? { notYetMeasuredReason: clip(v.notYetMeasuredReason) } : {}),
    recurrenceRisk: v.recurrenceRisk,
    ...(o.learningRecordId ? { learningRecordId: o.learningRecordId } : {}),
    ...(o.learningNotApplicableReason ? { learningNotApplicableReason: clip(o.learningNotApplicableReason) } : {}),
    ...(limits.length ? { dataLimitations: clipList(limits) } : {}),
    ...(refs.length ? { evidenceRefs: clipList(refs) } : {}),
  };
}

// ---- approval -------------------------------------------------------------------------------------------------------------------------------

export interface ApproveCloseoutInput {
  /** The version being approved (defaults to the current one; a stale version is refused). */
  closeoutVersion?: number;
  /** One of the six final statuses (never Not Yet Measured, Improving or On Target). */
  finalStatus: string;
  /** Required when the approved status differs from the system recommendation (or the system gave none) or from the assessed status. */
  overrideReason?: string | null;
  note?: string | null;
  /** Explicitly record that no learning record applies (otherwise a learning record must exist before the lock). */
  learningNotApplicableReason?: string | null;
  at?: Date;
}

/**
 * Management approves ONE closeout version. Both the system recommendation and the approved status are preserved. Approval is not the
 * lock: the candidate closes only at completeCloseout, after the gate in section 37 holds.
 */
export async function approveCloseout(db: PrismaClient, ctx: Ctx, actor: WorkflowActor, candidateId: string, input: ApproveCloseoutInput): Op<{ approvalId: string; closeoutVersion: number; finalStatus: string }> {
  return runOperation(db, ctx, actor, candidateId, { operation: "CLOSEOUT_APPROVED", at: input.at, origin: CLOSEOUT_ORIGIN }, async (env) => {
    const { tx, wf, em, at } = env;
    requireManagement(actor, "Approving a closeout");
    const co = await requireCloseout(tx, candidateId, "Approving the closeout");
    const v = await currentVersion(tx, co);
    if (!v) throw new DposError("CLOSEOUT_NOT_MEASURED", "No outcome has been recorded yet: record a measurement before approval.", 409);
    if (input.closeoutVersion !== undefined && input.closeoutVersion !== v.closeoutVersion) throw new DposError("CLOSEOUT_VERSION_STALE", `Version ${input.closeoutVersion} is not the current closeout version (${v.closeoutVersion}); review the current version.`, 409, { current: v.closeoutVersion });
    if (co.approvedVersion === v.closeoutVersion) throw new DposError("CLOSEOUT_VERSION_ALREADY_APPROVED", "This closeout version is already approved.", 409);
    if (!isFinalStatus(input.finalStatus) || input.finalStatus === "NOT_YET_MEASURED") {
      throw new DposError("FINAL_STATUS_REQUIRED", `The approved status must be one of the six final statuses (Not Yet Measured, Improving and On Target are interim and keep the candidate in closeout).`, 400, { finalStatus: input.finalStatus });
    }
    const overrideReason = optionalText(input.overrideReason, "overrideReason");
    const evidenceRefs = parseJson<string[]>(v.evidenceRefsJson, []);
    const recommended = v.recommendedStatus;
    const final = validateAssertedStatus(input.finalStatus, {
      measurement: measurementFromVersion(v),
      guidance: { recommendedStatus: recommended as ResolutionStatus | null, judgementRequired: v.judgementRequired, windowAdequate: true, basis: parseJson(v.recommendationBasisJson, { rule: "", explanation: "", conditionReductionPct: v.conditionReductionPct, windowReason: "" }) },
      rationale: overrideReason ?? (input.finalStatus === v.assessedStatus ? v.assessmentOverrideReason : null),
      evidenceRefs,
      field: "finalStatus",
    });
    if (final !== recommended && !overrideReason && !(final === v.assessedStatus && v.assessmentOverrideReason)) {
      throw new DposError("OVERRIDE_REASON_REQUIRED", recommended ? `The approved status (${final}) differs from the system recommendation (${recommended}): state the reason.` : "The system gave no recommendation (management judgement is required): state the reason for the approved status.", 400, { recommended });
    }
    if (final !== v.assessedStatus && !overrideReason) throw new DposError("OVERRIDE_REASON_REQUIRED", `The approved status (${final}) differs from the assessed status (${v.assessedStatus}): state the reason.`, 400);
    if (v.assessmentKind === "NOT_YET_MEASURED" && final !== "NO_LONGER_APPLICABLE" && evidenceRefs.length === 0) {
      throw new DposError("EVIDENCE_REQUIRED", "A final status on an unmeasured outcome needs evidence references (or a No Longer Applicable justification).", 409);
    }
    const note = optionalText(input.note, "note");
    const naReason = optionalText(input.learningNotApplicableReason, "learningNotApplicableReason");
    const approval = await tx.iamCoreCloseoutApproval.create({
      data: {
        closeoutId: co.closeoutId,
        candidateId,
        dposCompanyId: ctx.dposCompanyId,
        closeoutVersion: v.closeoutVersion,
        recommendedStatus: recommended,
        assessedStatus: v.assessedStatus,
        finalStatus: final,
        overrideReason: overrideReason ?? (final === v.assessedStatus ? v.assessmentOverrideReason : null),
        approvedBy: actor.actorId,
        approvedByRole: actor.role,
        approvedAt: at,
        note,
        learningNotApplicableReason: naReason,
      },
    });
    await tx.iamCoreCloseout.update({ where: { closeoutId: co.closeoutId }, data: { status: "APPROVED", approvedVersion: v.closeoutVersion, approvedAt: at, approvedBy: actor.actorId } });
    await appendHistory(tx, ctx, co, wf, { operation: "CLOSEOUT_APPROVED", from: co.status, to: "APPROVED", version: v.closeoutVersion, actor, at, reason: overrideReason ?? note, detail: { recommendedStatus: recommended, assessedStatus: v.assessedStatus, finalStatus: final, learningNotApplicableReason: naReason } });
    const residual = parseJson<ResidualExposure | null>(v.residualJson, null);
    await em.emit(
      "CLOSEOUT_APPROVED",
      {
        closeout: closeoutSection(co, v, { phase: "APPROVED", residual, approvedBy: actor.actorId, approvedAt: at, approvedVersion: v.closeoutVersion, finalStatus: final, overrideReason: approval.overrideReason, learningNotApplicableReason: naReason }),
        outcome: { attributionConfidence: v.attributionConfidence },
      },
      approval.approvalId,
    );
    return { approvalId: approval.approvalId, closeoutVersion: v.closeoutVersion, finalStatus: final };
  });
}

// ---- completion gate + permanent closure ---------------------------------------------------------------------------------------------------

export interface GateItem {
  key: string;
  label: string;
  met: boolean;
  detail: string;
}

/** The section-37 completion gate, evaluated from stored records (used by completeCloseout and by the closeout page). */
export async function evaluateCloseoutGate(
  tx: Tx,
  candidateId: string,
  extra: { learningNotApplicableReason?: string | null } = {},
): Promise<{ items: GateItem[]; canComplete: boolean; co: CloseoutRow | null; version: CloseoutVersionRow | null; approval: Awaited<ReturnType<typeof tx.iamCoreCloseoutApproval.findUnique>> | null; learning: Awaited<ReturnType<typeof tx.iamCoreLearningRecord.findUnique>> | null }> {
  const wf = await tx.iamCoreWorkflowState.findUnique({ where: { candidateId } });
  const t = await tx.iamCoreActionTracking.findUnique({ where: { candidateId } });
  const co = await tx.iamCoreCloseout.findUnique({ where: { candidateId } });
  const version = co ? await currentVersion(tx, co) : null;
  const approval = co && version ? await tx.iamCoreCloseoutApproval.findUnique({ where: { closeoutId_closeoutVersion: { closeoutId: co.closeoutId, closeoutVersion: version.closeoutVersion } } }) : null;
  const learning = co && version ? await tx.iamCoreLearningRecord.findUnique({ where: { closeoutId_closeoutVersion: { closeoutId: co.closeoutId, closeoutVersion: version.closeoutVersion } } }) : null;
  const items: GateItem[] = [];
  const add = (key: string, label: string, met: boolean, detail: string) => items.push({ key, label, met, detail });
  add("EXECUTION_COMPLETE", "Execution is complete and the candidate is in Completed History", wf?.workflowState === "COMPLETED_HISTORY" && t?.actionStatus === "COMPLETED", wf?.workflowState === "COMPLETED_HISTORY" ? "Execution complete." : `Workflow state is ${wf?.workflowState ?? "unknown"}.`);
  add("CLOSEOUT_STARTED", "Formal closeout has been started", !!co, co ? `Started ${co.startedAt.toISOString()}.` : "Closeout not started.");
  const measuredOrNla = !!version && (version.assessmentKind === "MEASUREMENT" || (version.assessedStatus === "NO_LONGER_APPLICABLE" && !!version.assessmentOverrideReason));
  add("MEASUREMENT_OR_JUSTIFICATION", "A final measurement / evidence exists, or a No Longer Applicable justification", measuredOrNla, !version ? "No measurement recorded." : measuredOrNla ? "Recorded." : "The current version is Not Yet Measured.");
  const finalOk = !!approval && isFinalStatus(approval.finalStatus) && approval.finalStatus !== "NOT_YET_MEASURED";
  add("FINAL_STATUS", "The final resolution status is final (not Not Yet Measured, Improving or On Target)", finalOk, approval ? `Approved status: ${approval.finalStatus}.` : "No approval of the current version.");
  add("MANAGEMENT_APPROVAL", "Management has approved the current closeout version", !!approval, approval ? `Approved by ${approval.approvedBy} at ${approval.approvedAt.toISOString()}.` : "Awaiting management approval.");
  add("ATTRIBUTION", "Attribution is recorded (even Insufficient)", !!version?.attributionCategory, version ? `${version.attributionCategory}.` : "No version.");
  const residualNeeded = version?.conditionReductionState === "MEASURED";
  add("RESIDUAL_EXPOSURE", "Residual exposure is recorded where measurable", !residualNeeded || !!version?.residualJson, residualNeeded ? (version?.residualJson ? "Recorded." : "Missing.") : "Not measurable for this outcome.");
  const naReason = extra.learningNotApplicableReason?.trim() || approval?.learningNotApplicableReason?.trim() || null;
  add("LEARNING", "A learning record exists, or is explicitly not applicable with a reason", !!learning || !!naReason, learning ? "Learning record captured." : naReason ? `Not applicable: ${naReason}` : "No learning record and no not-applicable reason.");
  return { items, canComplete: items.every((i) => i.met), co, version, approval, learning };
}

export interface CompleteCloseoutInput {
  /** Used only when no learning record exists and none was declared not-applicable at approval. */
  learningNotApplicableReason?: string | null;
  note?: string | null;
  at?: Date;
}

/**
 * Permanently close the candidate. Requires the whole section-37 gate. The closing write is LAST: afterwards the candidate, its
 * closeout, versions, approval, history and learning are immutable and the candidate never reopens (a returning condition is a
 * NEW candidate linked as a recurrence).
 */
export async function completeCloseout(db: PrismaClient, ctx: Ctx, actor: WorkflowActor, candidateId: string, input: CompleteCloseoutInput = {}): Op<{ closeoutId: string; finalResolutionStatus: string; closedAt: Date; closeoutVersion: number }> {
  return runOperation(db, ctx, actor, candidateId, { operation: "CLOSEOUT_COMPLETED", at: input.at, origin: CLOSEOUT_ORIGIN }, async (env) => {
    const { tx, wf, em, at } = env;
    requireManagement(actor, "Completing the closeout");
    const naReason = optionalText(input.learningNotApplicableReason, "learningNotApplicableReason");
    const gate = await evaluateCloseoutGate(tx, candidateId, { learningNotApplicableReason: naReason });
    if (!gate.canComplete || !gate.co || !gate.version || !gate.approval) {
      const unmet = gate.items.filter((i) => !i.met);
      throw new DposError("CLOSEOUT_GATE_NOT_MET", `The closeout cannot be completed yet: ${unmet.map((i) => i.label).join("; ")}.`, 409, { unmet: unmet.map((i) => ({ key: i.key, detail: i.detail })) });
    }
    const { co, version: v, approval, learning } = gate;
    if (co.status === "CLOSED") throw new DposError("CLOSEOUT_ALREADY_CLOSED", "Already closed.", 409);
    const note = optionalText(input.note, "note");
    const residual = parseJson<ResidualExposure | null>(v.residualJson, null);
    const eva = parseJson<ExpectedVsActual | null>(v.expectedVsActualJson, null);
    const impacts = actualImpacts(eva);
    const single = residual?.single ?? null;
    const learningNa = learning ? null : naReason ?? approval.learningNotApplicableReason ?? null;
    // history first (the closing write below is last)
    await appendHistory(tx, ctx, co, wf, { operation: "CLOSEOUT_COMPLETED", from: co.status, to: "CLOSED", version: v.closeoutVersion, actor, at, reason: note, detail: { finalResolutionStatus: approval.finalStatus, learningRecordId: learning?.learningId ?? null, learningNotApplicableReason: learningNa } });
    await tx.iamCoreOutcome.upsert({
      where: { candidateId },
      create: { candidateId, finalResolutionState: approval.finalStatus, measuredResultJson: toJson({ closeoutId: co.closeoutId, closeoutVersion: v.closeoutVersion, conditionReductionPct: v.conditionReductionPct, conditionReductionState: v.conditionReductionState, baselineExposure: v.baselineExposure, finalExposure: v.finalExposure, unit: v.exposureUnit, actualImpacts: impacts }), attributionJson: toJson({ category: v.attributionCategory, rationale: v.attributionRationale, outcomeConfidence: v.outcomeConfidence }), attributionConfidence: v.attributionConfidence, residualExposure: single?.value ?? null, closeoutAt: at, lessonsRef: learning?.learningId ?? null },
      update: { finalResolutionState: approval.finalStatus, measuredResultJson: toJson({ closeoutId: co.closeoutId, closeoutVersion: v.closeoutVersion, conditionReductionPct: v.conditionReductionPct, conditionReductionState: v.conditionReductionState, baselineExposure: v.baselineExposure, finalExposure: v.finalExposure, unit: v.exposureUnit, actualImpacts: impacts }), attributionJson: toJson({ category: v.attributionCategory, rationale: v.attributionRationale, outcomeConfidence: v.outcomeConfidence }), attributionConfidence: v.attributionConfidence, residualExposure: single?.value ?? null, closeoutAt: at, lessonsRef: learning?.learningId ?? null },
    });
    const sections = {
      closeout: {
        ...closeoutSection(co, v, { phase: "COMPLETED", residual, approvedBy: approval.approvedBy, approvedAt: approval.approvedAt, approvedVersion: v.closeoutVersion, finalStatus: approval.finalStatus, overrideReason: approval.overrideReason, closeoutAt: at, learningRecordId: learning?.learningId ?? null, learningNotApplicableReason: learningNa }),
        ...(learning ? { lessonsLearnedRef: learning.learningId } : {}),
        influenceFutureRecommendations: false,
        ...(impacts.length === 1 ? { measuredBusinessImpact: impacts[0]!.value, measuredBusinessImpactUnit: impacts[0]!.unit } : {}),
      },
      outcome: {
        outcomeState: "VALIDATED",
        finalResolutionState: approval.finalStatus,
        attributionConfidence: v.attributionConfidence,
        ...(single ? { residualExposure: single.value, improvementUnit: single.unit } : {}),
        validatedAt: at.toISOString(),
      },
      ...(learning ? { learning: { learningRecordId: learning.learningId, evidenceOnly: true } } : {}),
    };
    await em.emit("CLOSEOUT_COMPLETED", sections, co.closeoutId);
    await tx.iamCoreCloseout.update({ where: { closeoutId: co.closeoutId }, data: { status: "CLOSED", closedAt: at, closedBy: actor.actorId, finalResolutionStatus: approval.finalStatus, finalAttributionCategory: v.attributionCategory } });
    // THE LAST WRITE: the permanent lock. A closed candidate accepts no further writes and never reopens.
    await closeCandidate(tx, candidateId, at, "CLOSED");
    return { closeoutId: co.closeoutId, finalResolutionStatus: approval.finalStatus, closedAt: at, closeoutVersion: v.closeoutVersion };
  });
}
