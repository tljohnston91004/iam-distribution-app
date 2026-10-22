/**
 * Stage 4C closeout 4C-D8: immediate governance of the DISPLAYED priority.
 *
 * Governed controls that change what management sees - rank lock / release, manual tie-break, promote / demote (priority override) -
 * take effect and are published IMMEDIATELY as an immutable DOMAIN_PRIORITY_CHANGED event, in the same transaction as the governance
 * ledger row. Nothing is recalculated: the calculated score, calculated rank, band, modifiers and breakdown stored by the scoring run are
 * reused exactly as they are. Only the displayed rank, the Top 2 flag, the Critical-outside-Top-2 review and the governance markers move.
 *
 * Changes to SCORING INPUTS (strategic modifier, data confidence, execution burden, benefit uncertainty, factor inputs, scoring
 * configuration) are never applied here: they take effect only through a new governed scoring run.
 *
 * Each published change is also stored in the append-only `iam_core_display_changes` table (the "last published display state"), which
 * the next scoring run compares against, so a run never republishes what was already published immediately.
 */
import { randomUUID } from "node:crypto";
import { Emitter, SCORING_ORIGIN, parseJson, type EmittedEvent } from "../workflow/internal";
import type { WorkflowActor } from "../workflow/permissions";
import type { TieBreakValues } from "./calculate";
import { SCORING_CONFIG, SCORING_VERSION, type ScoringConfig } from "./config";
import { POOL_STATES, TOP2_STATES, activeLocks, activeOverrides, manualTieBreakGroups, type Tx } from "./ledger";
import { displayChangeSections, statesEqual, type PublishedState, type ScoringState } from "./publish";
import { applyRankLocks, orderItems, selectTop2, type RankItem } from "./ranking";

type Ctx = { dposCompanyId: string };

/** The last published state of a candidate as recorded in a score result row. */
export function publishedStateOfResult(r: {
  domainScore: number | null;
  calculatedRank: number | null;
  displayedRank: number | null;
  priorityBand: string | null;
  top2Qualified: boolean;
  emergencyReviewCandidate: boolean;
  criticalOutsideTop2: boolean;
  forcedReviewRequired: boolean;
  breakdownJson: string | null;
  publishedScoringState: string | null;
  scoringStateReason: string | null;
  scoreFlagsJson: string | null;
  additionalEmergencyReviewRequired: boolean;
}): PublishedState {
  const g = parseJson<{ governance?: { override?: { points?: number } | null; rankLock?: { rank?: number; applied?: boolean } | null } }>(r.breakdownJson, {}).governance;
  return {
    scoringState: (r.publishedScoringState as ScoringState | null) ?? (r.domainScore !== null ? "SCORED" : null),
    scoringStateReason: r.scoringStateReason,
    scoreFlags: parseJson<string[]>(r.scoreFlagsJson, []),
    additionalEmergencyReviewRequired: r.additionalEmergencyReviewRequired,
    domainScore: r.domainScore,
    calculatedRank: r.calculatedRank,
    displayedRank: r.displayedRank,
    priorityBand: r.priorityBand,
    top2Qualified: r.top2Qualified,
    emergencyReviewCandidate: r.emergencyReviewCandidate,
    criticalOutsideTop2: r.criticalOutsideTop2,
    forcedReviewRequired: r.forcedReviewRequired,
    overridePoints: g?.override?.points ?? null,
    rankLockRank: g?.rankLock?.applied ? (g.rankLock.rank ?? null) : null,
  };
}

/** The newest immediately-published display state per candidate. */
export async function latestDisplayStates(tx: Tx, candidateIds: string[]): Promise<Map<string, { createdAt: Date; state: PublishedState }>> {
  const out = new Map<string, { createdAt: Date; state: PublishedState }>();
  if (!candidateIds.length) return out;
  const rows = await tx.iamCoreDisplayChange.findMany({ where: { candidateId: { in: candidateIds } }, orderBy: [{ createdAt: "desc" }] });
  for (const r of rows) if (!out.has(r.candidateId)) out.set(r.candidateId, { createdAt: r.createdAt, state: parseJson<PublishedState>(r.stateJson, null as never) });
  return out;
}

export interface DisplayRefreshResult {
  events: Array<EmittedEvent & { candidateId: string }>;
  changed: string[];
}

/**
 * Re-derive the displayed order from the STORED calculated values of the company's latest scoring run and the governance now in
 * force, and publish every candidate whose displayed state changed. Safe to call repeatedly: an unchanged state publishes nothing.
 */
export async function refreshDisplayedPriority(
  tx: Tx,
  ctx: Ctx,
  actor: WorkflowActor,
  p: { at: Date; governanceId: string; cfg?: ScoringConfig },
): Promise<DisplayRefreshResult> {
  const cfg = p.cfg ?? SCORING_CONFIG;
  const none: DisplayRefreshResult = { events: [], changed: [] };
  const run = await tx.iamCoreScoringRun.findFirst({ where: { dposCompanyId: ctx.dposCompanyId }, orderBy: [{ runAt: "desc" }, { createdAt: "desc" }] });
  if (!run) return none;
  const results = await tx.iamCoreScoreResult.findMany({ where: { scoringRunId: run.scoringRunId, outcome: "RANKED" } });
  if (!results.length) return none;
  const ids = results.map((r) => r.candidateId);
  const candidates = await tx.iamCoreCandidate.findMany({ where: { candidateId: { in: ids }, closedAt: null } });
  const wf = await tx.iamCoreWorkflowState.findMany({ where: { candidateId: { in: ids } } });
  const wfBy = new Map(wf.map((w) => [w.candidateId, w]));
  const live = results.filter((r) => {
    const w = wfBy.get(r.candidateId);
    return candidates.some((c) => c.candidateId === r.candidateId) && !!w && (POOL_STATES as readonly string[]).includes(w.workflowState);
  });
  if (!live.length) return none;
  const liveIds = live.map((r) => r.candidateId);
  const candBy = new Map(candidates.map((c) => [c.candidateId, c]));

  const overrides = await activeOverrides(tx, liveIds, p.at);
  const locks = await activeLocks(tx, liveIds, p.at);
  const { groups: manual } = await manualTieBreakGroups(tx, ctx.dposCompanyId, liveIds);

  const items: RankItem[] = [];
  for (const r of live) {
    const tie = parseJson<{ values?: TieBreakValues | null }>(r.tieBreakJson, {}).values;
    if (!tie || r.domainScore === null) continue;
    const ov = overrides.get(r.candidateId);
    items.push({
      candidateId: r.candidateId,
      domainScore: r.domainScore,
      effectiveScore: Math.min(100, Math.max(0, Math.round((r.domainScore + (ov?.points ?? 0)) * 10_000) / 10_000)),
      tie,
      createdAt: candBy.get(r.candidateId)!.originalCreatedAt.toISOString(),
      eligibleForTop2: (TOP2_STATES as readonly string[]).includes(wfBy.get(r.candidateId)!.workflowState),
    });
  }
  const byId = new Map(items.map((i) => [i.candidateId, i]));
  const effective = orderItems(items, (i) => i.effectiveScore, manual, cfg);
  const application = applyRankLocks(effective.order, [...locks.values()].filter((l) => byId.has(l.candidateId)));
  const displayedRankOf = new Map(application.displayed.map((id, i) => [id, i + 1]));
  const top2 = selectTop2(application.displayed, byId, cfg);

  const prevPub = await tx.iamCoreScoreResult.findMany({ where: { candidateId: { in: liveIds }, publishedEventType: { not: null } }, orderBy: { scoredAt: "desc" }, distinct: ["candidateId"] });
  const prevPubBy = new Map(prevPub.map((r) => [r.candidateId, r]));
  const dispStates = await latestDisplayStates(tx, liveIds);

  const events: Array<EmittedEvent & { candidateId: string }> = [];
  const changed: string[] = [];
  for (const r of live) {
    const id = r.candidateId;
    if (!byId.has(id)) continue;
    const ov = overrides.get(id) ?? null;
    const lk = locks.get(id) ?? null;
    const lockApplied = !!lk && application.applied.some((a) => a.candidateId === id);
    const criticalOut = r.priorityBand === "CRITICAL" && !top2.includes(id);

    // Critical outside the Top 2 needs management review; a promotion into the Top 2 (or a documented demotion) resolves it.
    const openCrit = await tx.iamCoreForcedReview.findFirst({ where: { candidateId: id, reasonCode: "CRITICAL_OUTSIDE_TOP2", status: "OPEN" } });
    if (criticalOut && !openCrit && !(ov && ov.points < 0)) {
      const everResolved = await tx.iamCoreForcedReview.findFirst({ where: { candidateId: id, reasonCode: "CRITICAL_OUTSIDE_TOP2", status: "RESOLVED" } });
      const decided = await tx.iamCoreEmergencyReview.findFirst({ where: { candidateId: id, status: { in: ["CONFIRMED", "DECLINED"] } } });
      if (!everResolved && !decided) {
        await tx.iamCoreForcedReview.create({
          data: { dposCompanyId: ctx.dposCompanyId, candidateId: id, reasonCode: "CRITICAL_OUTSIDE_TOP2", detail: `Critical (score ${r.domainScore!.toFixed(2)}) but outside the Top 2 after a governed display change: management review is required.`, raisedAt: p.at, raisedByRunId: run.scoringRunId },
        });
      }
    } else if (!criticalOut && openCrit) {
      await tx.iamCoreForcedReview.update({ where: { reviewId: openCrit.reviewId }, data: { status: "RESOLVED", resolvedAt: p.at, resolvedBy: "iam-system", resolutionBasis: "NO_LONGER_APPLICABLE", resolution: "The candidate is no longer Critical outside the Top 2." } });
    }
    const stillOpen = await tx.iamCoreForcedReview.findMany({ where: { candidateId: id, status: "OPEN" }, orderBy: { raisedAt: "asc" } });

    const next: PublishedState = {
      scoringState: "SCORED",
      scoringStateReason: null,
      scoreFlags: parseJson<string[]>(r.scoreFlagsJson, []),
      additionalEmergencyReviewRequired: r.additionalEmergencyReviewRequired,
      domainScore: r.domainScore,
      calculatedRank: r.calculatedRank,
      displayedRank: displayedRankOf.get(id) ?? null,
      priorityBand: r.priorityBand,
      top2Qualified: top2.includes(id),
      emergencyReviewCandidate: r.emergencyReviewCandidate,
      criticalOutsideTop2: criticalOut,
      forcedReviewRequired: stillOpen.length > 0,
      overridePoints: ov?.points ?? null,
      rankLockRank: lockApplied ? lk!.rank : null,
    };
    const pub = prevPubBy.get(id);
    const disp = dispStates.get(id);
    const prev: PublishedState | null = disp && (!pub || disp.createdAt.getTime() >= pub.scoredAt.getTime()) ? disp.state : pub ? publishedStateOfResult(pub) : null;
    if (!prev || prev.domainScore === null) continue; // never published (or currently unscored): nothing to refresh
    if (statesEqual(prev, next)) continue;

    const displayChangeId = randomUUID();
    const reasonCodes = stillOpen.length ? [...new Set(stillOpen.map((x) => x.reasonCode))].join(", ") : null;
    const em = await Emitter.open(tx, ctx, id, actor, p.at, SCORING_ORIGIN);
    const ev = await em.emit(
      "DOMAIN_PRIORITY_CHANGED",
      displayChangeSections(SCORING_VERSION, {
        sourceRunId: run.scoringRunId,
        state: next,
        forcedReviewReason: reasonCodes,
        override: ov ? { points: ov.points, by: ov.by, reason: ov.reason, at: ov.at } : null,
        lock: lockApplied ? { until: lk!.expiresAt } : null,
      }),
      displayChangeId,
    );
    await tx.iamCoreDisplayChange.create({
      data: {
        displayChangeId,
        dposCompanyId: ctx.dposCompanyId,
        candidateId: id,
        governanceId: p.governanceId,
        basedOnScoreResultId: r.scoreResultId,
        stateJson: JSON.stringify(next),
        publishedEventType: "DOMAIN_PRIORITY_CHANGED",
        publishedOutboxId: ev.outboxId,
        createdAt: p.at,
      },
    });
    events.push({ ...ev, candidateId: id });
    changed.push(id);
  }
  return { events, changed };
}
