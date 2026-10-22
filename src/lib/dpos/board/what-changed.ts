/**
 * Stage 4D: "What Changed Since Last Review".
 *
 * Deterministic and materiality-filtered. The window is (last "Mark reviewed" record, now]; with no review on record it is the start
 * of the previous company-local operating week. Only meaningful changes appear - a Health recalculation that moved nothing, a refresh
 * timestamp, or a status that did not change is NOT an item - so the section carries no timestamp noise. Every item drills to the
 * record it came from. Items are ordered by time (newest first) then by id, so the same data always produces the same list.
 */
import type { Db } from "../errors";
import { compareHealth, toStoredHealth, type StoredHealth } from "../health/service";
import { COMPONENT_LABELS } from "../health/config";
import { ACTION_STATUS_LABELS, WORKFLOW_STATE_LABELS, type ActionStatus, type WorkflowState } from "../workflow/vocab";
import { candidateHref } from "./sections";
import { latestBoardReview } from "./review";
import { operatingWeekBefore } from "./time";

export interface ChangeItem {
  id: string;
  kind: "HEALTH" | "STATUS" | "DECISION" | "TOP_PRIORITY" | "NEW_CANDIDATE" | "BAND" | "EMERGENCY" | "COMPLETION";
  at: string;
  title: string;
  detail: string;
  candidateId: string | null;
  href: string;
}

export interface WhatChanged {
  since: string;
  sinceBasis: "LAST_REVIEW" | "START_OF_PREVIOUS_OPERATING_WEEK" | "ROLLING_7_DAYS_NO_TIME_ZONE";
  lastReview: { reviewedAt: string; reviewedBy: string } | null;
  items: ChangeItem[];
  empty: boolean;
  note: string | null;
}

/** Decision types that are meaningful on the board (a resolved flag or an unchanged state is not). */
const MEANINGFUL_DECISIONS: Record<string, string> = {
  APPROVE: "Approved",
  REJECT: "Rejected",
  RISK_ACCEPT: "Risk accepted",
  ESCALATE: "Escalated",
  SUPPRESS: "Suppressed",
  PLAN_REVISED: "Plan revised",
  COMPLETION_VALIDATED: "Completion validated",
  PAUSE_APPROVED: "Pause approved",
  PAUSE_DENIED: "Pause denied",
  RETURN_FOR_REVIEW: "Returned for review",
};

const BAND_MATERIAL_POINTS = 5;

export async function whatChangedSinceLastReview(db: Db, ctx: { dposCompanyId: string }, tz: string | null, now: Date, titleOfCandidate: (id: string) => string): Promise<WhatChanged> {
  const review = await latestBoardReview(db, ctx.dposCompanyId, now);
  // With no valid company time zone there is no calendar week to anchor on, and UTC is never assumed: a rolling 7 days is used and disclosed.
  const since = review ? review.reviewedAt : tz ? operatingWeekBefore(now, tz, 1).startsAt : new Date(now.getTime() - 7 * 24 * 3600 * 1000);
  const items: ChangeItem[] = [];
  const co = ctx.dposCompanyId;

  // Health: latest score versus the last score at or before the window start (so a same-window recalculation is not "a change").
  const latestHealthRow = await db.iamCoreHealthScore.findFirst({ where: { dposCompanyId: co, calculatedAt: { lte: now } }, orderBy: [{ calculatedAt: "desc" }, { createdAt: "desc" }] });
  const baseHealthRow = await db.iamCoreHealthScore.findFirst({ where: { dposCompanyId: co, calculatedAt: { lte: since } }, orderBy: [{ calculatedAt: "desc" }, { createdAt: "desc" }] });
  if (latestHealthRow && baseHealthRow && latestHealthRow.healthScoreId !== baseHealthRow.healthScoreId) {
    const cur: StoredHealth = toStoredHealth(latestHealthRow);
    const base: StoredHealth = toStoredHealth(baseHealthRow);
    const change = compareHealth(cur, base);
    if (change.comparable && (change.material || change.labelChanged)) {
      const moved = change.components.filter((c) => c.material);
      const parts = moved.map((c) => (c.availabilityChanged ? `${COMPONENT_LABELS[c.key]} ${c.current === null ? "became unavailable" : "became available"}` : `${COMPONENT_LABELS[c.key]} ${c.change! > 0 ? "+" : ""}${c.change}`));
      items.push({
        id: `health:${cur.healthScoreId}`,
        kind: "HEALTH",
        at: cur.calculatedAt,
        title: change.labelChanged ? `Health moved from ${base.labelText ?? "no label"} to ${cur.labelText ?? "no label"}` : `Health ${change.scoreChange! > 0 ? "rose" : "fell"} ${Math.abs(change.scoreChange!)} points`,
        detail: `${base.score ?? "n/a"} to ${cur.score ?? "n/a"}${parts.length ? `: ${parts.join("; ")}` : ""}.`,
        candidateId: null,
        href: `/board/health/${moved[0]?.key ?? "POSITION_BALANCE"}`,
      });
    }
  }

  // Status: only the escalating transitions flagged by the workflow, and completions.
  const statusRows = await db.iamCoreActionStatusHistory.findMany({
    where: { dposCompanyId: co, at: { gt: since, lte: now }, OR: [{ includeInWhatChanged: true }, { toStatus: "COMPLETED" }] },
    orderBy: [{ at: "desc" }, { statusHistoryId: "asc" }],
  });
  for (const r of statusRows) {
    const completed = r.toStatus === "COMPLETED";
    items.push({
      id: `status:${r.statusHistoryId}`,
      kind: completed ? "COMPLETION" : "STATUS",
      at: r.at.toISOString(),
      title: `${titleOfCandidate(r.candidateId)}: ${completed ? "action completed" : `now ${ACTION_STATUS_LABELS[r.toStatus as ActionStatus] ?? r.toStatus}`}`,
      detail: `Status ${ACTION_STATUS_LABELS[r.fromStatus as ActionStatus] ?? r.fromStatus ?? "none"} to ${ACTION_STATUS_LABELS[r.toStatus as ActionStatus] ?? r.toStatus}.`,
      candidateId: r.candidateId,
      href: candidateHref(r.candidateId),
    });
  }

  // Management decisions.
  const decisions = await db.iamCoreManagementDecision.findMany({ where: { dposCompanyId: co, decidedAt: { gt: since, lte: now }, decisionType: { in: Object.keys(MEANINGFUL_DECISIONS) } }, orderBy: [{ decidedAt: "desc" }, { decisionId: "asc" }] });
  for (const d of decisions) {
    items.push({
      id: `decision:${d.decisionId}`,
      kind: "DECISION",
      at: d.decidedAt.toISOString(),
      title: `${titleOfCandidate(d.candidateId)}: ${MEANINGFUL_DECISIONS[d.decisionType]}`,
      detail: d.reason ? d.reason : `Recorded by ${d.actorId}.`,
      candidateId: d.candidateId,
      href: d.decisionType === "PLAN_REVISED" ? `/board/candidates/${d.candidateId}/plan` : candidateHref(d.candidateId),
    });
  }

  // New candidates created in the window.
  const created = await db.iamCoreCandidate.findMany({ where: { dposCompanyId: co, originalCreatedAt: { gt: since, lte: now } }, orderBy: [{ originalCreatedAt: "desc" }, { candidateId: "asc" }] });
  for (const c of created) {
    items.push({ id: `new:${c.candidateId}`, kind: "NEW_CANDIDATE", at: c.originalCreatedAt.toISOString(), title: `New candidate: ${titleOfCandidate(c.candidateId)}`, detail: "A new governed condition was identified.", candidateId: c.candidateId, href: candidateHref(c.candidateId) });
  }

  // Top 2 membership: the latest run versus the run before the window start.
  const runs = await db.iamCoreScoringRun.findMany({ where: { dposCompanyId: co, runAt: { lte: now } }, orderBy: [{ runAt: "desc" }, { createdAt: "desc" }], take: 50 });
  const latestRun = runs[0];
  const baseRun = runs.find((r) => r.runAt.getTime() <= since.getTime());
  if (latestRun && baseRun && latestRun.scoringRunId !== baseRun.scoringRunId) {
    const now2 = new Set<string>(JSON.parse(latestRun.top2Json) as string[]);
    const was2 = new Set<string>(JSON.parse(baseRun.top2Json) as string[]);
    for (const id of now2) if (!was2.has(id)) items.push({ id: `top2in:${latestRun.scoringRunId}:${id}`, kind: "TOP_PRIORITY", at: latestRun.runAt.toISOString(), title: `${titleOfCandidate(id)}: entered the Top 2`, detail: "A new candidate now ranks among the top two priorities.", candidateId: id, href: candidateHref(id) });
    for (const id of was2) if (!now2.has(id)) items.push({ id: `top2out:${latestRun.scoringRunId}:${id}`, kind: "TOP_PRIORITY", at: latestRun.runAt.toISOString(), title: `${titleOfCandidate(id)}: left the Top 2`, detail: "The candidate is no longer among the top two priorities.", candidateId: id, href: candidateHref(id) });
  }

  // Priority band changes (a change of band, or a score move of at least the materiality threshold).
  if (latestRun && baseRun && latestRun.scoringRunId !== baseRun.scoringRunId) {
    const [curRows, baseRows] = await Promise.all([
      db.iamCoreScoreResult.findMany({ where: { scoringRunId: latestRun.scoringRunId, outcome: "RANKED" }, select: { candidateId: true, domainScore: true, priorityBand: true } }),
      db.iamCoreScoreResult.findMany({ where: { scoringRunId: baseRun.scoringRunId, outcome: "RANKED" }, select: { candidateId: true, domainScore: true, priorityBand: true } }),
    ]);
    const baseBy = new Map(baseRows.map((r) => [r.candidateId, r]));
    for (const r of curRows) {
      const b = baseBy.get(r.candidateId);
      if (!b || r.domainScore === null || b.domainScore === null) continue;
      const delta = Math.round((r.domainScore - b.domainScore) * 100) / 100;
      if (r.priorityBand !== b.priorityBand || Math.abs(delta) >= BAND_MATERIAL_POINTS) {
        items.push({ id: `band:${latestRun.scoringRunId}:${r.candidateId}`, kind: "BAND", at: latestRun.runAt.toISOString(), title: `${titleOfCandidate(r.candidateId)}: priority ${delta > 0 ? "rose" : "fell"}`, detail: `Score ${b.domainScore} (${b.priorityBand ?? "n/a"}) to ${r.domainScore} (${r.priorityBand ?? "n/a"}).`, candidateId: r.candidateId, href: candidateHref(r.candidateId) });
      }
    }
  }

  // Emergency reviews raised or confirmed in the window.
  const emergencies = await db.iamCoreEmergencyReview.findMany({ where: { dposCompanyId: co, OR: [{ raisedAt: { gt: since, lte: now } }, { decidedAt: { gt: since, lte: now } }] }, orderBy: [{ raisedAt: "desc" }, { emergencyReviewId: "asc" }] });
  for (const e of emergencies) {
    items.push({ id: `emergency:${e.emergencyReviewId}:${e.status}`, kind: "EMERGENCY", at: (e.decidedAt ?? e.raisedAt).toISOString(), title: `${titleOfCandidate(e.candidateId)}: emergency review ${e.status.toLowerCase()}`, detail: e.decisionReason ?? "An emergency review candidate was raised.", candidateId: e.candidateId, href: candidateHref(e.candidateId) });
  }

  items.sort((a, b) => b.at.localeCompare(a.at) || a.id.localeCompare(b.id));
  return {
    since: since.toISOString(),
    sinceBasis: review ? "LAST_REVIEW" : tz ? "START_OF_PREVIOUS_OPERATING_WEEK" : "ROLLING_7_DAYS_NO_TIME_ZONE",
    lastReview: review ? { reviewedAt: review.reviewedAt.toISOString(), reviewedBy: review.reviewedBy } : null,
    items,
    empty: items.length === 0,
    note: items.length === 0 ? "Nothing material has changed since the last review." : null,
  };
}

export const WORKFLOW_LABEL = (s: string) => WORKFLOW_STATE_LABELS[s as WorkflowState] ?? s;
