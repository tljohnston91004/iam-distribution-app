/**
 * Stage 4D Decision Board V4 sections (read models; no writes). Each section is a pure function of the loaded facts, so every number
 * on the board can be traced to a stored record and nothing is estimated, guessed or "filled".
 */
import { SCORING_CONFIG } from "../scoring/config";
import { ACTION_STATUS_LABELS, WORKFLOW_STATE_LABELS, type ActionStatus, type WorkflowState } from "../workflow/vocab";
import type { CapacitySnapshot } from "../workflow/read";
import type { StoredHealth } from "../health/service";
import { exposureOf, num, titleOf, type CandidateFacts } from "./facts";
import type { PendingIndicator } from "./pending";
import type { ClosedImpactSummary } from "../closeout/read";

const TOP_STATES: readonly string[] = ["NEW_CANDIDATE", "PRESENTED", "ESCALATED"];
const PORTFOLIO_STATES: readonly string[] = ["APPROVED_ASSIGNED", "PENDING_OWNER_ACCEPTANCE", "ACTIVE_ACTION"];

const stateLabel = (s: string | undefined | null) => (s ? (WORKFLOW_STATE_LABELS[s as WorkflowState] ?? s) : "Unknown");
const statusLabel = (s: string | undefined | null) => (s ? (ACTION_STATUS_LABELS[s as ActionStatus] ?? s) : "Not started");
export const candidateHref = (id: string) => `/board/candidates/${id}`;
export const planHref = (id: string) => `/board/candidates/${id}/plan`;
export const evidenceHref = (id: string) => `/board/candidates/${id}/evidence`;

// ---- 4. Top Inventory Management Priorities -----------------------------------------------------------------------------------

export interface PriorityItem {
  rank: number;
  candidateId: string;
  title: string;
  why: string | null;
  score: number | null;
  band: string | null;
  exposure: { inventory: number | null; cashImpact: number | null; profitImpact: number | null };
  recommendedAction: string | null;
  managementState: string;
  timeframe: string | null;
  confidence: string | null;
  emergency: boolean;
  pending: PendingIndicator;
  /** Immediate display governance (rank lock / override) is in force over the last run's values. */
  displayGoverned: boolean;
  planHref: string;
  detailHref: string;
}

export function topPriorities(facts: CandidateFacts[], pending: Map<string, PendingIndicator>): { items: PriorityItem[]; note: string } {
  const min = SCORING_CONFIG.top2.threshold;
  const eligible = facts
    .filter((f) => !!f.row.workflowState && TOP_STATES.includes(f.row.workflowState.workflowState) && f.display?.state.top2Qualified === true && f.display.state.scoringState !== "UNSCORED" && (f.display.state.domainScore ?? 0) >= min)
    .sort((a, b) => (a.display!.state.displayedRank ?? 1e9) - (b.display!.state.displayedRank ?? 1e9) || a.row.originalCreatedAt.getTime() - b.row.originalCreatedAt.getTime())
    .slice(0, SCORING_CONFIG.top2.slots);
  const items = eligible.map((f, i): PriorityItem => {
    const days = num(f.inputs?.timeSensitivity?.daysToAction);
    const rec = f.row.recommendations[0];
    const x = exposureOf(f);
    return {
      rank: f.display!.state.displayedRank ?? i + 1,
      candidateId: f.row.candidateId,
      title: titleOf(f),
      why: rec?.summary ?? null,
      score: f.display!.state.domainScore,
      band: f.display!.state.priorityBand,
      exposure: { inventory: x.inventory, cashImpact: x.cashImpact, profitImpact: x.profitImpact },
      recommendedAction: rec?.recommendedActionDirection ?? null,
      managementState: stateLabel(f.row.workflowState?.workflowState),
      timeframe: days === null ? null : f.inputs?.timeSensitivity?.overdue ? "Overdue" : days <= 0 ? "Act now" : `Act within ${days} day${days === 1 ? "" : "s"}`,
      confidence: f.display!.dataConfidence,
      emergency: f.display!.emergencyReviewCandidate,
      pending: pending.get(f.row.candidateId) ?? { pending: false, reasons: [], shownScoreFrom: null },
      displayGoverned: f.display!.fromDisplayChange,
      planHref: planHref(f.row.candidateId),
      detailHref: candidateHref(f.row.candidateId),
    };
  });
  return {
    items,
    note: items.length === 0
      ? `No new candidate currently qualifies (a Top ${SCORING_CONFIG.top2.slots} slot needs a calculated score of at least ${min}). Slots are never filled artificially.`
      : items.length < SCORING_CONFIG.top2.slots
        ? `${items.length} of ${SCORING_CONFIG.top2.slots} slots are filled: only candidates with a calculated score of at least ${min} appear.`
        : `Top ${SCORING_CONFIG.top2.slots} new candidates, each with a calculated score of at least ${min}.`,
  };
}

// ---- 5. Active Action Portfolio -----------------------------------------------------------------------------------------------

export interface PortfolioRow {
  candidateId: string;
  title: string;
  department: string | null;
  ownerId: string | null;
  ownerName: string | null;
  targetResolution: string | null;
  /** A. action completion (execution). Kept separate from B. */
  actionCompletionPct: number | null;
  /** B. condition reduction (outcome). Null = not yet measured (never shown as 0). */
  conditionReductionPct: number | null;
  conditionReductionStatus: string;
  remainingExposure: number | null;
  exposureUnit: string | null;
  status: string;
  statusCode: string;
  nextMilestone: string | null;
  nextMilestoneDue: string | null;
  decisionRequired: boolean;
  decisionReasons: string[];
  /** Approved in an earlier review cycle and still not completed. Derived: Holdover is a portfolio concept, never a workflow state. */
  holdover: boolean;
  detailHref: string;
}

export function activePortfolio(facts: CandidateFacts[], currentWeekStartsAt: Date): PortfolioRow[] {
  return facts
    .filter((f) => f.row.workflowState && PORTFOLIO_STATES.includes(f.row.workflowState.workflowState) && f.row.actionTracking?.actionStatus !== "COMPLETED")
    .map((f): PortfolioRow => {
      const t = f.row.actionTracking;
      const own = f.row.ownerships[0] ?? null;
      const wf = f.row.workflowState!.workflowState;
      const statusCode = t?.actionStatus ?? "NOT_STARTED";
      return {
        candidateId: f.row.candidateId,
        title: titleOf(f),
        department: own?.responsibleDepartment ?? null,
        ownerId: own?.taskOwnerId ?? null,
        ownerName: own?.taskOwnerName ?? null,
        targetResolution: t?.targetResolution ? t.targetResolution.toISOString().slice(0, 10) : null,
        actionCompletionPct: t?.actionCompletionPct ?? null,
        conditionReductionPct: t?.conditionReductionStatus === "MEASURED" ? (t.conditionReductionPct ?? null) : null,
        conditionReductionStatus: t?.conditionReductionStatus ?? "NOT_YET_MEASURED",
        remainingExposure: t?.currentExposure ?? t?.baselineExposure ?? null,
        exposureUnit: t?.exposureUnit ?? null,
        status: wf === "PENDING_OWNER_ACCEPTANCE" ? "Pending Owner Acceptance" : wf === "APPROVED_ASSIGNED" ? "Approved - awaiting owner" : statusLabel(statusCode),
        statusCode,
        nextMilestone: t?.nextMilestone ?? null,
        nextMilestoneDue: t?.nextMilestoneDue ? t.nextMilestoneDue.toISOString().slice(0, 10) : null,
        decisionRequired: f.row.decisionRequired.length > 0,
        decisionReasons: f.row.decisionRequired.map((d) => d.reasonCode),
        holdover: !!f.approvedAt && f.approvedAt.getTime() < currentWeekStartsAt.getTime(),
        detailHref: candidateHref(f.row.candidateId),
      };
    })
    .sort((a, b) => Number(b.decisionRequired) - Number(a.decisionRequired) || (a.targetResolution ?? "9999").localeCompare(b.targetResolution ?? "9999") || a.title.localeCompare(b.title));
}

// ---- 6. Management Decisions Required -----------------------------------------------------------------------------------------

export interface DecisionItem {
  key: string;
  candidateId: string;
  title: string;
  kind: string;
  kindLabel: string;
  why: string;
  owner: string | null;
  recommendedDecision: string;
  deadline: string | null;
  detailHref: string;
}

const KIND: Record<string, { label: string; recommend: string }> = {
  AT_RISK: { label: "At Risk", recommend: "Confirm the recovery plan, or adjust the target date or resources." },
  OVERDUE: { label: "Overdue", recommend: "Re-baseline the target with a reason, or escalate." },
  BLOCKED: { label: "Blocked", recommend: "Remove the blocker or escalate the dependency." },
  PAUSE_REQUEST: { label: "Pause requested", recommend: "Approve or deny the pause request." },
  OWNER_DISCUSSION: { label: "Owner discussion requested", recommend: "Hold the discussion; confirm or reassign the owner." },
  MATERIAL_DEPENDENCY: { label: "Material dependency", recommend: "Resolve or accept the dependency." },
  MATERIAL_PLAN_DEVIATION: { label: "Plan deviation", recommend: "Review the deviation and revise the plan or accept it with a reason." },
  ESCALATION_REQUEST: { label: "Escalation requested", recommend: "Review the escalation and decide." },
  COMPLETION_VALIDATION: { label: "Completion to validate", recommend: "Validate the completion and record the resolution." },
  PAUSE_REVIEW_DUE: { label: "Pause review due", recommend: "Reactivate the action or extend the pause with a reason." },
  CONDITION_WORSENED: { label: "Condition worsened", recommend: "Review the plan; the condition is worse than its baseline." },
  FORCED_REVIEW: { label: "Forced review", recommend: "Review the candidate and record a decision." },
  CRITICAL_OUTSIDE_TOP2: { label: "Critical outside Top 2", recommend: "Review the Critical candidate and approve, reject or accept the risk." },
  ADDITIONAL_EMERGENCY: { label: "Additional Emergency Review", recommend: "Confirm or decline the additional emergency." },
  EMERGENCY_REVIEW: { label: "Emergency review", recommend: "Confirm or decline the emergency." },
  REPEATED_REJECTION: { label: "Repeated rejection", recommend: "Senior review: approve, change the approach, or accept the risk with a reason." },
  SUPPRESSION_RE_REVIEW: { label: "Suppression review", recommend: "Re-review the condition after its suppression ended." },
  DATA_INVESTIGATION: { label: "Data investigation", recommend: "Resolve the data question, then decide." },
  POSSIBLE_DOUBLE_COUNTING: { label: "Possible double counting", recommend: "Confirm which candidate owns the economic amount." },
  RISK_ACCEPTANCE_REVIEW: { label: "Risk acceptance needs review", recommend: "A previously accepted risk has returned; confirm or withdraw the acceptance." },
};

export interface DecisionSources {
  forcedReviews: Array<{ reviewId: string; candidateId: string; reasonCode: string; detail: string | null }>;
  emergencyCandidates: Array<{ candidateId: string; additionalEmergency: boolean }>;
  /** Open candidates that recur an earlier RISK_ACCEPTED one. */
  riskAcceptedRecurrences: Array<{ candidateId: string; previousCandidateId: string }>;
  /** Candidates (closed or not) by id for title lookups when a source row's candidate is not in the open facts. */
}

export function decisionsRequired(facts: CandidateFacts[], src: DecisionSources): DecisionItem[] {
  const byId = new Map(facts.map((f) => [f.row.candidateId, f]));
  const out = new Map<string, DecisionItem>();
  const add = (candidateId: string, kind: string, why: string, deadlineOverride?: string | null) => {
    const f = byId.get(candidateId);
    if (!f) return;
    const key = `${candidateId}:${kind}`;
    if (out.has(key)) return;
    const meta = KIND[kind] ?? { label: kind, recommend: "Review and decide." };
    const own = f.row.ownerships[0];
    const t = f.row.actionTracking;
    out.set(key, {
      key,
      candidateId,
      title: titleOf(f),
      kind,
      kindLabel: meta.label,
      why,
      owner: own?.taskOwnerName ?? own?.taskOwnerId ?? own?.responsibleDepartment ?? null,
      recommendedDecision: meta.recommend,
      deadline: deadlineOverride ?? (t?.nextMilestoneDue ?? t?.targetResolution)?.toISOString().slice(0, 10) ?? null,
      detailHref: candidateHref(candidateId),
    });
  };
  for (const f of facts) {
    for (const d of f.row.decisionRequired) add(f.row.candidateId, d.reasonCode, d.detail ?? `${KIND[d.reasonCode]?.label ?? d.reasonCode} (raised ${d.raisedAt.toISOString().slice(0, 10)}).`);
    const w = f.row.workflowState;
    if (w?.reReviewRequired) add(f.row.candidateId, "FORCED_REVIEW", w.reReviewReason ?? "A governed forced re-review is required.");
    if (w?.repeatedRejectionFlag || w?.seniorReviewRequired) add(f.row.candidateId, "REPEATED_REJECTION", "This condition has been rejected repeatedly and needs senior review.");
    if (f.display?.state.criticalOutsideTop2 && w && TOP_STATES.includes(w.workflowState)) add(f.row.candidateId, "CRITICAL_OUTSIDE_TOP2", "A Critical candidate is outside the Top 2 and requires management review.");
    if (f.display?.state.additionalEmergencyReviewRequired && w && TOP_STATES.includes(w.workflowState)) add(f.row.candidateId, "ADDITIONAL_EMERGENCY", "An additional emergency exists while another is already confirmed.");
  }
  for (const r of src.forcedReviews) add(r.candidateId, r.reasonCode, r.detail ?? `${KIND[r.reasonCode]?.label ?? r.reasonCode} requires management review.`);
  for (const e of src.emergencyCandidates) add(e.candidateId, e.additionalEmergency ? "ADDITIONAL_EMERGENCY" : "EMERGENCY_REVIEW", e.additionalEmergency ? "An additional emergency review candidate needs a decision." : "An emergency review candidate needs a decision.");
  for (const r of src.riskAcceptedRecurrences) add(r.candidateId, "RISK_ACCEPTANCE_REVIEW", "This condition returned after management accepted its risk; the acceptance should be reviewed.");
  return [...out.values()].sort((a, b) => (a.deadline ?? "9999").localeCompare(b.deadline ?? "9999") || a.kindLabel.localeCompare(b.kindLabel) || a.title.localeCompare(b.title));
}

// ---- 7. Results & Business Impact --------------------------------------------------------------------------------------------

export interface ResultsView {
  /**
   * "PRELIMINARY_OPERATIONAL" until a candidate is formally closed. Once one is, realized outcomes come ONLY from formal closeout
   * (evidenced, attributed, confidence-labelled): "OPERATIONAL_WITH_FORMAL_CLOSEOUT". Estimated savings are never counted as results.
   */
  basis: "PRELIMINARY_OPERATIONAL" | "OPERATIONAL_WITH_FORMAL_CLOSEOUT";
  basisNotice: string;
  windowDays: number;
  completedActions: number;
  measuredCompletions: number;
  awaitingMeasurement: number;
  conditionReduction: Array<{ unit: string; baselineExposure: number; currentExposure: number; reducedBy: number; reductionPct: number | null; actions: number }>;
  activeExposure: Array<{ unit: string; exposure: number; actions: number }>;
  /** Formal-closeout realized outcomes (Stage 4E). Null until at least one candidate is formally closed. */
  realizedBusinessImpact: ClosedImpactSummary | null;
  items: Array<{ candidateId: string; title: string; completedAt: string; conditionReductionPct: number | null; measured: boolean; detailHref: string }>;
}

const DAY = 24 * 3600 * 1000;

export function resultsAndImpact(facts: CandidateFacts[], now: Date, windowDays = 90, formal: ClosedImpactSummary | null = null): ResultsView {
  const since = now.getTime() - windowDays * DAY;
  const completed = facts.filter((f) => f.row.actionTracking?.actionStatus === "COMPLETED" && f.row.actionTracking.completedAt && f.row.actionTracking.completedAt.getTime() >= since);
  const measured = completed.filter((f) => f.row.actionTracking!.conditionReductionStatus === "MEASURED");
  const byUnit = new Map<string, { baseline: number; current: number; actions: number }>();
  for (const f of measured) {
    const t = f.row.actionTracking!;
    if (t.baselineExposure === null || t.currentExposure === null) continue;
    const unit = t.exposureUnit ?? "units";
    const cur = byUnit.get(unit) ?? { baseline: 0, current: 0, actions: 0 };
    cur.baseline += t.baselineExposure;
    cur.current += t.currentExposure;
    cur.actions += 1;
    byUnit.set(unit, cur);
  }
  const active = new Map<string, { exposure: number; actions: number }>();
  for (const f of facts) {
    const t = f.row.actionTracking;
    if (!t || t.actionStatus === "COMPLETED" || !f.row.workflowState || !PORTFOLIO_STATES.includes(f.row.workflowState.workflowState)) continue;
    const v = t.currentExposure ?? t.baselineExposure;
    if (v === null || v === undefined) continue;
    const unit = t.exposureUnit ?? "units";
    const cur = active.get(unit) ?? { exposure: 0, actions: 0 };
    cur.exposure += v;
    cur.actions += 1;
    active.set(unit, cur);
  }
  return {
    basis: formal && formal.closedCount > 0 ? "OPERATIONAL_WITH_FORMAL_CLOSEOUT" : "PRELIMINARY_OPERATIONAL",
    basisNotice:
      formal && formal.closedCount > 0
        ? "Realized outcomes come only from formally closed candidates (evidenced, attributed and confidence-labelled). Operational action tracking below remains preliminary, and estimated savings are never counted as results."
        : "Preliminary operational results from action tracking. There is no closeout attribution yet, so realized business impact is not claimed.",
    windowDays,
    completedActions: completed.length,
    measuredCompletions: measured.length,
    awaitingMeasurement: completed.length - measured.length,
    conditionReduction: [...byUnit.entries()].map(([unit, v]) => ({ unit, baselineExposure: v.baseline, currentExposure: v.current, reducedBy: Math.round((v.baseline - v.current) * 100) / 100, reductionPct: v.baseline > 0 ? Math.round(((v.baseline - v.current) / v.baseline) * 10000) / 100 : null, actions: v.actions })),
    activeExposure: [...active.entries()].map(([unit, v]) => ({ unit, exposure: v.exposure, actions: v.actions })),
    realizedBusinessImpact: formal && formal.closedCount > 0 ? formal : null,
    items: completed
      .map((f) => ({ candidateId: f.row.candidateId, title: titleOf(f), completedAt: f.row.actionTracking!.completedAt!.toISOString(), conditionReductionPct: f.row.actionTracking!.conditionReductionStatus === "MEASURED" ? f.row.actionTracking!.conditionReductionPct : null, measured: f.row.actionTracking!.conditionReductionStatus === "MEASURED", detailHref: candidateHref(f.row.candidateId) }))
      .sort((a, b) => b.completedAt.localeCompare(a.completedAt) || a.title.localeCompare(b.title)),
  };
}

// ---- 8. What's Working Well ---------------------------------------------------------------------------------------------------

export interface WorkingWellItem {
  kind: string;
  text: string;
  evidence: string;
  href: string | null;
}

export function workingWell(facts: CandidateFacts[], health: StoredHealth | null, healthChange: { scoreChange: number | null; material: boolean } | null, now: Date, formal: ClosedImpactSummary | null = null): { items: WorkingWellItem[]; note: string | null } {
  const items: WorkingWellItem[] = [];
  if (health) {
    for (const c of health.components) {
      if (c.available && (c.score ?? 0) >= 90) items.push({ kind: "HEALTH_COMPONENT", text: `${c.label} is strong (${c.score}).`, evidence: c.drivers[0]?.text ?? "Calculated from governed data.", href: `/board/health/${c.key}` });
    }
    if (healthChange?.material && (healthChange.scoreChange ?? 0) > 0) items.push({ kind: "HEALTH_IMPROVED", text: `The Inventory Management Health Score improved by ${healthChange.scoreChange} points since the prior calculation.`, evidence: `Now ${health.score} (${health.labelText}).`, href: "/board/health/POSITION_BALANCE" });
  }
  const onTrack = facts.filter((f) => f.row.actionTracking?.actionStatus === "ON_TRACK" && f.row.workflowState?.workflowState === "ACTIVE_ACTION");
  if (onTrack.length) items.push({ kind: "ACTIONS_ON_TRACK", text: `${onTrack.length} active action${onTrack.length === 1 ? " is" : "s are"} On Track.`, evidence: onTrack.slice(0, 3).map((f) => titleOf(f)).join("; "), href: null });
  const since = now.getTime() - 90 * DAY;
  for (const f of facts) {
    const t = f.row.actionTracking;
    if (t?.actionStatus === "COMPLETED" && t.conditionReductionStatus === "MEASURED" && (t.conditionReductionPct ?? 0) >= 50 && t.completedAt && t.completedAt.getTime() >= since) {
      items.push({ kind: "MEASURED_REDUCTION", text: `${titleOf(f)} reduced its condition by ${t.conditionReductionPct}%.`, evidence: `Baseline ${t.baselineExposure} to ${t.currentExposure}${t.exposureUnit ? ` ${t.exposureUnit}` : ""}, measured.`, href: candidateHref(f.row.candidateId) });
    }
  }
  // Stage 4E: formally closed outcomes. Only a successful, credited (Confirmed / Probable), at least Medium-confidence closeout counts; a
  // provisional Health score or a bare sequence in time is never offered as proof.
  const sinceClosed = now.getTime() - 90 * DAY;
  for (const c of formal?.closedItems ?? []) {
    if (!c.closedAt || Date.parse(c.closedAt) < sinceClosed) continue;
    if (!["FULLY_RESOLVED", "SUBSTANTIALLY_RESOLVED"].includes(c.finalStatus) || !c.attributed || !["HIGH", "MEDIUM"].includes(c.outcomeConfidence)) continue;
    items.push({
      kind: "CLOSEOUT_RESOLVED",
      text: `${c.title ?? "A candidate"} was closed ${c.finalLabel}${c.conditionReductionPct !== null ? ` (condition reduced ${c.conditionReductionPct}%)` : ""}.`,
      evidence: `Formal closeout approved by management; attribution ${c.attributionLabel}; outcome confidence ${c.outcomeConfidence}.`,
      href: c.href,
    });
  }
  return { items, note: items.length ? null : "No evidence-based positive result is available yet. Nothing is shown unless a stored measurement supports it." };
}

// ---- 9. Active Action Capacity (informational only) ---------------------------------------------------------------------------

export interface CapacityView extends Omit<CapacitySnapshot, "generatedAt"> {
  generatedAt: string;
  notice: string;
}

export function capacityView(c: CapacitySnapshot): CapacityView {
  return { ...c, generatedAt: c.generatedAt.toISOString(), notice: "Informational only. Capacity never changes a score, a rank or what is shown, and nothing is hidden because of it." };
}
