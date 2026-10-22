/**
 * Stage 4C: auditable priority governance.
 *
 * Every control records a stable DPOS user id (4C-D5), the actor's role, a reason and a timestamp in the append-only ledger
 `iam_core_priority_governance`. Nothing is hidden and nothing here edits a calculated score, rank, band or modifier: the
 * calculated values are preserved by the scoring run, and the override / lock / tie-break is stored beside them.
 *
 * 4C-D8 timing. IMMEDIATE governance (published at once as an immutable DOMAIN_PRIORITY_CHANGED event, calculated score/rank untouched):
 * promote / demote of the displayed priority, rank lock and release, manual tie-break, emergency confirmation / decline / clearing, and
 * (Stage 4B workflow) suppression, suppression release, risk acceptance. Forced reviews are recorded the moment they are raised or
 * resolved. NEW SCORING RUN ONLY: strategic modifier, confidence, execution burden, benefit uncertainty, factor inputs and scoring
 * configuration - these change the calculation itself, so they never mutate an already-published score. A lock never freezes scoring.
 *
 * Suppression, suppression release, rejection and risk acceptance are Stage 4B workflow operations and keep their own history.
 */
import { randomUUID } from "node:crypto";
import type { PrismaClient } from "@prisma/client";
import { writeAudit } from "../audit";
import { DposError } from "../errors";
import { Emitter, SCORING_ORIGIN, optionalText, parseJson, requireText, toJson, type EmittedEvent } from "../workflow/internal";
import { requireManagement, requireSenior, type WorkflowActor } from "../workflow/permissions";
import { SCORING_CONFIG, SCORING_VERSION, STRATEGIC_LEVELS, type ScoringConfig, type StrategicLevel } from "./config";
import { POOL_STATES, assertStableUserId, monotonicEffectiveAt, type Tx } from "./ledger";
import { refreshDisplayedPriority } from "./display-refresh";
import { overrideMagnitude } from "./ranking";

type Ctx = { dposCompanyId: string };
const DAY_MS = 24 * 3600 * 1000;

interface GovEnv {
  tx: Tx;
  candidate: NonNullable<Awaited<ReturnType<Tx["iamCoreCandidate"]["findUnique"]>>>;
  workflowState: string;
  effectiveAt: Date;
  at: Date;
}

async function governed<T>(
  db: PrismaClient,
  ctx: Ctx,
  actor: WorkflowActor,
  candidateId: string,
  meta: { operation: string; at?: Date; allowAnyState?: boolean; senior?: string },
  fn: (env: GovEnv) => Promise<T>,
): Promise<T> {
  requireManagement(actor, meta.operation);
  assertStableUserId(actor, meta.operation);
  if (meta.senior) requireSenior(actor, meta.operation, meta.senior);
  return db.$transaction(
    async (tx) => {
      const candidate = await tx.iamCoreCandidate.findUnique({ where: { candidateId } });
      if (!candidate || candidate.dposCompanyId !== ctx.dposCompanyId) throw new DposError("CANDIDATE_NOT_FOUND", "Unknown candidate.", 404);
      if (candidate.closedAt) throw new DposError("CLOSED_CANDIDATE_NO_REOPEN", "This candidate is closed and is never reopened.", 409);
      const wf = await tx.iamCoreWorkflowState.findUnique({ where: { candidateId } });
      if (!wf) throw new DposError("CANDIDATE_NOT_IN_WORKFLOW", "This candidate has no workflow record.", 409);
      if (!meta.allowAnyState && !(POOL_STATES as readonly string[]).includes(wf.workflowState)) {
        throw new DposError("NOT_A_NEW_CANDIDATE", `${meta.operation} applies to new candidates; this one is ${wf.workflowState}.`, 409, { state: wf.workflowState });
      }
      const at = meta.at ?? new Date();
      const effectiveAt = await monotonicEffectiveAt(tx, candidateId, at);
      const out = await fn({ tx, candidate, workflowState: wf.workflowState, effectiveAt, at });
      await writeAudit(tx, { category: "SCORING_GOVERNANCE", action: meta.operation, outcome: "SUCCESS", actor: actor.actorId, dposCompanyId: ctx.dposCompanyId, subjectType: "IamCoreCandidate", subjectId: candidateId, detail: { role: actor.role }, at: effectiveAt });
      return out;
    },
    { maxWait: 10_000, timeout: 30_000 },
  );
}

async function ledger(
  env: GovEnv,
  ctx: Ctx,
  actor: WorkflowActor,
  actionType: string,
  reason: string,
  extra: { points?: number; magnitudeClass?: string; detail?: unknown; expiresAt?: Date | null; batchId?: string } = {},
) {
  return env.tx.iamCorePriorityGovernance.create({
    data: {
      dposCompanyId: ctx.dposCompanyId,
      candidateId: env.candidate.candidateId,
      batchId: extra.batchId ?? null,
      actionType,
      actorId: actor.actorId,
      actorRole: actor.role,
      reason,
      points: extra.points ?? null,
      magnitudeClass: extra.magnitudeClass ?? null,
      detailJson: toJson(extra.detail),
      effectiveAt: env.effectiveAt,
      expiresAt: extra.expiresAt ?? null,
    },
  });
}

// ---- promote / demote ------------------------------------------------------------------------------------------------------------

export interface OverrideInput {
  /** Signed points: Minor +/-1..5, Material +/-6..10. Anything larger is refused. */
  points: number;
  reason: string;
  at?: Date;
  expiresAt?: Date | null;
}

export async function setPriorityOverride(db: PrismaClient, ctx: Ctx, actor: WorkflowActor, candidateId: string, input: OverrideInput, cfg: ScoringConfig = SCORING_CONFIG) {
  return governed(db, ctx, actor, candidateId, { operation: "PRIORITY_OVERRIDE", at: input.at }, async (env) => {
    const reason = requireText(input.reason, "A reason for the priority override");
    const magnitude = overrideMagnitude(input.points, cfg);
    if (!magnitude) {
      throw new DposError("OVERRIDE_OUT_OF_RANGE", `An override must be +/-1 to +/-${cfg.override.minorMax} (minor) or +/-${cfg.override.minorMax + 1} to +/-${cfg.override.materialMax} (material). Strategic importance uses the strategic authorization; an emergency is a separate governance state.`, 400, { points: input.points });
    }
    const row = await ledger(env, ctx, actor, "PRIORITY_OVERRIDE", reason, { points: input.points, magnitudeClass: magnitude, expiresAt: input.expiresAt ?? null, detail: { direction: input.points > 0 ? "PROMOTE" : "DEMOTE", effective: "IMMEDIATE_DISPLAY" } });
    const refreshed = await refreshDisplayedPriority(env.tx, ctx, actor, { at: env.effectiveAt, governanceId: row.governanceId, cfg });
    return { governanceId: row.governanceId, candidateId, points: input.points, magnitudeClass: magnitude, effectiveAt: row.effectiveAt, events: refreshed.events };
  });
}

export async function revokePriorityOverride(db: PrismaClient, ctx: Ctx, actor: WorkflowActor, candidateId: string, input: { reason: string; at?: Date }, cfg: ScoringConfig = SCORING_CONFIG) {
  return governed(db, ctx, actor, candidateId, { operation: "OVERRIDE_REVOKED", at: input.at }, async (env) => {
    const reason = requireText(input.reason, "A reason for revoking the override");
    const row = await ledger(env, ctx, actor, "OVERRIDE_REVOKED", reason, { detail: { effective: "IMMEDIATE_DISPLAY" } });
    const refreshed = await refreshDisplayedPriority(env.tx, ctx, actor, { at: env.effectiveAt, governanceId: row.governanceId, cfg });
    return { governanceId: row.governanceId, candidateId, effectiveAt: row.effectiveAt, events: refreshed.events };
  });
}

// ---- rank lock -----------------------------------------------------------------------------------------------------------------------

export interface RankLockInput {
  rank: number;
  reason: string;
  at?: Date;
  /** End of the lock. Defaults to one weekly cycle; may never exceed it. */
  until?: Date;
}

export async function lockRank(db: PrismaClient, ctx: Ctx, actor: WorkflowActor, candidateId: string, input: RankLockInput, cfg: ScoringConfig = SCORING_CONFIG) {
  return governed(db, ctx, actor, candidateId, { operation: "RANK_LOCK", at: input.at }, async (env) => {
    const reason = requireText(input.reason, "A reason for the rank lock");
    if (!Number.isInteger(input.rank) || input.rank < 1) throw new DposError("RANK_INVALID", "The locked rank must be a whole number of 1 or more.", 400);
    const max = cfg.rankLock.maxDays * DAY_MS;
    const until = input.until ?? new Date(env.effectiveAt.getTime() + max);
    if (until.getTime() <= env.effectiveAt.getTime()) throw new DposError("RANK_LOCK_PERIOD_INVALID", "The rank lock must end after it starts.", 400);
    if (until.getTime() - env.effectiveAt.getTime() > max) throw new DposError("RANK_LOCK_TOO_LONG", `A rank lock lasts at most one weekly cycle (${cfg.rankLock.maxDays} days).`, 400);
    const latest = await env.tx.iamCoreScoreResult.findFirst({ where: { candidateId, outcome: "RANKED" }, orderBy: { scoredAt: "desc" } });
    if (!latest) throw new DposError("CANDIDATE_NOT_RANKED", "A rank can only be locked for a candidate that has been ranked by a scoring run.", 409);
    const row = await ledger(env, ctx, actor, "RANK_LOCK", reason, { expiresAt: until, detail: { rank: input.rank, calculatedRankWhenLocked: latest.calculatedRank, effective: "IMMEDIATE_DISPLAY", scoringStillRuns: true } });
    const refreshed = await refreshDisplayedPriority(env.tx, ctx, actor, { at: env.effectiveAt, governanceId: row.governanceId, cfg });
    return { governanceId: row.governanceId, candidateId, rank: input.rank, effectiveAt: row.effectiveAt, until, events: refreshed.events };
  });
}

export async function unlockRank(db: PrismaClient, ctx: Ctx, actor: WorkflowActor, candidateId: string, input: { reason: string; at?: Date }, cfg: ScoringConfig = SCORING_CONFIG) {
  return governed(db, ctx, actor, candidateId, { operation: "RANK_UNLOCK", at: input.at }, async (env) => {
    const reason = requireText(input.reason, "A reason for releasing the rank lock");
    const row = await ledger(env, ctx, actor, "RANK_UNLOCK", reason, { detail: { effective: "IMMEDIATE_DISPLAY" } });
    const refreshed = await refreshDisplayedPriority(env.tx, ctx, actor, { at: env.effectiveAt, governanceId: row.governanceId, cfg });
    return { governanceId: row.governanceId, candidateId, effectiveAt: row.effectiveAt, events: refreshed.events };
  });
}

// ---- manual tie-break ---------------------------------------------------------------------------------------------------------------------

/**
 * Explicit, auditable manual management tie-break (step 13). The listed candidates must currently be tied (same displayed
 * score or within 0.5 of the leader in the latest scoring run); the order is stored per candidate with one batch id.
 */
export async function recordManualTieBreak(db: PrismaClient, ctx: Ctx, actor: WorkflowActor, input: { candidateIds: string[]; reason: string; at?: Date }, cfg: ScoringConfig = SCORING_CONFIG) {
  requireManagement(actor, "Manual tie-break");
  assertStableUserId(actor, "Manual tie-break");
  const reason = requireText(input.reason, "A reason for the manual tie-break");
  const idsList = input.candidateIds;
  if (!Array.isArray(idsList) || idsList.length < 2 || new Set(idsList).size !== idsList.length) {
    throw new DposError("TIE_BREAK_CANDIDATES_INVALID", "A manual tie-break names at least two distinct candidates in the order management decides.", 400);
  }
  const batchId = randomUUID();
  const at = input.at ?? new Date();
  const results: Array<{ governanceId: string; candidateId: string; position: number; events: EmittedEvent[] }> = [];
  for (let i = 0; i < idsList.length; i++) {
    // The tie check runs on the first candidate's transaction; every row shares the batch id.
    const id = idsList[i]!;
    const r = await governed(db, ctx, actor, id, { operation: "MANUAL_TIEBREAK", at }, async (env) => {
      const latest = await env.tx.iamCoreScoreResult.findMany({ where: { candidateId: { in: idsList }, outcome: "RANKED" }, orderBy: { scoredAt: "desc" }, distinct: ["candidateId"] });
      if (latest.length !== idsList.length) throw new DposError("NOT_A_TIE", "Every candidate in a manual tie-break must have been ranked by a scoring run.", 409);
      const scores = latest.map((l) => Math.round(l.domainScore! * 10_000));
      const spread = Math.max(...scores) - Math.min(...scores);
      if (spread > Math.round(cfg.tie.withinPoints * 10_000)) {
        throw new DposError("NOT_A_TIE", `These candidates are not tied: their scores differ by more than ${cfg.tie.withinPoints} points, so the approved tie-break sequence does not apply.`, 409, { spreadPoints: spread / 10_000 });
      }
      const row = await ledger(env, ctx, actor, "MANUAL_TIEBREAK", reason, { batchId, detail: { position: i + 1, order: idsList, effective: "IMMEDIATE_DISPLAY" } });
      // The batch is complete only with its last entry: publish the new displayed order then, in the same transaction.
      const refreshed = i === idsList.length - 1 ? await refreshDisplayedPriority(env.tx, ctx, actor, { at: env.effectiveAt, governanceId: row.governanceId, cfg }) : null;
      return { governanceId: row.governanceId, candidateId: id, position: i + 1, events: refreshed?.events ?? [] };
    });
    results.push(r);
  }
  return { batchId, order: idsList, entries: results, events: results.flatMap((r) => r.events) };
}

// ---- strategic authorization ----------------------------------------------------------------------------------------------------------------

/** A positive strategic modifier exists only when management authorizes it; it is never assigned automatically. */
export async function authorizeStrategic(db: PrismaClient, ctx: Ctx, actor: WorkflowActor, candidateId: string, input: { level: StrategicLevel; reason: string; at?: Date }) {
  return governed(db, ctx, actor, candidateId, { operation: "STRATEGIC_AUTHORIZED", at: input.at }, async (env) => {
    const reason = requireText(input.reason, "A reason for the strategic authorization");
    if (!(STRATEGIC_LEVELS as readonly string[]).includes(input.level) || input.level === "NORMAL") {
      throw new DposError("STRATEGIC_LEVEL_INVALID", `The strategic level must be one of ${STRATEGIC_LEVELS.filter((l) => l !== "NORMAL").join(", ")}.`, 400);
    }
    const row = await ledger(env, ctx, actor, "STRATEGIC_AUTHORIZED", reason, { detail: { level: input.level, effective: "NEXT_SCORING_RUN" } });
    return { governanceId: row.governanceId, candidateId, level: input.level, authorizedBy: actor.actorId, effectiveAt: row.effectiveAt };
  });
}

export async function revokeStrategic(db: PrismaClient, ctx: Ctx, actor: WorkflowActor, candidateId: string, input: { reason: string; at?: Date }) {
  return governed(db, ctx, actor, candidateId, { operation: "STRATEGIC_REVOKED", at: input.at }, async (env) => {
    const reason = requireText(input.reason, "A reason for revoking the strategic authorization");
    const row = await ledger(env, ctx, actor, "STRATEGIC_REVOKED", reason, { detail: { effective: "NEXT_SCORING_RUN" } });
    return { governanceId: row.governanceId, candidateId, effectiveAt: row.effectiveAt };
  });
}

// ---- emergency review decisions ----------------------------------------------------------------------------------------------------------------------

async function emitEmergency(env: GovEnv, ctx: Ctx, actor: WorkflowActor, candidateId: string, governanceId: string, emergency: boolean, type: string, reason: string): Promise<EmittedEvent> {
  const latest = await env.tx.iamCoreScoreResult.findFirst({ where: { candidateId }, orderBy: { scoredAt: "desc" }, select: { scoringRunId: true } });
  const em = await Emitter.open(env.tx, ctx, candidateId, actor, env.effectiveAt, SCORING_ORIGIN);
  return em.emit(
    "DOMAIN_PRIORITY_CHANGED",
    {
      source: { iamSourceRunId: latest?.scoringRunId ?? governanceId, iamSourceVersion: SCORING_VERSION },
      recommendation: {
        emergencyPriority: emergency,
        priorityOverrideType: type,
        priorityOverrideBy: actor.actorId,
        priorityOverrideReason: reason,
        priorityOverrideAt: env.effectiveAt.toISOString(),
      },
    },
    governanceId,
  );
}

async function loadEmergency(tx: Tx, ctx: Ctx, candidateId: string, from: string[]) {
  const row = await tx.iamCoreEmergencyReview.findFirst({ where: { dposCompanyId: ctx.dposCompanyId, candidateId, status: { in: from } }, orderBy: { raisedAt: "desc" } });
  if (!row) throw new DposError("NO_EMERGENCY_REVIEW", `This candidate has no emergency review in state ${from.join(" / ")}. An emergency is never automatic: it begins as an emergency review candidate raised by a scoring run.`, 409);
  return row;
}

async function resolveEmergencyEvaluated(env: GovEnv, candidateId: string, by: string, status: string, reason: string) {
  const open = await env.tx.iamCoreForcedReview.findMany({ where: { candidateId, status: "OPEN", reasonCode: { in: ["CRITICAL_OUTSIDE_TOP2", "ADDITIONAL_EMERGENCY"] } } });
  for (const r of open) {
    await env.tx.iamCoreForcedReview.update({ where: { reviewId: r.reviewId }, data: { status: "RESOLVED", resolvedAt: env.effectiveAt, resolvedBy: by, resolutionBasis: "EMERGENCY_EVALUATED", resolution: `Emergency review ${status}: ${reason}`.slice(0, 2000) } });
  }
  return open.length;
}

/** Management confirms an emergency review candidate. Only then does an Emergency exist (and it is published). */
export async function confirmEmergency(db: PrismaClient, ctx: Ctx, actor: WorkflowActor, candidateId: string, input: { reason: string; acknowledgeAdditionalEmergency?: boolean; at?: Date }, cfg: ScoringConfig = SCORING_CONFIG) {
  return governed(db, ctx, actor, candidateId, { operation: "EMERGENCY_CONFIRMED", at: input.at }, async (env) => {
    const reason = requireText(input.reason, "A reason for confirming the emergency");
    const review = await loadEmergency(env.tx, ctx, candidateId, ["CANDIDATE"]);
    const others = await env.tx.iamCoreEmergencyReview.count({ where: { dposCompanyId: ctx.dposCompanyId, status: "CONFIRMED", candidateId: { not: candidateId } } });
    if (others >= cfg.emergency.maxPublishedEmergencies) {
      // 4C-D5: an additional qualifying emergency is a MANAGEMENT decision that needs an explicit acknowledgement; it is never auto-published.
      if (!input.acknowledgeAdditionalEmergency) {
        throw new DposError("ADDITIONAL_EMERGENCY_ACKNOWLEDGEMENT_REQUIRED", "Another emergency is already published. Confirming an additional one needs explicit acknowledgement (acknowledgeAdditionalEmergency).", 409);
      }
    }
    await env.tx.iamCoreEmergencyReview.update({ where: { emergencyReviewId: review.emergencyReviewId }, data: { status: "CONFIRMED", decidedBy: actor.actorId, decidedAt: env.effectiveAt, decisionReason: reason } });
    const row = await ledger(env, ctx, actor, "EMERGENCY_CONFIRMED", reason, { detail: { emergencyReviewId: review.emergencyReviewId, triggers: parseJson<string[]>(review.triggersJson, []), additionalEmergency: others > 0 } });
    await resolveEmergencyEvaluated(env, candidateId, actor.actorId, "CONFIRMED", reason);
    const ev = await emitEmergency(env, ctx, actor, candidateId, row.governanceId, true, "EMERGENCY_CONFIRMED", reason);
    return { governanceId: row.governanceId, emergencyReviewId: review.emergencyReviewId, candidateId, status: "CONFIRMED", events: [ev] };
  });
}

export async function declineEmergency(db: PrismaClient, ctx: Ctx, actor: WorkflowActor, candidateId: string, input: { reason: string; at?: Date }) {
  return governed(db, ctx, actor, candidateId, { operation: "EMERGENCY_DECLINED", at: input.at }, async (env) => {
    const reason = requireText(input.reason, "A reason for declining the emergency");
    const review = await loadEmergency(env.tx, ctx, candidateId, ["CANDIDATE"]);
    await env.tx.iamCoreEmergencyReview.update({ where: { emergencyReviewId: review.emergencyReviewId }, data: { status: "DECLINED", decidedBy: actor.actorId, decidedAt: env.effectiveAt, decisionReason: reason } });
    const row = await ledger(env, ctx, actor, "EMERGENCY_DECLINED", reason, { detail: { emergencyReviewId: review.emergencyReviewId } });
    await resolveEmergencyEvaluated(env, candidateId, actor.actorId, "DECLINED", reason);
    const ev = await emitEmergency(env, ctx, actor, candidateId, row.governanceId, false, "EMERGENCY_DECLINED", reason);
    return { governanceId: row.governanceId, emergencyReviewId: review.emergencyReviewId, candidateId, status: "DECLINED", events: [ev] };
  });
}

export async function clearEmergency(db: PrismaClient, ctx: Ctx, actor: WorkflowActor, candidateId: string, input: { reason: string; at?: Date }) {
  return governed(db, ctx, actor, candidateId, { operation: "EMERGENCY_CLEARED", at: input.at, allowAnyState: true }, async (env) => {
    const reason = requireText(input.reason, "A reason for clearing the emergency");
    const review = await loadEmergency(env.tx, ctx, candidateId, ["CONFIRMED"]);
    await env.tx.iamCoreEmergencyReview.update({ where: { emergencyReviewId: review.emergencyReviewId }, data: { status: "CLEARED", decidedBy: actor.actorId, decidedAt: env.effectiveAt, decisionReason: reason } });
    const row = await ledger(env, ctx, actor, "EMERGENCY_CLEARED", reason, { detail: { emergencyReviewId: review.emergencyReviewId } });
    const ev = await emitEmergency(env, ctx, actor, candidateId, row.governanceId, false, "EMERGENCY_CLEARED", reason);
    return { governanceId: row.governanceId, emergencyReviewId: review.emergencyReviewId, candidateId, status: "CLEARED", events: [ev] };
  });
}

// ---- data investigation + forced review resolution ------------------------------------------------------------------------------------------------------

export async function routeToDataInvestigation(db: PrismaClient, ctx: Ctx, actor: WorkflowActor, candidateId: string, input: { reason: string; at?: Date }) {
  return governed(db, ctx, actor, candidateId, { operation: "DATA_INVESTIGATION_ROUTED", at: input.at }, async (env) => {
    const reason = requireText(input.reason, "A reason for the data investigation");
    const open = await env.tx.iamCoreForcedReview.findFirst({ where: { candidateId, reasonCode: "DATA_INVESTIGATION", status: "OPEN" } });
    const review =
      open ??
      (await env.tx.iamCoreForcedReview.create({ data: { dposCompanyId: ctx.dposCompanyId, candidateId, reasonCode: "DATA_INVESTIGATION", detail: reason.slice(0, 2000), raisedAt: env.effectiveAt } }));
    const row = await ledger(env, ctx, actor, "DATA_INVESTIGATION_ROUTED", reason, { detail: { reviewId: review.reviewId } });
    return { governanceId: row.governanceId, reviewId: review.reviewId, candidateId };
  });
}

export const FORCED_REVIEW_RESOLUTION_BASES = ["MANAGEMENT_REVIEWED", "SENIOR_REVIEWED", "EMERGENCY_EVALUATED", "DOCUMENTED_DEMOTION", "DATA_INVESTIGATION_COMPLETE"] as const;
export type ForcedReviewResolutionBasis = (typeof FORCED_REVIEW_RESOLUTION_BASES)[number];

/**
 * Management resolves a forced review. A Critical candidate outside the Top 2 needs a management review, an emergency
 * evaluation or a documented demotion (risk acceptance resolves it automatically when the candidate is closed). A repeated-
 * rejection review needs a SENIOR reviewer. A data investigation completes only when new scoring facts have been recorded.
 */
export async function resolveForcedReview(db: PrismaClient, ctx: Ctx, actor: WorkflowActor, reviewId: string, input: { basis: ForcedReviewResolutionBasis; reason: string; at?: Date }) {
  const review = await db.iamCoreForcedReview.findUnique({ where: { reviewId } });
  if (!review || review.dposCompanyId !== ctx.dposCompanyId) throw new DposError("FORCED_REVIEW_NOT_FOUND", "Unknown forced review.", 404);
  return governed(db, ctx, actor, review.candidateId, { operation: "FORCED_REVIEW_RESOLVED", at: input.at, allowAnyState: true, ...(review.reasonCode === "REPEATED_REJECTION" ? { senior: "three or more qualified rejections of the same condition" } : {}) }, async (env) => {
    const reason = requireText(input.reason, "A resolution reason");
    if (!(FORCED_REVIEW_RESOLUTION_BASES as readonly string[]).includes(input.basis)) throw new DposError("RESOLUTION_BASIS_INVALID", `basis must be one of ${FORCED_REVIEW_RESOLUTION_BASES.join(", ")}.`, 400);
    const current = await env.tx.iamCoreForcedReview.findUnique({ where: { reviewId } });
    if (!current || current.status !== "OPEN") throw new DposError("FORCED_REVIEW_NOT_OPEN", "This forced review is already resolved.", 409);
    if (current.reasonCode === "REPEATED_REJECTION" && input.basis !== "SENIOR_REVIEWED") throw new DposError("SENIOR_REVIEW_REQUIRED", "A repeated-rejection review is resolved by a senior review (basis SENIOR_REVIEWED).", 409);
    if (input.basis === "SENIOR_REVIEWED") requireSenior(actor, "Senior review", "senior review was requested");
    if (input.basis === "EMERGENCY_EVALUATED") {
      const decided = await env.tx.iamCoreEmergencyReview.findFirst({ where: { candidateId: current.candidateId, status: { in: ["CONFIRMED", "DECLINED"] } } });
      if (!decided) throw new DposError("EMERGENCY_NOT_EVALUATED", "No emergency decision has been recorded for this candidate.", 409);
    }
    if (input.basis === "DOCUMENTED_DEMOTION") {
      const demo = await env.tx.iamCorePriorityGovernance.findFirst({ where: { candidateId: current.candidateId, actionType: "PRIORITY_OVERRIDE", points: { lt: 0 } }, orderBy: { effectiveAt: "desc" } });
      if (!demo) throw new DposError("NO_DOCUMENTED_DEMOTION", "No documented demotion (negative priority override) is on record for this candidate.", 409);
    }
    if (input.basis === "DATA_INVESTIGATION_COMPLETE") {
      if (current.reasonCode !== "DATA_INVESTIGATION") throw new DposError("RESOLUTION_BASIS_INVALID", "DATA_INVESTIGATION_COMPLETE applies only to a data-investigation review.", 400);
      const newer = await env.tx.iamCoreScoringInput.findFirst({ where: { candidateId: current.candidateId, recordedAt: { gt: current.raisedAt } } });
      if (!newer) throw new DposError("DATA_INVESTIGATION_NOT_COMPLETE", "New scoring facts must be recorded after the investigation began before it can be closed.", 409);
    }
    await env.tx.iamCoreForcedReview.update({ where: { reviewId }, data: { status: "RESOLVED", resolvedAt: env.effectiveAt, resolvedBy: actor.actorId, resolutionBasis: input.basis, resolution: reason } });
    const row = await ledger(env, ctx, actor, "FORCED_REVIEW_RESOLVED", reason, { detail: { reviewId, reasonCode: current.reasonCode, basis: input.basis } });
    return { governanceId: row.governanceId, reviewId, candidateId: current.candidateId, reasonCode: current.reasonCode, basis: input.basis };
  });
}

export { optionalText };
