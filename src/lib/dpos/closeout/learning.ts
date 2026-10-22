/**
 * Stage 4E learning: EVIDENCE CAPTURE, not self-modification.
 *
 * A learning record describes what was recommended, what management decided, what happened and how far the action can be credited. It
 * may feed descriptive statistics (counts, rates, averages by segment). It NEVER changes scoring weights, Health curves, RSE policy or
 * recommendation logic, and it implies no causality beyond the recorded attribution. Management deviation from a recommendation is
 * recorded as what happened (followed / modified / alternative / rejected-then-approved / delayed / suppressed-then-approved), never
 * labelled "wrong" because the result was poor.
 */
import type { PrismaClient } from "@prisma/client";
import { DposError, type Db } from "../errors";
import { optionalText, parseJson, runOperation, toJson, type Ctx, type OperationResult, type Tx } from "../workflow/internal";
import { requireSystemOrManagement, type WorkflowActor } from "../workflow/permissions";
import { recurrenceChain } from "./recurrence";
import { CONDITION_FAMILY_VOCABULARY_VERSION, FALLBACK_CONDITION_FAMILY, classifyCandidate, conditionFamilyLabel, readClassification, requireConditionFamily } from "./family";
import { appendHistory, requireCloseout, uniqueStrings, currentVersion } from "./shared";
import { CLOSEOUT_ORIGIN, MANAGEMENT_RESPONSES, MANAGEMENT_RESPONSE_LABELS, RESOLUTION_LABELS, ATTRIBUTION_LABELS, type ManagementResponse, type ResolutionStatus } from "./vocab";
import type { PlanContext } from "./context";
import type { ExpectedVsActual, ResidualExposure } from "./measure";

export const ASSUMPTION_RESULTS = ["TRUE", "FALSE", "UNKNOWN"] as const;

export interface RecordLearningInput {
  /** Explicit management response. When omitted it is derived from the decision history; FOLLOWED is refused when the plan deviated. */
  managementResponse?: string | null;
  whatWorked?: string | null;
  whatDidNotWork?: string | null;
  barriers?: string[] | null;
  assumptions?: Array<{ assumption: string; held: string; evidenceRef?: string | null }> | null;
  dependencies?: string[] | null;
  futureHandling?: string | null;
  dataLimitations?: string[] | null;
  /**
   * Governed condition family (4E-C4). Used only when the candidate has no classification yet (management classifies it now); a code that
   * disagrees with an existing classification is refused. When neither exists the record carries OTHER_GOVERNED_CONDITION, flagged as an
   * unclassified default. The free-form condition text is stored separately as detail and is never a grouping key.
   */
  conditionFamily?: string | null;
  /** Evidence supporting the lessons (required unless the approved closeout version already carries evidence references). */
  evidenceRefs?: string[] | null;
  at?: Date;
}

/** How management's path compares with the system recommendation, derived only from recorded decisions. */
export async function deriveManagementResponse(tx: Tx, candidate: { candidateId: string; groupedConditionKey: string; dposCompanyId: string }, plan: { deviatesFromRecommendation: boolean }): Promise<{ response: ManagementResponse; path: Array<{ decisionType: string; at: string; reason: string | null; candidateId: string }> }> {
  const own = await tx.iamCoreManagementDecision.findMany({ where: { candidateId: candidate.candidateId }, orderBy: { decidedAt: "asc" } });
  const approve = own.find((d) => d.decisionType === "APPROVE") ?? null;
  const cutoff = approve?.decidedAt ?? new Date(8.64e15);
  const priorRejects = await tx.iamCoreManagementDecision.findMany({ where: { dposCompanyId: candidate.dposCompanyId, groupedConditionKey: candidate.groupedConditionKey, decisionType: "REJECT", decidedAt: { lt: cutoff } }, orderBy: { decidedAt: "asc" } });
  const path = [...priorRejects.map((d) => ({ decisionType: d.decisionType, at: d.decidedAt.toISOString(), reason: d.reason, candidateId: d.candidateId })), ...own.map((d) => ({ decisionType: d.decisionType, at: d.decidedAt.toISOString(), reason: d.reason, candidateId: d.candidateId }))].sort((a, b) => a.at.localeCompare(b.at));
  let response: ManagementResponse = "FOLLOWED";
  if (own.some((d) => d.decisionType === "SUPPRESS")) response = "SUPPRESSED_THEN_APPROVED";
  else if (priorRejects.length > 0) response = "REJECTED_THEN_APPROVED";
  else if (own.some((d) => d.decisionType === "RETURN_FOR_REVIEW")) response = "DELAYED";
  else if (plan.deviatesFromRecommendation) response = "MODIFIED";
  return { response, path };
}

/**
 * Capture the learning record of the APPROVED closeout version (one per version). Evidence is required. Nothing here is fed back into
 * scoring, Health, RSE policy or recommendations (the contract event carries influenceFutureRecommendations=false and evidenceOnly=true).
 */
export async function recordLearning(db: PrismaClient, ctx: Ctx, actor: WorkflowActor, candidateId: string, input: RecordLearningInput): Promise<OperationResult<{ learningId: string; closeoutVersion: number; managementResponse: string }>> {
  return runOperation(db, ctx, actor, candidateId, { operation: "LEARNING_RECORDED", at: input.at, origin: CLOSEOUT_ORIGIN }, async (env) => {
    const { tx, wf, em, at } = env;
    requireSystemOrManagement(actor, "Recording a learning record");
    const co = await requireCloseout(tx, candidateId, "Recording learning");
    const v = await currentVersion(tx, co);
    if (!v || co.status !== "APPROVED" || co.approvedVersion !== v.closeoutVersion) {
      throw new DposError("CLOSEOUT_NOT_APPROVED", "A learning record is captured for the APPROVED closeout version: approve the current version first.", 409);
    }
    const approval = await tx.iamCoreCloseoutApproval.findUniqueOrThrow({ where: { closeoutId_closeoutVersion: { closeoutId: co.closeoutId, closeoutVersion: v.closeoutVersion } } });
    if (await tx.iamCoreLearningRecord.findUnique({ where: { closeoutId_closeoutVersion: { closeoutId: co.closeoutId, closeoutVersion: v.closeoutVersion } } })) {
      throw new DposError("LEARNING_ALREADY_RECORDED", "A learning record already exists for this approved closeout version.", 409);
    }
    const whatWorked = optionalText(input.whatWorked, "whatWorked");
    const whatDidNotWork = optionalText(input.whatDidNotWork, "whatDidNotWork");
    const futureHandling = optionalText(input.futureHandling, "futureHandling");
    const barriers = uniqueStrings(input.barriers, "barriers");
    const dependencies = uniqueStrings(input.dependencies, "dependencies");
    const assumptions = (input.assumptions ?? []).map((a, i) => {
      const text = (a.assumption ?? "").trim();
      if (!text) throw new DposError("ASSUMPTION_REQUIRED", `assumptions[${i}].assumption is required.`, 400);
      if (!(ASSUMPTION_RESULTS as readonly string[]).includes(a.held)) throw new DposError("VOCABULARY_VIOLATION", `assumptions[${i}].held must be one of ${ASSUMPTION_RESULTS.join(", ")}.`, 400);
      return { assumption: text.slice(0, 1000), held: a.held, evidenceRef: a.evidenceRef?.trim() || null };
    });
    if (!whatWorked && !whatDidNotWork && !futureHandling && barriers.length === 0 && assumptions.length === 0 && dependencies.length === 0) {
      throw new DposError("LEARNING_CONTENT_REQUIRED", "A learning record needs at least one structured lesson (what worked, what did not, barriers, assumptions, dependencies or future handling).", 400);
    }
    const versionRefs = parseJson<string[]>(v.evidenceRefsJson, []);
    const evidenceRefs = [...new Set([...uniqueStrings(input.evidenceRefs, "evidenceRefs"), ...versionRefs])];
    if (evidenceRefs.length === 0) throw new DposError("EVIDENCE_REQUIRED", "A learning record needs evidence: supply evidence references (or record them on the closeout version).", 400);

    const planCtx = parseJson<PlanContext & { revisionReason?: string | null }>(v.planContextJson, {} as PlanContext);
    const wfRow = await tx.iamCoreWorkflowState.findUnique({ where: { candidateId } });
    const rec = await tx.iamCoreSystemRecommendation.findFirst({ where: { candidateId }, orderBy: { recommendationVersion: "desc" } });
    const tracking = await tx.iamCoreActionTracking.findUnique({ where: { candidateId } });
    const derived = await deriveManagementResponse(tx, env.candidate, { deviatesFromRecommendation: !!planCtx.deviatesFromRecommendation });
    let response = derived.response;
    if (input.managementResponse) {
      if (!(MANAGEMENT_RESPONSES as readonly string[]).includes(input.managementResponse)) throw new DposError("VOCABULARY_VIOLATION", `managementResponse must be one of ${MANAGEMENT_RESPONSES.join(", ")}.`, 400);
      if (input.managementResponse === "FOLLOWED" && derived.response !== "FOLLOWED") throw new DposError("MANAGEMENT_RESPONSE_CONFLICT", `The decision history shows ${derived.response}; it cannot be recorded as Followed.`, 409, { derived: derived.response });
      response = input.managementResponse as ManagementResponse;
    }
    const facets = parseJson<{ facets?: { conditionKey?: string } }>(env.candidate.groupedConditionJson, {}).facets;
    const requestedFamily = input.conditionFamily ? requireConditionFamily(input.conditionFamily) : null;
    const existingClass = await readClassification(tx, candidateId);
    let family: { code: string; version: string; source: string };
    if (existingClass) {
      if (requestedFamily && requestedFamily !== existingClass.familyCode) {
        throw new DposError("CONDITION_FAMILY_CONFLICT", `This candidate is already classified as ${existingClass.familyCode}; a classification is never changed.`, 409, { existing: existingClass.familyCode, requested: requestedFamily });
      }
      family = { code: existingClass.familyCode, version: existingClass.vocabularyVersion, source: existingClass.source };
    } else if (requestedFamily) {
      const made = await classifyCandidate(tx, ctx, { candidateId, familyCode: requestedFamily, source: "MANAGEMENT", classifiedBy: actor.actorId, at });
      family = { code: made.familyCode, version: made.vocabularyVersion, source: made.source };
    } else {
      family = { code: FALLBACK_CONDITION_FAMILY, version: CONDITION_FAMILY_VOCABULARY_VERSION, source: "DEFAULT_UNCLASSIFIED" };
    }
    const residual = parseJson<ResidualExposure | null>(v.residualJson, null);
    const eva = parseJson<ExpectedVsActual | null>(v.expectedVsActualJson, null);
    const chain = await recurrenceChain(tx, candidateId);
    const start = tracking?.startedAt ?? null;
    const end = v.measurementEnd ?? v.evidenceCurrentThrough ?? null;
    const timeToResultDays = start && end ? Math.round(((end.getTime() - start.getTime()) / 86_400_000) * 10) / 10 : null;
    const targetResolution = tracking?.targetResolution ?? null;
    const completedOnTime = tracking?.completedAt && targetResolution ? tracking.completedAt.getTime() <= targetResolution.getTime() + 86_399_999 : null;
    const limits = [...new Set([...uniqueStrings(input.dataLimitations, "dataLimitations"), ...parseJson<string[]>(v.dataLimitationsJson, [])])];
    const created = await tx.iamCoreLearningRecord.create({
      data: {
        closeoutId: co.closeoutId,
        closeoutVersion: v.closeoutVersion,
        candidateId,
        dposCompanyId: ctx.dposCompanyId,
        groupedConditionKey: env.candidate.groupedConditionKey,
        actionType: (planCtx.primaryAction ?? wfRow?.candidateType ?? null)?.slice(0, 500) ?? null,
        department: planCtx.department ?? null,
        ownerRole: planCtx.ownerId ? "TASK_OWNER" : null,
        conditionType: facets?.conditionKey?.slice(0, 500) ?? null,
        conditionFamily: family.code,
        conditionFamilyVersion: family.version,
        conditionFamilySource: family.source,
        category: wfRow?.category ?? null,
        recommendationText: rec?.recommendedActionDirection?.slice(0, 2000) ?? null,
        planSummary: planCtx.summary?.slice(0, 2000) ?? null,
        managementResponse: response,
        deviationReason: planCtx.deviationReason ?? null,
        managementPathJson: toJson(derived.path),
        executionResultJson: toJson({ actionCompletionPct: tracking?.actionCompletionPct ?? null, completedAt: tracking?.completedAt?.toISOString() ?? null, targetResolution: targetResolution?.toISOString() ?? null, completedOnTime, planVersion: planCtx.planVersion ?? null, planRevisions: planCtx.revisions?.length ?? 0 }) as string,
        conditionResultJson: toJson({ conditionReductionPct: v.conditionReductionPct, conditionReductionState: v.conditionReductionState, baselineExposure: v.baselineExposure, finalExposure: v.finalExposure, unit: v.exposureUnit, residual }) as string,
        assessedStatus: approval.finalStatus,
        attributionCategory: v.attributionCategory,
        outcomeConfidence: v.outcomeConfidence,
        expectedVsActualJson: toJson(eva),
        timeToResultDays,
        recurrenceSequence: chain.length,
        recurrenceJson: toJson({ chain, recurrenceCount: chain.length - 1 }),
        whatWorked,
        whatDidNotWork,
        barriersJson: barriers.length ? toJson(barriers) : null,
        assumptionsJson: assumptions.length ? toJson(assumptions) : null,
        dependenciesJson: dependencies.length ? toJson(dependencies) : null,
        futureHandling,
        dataLimitationsJson: limits.length ? toJson(limits) : null,
        evidenceRefsJson: toJson(evidenceRefs),
        recordedBy: actor.actorId,
        recordedByRole: actor.role,
        recordedAt: at,
      },
    });
    await appendHistory(tx, ctx, co, wf, { operation: "LEARNING_RECORDED", version: v.closeoutVersion, actor, at, detail: { learningId: created.learningId, managementResponse: response, evidenceOnly: true } });
    await em.emit(
      "LEARNING_RECORDED",
      {
        learning: {
          learningRecordId: created.learningId,
          ...(created.actionType ? { actionType: created.actionType } : {}),
          normalizedOutcome: approval.finalStatus,
          resultSummary: `${RESOLUTION_LABELS[approval.finalStatus as ResolutionStatus]}; attribution: ${ATTRIBUTION_LABELS[v.attributionCategory as keyof typeof ATTRIBUTION_LABELS]}; management response: ${MANAGEMENT_RESPONSE_LABELS[response]}.`.slice(0, 4000),
          confidence: v.attributionConfidence,
          managementResponse: response,
          ...(timeToResultDays !== null && timeToResultDays >= 0 ? { timeToResultDays } : {}),
          recurrenceSequence: chain.length,
          evidenceOnly: true,
        },
        closeout: { closeoutId: co.closeoutId, closeoutVersion: v.closeoutVersion },
      },
      created.learningId,
    );
    return { learningId: created.learningId, closeoutVersion: v.closeoutVersion, managementResponse: response };
  });
}

// ---- descriptive effectiveness (read only) ---------------------------------------------------------------------------------------------------

export interface EffectivenessGroup {
  key: string;
  /** Display label (condition families show the governed label; every other segment shows its key). */
  label: string;
  closed: number;
  /** Closed candidates whose condition reduction was measured (excluding No Longer Applicable). */
  measured: number;
  /** Fully or Substantially Resolved among the measured. */
  succeeded: number;
  measuredSuccessRatePct: number | null;
  avgConditionReductionPct: number | null;
  recurred: number;
  recurrenceRatePct: number | null;
  avgTimeToResultDays: number | null;
  expectedVsActual: Array<{ measure: string; unit: string; n: number; avgVariance: number }>;
  /** Few cases: shown for reference, never as a conclusion. */
  lowSample: boolean;
}

export interface EffectivenessView {
  asOf: string;
  attemptedActions: number;
  completedActions: number;
  completionRatePct: number | null;
  closedCandidates: number;
  resolutionDistribution: Array<{ status: string; label: string; count: number }>;
  overall: EffectivenessGroup;
  segments: Record<"actionType" | "conditionFamily" | "department" | "category" | "outcomeConfidence" | "attribution", EffectivenessGroup[]>;
  managementResponses: Array<EffectivenessGroup & { response: string; label: string }>;
  commonBarriers: Array<{ barrier: string; count: number }>;
  recentClosed: Array<{ candidateId: string; title: string | null; closedAt: string; finalStatus: string; finalLabel: string; attributionCategory: string | null; attributionLabel: string | null; conditionReductionPct: number | null; outcomeConfidence: string | null; learningRecorded: boolean }>;
  recurrence: { closedCandidates: number; withRecurrence: number; ratePct: number | null };
  statement: string;
}

const LOW_SAMPLE = 5;
const r2 = (n: number) => Math.round(n * 100) / 100;
const avg = (xs: number[]) => (xs.length ? r2(xs.reduce((a, b) => a + b, 0) / xs.length) : null);

interface Row {
  candidateId: string;
  finalStatus: string;
  reduction: number | null;
  measuredState: string;
  days: number | null;
  recurred: boolean;
  eva: ExpectedVsActual | null;
  segments: Record<string, string>;
}

function group(key: string, rows: Row[], label: string = key): EffectivenessGroup {
  const measured = rows.filter((r) => r.measuredState === "MEASURED" && r.finalStatus !== "NO_LONGER_APPLICABLE");
  const succeeded = measured.filter((r) => r.finalStatus === "FULLY_RESOLVED" || r.finalStatus === "SUBSTANTIALLY_RESOLVED");
  const recurred = rows.filter((r) => r.recurred).length;
  const vmap = new Map<string, { measure: string; unit: string; xs: number[] }>();
  for (const r of rows) {
    for (const row of r.eva?.rows ?? []) {
      if (row.variance === null || !row.actual) continue;
      const k = `${row.measure}|${row.actual.unit}`;
      const e = vmap.get(k) ?? { measure: row.measure, unit: row.actual.unit, xs: [] };
      e.xs.push(row.variance);
      vmap.set(k, e);
    }
  }
  return {
    key,
    label,
    closed: rows.length,
    measured: measured.length,
    succeeded: succeeded.length,
    measuredSuccessRatePct: measured.length ? r2((succeeded.length / measured.length) * 100) : null,
    avgConditionReductionPct: avg(measured.map((r) => r.reduction).filter((x): x is number => x !== null)),
    recurred,
    recurrenceRatePct: rows.length ? r2((recurred / rows.length) * 100) : null,
    avgTimeToResultDays: avg(rows.map((r) => r.days).filter((x): x is number => x !== null)),
    expectedVsActual: [...vmap.values()].map((e) => ({ measure: e.measure, unit: e.unit, n: e.xs.length, avgVariance: avg(e.xs) as number })),
    lowSample: rows.length < LOW_SAMPLE,
  };
}

export async function readEffectiveness(db: Db, ctx: Ctx, now: Date = new Date()): Promise<EffectivenessView> {
  const closeouts = await db.iamCoreCloseout.findMany({ where: { dposCompanyId: ctx.dposCompanyId, status: "CLOSED" }, orderBy: { closedAt: "desc" } });
  const learning = await db.iamCoreLearningRecord.findMany({ where: { dposCompanyId: ctx.dposCompanyId }, orderBy: { recordedAt: "desc" } });
  const learningBy = new Map(learning.map((l) => [l.candidateId, l]));
  const priors = new Set((await db.iamCoreRecurrenceLink.findMany({ where: { dposCompanyId: ctx.dposCompanyId, matchStatus: { in: ["LINKED", "REVIEW_CONFIRMED"] } }, select: { priorCandidateId: true } })).map((r) => r.priorCandidateId));
  const rows: Row[] = [];
  for (const c of closeouts) {
    const l = learningBy.get(c.candidateId);
    const cond = parseJson<{ conditionReductionPct: number | null; conditionReductionState: string }>(l?.conditionResultJson, { conditionReductionPct: null, conditionReductionState: "NOT_MEASURABLE" });
    const v = !l && c.approvedVersion ? await db.iamCoreCloseoutVersion.findUnique({ where: { closeoutId_closeoutVersion: { closeoutId: c.closeoutId, closeoutVersion: c.approvedVersion } } }) : null;
    // A closeout whose learning was explicitly "not applicable" has no learning record. Its segments still come from the same stored facts
    // (the approved version's plan context, the workflow row and the candidate), so it is not hidden under "Unspecified".
    let fb: { actionType: string | null; department: string | null; category: string | null; conditionFamily: string | null } = { actionType: null, department: null, category: null, conditionFamily: null };
    if (!l) {
      const pc = parseJson<{ primaryAction?: string | null; department?: string | null }>(v?.planContextJson, {});
      const wf = await db.iamCoreWorkflowState.findUnique({ where: { candidateId: c.candidateId } });
      const cls = await readClassification(db, c.candidateId);
      fb = { actionType: (pc.primaryAction ?? wf?.candidateType ?? null)?.slice(0, 500) ?? null, department: pc.department ?? null, category: wf?.category ?? null, conditionFamily: cls?.familyCode ?? null };
    }
    rows.push({
      candidateId: c.candidateId,
      finalStatus: c.finalResolutionStatus ?? "NOT_YET_MEASURED",
      reduction: l ? cond.conditionReductionPct : (v?.conditionReductionPct ?? null),
      measuredState: l ? cond.conditionReductionState : (v?.conditionReductionState ?? "NOT_MEASURABLE"),
      days: l?.timeToResultDays ?? null,
      recurred: priors.has(c.candidateId),
      eva: parseJson<ExpectedVsActual | null>(l?.expectedVsActualJson ?? v?.expectedVsActualJson, null),
      segments: {
        actionType: (l ? l.actionType : fb.actionType) ?? "Unspecified",
        conditionFamily: (l ? l.conditionFamily : fb.conditionFamily) ?? FALLBACK_CONDITION_FAMILY,
        department: (l ? l.department : fb.department) ?? "Unspecified",
        category: (l ? l.category : fb.category) ?? "Unspecified",
        outcomeConfidence: l?.outcomeConfidence ?? v?.outcomeConfidence ?? "Unspecified",
        attribution: l?.attributionCategory ?? c.finalAttributionCategory ?? "Unspecified",
        response: l?.managementResponse ?? "Unspecified",
      },
    });
  }
  const segmentOf = (name: string) => {
    const by = new Map<string, Row[]>();
    for (const r of rows) by.set(r.segments[name]!, [...(by.get(r.segments[name]!) ?? []), r]);
    return [...by.entries()].sort((a, b) => b[1].length - a[1].length || a[0].localeCompare(b[0])).map(([k, rs]) => group(k, rs, name === "conditionFamily" ? conditionFamilyLabel(k) : k));
  };
  const responses = segmentOf("response").filter((g) => g.key !== "Unspecified").map((g) => ({ ...g, response: g.key, label: MANAGEMENT_RESPONSE_LABELS[g.key as ManagementResponse] ?? g.key }));
  const attempted = await db.iamCoreActionTracking.count({ where: { dposCompanyId: ctx.dposCompanyId, startedAt: { not: null } } });
  const completed = await db.iamCoreActionTracking.count({ where: { dposCompanyId: ctx.dposCompanyId, startedAt: { not: null }, actionStatus: "COMPLETED" } });
  const dist = new Map<string, number>();
  for (const r of rows) dist.set(r.finalStatus, (dist.get(r.finalStatus) ?? 0) + 1);
  const barrierCount = new Map<string, number>();
  for (const l of learning) for (const b of parseJson<string[]>(l.barriersJson, [])) barrierCount.set(b, (barrierCount.get(b) ?? 0) + 1);
  const titles = await db.iamCoreWorkflowState.findMany({ where: { candidateId: { in: closeouts.slice(0, 10).map((c) => c.candidateId) } }, select: { candidateId: true, title: true } });
  const titleBy = new Map(titles.map((t) => [t.candidateId, t.title]));
  const versions = await Promise.all(closeouts.slice(0, 10).map((c) => (c.approvedVersion ? db.iamCoreCloseoutVersion.findUnique({ where: { closeoutId_closeoutVersion: { closeoutId: c.closeoutId, closeoutVersion: c.approvedVersion } } }) : Promise.resolve(null))));
  const withRecurrence = rows.filter((r) => r.recurred).length;
  return {
    asOf: now.toISOString(),
    attemptedActions: attempted,
    completedActions: completed,
    completionRatePct: attempted ? r2((completed / attempted) * 100) : null,
    closedCandidates: rows.length,
    resolutionDistribution: [...dist.entries()].map(([status, count]) => ({ status, label: RESOLUTION_LABELS[status as ResolutionStatus] ?? status, count })).sort((a, b) => b.count - a.count),
    overall: group("All closed", rows),
    segments: { actionType: segmentOf("actionType"), conditionFamily: segmentOf("conditionFamily"), department: segmentOf("department"), category: segmentOf("category"), outcomeConfidence: segmentOf("outcomeConfidence"), attribution: segmentOf("attribution") },
    managementResponses: responses,
    commonBarriers: [...barrierCount.entries()].map(([barrier, count]) => ({ barrier, count })).sort((a, b) => b.count - a.count || a.barrier.localeCompare(b.barrier)).slice(0, 10),
    recentClosed: closeouts.slice(0, 10).map((c, i) => ({
      candidateId: c.candidateId,
      title: titleBy.get(c.candidateId) ?? null,
      closedAt: (c.closedAt as Date).toISOString(),
      finalStatus: c.finalResolutionStatus ?? "",
      finalLabel: RESOLUTION_LABELS[(c.finalResolutionStatus ?? "NOT_YET_MEASURED") as ResolutionStatus] ?? (c.finalResolutionStatus ?? ""),
      attributionCategory: c.finalAttributionCategory,
      attributionLabel: c.finalAttributionCategory ? (ATTRIBUTION_LABELS[c.finalAttributionCategory as keyof typeof ATTRIBUTION_LABELS] ?? c.finalAttributionCategory) : null,
      conditionReductionPct: versions[i]?.conditionReductionPct ?? null,
      outcomeConfidence: versions[i]?.outcomeConfidence ?? null,
      learningRecorded: learningBy.has(c.candidateId),
    })),
    recurrence: { closedCandidates: rows.length, withRecurrence, ratePct: rows.length ? r2((withRecurrence / rows.length) * 100) : null },
    statement:
      "Descriptive statistics from recorded closeouts and learning records only. They show what happened, segment by segment; they imply no causality beyond each closeout's recorded attribution and they never change scoring weights, Health curves, RSE policy or recommendation logic. Segments with fewer than five cases are marked as low-sample.",
  };
}
