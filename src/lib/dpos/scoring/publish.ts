/**
 * Stage 4C: builds the Results Return payload sections for score / rank publication.
 *
 * Event design (the smallest clean one that fits the approved contract):
 *   CANDIDATE_SCORED         first score of a candidate, and every later finalized-run result whose calculated score, calculated
 *                            rank, band or review flags changed.
 *   SCORING_STATE_CHANGED    4C-D7: a previously scored candidate is now UNSCORED / NOT_RANKABLE (excluded, insufficient data confidence, no
 *                            valid inputs). The Data Hub clears the current score, rank and band with the reason; history stays.
 *                            4C-D8: rank locks, manual tie-breaks and promote/demote publish DOMAIN_PRIORITY_CHANGED IMMEDIATELY
 *                            (display-refresh.ts) with no new calculation.
 *   DOMAIN_PRIORITY_CHANGED  a governed change of the displayed priority without a new calculation (rank lock / override /
 *                            manual tie-break taking effect, emergency confirmation, decline or clearing), or a change of the
 *                            displayed rank / flags only.
 * Historical events are never edited; the Data Hub's current state reflects the latest accepted values.
 */
import type { ScoreCalculation } from "./calculate";
import { SCORING_VERSION, FACTOR_KEYS, MODIFIER_KEYS } from "./config";

export type ScoringState = "SCORED" | "UNSCORED" | "NOT_RANKABLE";

export interface PublishedState {
  /** Null when the candidate has never been published a scoring state (older rows are read as SCORED when they carry a score). */
  scoringState?: ScoringState | null;
  scoringStateReason?: string | null;
  scoreFlags?: string[];
  additionalEmergencyReviewRequired?: boolean;
  domainScore: number | null;
  calculatedRank: number | null;
  displayedRank: number | null;
  priorityBand: string | null;
  top2Qualified: boolean;
  emergencyReviewCandidate: boolean;
  criticalOutsideTop2: boolean;
  forcedReviewRequired: boolean;
  overridePoints: number | null;
  rankLockRank: number | null;
}

export interface PublishInput {
  scoringRunId: string;
  scoredAt: Date;
  calc: ScoreCalculation;
  calculatedRank: number | null;
  previousCalculatedRank: number | null;
  displayedRank: number | null;
  top2Qualified: boolean;
  emergencyReviewCandidate: boolean;
  criticalOutsideTop2: boolean;
  forcedReviewRequired: boolean;
  forcedReviewReason: string | null;
  override: { points: number; by: string; reason: string; at: Date } | null;
  lock: { rank: number; until: Date; by: string; reason: string } | null;
  additionalEmergencyReviewRequired?: boolean;
}

export const statesEqual = (a: PublishedState, b: PublishedState): boolean =>
  a.domainScore === b.domainScore &&
  a.calculatedRank === b.calculatedRank &&
  a.displayedRank === b.displayedRank &&
  a.priorityBand === b.priorityBand &&
  a.top2Qualified === b.top2Qualified &&
  a.emergencyReviewCandidate === b.emergencyReviewCandidate &&
  a.criticalOutsideTop2 === b.criticalOutsideTop2 &&
  a.forcedReviewRequired === b.forcedReviewRequired &&
  a.overridePoints === b.overridePoints &&
  a.rankLockRank === b.rankLockRank &&
  (a.scoringState ?? null) === (b.scoringState ?? null) &&
  (a.scoringStateReason ?? null) === (b.scoringStateReason ?? null) &&
  [...(a.scoreFlags ?? [])].sort().join("|") === [...(b.scoreFlags ?? [])].sort().join("|") &&
  !!a.additionalEmergencyReviewRequired === !!b.additionalEmergencyReviewRequired;

/** Which event (if any) a run result needs, given what was last published for the candidate. */
export function chooseEvent(prev: PublishedState | null, next: PublishedState): "CANDIDATE_SCORED" | "DOMAIN_PRIORITY_CHANGED" | null {
  if (!prev || prev.domainScore === null) return next.domainScore === null ? null : "CANDIDATE_SCORED";
  if (statesEqual(prev, next)) return null;
  if (next.domainScore === null) return null; // an unscored result is decided by chooseUnscoredEvent
  if (next.domainScore !== null && (prev.domainScore !== next.domainScore || prev.calculatedRank !== next.calculatedRank || prev.priorityBand !== next.priorityBand)) return "CANDIDATE_SCORED";
  return "DOMAIN_PRIORITY_CHANGED";
}

/**
 * 4C-D7: which event a candidate that is NOT scored in this run needs. A previously scored candidate publishes an explicit
 * SCORING_STATE_CHANGED (never relying on the absence of a score); a candidate that was already published as UNSCORED / NOT_RANKABLE
 * publishes again only when its state or reason changed; a candidate that was never scored publishes nothing (nothing to clear).
 */
export function chooseUnscoredEvent(prev: PublishedState | null, next: { scoringState: ScoringState; scoringStateReason: string }): "SCORING_STATE_CHANGED" | null {
  if (!prev) return null;
  const prevState: ScoringState | null = prev.scoringState ?? (prev.domainScore !== null ? "SCORED" : null);
  if (prevState === null) return null;
  if (prevState === "SCORED") return "SCORING_STATE_CHANGED";
  return prevState !== next.scoringState || (prev.scoringStateReason ?? null) !== next.scoringStateReason ? "SCORING_STATE_CHANGED" : null;
}

/** The scoring state and reason an excluded result represents. Insufficient data confidence is NOT_RANKABLE; every other exclusion is UNSCORED. */
export function scoringStateOfExclusion(exclusion: { reason: string; detail?: string }): { scoringState: ScoringState; scoringStateReason: string } {
  const state: ScoringState = exclusion.reason === "INSUFFICIENT_DATA_CONFIDENCE" ? "NOT_RANKABLE" : "UNSCORED";
  return { scoringState: state, scoringStateReason: exclusion.detail ? `${exclusion.reason}: ${exclusion.detail}`.slice(0, 500) : exclusion.reason };
}

const r2 = (n: number) => Math.round(n * 100) / 100;

/** Drop undefined members so an omitted value is omitted (never sent as null). */
const clean = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T;

export function scoreSections(runVersion: string, p: PublishInput): Record<string, Record<string, unknown>> {
  const c = p.calc;
  const factorScores = Object.fromEntries(FACTOR_KEYS.map((k) => [k, c.factors[k].score]));
  const modifierValues = Object.fromEntries(MODIFIER_KEYS.map((k) => [k, c.modifiers[k].value]));
  return clean({
    source: { iamSourceRunId: p.scoringRunId, iamSourceVersion: runVersion },
    recommendation: {
      scoringState: "SCORED",
      domainScore: c.domainScore,
      mathematicalDomainScore: c.mathematicalDomainScore ?? undefined,
      scoreFlags: c.flags,
      emergencyTriggers: c.emergency.triggers,
      additionalEmergencyReviewRequired: !!p.additionalEmergencyReviewRequired,
      rankLockActive: !!p.lock,
      uncappedDomainScore: c.uncappedDomainScore !== null ? r2(c.uncappedDomainScore) : undefined,
      domainRank: p.calculatedRank ?? undefined,
      previousDomainRank: p.previousCalculatedRank ?? undefined,
      priorityBand: c.priorityBand ?? undefined,
      scoringRunId: p.scoringRunId,
      scoreVersion: runVersion,
      scoredAt: p.scoredAt.toISOString(),
      rawCoreScore: c.rawCoreScore,
      dataConfidence: c.confidence.level,
      confidenceMultiplier: c.confidence.multiplier ?? undefined,
      confidenceAdjustedCoreScore: c.confidenceAdjustedCoreScore ?? undefined,
      uncappedModifierTotal: c.uncappedModifierTotal,
      cappedModifierTotal: c.cappedModifierTotal,
      factorScores,
      modifierValues,
      displayedDomainRank: p.displayedRank ?? undefined,
      emergencyReviewCandidate: p.emergencyReviewCandidate,
      emergencyReviewReasons: c.emergency.reasons.length ? c.emergency.reasons : undefined,
      top2Qualified: p.top2Qualified,
      criticalOutsideTop2: p.criticalOutsideTop2,
      forcedReviewRequired: p.forcedReviewRequired,
      forcedReviewReason: p.forcedReviewReason ?? undefined,
      ...(p.override
        ? {
            priorityOverrideType: p.override.points > 0 ? "PROMOTE" : "DEMOTE",
            priorityOverrideBy: p.override.by,
            priorityOverrideReason: p.override.reason,
            priorityOverrideAt: p.override.at.toISOString(),
          }
        : {}),
      ...(p.lock ? { rankLockedUntil: p.lock.until.toISOString() } : {}),
    },
  });
}

/** 4C-D7: the explicit state of a candidate that is no longer scored. Carries the reason and NEVER a score, rank or band. */
export function scoringStateSections(
  runVersion: string,
  p: { scoringRunId: string; scoredAt: Date; scoringState: ScoringState; scoringStateReason: string; calc: ScoreCalculation | null; emergencyReviewCandidate: boolean; additionalEmergencyReviewRequired?: boolean; forcedReviewRequired: boolean; forcedReviewReason: string | null },
): Record<string, Record<string, unknown>> {
  return clean({
    source: { iamSourceRunId: p.scoringRunId, iamSourceVersion: runVersion },
    recommendation: {
      scoringState: p.scoringState,
      notRankableReason: p.scoringStateReason,
      scoringRunId: p.scoringRunId,
      scoreVersion: runVersion,
      scoredAt: p.scoredAt.toISOString(),
      ...(p.calc ? { dataConfidence: p.calc.confidence.level } : {}),
      emergencyReviewCandidate: p.emergencyReviewCandidate,
      emergencyTriggers: p.calc?.emergency.triggers ?? [],
      additionalEmergencyReviewRequired: !!p.additionalEmergencyReviewRequired,
      forcedReviewRequired: p.forcedReviewRequired,
      forcedReviewReason: p.forcedReviewReason ?? undefined,
      rankLockActive: false,
    },
  });
}

/**
 * 4C-D8: an immediate governance change of the DISPLAYED priority (rank lock / release, manual tie-break, promote / demote). No score is
 * recalculated: the calculated score, calculated rank and band are reused untouched; only displayed rank, Top 2 and the governance
 * markers change.
 */
export function displayChangeSections(
  runVersion: string,
  p: {
    sourceRunId: string;
    state: PublishedState;
    forcedReviewReason: string | null;
    override: { points: number; by: string; reason: string; at: Date } | null;
    lock: { until: Date } | null;
  },
): Record<string, Record<string, unknown>> {
  return clean({
    source: { iamSourceRunId: p.sourceRunId, iamSourceVersion: runVersion },
    recommendation: {
      displayedDomainRank: p.state.displayedRank ?? undefined,
      top2Qualified: p.state.top2Qualified,
      criticalOutsideTop2: p.state.criticalOutsideTop2,
      forcedReviewRequired: p.state.forcedReviewRequired,
      forcedReviewReason: p.forcedReviewReason ?? undefined,
      rankLockActive: !!p.lock,
      ...(p.lock ? { rankLockedUntil: p.lock.until.toISOString() } : {}),
      ...(p.override
        ? {
            priorityOverrideType: p.override.points > 0 ? "PROMOTE" : "DEMOTE",
            priorityOverrideBy: p.override.by,
            priorityOverrideReason: p.override.reason,
            priorityOverrideAt: p.override.at.toISOString(),
          }
        : {}),
    },
  });
}

/** Flags-only change for a candidate that is not (or no longer) rankable: no score is invented. */
export function flagsOnlySections(runVersion: string, p: Pick<PublishInput, "scoringRunId" | "scoredAt" | "emergencyReviewCandidate" | "forcedReviewRequired" | "forcedReviewReason" | "calc">): Record<string, Record<string, unknown>> {
  return clean({
    source: { iamSourceRunId: p.scoringRunId, iamSourceVersion: runVersion },
    recommendation: {
      scoringRunId: p.scoringRunId,
      scoreVersion: runVersion,
      scoredAt: p.scoredAt.toISOString(),
      dataConfidence: p.calc.confidence.level,
      emergencyReviewCandidate: p.emergencyReviewCandidate,
      emergencyReviewReasons: p.calc.emergency.reasons.length ? p.calc.emergency.reasons : undefined,
      forcedReviewRequired: p.forcedReviewRequired,
      forcedReviewReason: p.forcedReviewReason ?? undefined,
    },
  });
}

export { SCORING_VERSION };
