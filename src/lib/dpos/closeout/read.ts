/**
 * Stage 4E closeout reads (no writes): the closeout detail view, the board's Completed History / closeout rows and the formal-closeout
 * business-impact summary. Everything is derived from stored closeout versions; nothing is recomputed or estimated here.
 */
import type { Db } from "../errors";
import { DposError } from "../errors";
import { parseJson, type Ctx, type Tx } from "../workflow/internal";
import { WORKFLOW_STATE_LABELS, type WorkflowState } from "../workflow/vocab";
import { isManagement, relationOf, type WorkflowActor } from "../workflow/permissions";
import { readHealthContext, readPlanAndCoi, readScoringHistory, buildCoiVsActual, type CoiVsActual, type HealthContext, type PlanContext, type ScoringHistory } from "./context";
import { evaluateCloseoutGate, type GateItem } from "./service";
import { readRecurrenceContext, type RecurrenceContext } from "./recurrence";
import { buildExpectedVsActual, actualImpacts, type ExpectedVsActual, type ResidualExposure } from "./measure";
import {
  ATTRIBUTED_CATEGORIES,
  ATTRIBUTION_LABELS,
  CLOSEOUT_BOARD_LABELS,
  IMPACT_LABELS,
  MANAGEMENT_RESPONSE_LABELS,
  RESOLUTION_LABELS,
  closeoutBoardLabel,
  type CloseoutBoardStatus,
  type ImpactMeasure,
  type ResolutionStatus,
} from "./vocab";
import { isFinalStatus } from "./measure";
import { conditionFamilyLabel, readClassification } from "./family";

const iso = (d: Date | null | undefined) => (d ? d.toISOString() : null);
const day = (d: Date | null | undefined) => (d ? d.toISOString().slice(0, 10) : null);

export interface VersionView {
  closeoutVersion: number;
  supersedesVersion: number | null;
  assessmentKind: string;
  recordedAt: string;
  recordedBy: string;
  recordedByRole: string;
  actionCompletedAt: string | null;
  actionCompletionPct: number | null;
  window: { measurementStart: string | null; measurementEnd: string | null; evidenceCurrentThrough: string | null; nextMeasurementDate: string | null };
  notYetMeasured: { reason: string | null; requiredEvidence: string[] } | null;
  baselineExposure: number | null;
  finalExposure: number | null;
  exposureUnit: string | null;
  conditionReductionPct: number | null;
  conditionReductionState: string;
  residual: ResidualExposure | null;
  expectedVsActual: ExpectedVsActual | null;
  recommendation: { status: string | null; label: string | null; judgementRequired: boolean; basis: { rule?: string; explanation?: string; windowReason?: string } };
  assessed: { status: string; label: string; rationale: string | null };
  outcomeConfidence: { level: string; rationale: string | null };
  attribution: { category: string; label: string; rationale: string; confidence: string; evidence: Array<{ kind: string; ref: string | null; note: string | null }>; alternatives: string[] };
  recurrenceRisk: string;
  recurrenceRiskRationale: string | null;
  followUpRecommendation: string | null;
  dataLimitations: string[];
  evidenceRefs: string[];
  observationRefs: string[];
  scoring: ScoringHistory | null;
  health: HealthContext | null;
  plan: (PlanContext & { revisionReason?: string | null; baselineChangeReason?: string | null }) | null;
  coi: CoiVsActual | null;
  contentHash: string;
  approved: boolean;
}

export interface CloseoutView {
  candidateId: string;
  title: string | null;
  /** Governed condition family (analytical key) and the candidate-specific condition detail (free text, never a grouping key). */
  conditionFamily: { code: string; label: string; vocabularyVersion: string; source: string } | null;
  conditionDetail: string | null;
  groupedConditionKey: string;
  workflowState: string;
  workflowStateLabel: string;
  closed: boolean;
  closedAt: string | null;
  boardStatus: CloseoutBoardStatus;
  boardLabel: string;
  closeout: null | { closeoutId: string; status: string; currentVersion: number; approvedVersion: number | null; startedAt: string; startedBy: string; approvedAt: string | null; approvedBy: string | null; closedAt: string | null; closedBy: string | null; finalResolutionStatus: string | null; finalResolutionLabel: string | null; finalAttributionCategory: string | null };
  execution: { actionStatus: string | null; actionCompletionPct: number | null; startedAt: string | null; completedAt: string | null; targetResolution: string | null; completionValidatedAt: string | null; baselineExposure: number | null; currentExposure: number | null; exposureUnit: string | null };
  versions: VersionView[];
  latest: VersionView | null;
  /** Read-only scoring / Health / plan / COI context, shown only until the first measurement version captures its own immutable snapshot. */
  liveContext: Pick<VersionView, "scoring" | "health" | "plan" | "coi"> | null;
  approval: null | { closeoutVersion: number; recommendedStatus: string | null; assessedStatus: string; finalStatus: string; finalLabel: string; overrideReason: string | null; approvedBy: string; approvedByRole: string; approvedAt: string; note: string | null; learningNotApplicableReason: string | null };
  approvals: Array<{ closeoutVersion: number; finalStatus: string; approvedBy: string; approvedAt: string; overrideReason: string | null }>;
  history: Array<{ at: string; operation: string; fromStatus: string | null; toStatus: string | null; closeoutVersion: number | null; actorId: string; actorRole: string; reason: string | null; detail: unknown }>;
  observations: Array<{ at: string; actorId: string; text: string | null; evidenceRef: string | null; observedValue: number | null; unit: string | null }>;
  learning: null | { learningId: string; closeoutVersion: number; managementResponse: string; managementResponseLabel: string; deviationReason: string | null; actionType: string | null; department: string | null; conditionType: string | null; conditionFamily: string | null; conditionFamilyLabel: string; conditionFamilyVersion: string | null; conditionFamilySource: string | null; whatWorked: string | null; whatDidNotWork: string | null; barriers: string[]; assumptions: Array<{ assumption: string; held: string; evidenceRef: string | null }>; dependencies: string[]; futureHandling: string | null; timeToResultDays: number | null; recurrenceSequence: number; evidenceRefs: string[]; recordedBy: string; recordedAt: string; managementPath: unknown };
  gate: { items: GateItem[]; canComplete: boolean };
  recurrence: RecurrenceContext;
  /** Later candidates that recurred from this one (this candidate itself is never changed by them). */
  recurrencesOfThis: Array<{ candidateId: string; title: string | null; createdAt: string; matchStatus: string; recurrenceSequence: number }>;
  permissions: { relation: string; canStart: boolean; canObserve: boolean; canMeasure: boolean; canApprove: boolean; canRecordLearning: boolean; canComplete: boolean; reason: string | null };
  statements: string[];
}

function versionView(v: Awaited<ReturnType<Db["iamCoreCloseoutVersion"]["findUniqueOrThrow"]>>, approvedVersion: number | null): VersionView {
  const basis = parseJson<{ rule?: string; explanation?: string; windowReason?: string }>(v.recommendationBasisJson, {});
  return {
    closeoutVersion: v.closeoutVersion,
    supersedesVersion: v.supersedesVersion,
    assessmentKind: v.assessmentKind,
    recordedAt: v.recordedAt.toISOString(),
    recordedBy: v.recordedBy,
    recordedByRole: v.recordedByRole,
    actionCompletedAt: iso(v.actionCompletedAt),
    actionCompletionPct: v.actionCompletionPct,
    window: { measurementStart: day(v.measurementStart), measurementEnd: day(v.measurementEnd), evidenceCurrentThrough: iso(v.evidenceCurrentThrough), nextMeasurementDate: day(v.nextMeasurementDate) },
    notYetMeasured: v.notYetMeasuredReason || v.requiredEvidenceJson ? { reason: v.notYetMeasuredReason, requiredEvidence: parseJson<string[]>(v.requiredEvidenceJson, []) } : null,
    baselineExposure: v.baselineExposure,
    finalExposure: v.finalExposure,
    exposureUnit: v.exposureUnit,
    conditionReductionPct: v.conditionReductionPct,
    conditionReductionState: v.conditionReductionState,
    residual: parseJson<ResidualExposure | null>(v.residualJson, null),
    expectedVsActual: parseJson<ExpectedVsActual | null>(v.expectedVsActualJson, null),
    recommendation: { status: v.recommendedStatus, label: v.recommendedStatus ? RESOLUTION_LABELS[v.recommendedStatus as ResolutionStatus] : null, judgementRequired: v.judgementRequired, basis },
    assessed: { status: v.assessedStatus, label: RESOLUTION_LABELS[v.assessedStatus as ResolutionStatus], rationale: v.assessmentOverrideReason },
    outcomeConfidence: { level: v.outcomeConfidence, rationale: v.outcomeConfidenceRationale },
    attribution: { category: v.attributionCategory, label: ATTRIBUTION_LABELS[v.attributionCategory as keyof typeof ATTRIBUTION_LABELS], rationale: v.attributionRationale, confidence: v.attributionConfidence, evidence: parseJson(v.attributionEvidenceJson, []), alternatives: parseJson<string[]>(v.alternativesJson, []) },
    recurrenceRisk: v.recurrenceRisk,
    recurrenceRiskRationale: v.recurrenceRiskRationale,
    followUpRecommendation: v.followUpRecommendation,
    dataLimitations: parseJson<string[]>(v.dataLimitationsJson, []),
    evidenceRefs: parseJson<string[]>(v.evidenceRefsJson, []),
    observationRefs: parseJson<string[]>(v.observationRefsJson, []),
    scoring: parseJson<ScoringHistory | null>(v.scoringContextJson, null),
    health: parseJson<HealthContext | null>(v.healthContextJson, null),
    plan: parseJson(v.planContextJson, null),
    coi: parseJson<CoiVsActual | null>(v.coiJson, null),
    contentHash: v.contentHash,
    approved: approvedVersion === v.closeoutVersion,
  };
}

/** The board label from the stored records (execution complete is NOT closeout complete). */
export function boardStatusOf(co: { status: string; finalResolutionStatus: string | null } | null, latest: { assessedStatus: string } | null): CloseoutBoardStatus {
  if (!co) return "CLOSEOUT_NOT_STARTED";
  if (co.status === "CLOSED") return "CLOSED";
  if (co.status === "APPROVED") return "APPROVED_AWAITING_FINALIZATION";
  if (latest && isFinalStatus(latest.assessedStatus)) return "AWAITING_MANAGEMENT_CLOSEOUT";
  return "AWAITING_MEASUREMENT";
}

export async function readCloseout(db: Db, ctx: Ctx, candidateId: string, actor: WorkflowActor, now: Date = new Date()): Promise<CloseoutView> {
  const cand = await db.iamCoreCandidate.findUnique({ where: { candidateId } });
  if (!cand || cand.dposCompanyId !== ctx.dposCompanyId) throw new DposError("CANDIDATE_NOT_FOUND", "Unknown candidate.", 404);
  const wf = await db.iamCoreWorkflowState.findUnique({ where: { candidateId } });
  if (!wf) throw new DposError("CANDIDATE_NOT_IN_WORKFLOW", "This candidate has no workflow record.", 409);
  const t = await db.iamCoreActionTracking.findUnique({ where: { candidateId } });
  const co = await db.iamCoreCloseout.findUnique({ where: { candidateId } });
  const versionRows = co ? await db.iamCoreCloseoutVersion.findMany({ where: { closeoutId: co.closeoutId }, orderBy: { closeoutVersion: "asc" } }) : [];
  const versions = versionRows.map((v) => versionView(v, co?.approvedVersion ?? null));
  const latest = versions[versions.length - 1] ?? null;
  const approvalRows = co ? await db.iamCoreCloseoutApproval.findMany({ where: { closeoutId: co.closeoutId }, orderBy: { closeoutVersion: "asc" } }) : [];
  const approvalNow = co?.approvedVersion ? approvalRows.find((a) => a.closeoutVersion === co.approvedVersion) ?? null : null;
  const historyRows = co ? await db.iamCoreCloseoutHistory.findMany({ where: { closeoutId: co.closeoutId }, orderBy: [{ at: "asc" }, { historyId: "asc" }] }) : [];
  const learningRow = co ? await db.iamCoreLearningRecord.findFirst({ where: { closeoutId: co.closeoutId }, orderBy: { closeoutVersion: "desc" } }) : null;
  const gate = await evaluateCloseoutGate(db as Tx, candidateId);
  const recurrence = await readRecurrenceContext(db, candidateId);
  const later = await db.iamCoreRecurrenceLink.findMany({ where: { priorCandidateId: candidateId, matchStatus: { in: ["LINKED", "REVIEW_CONFIRMED"] } }, orderBy: { createdAt: "asc" } });
  const laterTitles = await db.iamCoreWorkflowState.findMany({ where: { candidateId: { in: later.map((l) => l.candidateId) } }, select: { candidateId: true, title: true } });
  const { facts } = { facts: await ownershipOf(db, candidateId) };
  const relation = relationOf(actor, facts);
  const mgmt = isManagement(actor);
  const closed = cand.closedAt !== null;
  const open = !closed;
  const status = co?.status ?? null;
  const awaitingMeasure = !!co && open && status !== "CLOSED";
  const latestRow = versionRows[versionRows.length - 1] ?? null;
  const boardStatus = boardStatusOf(co, latestRow);
  const canStart = mgmt && open && !co && wf.workflowState === "COMPLETED_HISTORY";
  let reason: string | null = null;
  if (closed) reason = "This candidate is permanently closed. It is never reopened; a returning condition becomes a new, linked candidate.";
  else if (!co && wf.workflowState === "COMPLETED_VALIDATED") reason = "Move the validated completion to Completed History before starting formal closeout.";
  else if (!co && wf.workflowState !== "COMPLETED_HISTORY") reason = "Formal closeout is available only after execution is complete and the candidate is in Completed History.";
  else if (!mgmt && relation === "NONE") reason = "Read-only: you have no role on this candidate's closeout.";

  // Live context only until a version captured it (a version carries its own immutable snapshot)
  let liveContext: CloseoutView["liveContext"] = null;
  if (!latest) {
    const pc = await readPlanAndCoi(db, ctx, candidateId, actor, now);
    liveContext = {
      scoring: await readScoringHistory(db, candidateId, now),
      health: await readHealthContext(db, ctx, { candidateCreatedAt: cand.originalCreatedAt, actionStartedAt: t?.startedAt ?? null, closeoutAt: now }),
      plan: pc.plan,
      coi: buildCoiVsActual(pc.coi, buildExpectedVsActual(null), null),
    };
  }
  const classification = await readClassification(db, candidateId);
  const detailFacets = parseJson<{ facets?: { conditionKey?: string } }>(cand.groupedConditionJson, {}).facets;
  const view: CloseoutView = {
    candidateId,
    title: wf.title,
    conditionFamily: classification ? { code: classification.familyCode, label: conditionFamilyLabel(classification.familyCode), vocabularyVersion: classification.vocabularyVersion, source: classification.source } : null,
    conditionDetail: detailFacets?.conditionKey ?? null,
    groupedConditionKey: cand.groupedConditionKey,
    workflowState: wf.workflowState,
    workflowStateLabel: WORKFLOW_STATE_LABELS[wf.workflowState as WorkflowState] ?? wf.workflowState,
    closed,
    closedAt: iso(cand.closedAt),
    boardStatus,
    boardLabel: closeoutBoardLabel(boardStatus, co?.finalResolutionStatus),
    closeout: co ? { closeoutId: co.closeoutId, status: co.status, currentVersion: co.currentVersion, approvedVersion: co.approvedVersion, startedAt: co.startedAt.toISOString(), startedBy: co.startedBy, approvedAt: iso(co.approvedAt), approvedBy: co.approvedBy, closedAt: iso(co.closedAt), closedBy: co.closedBy, finalResolutionStatus: co.finalResolutionStatus, finalResolutionLabel: co.finalResolutionStatus ? RESOLUTION_LABELS[co.finalResolutionStatus as ResolutionStatus] : null, finalAttributionCategory: co.finalAttributionCategory } : null,
    execution: { actionStatus: t?.actionStatus ?? null, actionCompletionPct: t?.actionCompletionPct ?? null, startedAt: iso(t?.startedAt), completedAt: iso(t?.completedAt), targetResolution: day(t?.targetResolution), completionValidatedAt: iso(t?.completionValidatedAt), baselineExposure: t?.baselineExposure ?? null, currentExposure: t?.currentExposure ?? null, exposureUnit: t?.exposureUnit ?? null },
    versions: latest ? versions : [],
    latest: latest ?? null,
    liveContext,
    approval: approvalNow ? { closeoutVersion: approvalNow.closeoutVersion, recommendedStatus: approvalNow.recommendedStatus, assessedStatus: approvalNow.assessedStatus, finalStatus: approvalNow.finalStatus, finalLabel: RESOLUTION_LABELS[approvalNow.finalStatus as ResolutionStatus], overrideReason: approvalNow.overrideReason, approvedBy: approvalNow.approvedBy, approvedByRole: approvalNow.approvedByRole, approvedAt: approvalNow.approvedAt.toISOString(), note: approvalNow.note, learningNotApplicableReason: approvalNow.learningNotApplicableReason } : null,
    approvals: approvalRows.map((a) => ({ closeoutVersion: a.closeoutVersion, finalStatus: a.finalStatus, approvedBy: a.approvedBy, approvedAt: a.approvedAt.toISOString(), overrideReason: a.overrideReason })),
    history: historyRows.map((h) => ({ at: h.at.toISOString(), operation: h.operation, fromStatus: h.fromStatus, toStatus: h.toStatus, closeoutVersion: h.closeoutVersion, actorId: h.actorId, actorRole: h.actorRole, reason: h.reason, detail: parseJson(h.detailJson, null) })),
    observations: historyRows
      .filter((h) => h.operation === "CLOSEOUT_OBSERVATION")
      .map((h) => {
        const d = parseJson<{ evidenceRef?: string | null; observedValue?: number | null; unit?: string | null }>(h.detailJson, {});
        return { at: h.at.toISOString(), actorId: h.actorId, text: h.reason, evidenceRef: d.evidenceRef ?? null, observedValue: d.observedValue ?? null, unit: d.unit ?? null };
      }),
    learning: learningRow
      ? {
          learningId: learningRow.learningId,
          closeoutVersion: learningRow.closeoutVersion,
          managementResponse: learningRow.managementResponse,
          managementResponseLabel: MANAGEMENT_RESPONSE_LABELS[learningRow.managementResponse as keyof typeof MANAGEMENT_RESPONSE_LABELS] ?? learningRow.managementResponse,
          deviationReason: learningRow.deviationReason,
          actionType: learningRow.actionType,
          department: learningRow.department,
          conditionType: learningRow.conditionType,
          conditionFamily: learningRow.conditionFamily,
          conditionFamilyLabel: conditionFamilyLabel(learningRow.conditionFamily),
          conditionFamilyVersion: learningRow.conditionFamilyVersion,
          conditionFamilySource: learningRow.conditionFamilySource,
          whatWorked: learningRow.whatWorked,
          whatDidNotWork: learningRow.whatDidNotWork,
          barriers: parseJson<string[]>(learningRow.barriersJson, []),
          assumptions: parseJson(learningRow.assumptionsJson, []),
          dependencies: parseJson<string[]>(learningRow.dependenciesJson, []),
          futureHandling: learningRow.futureHandling,
          timeToResultDays: learningRow.timeToResultDays,
          recurrenceSequence: learningRow.recurrenceSequence,
          evidenceRefs: parseJson<string[]>(learningRow.evidenceRefsJson, []),
          recordedBy: learningRow.recordedBy,
          recordedAt: learningRow.recordedAt.toISOString(),
          managementPath: parseJson(learningRow.managementPathJson, null),
        }
      : null,
    gate: { items: gate.items, canComplete: gate.canComplete },
    recurrence,
    recurrencesOfThis: later.map((l) => ({ candidateId: l.candidateId, title: laterTitles.find((x) => x.candidateId === l.candidateId)?.title ?? null, createdAt: l.createdAt.toISOString(), matchStatus: l.matchStatus, recurrenceSequence: l.recurrenceSequence })),
    permissions: {
      relation,
      canStart,
      canObserve: awaitingMeasure && (mgmt || relation === "PRIMARY_OWNER" || relation === "AUTHORIZED_CONTRIBUTOR" || relation === "CONTRIBUTOR"),
      canMeasure: awaitingMeasure && mgmt,
      canApprove: awaitingMeasure && mgmt && status === "MEASURED" && !!latest && isFinalStatus(latest.assessed.status),
      canRecordLearning: awaitingMeasure && mgmt && status === "APPROVED" && !learningRow,
      canComplete: awaitingMeasure && mgmt && gate.canComplete,
      reason,
    },
    statements: [
      "Execution complete is not closeout complete: a candidate is permanently closed only after management approves a measured (or justified) outcome and the completion gate holds.",
      "A task owner provides execution evidence and observations; only management approves and finalizes. A closed candidate is never reopened.",
      "Attribution is separate from the outcome and is never inferred from timing alone. Health curves are PROVISIONAL and a Health movement is context, not proof.",
    ],
  };
  return view;
}

async function ownershipOf(db: Db, candidateId: string) {
  const ownership = await db.iamCoreOwnership.findFirst({ where: { candidateId, endedAt: null }, include: { contributors: true }, orderBy: { assignedAt: "desc" } });
  const auths = await db.iamCoreContributorAuthorization.findMany({ where: { candidateId, revokedAt: null } });
  return { taskOwnerId: ownership?.taskOwnerId ?? null, contributorIds: (ownership?.contributors ?? []).map((c) => c.userId), authorizedOfficialWriterIds: auths.map((a) => a.userId) };
}

// ---- board rows ----------------------------------------------------------------------------------------------------------------------------

export interface CloseoutBoardRow {
  candidateId: string;
  title: string | null;
  department: string | null;
  executionCompletedAt: string | null;
  boardStatus: CloseoutBoardStatus;
  statusLabel: string;
  interimStatus: string | null;
  interimLabel: string | null;
  nextMeasurementDate: string | null;
  finalStatus: string | null;
  finalLabel: string | null;
  conditionReductionPct: number | null;
  attributionLabel: string | null;
  closedAt: string | null;
  href: string;
}

/** Completed History rows: execution-complete candidates still awaiting closeout, then the most recently closed ones. */
export async function readCloseoutBoardRows(db: Db, ctx: Ctx, opts: { closedLimit?: number } = {}): Promise<{ pending: CloseoutBoardRow[]; closed: CloseoutBoardRow[] }> {
  const wfs = await db.iamCoreWorkflowState.findMany({ where: { dposCompanyId: ctx.dposCompanyId, workflowState: "COMPLETED_HISTORY", candidate: { closedAt: null } }, include: { candidate: { include: { closeout: true, actionTracking: true, ownerships: { where: { endedAt: null }, take: 1 } } } }, orderBy: { updatedAt: "desc" } });
  const pending: CloseoutBoardRow[] = [];
  for (const w of wfs) {
    const co = w.candidate.closeout;
    const latest = co && co.currentVersion > 0 ? await db.iamCoreCloseoutVersion.findUnique({ where: { closeoutId_closeoutVersion: { closeoutId: co.closeoutId, closeoutVersion: co.currentVersion } } }) : null;
    const st = boardStatusOf(co, latest);
    const interim = latest && !isFinalStatus(latest.assessedStatus) ? latest.assessedStatus : null;
    pending.push({
      candidateId: w.candidateId,
      title: w.title,
      department: w.candidate.ownerships[0]?.responsibleDepartment ?? null,
      executionCompletedAt: iso(w.candidate.actionTracking?.completedAt),
      boardStatus: st,
      statusLabel: closeoutBoardLabel(st),
      interimStatus: interim,
      interimLabel: interim ? RESOLUTION_LABELS[interim as ResolutionStatus] : null,
      nextMeasurementDate: day(latest?.nextMeasurementDate),
      finalStatus: null,
      finalLabel: null,
      conditionReductionPct: latest?.conditionReductionPct ?? null,
      attributionLabel: latest ? ATTRIBUTION_LABELS[latest.attributionCategory as keyof typeof ATTRIBUTION_LABELS] : null,
      closedAt: null,
      href: `/board/candidates/${w.candidateId}/closeout`,
    });
  }
  const closedRows = await db.iamCoreCloseout.findMany({ where: { dposCompanyId: ctx.dposCompanyId, status: "CLOSED" }, orderBy: { closedAt: "desc" }, take: opts.closedLimit ?? 10, include: { candidate: { include: { ownerships: { orderBy: { assignedAt: "desc" }, take: 1 }, actionTracking: true } } } });
  const titles = await db.iamCoreWorkflowState.findMany({ where: { candidateId: { in: closedRows.map((c) => c.candidateId) } }, select: { candidateId: true, title: true } });
  const closed: CloseoutBoardRow[] = [];
  for (const c of closedRows) {
    const v = c.approvedVersion ? await db.iamCoreCloseoutVersion.findUnique({ where: { closeoutId_closeoutVersion: { closeoutId: c.closeoutId, closeoutVersion: c.approvedVersion } } }) : null;
    closed.push({
      candidateId: c.candidateId,
      title: titles.find((x) => x.candidateId === c.candidateId)?.title ?? null,
      department: c.candidate.ownerships[0]?.responsibleDepartment ?? null,
      executionCompletedAt: iso(c.candidate.actionTracking?.completedAt),
      boardStatus: "CLOSED",
      statusLabel: closeoutBoardLabel("CLOSED", c.finalResolutionStatus),
      interimStatus: null,
      interimLabel: null,
      nextMeasurementDate: null,
      finalStatus: c.finalResolutionStatus,
      finalLabel: c.finalResolutionStatus ? RESOLUTION_LABELS[c.finalResolutionStatus as ResolutionStatus] : null,
      conditionReductionPct: v?.conditionReductionPct ?? null,
      attributionLabel: c.finalAttributionCategory ? ATTRIBUTION_LABELS[c.finalAttributionCategory as keyof typeof ATTRIBUTION_LABELS] : null,
      closedAt: iso(c.closedAt),
      href: `/board/candidates/${c.candidateId}/closeout`,
    });
  }
  return { pending, closed };
}

// ---- formal-closeout business impact -----------------------------------------------------------------------------------------------------------

export interface ClosedImpactItem {
  candidateId: string;
  title: string | null;
  measure: ImpactMeasure;
  measureLabel: string;
  value: number;
  unit: string;
  evidenceRef: string;
  attributionCategory: string;
  attributionLabel: string;
  attributed: boolean;
  outcomeConfidence: string;
  finalLabel: string;
}

export interface ClosedOutcomeItem {
  candidateId: string;
  title: string | null;
  closedAt: string | null;
  finalStatus: string;
  finalLabel: string;
  conditionReductionPct: number | null;
  attributionCategory: string;
  attributionLabel: string;
  attributed: boolean;
  outcomeConfidence: string;
  href: string;
}

export interface ClosedImpactSummary {
  closedCount: number;
  /** Every formally closed candidate (most recent first), with its approved outcome. */
  closedItems: ClosedOutcomeItem[];
  /** Totals per measure and unit for Confirmed / Probable contributions ONLY. Incompatible units are never summed. */
  attributedTotals: Array<{ measure: ImpactMeasure; label: string; unit: string; total: number; items: number }>;
  /** Evidenced improvements that are NOT credited to IAM (Possible, Unclear, External, Negative). Never added to the attributed totals. */
  observedNotAttributedTotals: Array<{ measure: ImpactMeasure; label: string; unit: string; total: number; items: number }>;
  items: ClosedImpactItem[];
  resolutionCounts: Array<{ status: string; label: string; count: number }>;
  avgConditionReductionPct: number | null;
  recurrence: { closed: number; recurred: number };
  statement: string;
}

export async function readClosedImpact(db: Db, ctx: Ctx): Promise<ClosedImpactSummary> {
  const closeouts = await db.iamCoreCloseout.findMany({ where: { dposCompanyId: ctx.dposCompanyId, status: "CLOSED" }, orderBy: { closedAt: "desc" } });
  const titles = await db.iamCoreWorkflowState.findMany({ where: { candidateId: { in: closeouts.map((c) => c.candidateId) } }, select: { candidateId: true, title: true } });
  const priors = new Set((await db.iamCoreRecurrenceLink.findMany({ where: { dposCompanyId: ctx.dposCompanyId, matchStatus: { in: ["LINKED", "REVIEW_CONFIRMED"] } }, select: { priorCandidateId: true } })).map((r) => r.priorCandidateId));
  const items: ClosedImpactItem[] = [];
  const closedItems: ClosedOutcomeItem[] = [];
  const reductions: number[] = [];
  const counts = new Map<string, number>();
  for (const c of closeouts) {
    counts.set(c.finalResolutionStatus ?? "", (counts.get(c.finalResolutionStatus ?? "") ?? 0) + 1);
    const v = c.approvedVersion ? await db.iamCoreCloseoutVersion.findUnique({ where: { closeoutId_closeoutVersion: { closeoutId: c.closeoutId, closeoutVersion: c.approvedVersion } } }) : null;
    if (!v) continue;
    if (v.conditionReductionPct !== null && c.finalResolutionStatus !== "NO_LONGER_APPLICABLE") reductions.push(v.conditionReductionPct);
    closedItems.push({
      candidateId: c.candidateId,
      title: titles.find((t) => t.candidateId === c.candidateId)?.title ?? null,
      closedAt: iso(c.closedAt),
      finalStatus: c.finalResolutionStatus ?? "",
      finalLabel: RESOLUTION_LABELS[(c.finalResolutionStatus ?? "NOT_YET_MEASURED") as ResolutionStatus],
      conditionReductionPct: v.conditionReductionPct,
      attributionCategory: v.attributionCategory,
      attributionLabel: ATTRIBUTION_LABELS[v.attributionCategory as keyof typeof ATTRIBUTION_LABELS],
      attributed: (ATTRIBUTED_CATEGORIES as readonly string[]).includes(v.attributionCategory),
      outcomeConfidence: v.outcomeConfidence,
      href: `/board/candidates/${c.candidateId}/closeout`,
    });
    const eva = parseJson<ExpectedVsActual | null>(v.expectedVsActualJson, null);
    for (const a of actualImpacts(eva)) {
      items.push({
        candidateId: c.candidateId,
        title: titles.find((t) => t.candidateId === c.candidateId)?.title ?? null,
        measure: a.measure,
        measureLabel: IMPACT_LABELS[a.measure],
        value: a.value,
        unit: a.unit,
        evidenceRef: a.evidenceRef,
        attributionCategory: v.attributionCategory,
        attributionLabel: ATTRIBUTION_LABELS[v.attributionCategory as keyof typeof ATTRIBUTION_LABELS],
        attributed: (ATTRIBUTED_CATEGORIES as readonly string[]).includes(v.attributionCategory),
        outcomeConfidence: v.outcomeConfidence,
        finalLabel: RESOLUTION_LABELS[(c.finalResolutionStatus ?? "NOT_YET_MEASURED") as ResolutionStatus],
      });
    }
  }
  const totals = (attributed: boolean) => {
    const m = new Map<string, { measure: ImpactMeasure; label: string; unit: string; total: number; items: number }>();
    for (const i of items.filter((x) => x.attributed === attributed)) {
      const k = `${i.measure}|${i.unit.toLowerCase()}`;
      const e = m.get(k) ?? { measure: i.measure, label: i.measureLabel, unit: i.unit, total: 0, items: 0 };
      e.total = Math.round((e.total + i.value) * 100) / 100;
      e.items += 1;
      m.set(k, e);
    }
    return [...m.values()];
  };
  return {
    closedCount: closeouts.length,
    closedItems,
    attributedTotals: totals(true),
    observedNotAttributedTotals: totals(false),
    items,
    resolutionCounts: [...counts.entries()].map(([status, count]) => ({ status, label: RESOLUTION_LABELS[status as ResolutionStatus] ?? status, count })).sort((a, b) => b.count - a.count),
    avgConditionReductionPct: reductions.length ? Math.round((reductions.reduce((a, b) => a + b, 0) / reductions.length) * 100) / 100 : null,
    recurrence: { closed: closeouts.length, recurred: closeouts.filter((c) => priors.has(c.candidateId)).length },
    statement:
      "Only evidenced actual results from formally closed candidates are shown. IAM-attributed totals count Confirmed and Probable contributions only; evidenced improvements without that attribution are listed separately and never added in. Units are never mixed, estimated savings and the cost of inaction are never counted as results, and a provisional Health score is never evidence of a result.",
  };
}

export { CLOSEOUT_BOARD_LABELS };
