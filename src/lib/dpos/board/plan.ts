/**
 * Stage 4D Recommended Action Plan read model (a separate page, not a side panel).
 *
 * The system recommendation and the management-approved plan are two different records: the recommendation is append-only and is
 * never overwritten by the plan; plan changes are new versions with the prior versions kept. Anything the stored records do not
 * supply is shown as "not supplied" and becomes a VERIFICATION QUESTION - the page never invents a metric, a target, a feasibility
 * or an impact.
 *
 * Content schema (PLAN_CONTENT_V1) - optional JSON stored in the recommendation's `recommendationJson` and in the plan's
 * `planJson.detail`; every field is optional:
 *   { condition, objective, metric: {name, baseline, target, direction: REDUCE|INCREASE|MAINTAIN, unit},
 *     primaryAction: {title, detail?, department?}, supportingActions[], alternativeActions[], escalationActions[],
 *     notRecommended: [{title, reason}], dependencies[], constraints[], assumptions[],
 *     feasibility: {level: CONFIRMED_FEASIBLE|LIKELY_FEASIBLE|REQUIRES_VERIFICATION|NOT_FEASIBLE, basis},
 *     expectedImpact: {description, amount?, unit?}, naturalSellThrough: {protectedValue, horizonDays, evidenceRef},
 *     expectedPreventableLoss: {amount, evidenceRef, basis}, contributorsNeeded[], verification[] }
 */
import type { Db } from "../errors";
import { DposError } from "../errors";
import type { WorkflowActor } from "../workflow/permissions";
import { isManagement, relationOf, type ActorRelation } from "../workflow/permissions";
import { ownershipFacts, parseJson } from "../workflow/internal";
import { ACTION_STATUS_LABELS, WORKFLOW_STATE_LABELS, type ActionStatus, type WorkflowState } from "../workflow/vocab";
import type { Tx } from "../workflow/internal";
import { computeCoi, type CoiResult } from "./coi";
import { loadCandidateFacts, exposureOf, num, titleOf } from "./facts";
import { candidateHref, evidenceHref, planHref } from "./sections";
import { pendingByCandidate, type PendingIndicator } from "./pending";

export const FEASIBILITY_LEVELS = ["CONFIRMED_FEASIBLE", "LIKELY_FEASIBLE", "REQUIRES_VERIFICATION", "NOT_FEASIBLE"] as const;
export type FeasibilityLevel = (typeof FEASIBILITY_LEVELS)[number];
export const FEASIBILITY_LABELS: Record<FeasibilityLevel, string> = {
  CONFIRMED_FEASIBLE: "Confirmed Feasible",
  LIKELY_FEASIBLE: "Likely Feasible",
  REQUIRES_VERIFICATION: "Requires Verification",
  NOT_FEASIBLE: "Not Feasible / Not Applicable",
};

export interface PlanAction {
  title: string;
  detail: string | null;
  department: string | null;
}

export interface PlanContent {
  condition: string | null;
  objective: string | null;
  metric: { name: string | null; baseline: number | null; target: number | null; direction: string | null; unit: string | null };
  primaryAction: PlanAction | null;
  supportingActions: PlanAction[];
  alternativeActions: PlanAction[];
  escalationActions: PlanAction[];
  notRecommended: Array<{ title: string; reason: string | null }>;
  dependencies: string[];
  constraints: string[];
  assumptions: string[];
  feasibility: { level: FeasibilityLevel | null; basis: string | null };
  expectedImpact: { description: string | null; amount: number | null; unit: string | null } | null;
  contributorsNeeded: string[];
  verification: string[];
  naturalSellThrough: { protectedValue: number; horizonDays: number; evidenceRef: string } | null;
  expectedPreventableLoss: { amount: number; evidenceRef: string | null; basis: string | null } | null;
}

const str = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v.trim() : null);
const strs = (v: unknown): string[] => (Array.isArray(v) ? v.map(str).filter((x): x is string => !!x) : []);
const obj = (v: unknown): Record<string, unknown> | null => (v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null);
const action = (v: unknown): PlanAction | null => {
  if (typeof v === "string") return str(v) ? { title: v.trim(), detail: null, department: null } : null;
  const o = obj(v);
  if (!o) return null;
  const title = str(o.title);
  return title ? { title, detail: str(o.detail), department: str(o.department) } : null;
};
const actions = (v: unknown): PlanAction[] => (Array.isArray(v) ? v.map(action).filter((x): x is PlanAction => !!x) : []);

/** Parse the content block of a recommendation / plan (tolerant: unknown or malformed parts are simply "not supplied"). */
export function parsePlanContent(raw: unknown): PlanContent {
  const o = obj(raw) ?? {};
  const m = obj(o.metric) ?? {};
  const f = obj(o.feasibility) ?? {};
  const level = typeof f.level === "string" && (FEASIBILITY_LEVELS as readonly string[]).includes(f.level) ? (f.level as FeasibilityLevel) : null;
  const impact = obj(o.expectedImpact);
  const nst = obj(o.naturalSellThrough);
  const loss = obj(o.expectedPreventableLoss);
  return {
    condition: str(o.condition),
    objective: str(o.objective),
    metric: { name: str(m.name), baseline: num(m.baseline), target: num(m.target), direction: str(m.direction), unit: str(m.unit) },
    primaryAction: action(o.primaryAction),
    supportingActions: actions(o.supportingActions),
    alternativeActions: actions(o.alternativeActions),
    escalationActions: actions(o.escalationActions),
    notRecommended: Array.isArray(o.notRecommended) ? o.notRecommended.map((x) => { const r = obj(x); const t = r ? str(r.title) : str(x); return t ? { title: t, reason: r ? str(r.reason) : null } : null; }).filter((x): x is { title: string; reason: string | null } => !!x) : [],
    dependencies: strs(o.dependencies),
    constraints: strs(o.constraints),
    assumptions: strs(o.assumptions),
    feasibility: { level, basis: str(f.basis) },
    expectedImpact: impact ? { description: str(impact.description), amount: num(impact.amount), unit: str(impact.unit) } : null,
    contributorsNeeded: strs(o.contributorsNeeded),
    verification: strs(o.verification),
    naturalSellThrough: nst && num(nst.protectedValue) !== null && num(nst.horizonDays) !== null && str(nst.evidenceRef) ? { protectedValue: num(nst.protectedValue)!, horizonDays: num(nst.horizonDays)!, evidenceRef: str(nst.evidenceRef)! } : null,
    expectedPreventableLoss: loss && num(loss.amount) !== null ? { amount: num(loss.amount)!, evidenceRef: str(loss.evidenceRef), basis: str(loss.basis) } : null,
  };
}

/** Merge: the approved plan's content wins field-by-field over the system recommendation's (the recommendation itself is untouched). */
function effectiveContent(rec: PlanContent, plan: PlanContent | null): PlanContent {
  if (!plan) return rec;
  const pick = <T,>(p: T | null, r: T | null): T | null => (p !== null && p !== undefined ? p : r);
  const list = <T,>(p: T[], r: T[]): T[] => (p.length ? p : r);
  return {
    condition: pick(plan.condition, rec.condition),
    objective: pick(plan.objective, rec.objective),
    metric: { name: pick(plan.metric.name, rec.metric.name), baseline: pick(plan.metric.baseline, rec.metric.baseline), target: pick(plan.metric.target, rec.metric.target), direction: pick(plan.metric.direction, rec.metric.direction), unit: pick(plan.metric.unit, rec.metric.unit) },
    primaryAction: pick(plan.primaryAction, rec.primaryAction),
    supportingActions: list(plan.supportingActions, rec.supportingActions),
    alternativeActions: list(plan.alternativeActions, rec.alternativeActions),
    escalationActions: list(plan.escalationActions, rec.escalationActions),
    notRecommended: list(plan.notRecommended, rec.notRecommended),
    dependencies: list(plan.dependencies, rec.dependencies),
    constraints: list(plan.constraints, rec.constraints),
    assumptions: list(plan.assumptions, rec.assumptions),
    feasibility: plan.feasibility.level ? plan.feasibility : rec.feasibility,
    expectedImpact: pick(plan.expectedImpact, rec.expectedImpact),
    contributorsNeeded: list(plan.contributorsNeeded, rec.contributorsNeeded),
    verification: list(plan.verification, rec.verification),
    naturalSellThrough: pick(plan.naturalSellThrough, rec.naturalSellThrough),
    expectedPreventableLoss: pick(plan.expectedPreventableLoss, rec.expectedPreventableLoss),
  };
}

export interface PlanVersionView {
  planVersion: number;
  state: string;
  summary: string | null;
  direction: string | null;
  deviatesFromRecommendation: boolean;
  deviationReason: string | null;
  approver: string | null;
  approvedAt: string | null;
  createdBy: string;
  createdAt: string;
  basedOnRecommendationVersion: number | null;
  current: boolean;
}

export interface PlanRevisionEvent {
  at: string;
  planVersionBefore: number | null;
  planVersionAfter: number | null;
  reason: string | null;
  actorId: string;
  source: "DECISION" | "ASSIGNMENT";
}

export interface ActionPlanView {
  candidateId: string;
  title: string;
  workflowState: string;
  workflowStateLabel: string;
  closed: boolean;
  condition: { summary: string | null; groupedConditionKey: string; category: string | null; evidenceCount: number; statement: string | null };
  objective: string | null;
  metric: { name: string | null; baseline: number | null; target: number | null; direction: string | null; unit: string | null; baselineSource: string };
  actions: { primary: PlanAction | null; supporting: PlanAction[]; alternative: PlanAction[]; escalation: PlanAction[]; notRecommended: Array<{ title: string; reason: string | null }> };
  dates: { start: string | null; resolution: string | null };
  ownership: { department: string | null; ownerId: string | null; ownerName: string | null; contributors: Array<{ userId: string; displayName: string | null }>; contributorsNeeded: string[] };
  dependencies: string[];
  constraints: string[];
  assumptions: string[];
  feasibility: { level: FeasibilityLevel; label: string; basis: string | null; assumed: boolean };
  confidence: string | null;
  scoring: { state: string | null; score: number | null; band: string | null; displayedRank: number | null; top2Qualified: boolean };
  coi: CoiResult;
  expectedImpact: { description: string | null; amount: number | null; unit: string | null } | null;
  evidence: Array<{ evidenceRef: string; kind: string; sku: string | null; vendor: string | null; category: string | null; poRef: string | null; backorderRef: string | null }>;
  /** The original system recommendation (append-only; never overwritten). */
  systemRecommendation: { version: number; recommendedAt: string; recommendedBy: string; direction: string; title: string | null; summary: string | null };
  /** The management-approved plan (null until management approves one). */
  managementPlan: PlanVersionView | null;
  versions: PlanVersionView[];
  revisions: PlanRevisionEvent[];
  execution: { actionStatus: string; actionStatusLabel: string; actionCompletionPct: number | null; conditionReductionPct: number | null; conditionReductionStatus: string; remainingExposure: number | null; exposureUnit: string | null };
  verificationQuestions: string[];
  pending: PendingIndicator;
  permissions: { relation: ActorRelation; canRevisePlan: boolean; canDecide: boolean; canUpdateProgress: boolean; canAddNotes: boolean; reason: string | null };
  links: { detail: string; plan: string; evidence: string; board: string };
}

const iso = (d: Date | null | undefined) => (d ? d.toISOString() : null);
const day = (d: Date | null | undefined) => (d ? d.toISOString().slice(0, 10) : null);

export async function readActionPlan(db: Db, ctx: { dposCompanyId: string }, candidateId: string, actor: WorkflowActor, now: Date = new Date()): Promise<ActionPlanView> {
  const all = await loadCandidateFacts(db, ctx.dposCompanyId, { includeClosed: true });
  const f = all.find((x) => x.row.candidateId === candidateId);
  if (!f) throw new DposError("CANDIDATE_NOT_FOUND", "Unknown candidate.", 404);
  const row = f.row;
  const wf = row.workflowState;
  const rec = row.recommendations[0];
  if (!rec) throw new DposError("RECOMMENDATION_REQUIRED", "This candidate has no system recommendation yet.", 404);
  const evidence = await db.iamCoreCandidateEvidence.findMany({ where: { candidateId }, orderBy: { evidenceRef: "asc" } });
  const approvedPlans = row.managementPlans.filter((p) => p.approvalState === "APPROVED");
  const currentPlan = approvedPlans[0] ?? null;
  const recContent = parsePlanContent(parseJson<unknown>(rec.recommendationJson, null));
  const planContent = currentPlan ? parsePlanContent(obj(parseJson<unknown>(currentPlan.planJson, null))?.detail ?? null) : null;
  const eff = effectiveContent(recContent, planContent);
  const t = row.actionTracking;
  const own = row.ownerships[0] ?? null;
  const x = exposureOf(f);

  // Metric baseline: the recorded quantitative baseline wins; otherwise the content's baseline; otherwise unknown.
  const baseline = t?.baselineExposure ?? eff.metric.baseline;
  const baselineSource = t?.baselineExposure !== null && t?.baselineExposure !== undefined ? "Recorded baseline exposure (action tracking)" : eff.metric.baseline !== null ? "Stated in the plan content" : "Not supplied";

  // COI: horizon = target-resolution horizon (default 30 days); the exposure is the affected inventory value, residual after evidenced sell-through.
  const excess = x.inventory ?? (x.unit === null || /^(usd|\$|dollars?)$/i.test(x.unit ?? "") ? x.baseline : null);
  const horizonFrom = t?.targetStart && t.targetStart.getTime() > now.getTime() ? t.targetStart : now;
  const coi = computeCoi({ excessValue: excess, naturalSellThrough: eff.naturalSellThrough, from: horizonFrom, targetResolution: t?.targetResolution ?? null, expectedPreventableLoss: eff.expectedPreventableLoss ?? (num(f.inputs?.preventableLoss) !== null ? { amount: num(f.inputs?.preventableLoss)!, evidenceRef: f.inputs?.sourceRefs?.[0] ?? null, basis: "Scoring input: preventable loss" } : null) });

  // Feasibility: only what the records state; otherwise it is Requires Verification (never assumed feasible).
  const feasLevel = eff.feasibility.level ?? "REQUIRES_VERIFICATION";
  const assumedFeas = eff.feasibility.level === null;

  // Verification questions: every unknown becomes a question; explicit ones come first.
  const questions = [...eff.verification];
  if (!eff.objective) questions.push("What business objective should this action achieve?");
  if (!eff.metric.name) questions.push("Which metric will show that the condition has been resolved?");
  if (baseline === null) questions.push("What is the current baseline value of that metric?");
  if (eff.metric.target === null) questions.push("What target value does management want to reach, and by when?");
  if (!eff.primaryAction) questions.push("What is the primary action to take?");
  if (!own?.responsibleDepartment) questions.push("Which department is responsible?");
  if (!own?.taskOwnerId) questions.push("Who is the task owner?");
  if (!t?.targetStart || !t?.targetResolution) questions.push("What are the start and resolution dates?");
  if (assumedFeas) questions.push("Has the feasibility of the primary action been confirmed with the responsible department?");
  if (!eff.dependencies.length) questions.push("Does the action depend on anything outside the owner's control (vendor, system, approval)?");
  if (excess === null) questions.push("What is the quantified excess or exposure value, so the cost of inaction can be computed?");
  if (!coi.expectedPreventableLossSupported) questions.push("Is there evidence-supported expected preventable loss to add to the carrying cost?");

  const { facts } = await ownershipFacts(db as unknown as Tx, candidateId);
  const relation = relationOf(actor, facts);
  const mgmt = isManagement(actor);
  const planEditable = !!wf && ["APPROVED_ASSIGNED", "PENDING_OWNER_ACCEPTANCE", "ACTIVE_ACTION"].includes(wf.workflowState) && row.closedAt === null;
  const decidable = !!wf && ["PRESENTED", "ESCALATED"].includes(wf.workflowState);

  const decisions = await db.iamCoreManagementDecision.findMany({ where: { candidateId, decisionType: "PLAN_REVISED" }, orderBy: { decidedAt: "asc" } });
  const events = await db.iamCoreAssignmentEvent.findMany({ where: { candidateId, planVersionAfter: { not: null } }, orderBy: { at: "asc" } });
  const revisions: PlanRevisionEvent[] = decisions.map((d) => ({ at: d.decidedAt.toISOString(), planVersionBefore: null, planVersionAfter: d.planVersion, reason: d.reason, actorId: d.actorId, source: "DECISION" as const }));
  for (const e of events) {
    if (e.planVersionBefore !== null && e.planVersionAfter !== null && e.planVersionBefore !== e.planVersionAfter) {
      const d = revisions.find((r) => r.planVersionAfter === e.planVersionAfter);
      if (d) d.planVersionBefore = e.planVersionBefore;
      else revisions.push({ at: e.at.toISOString(), planVersionBefore: e.planVersionBefore, planVersionAfter: e.planVersionAfter, reason: e.reason, actorId: e.actorId, source: "ASSIGNMENT" });
    }
  }
  const recVersionOf = new Map([[rec.recommendationId, rec.recommendationVersion]]);
  const versions: PlanVersionView[] = [...row.managementPlans]
    .sort((a, b) => b.planVersion - a.planVersion)
    .map((p) => ({
      planVersion: p.planVersion,
      state: p.approvalState,
      summary: p.planSummary,
      direction: str(obj(parseJson<unknown>(p.planJson, null))?.actionDirection),
      deviatesFromRecommendation: p.deviatesFromRecommendation,
      deviationReason: p.deviationReason,
      approver: p.approver,
      approvedAt: iso(p.approvedAt),
      createdBy: p.createdBy,
      createdAt: p.createdAt.toISOString(),
      basedOnRecommendationVersion: recVersionOf.get(p.basedOnRecommendationId) ?? null,
      current: currentPlan?.planId === p.planId,
    }));
  const pending = (await pendingByCandidate(db, ctx.dposCompanyId, [candidateId])).get(candidateId) ?? { pending: false, reasons: [], shownScoreFrom: null };
  const statusCode = t?.actionStatus ?? "NOT_STARTED";

  return {
    candidateId,
    title: titleOf(f),
    workflowState: wf?.workflowState ?? "UNKNOWN",
    workflowStateLabel: wf ? (WORKFLOW_STATE_LABELS[wf.workflowState as WorkflowState] ?? wf.workflowState) : "Unknown",
    closed: row.closedAt !== null,
    condition: { summary: wf?.title ?? rec.title ?? null, groupedConditionKey: row.groupedConditionKey, category: wf?.category ?? null, evidenceCount: evidence.length, statement: eff.condition ?? rec.summary ?? null },
    objective: eff.objective,
    metric: { name: eff.metric.name, baseline, target: eff.metric.target, direction: eff.metric.direction, unit: t?.exposureUnit ?? eff.metric.unit, baselineSource },
    actions: { primary: eff.primaryAction ?? (rec.recommendedActionDirection ? { title: rec.recommendedActionDirection, detail: null, department: null } : null), supporting: eff.supportingActions, alternative: eff.alternativeActions, escalation: eff.escalationActions, notRecommended: eff.notRecommended },
    dates: { start: day(t?.targetStart), resolution: day(t?.targetResolution) },
    ownership: { department: own?.responsibleDepartment ?? null, ownerId: own?.taskOwnerId ?? null, ownerName: own?.taskOwnerName ?? null, contributors: (own?.contributors ?? []).map((c) => ({ userId: c.userId, displayName: c.displayName })), contributorsNeeded: eff.contributorsNeeded },
    dependencies: eff.dependencies,
    constraints: eff.constraints,
    assumptions: eff.assumptions,
    feasibility: { level: feasLevel, label: FEASIBILITY_LABELS[feasLevel], basis: eff.feasibility.basis, assumed: assumedFeas },
    confidence: f.display?.dataConfidence ?? f.inputs?.dataConfidence ?? null,
    scoring: { state: f.display?.state.scoringState ?? null, score: f.display?.state.domainScore ?? null, band: f.display?.state.priorityBand ?? null, displayedRank: f.display?.state.displayedRank ?? null, top2Qualified: f.display?.state.top2Qualified === true },
    coi,
    expectedImpact: eff.expectedImpact,
    evidence: evidence.map((e) => ({ evidenceRef: e.evidenceRef, kind: e.kind, sku: e.sku, vendor: e.vendor, category: e.category, poRef: e.poRef, backorderRef: e.backorderRef })),
    systemRecommendation: { version: rec.recommendationVersion, recommendedAt: rec.recommendedAt.toISOString(), recommendedBy: rec.recommendedBy, direction: rec.recommendedActionDirection, title: rec.title, summary: rec.summary },
    managementPlan: versions.find((v) => v.current) ?? null,
    versions,
    revisions,
    execution: { actionStatus: statusCode, actionStatusLabel: ACTION_STATUS_LABELS[statusCode as ActionStatus] ?? statusCode, actionCompletionPct: t?.actionCompletionPct ?? null, conditionReductionPct: t?.conditionReductionStatus === "MEASURED" ? (t.conditionReductionPct ?? null) : null, conditionReductionStatus: t?.conditionReductionStatus ?? "NOT_YET_MEASURED", remainingExposure: t?.currentExposure ?? null, exposureUnit: t?.exposureUnit ?? null },
    verificationQuestions: [...new Set(questions)],
    pending,
    permissions: {
      relation,
      canRevisePlan: mgmt && planEditable,
      canDecide: mgmt && decidable,
      canUpdateProgress: (relation === "PRIMARY_OWNER" || relation === "AUTHORIZED_CONTRIBUTOR" || mgmt) && wf?.workflowState === "ACTIVE_ACTION" && row.closedAt === null,
      canAddNotes: relation !== "NONE",
      reason: mgmt ? null : relation === "NONE" ? "Your role can view this plan but cannot act on it." : relation === "CONTRIBUTOR" ? "As a contributor you can add notes and supporting work; official values and plan changes need the owner or a manager." : "Plan changes and management decisions need management-level authorization.",
    },
    links: { detail: candidateHref(candidateId), plan: planHref(candidateId), evidence: evidenceHref(candidateId), board: "/board" },
  };
}
