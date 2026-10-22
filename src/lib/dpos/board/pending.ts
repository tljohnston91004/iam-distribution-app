/**
 * Stage 4D (4D-D2): "Pending Next Scoring Run" indicator.
 *
 * INFORMATIONAL and DERIVED (never stored): when an accepted scoring-input change or a governed strategic modifier change has been
 * recorded after a candidate's latest score result, the board says the change is waiting for the next governed scoring run. It never
 * fabricates an interim score and never rewrites the calculated score: the stored result is shown exactly as calculated, beside the
 * indicator. Immediate display governance (rank lock, override, tie-break) is NOT pending: it is applied and published immediately
 * (4C-D8), so it is not listed here.
 *
 * The indicator clears when a scoring run later than the change produces a result for the candidate.
 */
import type { Db } from "../errors";

export const PENDING_REASON_LABELS = {
  SCORING_INPUT_CHANGED: "Scoring inputs changed after the last scoring run",
  STRATEGIC_MODIFIER_CHANGED: "A governed strategic modifier changed after the last scoring run",
  NOT_YET_SCORED: "Scoring inputs are recorded but the candidate has not been scored yet",
} as const;
export type PendingReasonCode = keyof typeof PENDING_REASON_LABELS;

export interface PendingReason {
  code: PendingReasonCode;
  label: string;
  /** When the change was recorded. */
  at: string;
}

export interface PendingIndicator {
  pending: boolean;
  reasons: PendingReason[];
  /** The calculated score the board keeps showing until the next run (never replaced by an estimate). */
  shownScoreFrom: string | null;
}

const NOT_PENDING: PendingIndicator = { pending: false, reasons: [], shownScoreFrom: null };

export async function pendingByCandidate(db: Db, companyId: string, candidateIds: string[]): Promise<Map<string, PendingIndicator>> {
  const out = new Map<string, PendingIndicator>();
  if (!candidateIds.length) return out;
  const results = await db.iamCoreScoreResult.findMany({
    where: { candidateId: { in: candidateIds }, dposCompanyId: companyId },
    orderBy: { scoredAt: "desc" },
    distinct: ["candidateId"],
    select: { candidateId: true, scoredAt: true },
  });
  const scoredAt = new Map(results.map((r) => [r.candidateId, r.scoredAt]));
  const inputs = await db.iamCoreScoringInput.findMany({
    where: { candidateId: { in: candidateIds }, dposCompanyId: companyId },
    orderBy: { recordedAt: "desc" },
    distinct: ["candidateId"],
    select: { candidateId: true, recordedAt: true },
  });
  const inputAt = new Map(inputs.map((r) => [r.candidateId, r.recordedAt]));
  const strategic = await db.iamCorePriorityGovernance.findMany({
    where: { candidateId: { in: candidateIds }, dposCompanyId: companyId, actionType: { in: ["STRATEGIC_AUTHORIZED", "STRATEGIC_REVOKED"] } },
    orderBy: { effectiveAt: "desc" },
    distinct: ["candidateId"],
    select: { candidateId: true, effectiveAt: true },
  });
  const strategicAt = new Map(strategic.map((r) => [r.candidateId, r.effectiveAt]));

  for (const id of candidateIds) {
    const s = scoredAt.get(id) ?? null;
    const reasons: PendingReason[] = [];
    const i = inputAt.get(id);
    if (i && !s) reasons.push({ code: "NOT_YET_SCORED", label: PENDING_REASON_LABELS.NOT_YET_SCORED, at: i.toISOString() });
    else if (i && s && i.getTime() > s.getTime()) reasons.push({ code: "SCORING_INPUT_CHANGED", label: PENDING_REASON_LABELS.SCORING_INPUT_CHANGED, at: i.toISOString() });
    const g = strategicAt.get(id);
    if (g && s && g.getTime() > s.getTime()) reasons.push({ code: "STRATEGIC_MODIFIER_CHANGED", label: PENDING_REASON_LABELS.STRATEGIC_MODIFIER_CHANGED, at: g.toISOString() });
    out.set(id, reasons.length ? { pending: true, reasons, shownScoreFrom: s ? s.toISOString() : null } : NOT_PENDING);
  }
  return out;
}

export interface BoardPending {
  /** True when any candidate is pending, or a Data Hub refresh is newer than the last scoring run. */
  pending: boolean;
  candidatesPending: number;
  refreshNewerThanLastRun: boolean;
  lastScoringRunAt: string | null;
  lastRefreshAt: string | null;
  message: string | null;
}

export async function boardPending(db: Db, companyId: string, lastIamRefreshAt: string | null, candidateIndicators: Iterable<PendingIndicator>): Promise<BoardPending> {
  const run = await db.iamCoreScoringRun.findFirst({ where: { dposCompanyId: companyId }, orderBy: [{ runAt: "desc" }, { createdAt: "desc" }], select: { runAt: true } });
  const refreshAt = lastIamRefreshAt ? Date.parse(lastIamRefreshAt) : NaN;
  const refreshNewer = !Number.isNaN(refreshAt) && (!run || refreshAt > run.runAt.getTime());
  let count = 0;
  for (const p of candidateIndicators) if (p.pending) count++;
  const pending = count > 0 || refreshNewer;
  const parts: string[] = [];
  if (refreshNewer) parts.push("new Data Hub data has been refreshed since the last scoring run");
  if (count > 0) parts.push(`${count} candidate${count === 1 ? " has" : "s have"} accepted changes waiting for the next scoring run`);
  return {
    pending,
    candidatesPending: count,
    refreshNewerThanLastRun: refreshNewer,
    lastScoringRunAt: run ? run.runAt.toISOString() : null,
    lastRefreshAt: lastIamRefreshAt,
    message: pending ? `Pending next scoring run: ${parts.join("; ")}. Scores shown are as last calculated; nothing has been re-scored.` : null,
  };
}
