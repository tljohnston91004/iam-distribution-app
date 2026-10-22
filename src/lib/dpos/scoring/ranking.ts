/**
 * Stage 4C: deterministic domain ranking, tie-break, rank lock and Top 2 selection. Pure functions: no database, no clock.
 *
 * Tie definition (approved): two candidates are tied when they have the same displayed one-decimal score OR their scores are
 * within 0.5 points. Because "within 0.5" is not transitive, tie clusters are ANCHORED to the leader of the cluster: walking
 * down the score order, a candidate joins the current cluster while its score is within 0.5 of the cluster's highest-scoring
 * member; otherwise it starts a new cluster. Inside a cluster the approved 12-step tie-break sequence orders the candidates;
 * the manual management tie-break (step 13) applies when steps 1-12 leave candidates level, and the lowest candidate id is the
 * last, flagged deterministic fallback so a run is always reproducible.
 */
import { SCORING_CONFIG, type ScoringConfig } from "./config";
import type { TieBreakValues } from "./calculate";

const SCALE = 10_000;
const s4 = (n: number) => Math.round(n * SCALE);

/** Score >= threshold, comparing the score rounded half-up to two decimals (the same rounding the priority bands use). */
export function scoreAtLeast(score: number, min: number): boolean {
  return Math.floor((s4(score) + 50) / 100) >= Math.round(min * 100);
}

export const TIE_LEVELS = [
  "CASH_IMPACT_SCORE",
  "EXPECTED_13_WEEK_CASH_IMPACT",
  "TIME_SENSITIVITY",
  "OPERATIONAL_RISK",
  "CUSTOMER_REVENUE_IMPACT",
  "PREVENTABLE_LOSS",
  "DATA_CONFIDENCE",
  "FASTER_BENEFIT_REALIZATION",
  "LOWER_EXECUTION_BURDEN",
  "LONGER_PERSISTENCE",
  "EARLIER_ACTION_DEADLINE",
  "EARLIER_CANDIDATE_CREATION",
  "MANUAL_MANAGEMENT_TIE_BREAK",
  "DETERMINISTIC_ID_FALLBACK",
] as const;
export type TieLevelName = (typeof TIE_LEVELS)[number];

export interface RankItem {
  candidateId: string;
  /** Calculated domain score (never altered by a governed override). */
  domainScore: number;
  /** Calculated score plus any active governed override points, clamped 0..100 (management view). */
  effectiveScore: number;
  tie: TieBreakValues;
  /** ISO timestamp the candidate was first created. */
  createdAt: string;
  /** Part of the NEW-candidate Top 2 pool (not assigned/active, not suppressed). */
  eligibleForTop2: boolean;
}

/** Explicit management tie-break decisions: each inner list is an ordered group, best first. */
export type ManualTieBreaks = string[][];

export interface TieNote {
  clusterId: number;
  clusterSize: number;
  position: number;
  /** 1-based level (1..14) that separated this candidate from the next one in the cluster, or null for the last. */
  separatedFromNextAt: number | null;
  /** 1-based level (1..14) that separated this candidate from the previous one in the cluster, or null for the first. */
  separatedFromPreviousAt: number | null;
  levelNames: { next: TieLevelName | null; previous: TieLevelName | null };
  usedManualTieBreak: boolean;
  usedDeterministicFallback: boolean;
}

export interface CompareResult {
  /** Negative: a ranks ahead of b. */
  order: number;
  /** 1-based level of the sequence that decided (1..14). */
  level: number;
}

function cmpDesc(a: number, b: number): number {
  return a === b ? 0 : a > b ? -1 : 1;
}
function cmpAsc(a: number, b: number): number {
  return a === b ? 0 : a < b ? -1 : 1;
}

function manualPosition(groups: ManualTieBreaks, a: string, b: string): number {
  for (const g of groups) {
    const ia = g.indexOf(a);
    const ib = g.indexOf(b);
    if (ia >= 0 && ib >= 0 && ia !== ib) return ia < ib ? -1 : 1;
  }
  return 0;
}

/** The approved tie-break sequence. Returns which level decided so the decision is explainable. */
export function compareTieBreak(a: RankItem, b: RankItem, manual: ManualTieBreaks = []): CompareResult {
  const steps: Array<() => number> = [
    () => cmpDesc(a.tie.cashScore, b.tie.cashScore),
    () => cmpDesc(a.tie.expectedCash, b.tie.expectedCash),
    () => cmpDesc(a.tie.timeScore, b.tie.timeScore),
    () => cmpDesc(a.tie.operationalRisk, b.tie.operationalRisk),
    () => cmpDesc(a.tie.customerRevenue, b.tie.customerRevenue),
    () => cmpDesc(a.tie.preventableLoss, b.tie.preventableLoss),
    () => cmpDesc(a.tie.confidenceRank, b.tie.confidenceRank),
    () => cmpDesc(a.tie.benefitSpeed, b.tie.benefitSpeed),
    () => cmpAsc(a.tie.executionBurden, b.tie.executionBurden),
    () => cmpDesc(a.tie.persistence, b.tie.persistence),
    () => {
      // Earlier deadline first; a candidate with no deadline ranks after one that has a deadline.
      if (a.tie.actionDeadline === b.tie.actionDeadline) return 0;
      if (a.tie.actionDeadline === null) return 1;
      if (b.tie.actionDeadline === null) return -1;
      return a.tie.actionDeadline < b.tie.actionDeadline ? -1 : 1;
    },
    () => cmpAsc(Date.parse(a.createdAt), Date.parse(b.createdAt)),
    () => manualPosition(manual, a.candidateId, b.candidateId),
    () => (a.candidateId === b.candidateId ? 0 : a.candidateId < b.candidateId ? -1 : 1),
  ];
  for (let i = 0; i < steps.length; i++) {
    const r = steps[i]!();
    if (r !== 0) return { order: r, level: i + 1 };
  }
  return { order: 0, level: steps.length };
}

export interface OrderedRanking {
  /** Candidate ids, best first. */
  order: string[];
  notes: Map<string, TieNote>;
}

/**
 * Order the items by `scoreOf` descending, resolving ties (same displayed score or within 0.5 of the cluster leader) with the
 * approved sequence. Deterministic: the result does not depend on the input order.
 */
export function orderItems(items: RankItem[], scoreOf: (i: RankItem) => number, manual: ManualTieBreaks = [], cfg: ScoringConfig = SCORING_CONFIG): OrderedRanking {
  const base = [...items].sort((x, y) => s4(scoreOf(y)) - s4(scoreOf(x)) || (x.candidateId < y.candidateId ? -1 : 1));
  const within = Math.round(cfg.tie.withinPoints * SCALE);
  const clusters: RankItem[][] = [];
  for (const it of base) {
    const cur = clusters[clusters.length - 1];
    if (cur && s4(scoreOf(cur[0]!)) - s4(scoreOf(it)) <= within) cur.push(it);
    else clusters.push([it]);
  }
  const order: string[] = [];
  const notes = new Map<string, TieNote>();
  clusters.forEach((cluster, idx) => {
    if (cluster.length === 1) {
      order.push(cluster[0]!.candidateId);
      return;
    }
    const sorted = [...cluster].sort((x, y) => compareTieBreak(x, y, manual).order);
    sorted.forEach((it, pos) => {
      const next = sorted[pos + 1];
      const prev = sorted[pos - 1];
      const nextLevel = next ? compareTieBreak(it, next, manual).level : null;
      const prevLevel = prev ? compareTieBreak(prev, it, manual).level : null;
      notes.set(it.candidateId, {
        clusterId: idx + 1,
        clusterSize: sorted.length,
        position: pos + 1,
        separatedFromNextAt: nextLevel,
        separatedFromPreviousAt: prevLevel,
        levelNames: { next: nextLevel ? TIE_LEVELS[nextLevel - 1]! : null, previous: prevLevel ? TIE_LEVELS[prevLevel - 1]! : null },
        usedManualTieBreak: nextLevel === 13 || prevLevel === 13,
        usedDeterministicFallback: nextLevel === 14 || prevLevel === 14,
      });
      order.push(it.candidateId);
    });
  });
  return { order, notes };
}

export interface RankLockInput {
  candidateId: string;
  /** The displayed rank the lock holds (1-based). */
  rank: number;
  effectiveAt: Date;
  /** Governance row id, used as the deterministic tiebreaker between conflicting locks. */
  governanceId: string;
}

export interface LockApplication {
  displayed: string[];
  applied: Array<{ candidateId: string; rank: number }>;
  ignored: Array<{ candidateId: string; rank: number; reason: string }>;
}

/** Hold each locked candidate at its locked displayed rank; everyone else keeps the effective order around them. */
export function applyRankLocks(effectiveOrder: string[], locks: RankLockInput[]): LockApplication {
  const n = effectiveOrder.length;
  const applied: LockApplication["applied"] = [];
  const ignored: LockApplication["ignored"] = [];
  const slots = new Map<number, string>();
  const ordered = [...locks].sort((a, b) => a.effectiveAt.getTime() - b.effectiveAt.getTime() || (a.governanceId < b.governanceId ? -1 : 1));
  for (const l of ordered) {
    if (!effectiveOrder.includes(l.candidateId)) {
      ignored.push({ candidateId: l.candidateId, rank: l.rank, reason: "CANDIDATE_NOT_RANKED_IN_THIS_RUN" });
      continue;
    }
    const rank = Math.min(Math.max(1, l.rank), Math.max(1, n));
    if (slots.has(rank)) {
      ignored.push({ candidateId: l.candidateId, rank, reason: `RANK_ALREADY_LOCKED_BY_${slots.get(rank)}` });
      continue;
    }
    slots.set(rank, l.candidateId);
    applied.push({ candidateId: l.candidateId, rank });
  }
  const lockedIds = new Set(slots.values());
  const rest = effectiveOrder.filter((id) => !lockedIds.has(id));
  const displayed: string[] = [];
  let ri = 0;
  for (let rank = 1; rank <= n; rank++) {
    const locked = slots.get(rank);
    displayed.push(locked ?? rest[ri++]!);
  }
  return { displayed, applied, ignored };
}

/** Top 2: new, qualified candidates only (effective score >= threshold). Never filled with lower-scoring candidates. */
export function selectTop2(displayedOrder: string[], byId: Map<string, RankItem>, cfg: ScoringConfig = SCORING_CONFIG): string[] {
  const out: string[] = [];
  for (const id of displayedOrder) {
    const it = byId.get(id)!;
    if (!it.eligibleForTop2) continue;
    if (!scoreAtLeast(it.effectiveScore, cfg.top2.threshold)) continue;
    out.push(id);
    if (out.length >= cfg.top2.slots) break;
  }
  return out;
}

/** Override guidance: Minor +/-1..5, Material +/-6..10. Anything outside is refused (never silently exceeded). */
export function overrideMagnitude(points: number, cfg: ScoringConfig = SCORING_CONFIG): "MINOR" | "MATERIAL" | null {
  const a = Math.abs(points);
  if (!Number.isFinite(points) || a < 1) return null;
  if (a <= cfg.override.minorMax) return "MINOR";
  if (a <= cfg.override.materialMax) return "MATERIAL";
  return null;
}
