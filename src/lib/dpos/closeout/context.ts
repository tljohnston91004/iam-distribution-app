/**
 * Stage 4E read-only context for a closeout: scoring history, Health history and the plan / cost-of-inaction picture.
 *
 * Everything here READS. Scoring is never recomputed (4E-D4: the current scoring state AND the immutable SCORING_STATE_CHANGED history
 * are used) and Health is never recalculated or mutated; Health curves stay PROVISIONAL (4E-D5 / 4E-D6), a Health movement is shown as
 * context and is never claimed as the effect of the candidate.
 */
import type { Db } from "../errors";
import { listHealthHistory, compareHealth, type StoredHealth } from "../health/service";
import { COMPONENT_KEYS } from "../health/config";
import { readActionPlan, type ActionPlanView } from "../board/plan";
import type { WorkflowActor } from "../workflow/permissions";
import { parseJson } from "../workflow/internal";
import type { CoiResult } from "../board/coi";
import type { ExpectedVsActual, ResidualExposure } from "./measure";
import { actualImpacts } from "./measure";

// ---- scoring history ----------------------------------------------------------------------------------------------------------

export interface ScoringHistoryEntry {
  at: string;
  outcome: string;
  scoringState: string | null;
  domainScore: number | null;
  priorityBand: string | null;
  calculatedRank: number | null;
  displayedRank: number | null;
  emergencyReviewCandidate: boolean;
  publishedEventType: string | null;
}

export interface ScoringHistory {
  /** Current scoring state read from the stored scoring results (nothing is recomputed). */
  current: { scoringState: string | null; domainScore: number | null; priorityBand: string | null; displayedRank: number | null; at: string } | null;
  initial: { domainScore: number | null; calculatedRank: number | null; priorityBand: string | null; at: string } | null;
  peak: { domainScore: number; calculatedRank: number | null; at: string } | null;
  /** The last ranked result at or before the cut-off (the closeout moment) - the final pre-closeout score. */
  finalPreCloseout: { domainScore: number | null; calculatedRank: number | null; displayedRank: number | null; priorityBand: string | null; at: string } | null;
  rankHistory: ScoringHistoryEntry[];
  bandMovements: Array<{ at: string; from: string | null; to: string | null }>;
  emergencyReviews: Array<{ status: string; raisedAt: string; decidedAt: string | null }>;
  /** The immutable SCORING_STATE_CHANGED events (what the Data Hub was told). */
  scoringStateChanges: Array<{ at: string; scoringState: string | null; reason: string | null }>;
  statement: string;
}

export async function readScoringHistory(db: Db, candidateId: string, cutoff: Date): Promise<ScoringHistory> {
  const results = await db.iamCoreScoreResult.findMany({ where: { candidateId }, orderBy: [{ scoredAt: "asc" }, { scoreResultId: "asc" }] });
  const emergencies = await db.iamCoreEmergencyReview.findMany({ where: { candidateId }, orderBy: { raisedAt: "asc" } });
  const changes = await db.dposResultsReturnOutbox.findMany({ where: { candidateId, eventType: "SCORING_STATE_CHANGED" }, orderBy: { createdAt: "asc" }, select: { createdAt: true, payloadJson: true } });
  const entries: ScoringHistoryEntry[] = results.map((r) => ({
    at: r.scoredAt.toISOString(),
    outcome: r.outcome,
    scoringState: r.scoringState ?? (r.outcome === "RANKED" ? "SCORED" : null),
    domainScore: r.domainScore,
    priorityBand: r.priorityBand,
    calculatedRank: r.calculatedRank,
    displayedRank: r.displayedRank,
    emergencyReviewCandidate: r.emergencyReviewCandidate,
    publishedEventType: r.publishedEventType,
  }));
  const ranked = results.filter((r) => r.outcome === "RANKED");
  const last = results[results.length - 1] ?? null;
  const bandMovements: ScoringHistory["bandMovements"] = [];
  let prevBand: string | null = null;
  for (const r of ranked) {
    if (r.priorityBand !== prevBand) bandMovements.push({ at: r.scoredAt.toISOString(), from: prevBand, to: r.priorityBand });
    prevBand = r.priorityBand;
  }
  let peak: ScoringHistory["peak"] = null;
  for (const r of ranked) if (typeof r.domainScore === "number" && (!peak || r.domainScore > peak.domainScore)) peak = { domainScore: r.domainScore, calculatedRank: r.calculatedRank, at: r.scoredAt.toISOString() };
  const beforeCut = ranked.filter((r) => r.scoredAt.getTime() <= cutoff.getTime());
  const fin = beforeCut[beforeCut.length - 1] ?? null;
  const first = ranked[0] ?? null;
  return {
    current: last ? { scoringState: last.scoringState ?? (last.outcome === "RANKED" ? "SCORED" : null), domainScore: last.domainScore, priorityBand: last.priorityBand, displayedRank: last.displayedRank, at: last.scoredAt.toISOString() } : null,
    initial: first ? { domainScore: first.domainScore, calculatedRank: first.calculatedRank, priorityBand: first.priorityBand, at: first.scoredAt.toISOString() } : null,
    peak,
    finalPreCloseout: fin ? { domainScore: fin.domainScore, calculatedRank: fin.calculatedRank, displayedRank: fin.displayedRank, priorityBand: fin.priorityBand, at: fin.scoredAt.toISOString() } : null,
    rankHistory: entries,
    bandMovements,
    emergencyReviews: emergencies.map((e) => ({ status: e.status, raisedAt: e.raisedAt.toISOString(), decidedAt: e.decidedAt ? e.decidedAt.toISOString() : null })),
    scoringStateChanges: changes.map((c) => {
      const scoring = (parseJson<{ scoring?: { scoringState?: string; notRankableReason?: string } }>(c.payloadJson, {}).scoring ?? {}) as { scoringState?: string; notRankableReason?: string };
      return { at: c.createdAt.toISOString(), scoringState: scoring.scoringState ?? null, reason: scoring.notRankableReason ?? null };
    }),
    statement: "Read-only history of the stored scoring results and the published SCORING_STATE_CHANGED events. Nothing is recomputed here and no earlier score is reinterpreted.",
  };
}

// ---- Health history -----------------------------------------------------------------------------------------------------------

export interface HealthPoint {
  label: "AT_CANDIDATE_CREATION" | "AT_ACTION_START" | "AT_CLOSEOUT";
  healthScoreId: string | null;
  calculatedAt: string | null;
  score: number | null;
  healthLabel: string | null;
  curveStatus: string | null;
  components: Array<{ key: string; score: number | null; available: boolean }>;
}

export interface HealthContext {
  points: HealthPoint[];
  /** Movement between the first and last point (null when fewer than two points or different formula versions). */
  movement: { comparable: boolean; scoreChange: number | null; components: Array<{ key: string; change: number | null }> } | null;
  curveStatus: string | null;
  provisional: boolean;
  statement: string;
}

const PROVISIONAL_STATEMENT =
  "Health curves are PROVISIONAL (pending Product Owner approval). Health is company-level context: a Health movement around this candidate is shown for reference and is NOT proof that the candidate caused it, and a provisional Health score is never the sole proof that an action succeeded.";

function pointAt(history: StoredHealth[], at: Date | null, label: HealthPoint["label"]): HealthPoint {
  const empty: HealthPoint = { label, healthScoreId: null, calculatedAt: null, score: null, healthLabel: null, curveStatus: null, components: [] };
  if (!at) return empty;
  // history is newest-first; take the newest score calculated at or before the moment
  const h = history.find((x) => Date.parse(x.calculatedAt) <= at.getTime());
  if (!h) return empty;
  return {
    label,
    healthScoreId: h.healthScoreId,
    calculatedAt: h.calculatedAt,
    score: h.score,
    healthLabel: h.label,
    curveStatus: h.curveStatus,
    components: h.components.map((c) => ({ key: c.key, score: c.score ?? null, available: c.available })),
  };
}

export async function readHealthContext(db: Db, ctx: { dposCompanyId: string }, moments: { candidateCreatedAt: Date; actionStartedAt: Date | null; closeoutAt: Date }): Promise<HealthContext> {
  const history = await listHealthHistory(db, ctx, { limit: 520 });
  const points = [pointAt(history, moments.candidateCreatedAt, "AT_CANDIDATE_CREATION"), pointAt(history, moments.actionStartedAt, "AT_ACTION_START"), pointAt(history, moments.closeoutAt, "AT_CLOSEOUT")];
  const withScore = points.filter((p) => p.healthScoreId);
  let movement: HealthContext["movement"] = null;
  if (withScore.length >= 2) {
    const firstP = withScore[0]!;
    const lastP = withScore[withScore.length - 1]!;
    if (firstP.healthScoreId !== lastP.healthScoreId) {
      const a = history.find((h) => h.healthScoreId === firstP.healthScoreId)!;
      const b = history.find((h) => h.healthScoreId === lastP.healthScoreId)!;
      const change = compareHealth(b, a);
      movement = { comparable: change.comparable, scoreChange: change.scoreChange, components: COMPONENT_KEYS.map((k) => ({ key: k, change: change.components.find((c) => c.key === k)?.change ?? null })) };
    }
  }
  const curve = history[0]?.curveStatus ?? null;
  return { points, movement, curveStatus: curve, provisional: curve !== "APPROVED", statement: PROVISIONAL_STATEMENT };
}

// ---- plan / COI ----------------------------------------------------------------------------------------------------------------

export interface PlanContext {
  planVersion: number | null;
  recommendationVersion: number | null;
  summary: string | null;
  direction: string | null;
  deviatesFromRecommendation: boolean;
  deviationReason: string | null;
  versions: Array<{ planVersion: number; state: string; summary: string | null; approvedAt: string | null; current: boolean }>;
  revisions: Array<{ at: string; planVersionBefore: number | null; planVersionAfter: number | null; reason: string | null; actorId: string }>;
  department: string | null;
  ownerId: string | null;
  primaryAction: string | null;
  targetResolution: string | null;
  expectedImpact: ActionPlanView["expectedImpact"];
}

export interface PlanAndCoi {
  plan: PlanContext;
  coi: CoiResult;
  scoringExpected: { cash: number | null; profitability: number | null };
  view: ActionPlanView;
}

export async function readPlanAndCoi(db: Db, ctx: { dposCompanyId: string }, candidateId: string, actor: WorkflowActor, now: Date): Promise<PlanAndCoi> {
  const v = await readActionPlan(db, ctx, candidateId, actor, now);
  const cur = v.managementPlan;
  const rec = v.systemRecommendation;
  const inputs = await db.iamCoreScoringInput.findFirst({ where: { candidateId }, orderBy: { inputVersion: "desc" } });
  const parsed = parseJson<{ cash?: { expected13WeekNetCashImpact?: number }; profitability?: { netProfitabilityImpact?: number } }>(inputs?.inputsJson, {});
  const n = (x: unknown) => (typeof x === "number" && Number.isFinite(x) ? x : null);
  return {
    plan: {
      planVersion: cur?.planVersion ?? null,
      recommendationVersion: rec.version,
      summary: cur?.summary ?? null,
      direction: cur?.direction ?? rec.direction,
      deviatesFromRecommendation: cur?.deviatesFromRecommendation ?? false,
      deviationReason: cur?.deviationReason ?? null,
      versions: v.versions.map((p) => ({ planVersion: p.planVersion, state: p.state, summary: p.summary, approvedAt: p.approvedAt, current: p.current })),
      revisions: v.revisions.map((r) => ({ at: r.at, planVersionBefore: r.planVersionBefore, planVersionAfter: r.planVersionAfter, reason: r.reason, actorId: r.actorId })),
      department: v.ownership.department,
      ownerId: v.ownership.ownerId,
      primaryAction: v.actions.primary?.title ?? null,
      targetResolution: v.dates.resolution,
      expectedImpact: v.expectedImpact,
    },
    coi: v.coi,
    scoringExpected: { cash: n(parsed.cash?.expected13WeekNetCashImpact), profitability: n(parsed.profitability?.netProfitabilityImpact) },
    view: v,
  };
}

// ---- COI vs actual ---------------------------------------------------------------------------------------------------------------------

export interface CoiVsActual {
  estimatedCoi: { value: number | null; status: string; statement: string; horizonDays: number };
  actualMeasuredImpacts: Array<{ measure: string; value: number; unit: string; evidenceRef: string }>;
  residual: ResidualExposure | null;
  /** Always null: the cost of inaction is an ESTIMATE of what not acting would cost; it is never converted to realized savings. */
  realizedSavings: null;
  variance: null;
  statement: string;
}

export function buildCoiVsActual(coi: CoiResult, eva: ExpectedVsActual | null, residual: ResidualExposure | null): CoiVsActual {
  return {
    estimatedCoi: { value: coi.total, status: coi.status, statement: coi.statement, horizonDays: coi.horizonDays },
    actualMeasuredImpacts: actualImpacts(eva),
    residual,
    realizedSavings: null,
    variance: null,
    statement:
      "The estimated cost of inaction (COI) is shown beside the evidenced actual impact and the residual exposure. COI is an estimate of the cost of NOT acting; it is never converted into realized savings, and no variance is computed between an estimate and a measured result.",
  };
}
