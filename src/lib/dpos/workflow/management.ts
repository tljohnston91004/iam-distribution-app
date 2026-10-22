/**
 * Stage 4B management decision workflow: approve, reject, suppress (and release / expire), escalate, risk accept, return
 * for review/discussion, and resolution of Management Decision Required flags.
 *
 * What is preserved, always:
 *   - the ORIGINAL system recommendation (append-only table; never touched here),
 *   - the management decision with its reason, actor, role and timestamp (append-only ledger),
 *   - the management-approved PLAN as a separate versioned record,
 *   - the full workflow history.
 * A rejection scores nothing and penalises nothing: it is history. The only consequence is the governance rule that after
 * three QUALIFIED rejections of the same recurring condition the repeated rejection is flagged and senior review is required.
 */
import type { PrismaClient } from "@prisma/client";
import { DposError } from "../errors";
import {
  addDays,
  assertWorkflowState,
  closeCandidate,
  countQualifiedRejections,
  isoDate,
  optionalText,
  recordDecision,
  requireText,
  runOperation,
  toDateOnly,
  transition,
  type CandidateRow,
  type OperationEnv,
  type WorkflowRow,
} from "./internal";
import { applyAssignment, createApprovedPlan, ensureTracking, type ContributorInput, type PlanInput } from "./shared";
import { SYSTEM_ACTOR, isSenior, requireManagement, requireSenior, type WorkflowActor } from "./permissions";
import { DECISION_REQUIRED_REASONS, WORKFLOW_POLICY, type DecisionRequiredReason, type WorkflowPolicy } from "./vocab";
import type { Ctx } from "./internal";

export type SuppressionEndTrigger = "MANAGEMENT_RELEASE" | "EXPIRED" | "BECAME_CRITICAL" | "MATERIALLY_WORSENED" | "RE_ENTERED";

/** Decisions that avoid or defer the condition need a senior actor when the repeated-rejection flag is set. */
function requireDecisionAuthority(actor: WorkflowActor, wf: WorkflowRow, operation: string, kind: "AVOIDANCE" | "ANY") {
  requireManagement(actor, operation);
  if (wf.workflowState === "ESCALATED") requireSenior(actor, operation, "the candidate was escalated");
  if (kind === "AVOIDANCE" && wf.seniorReviewRequired && !isSenior(actor)) {
    requireSenior(actor, operation, "this condition has been rejected repeatedly");
  }
}

// ---- approve ----------------------------------------------------------------------------------------------------------------

export interface ApproveInput {
  reason?: string;
  /** The management-approved plan. Stored as its own version; the system recommendation is never overwritten. */
  plan: PlanInput;
  assignment?: { responsibleDepartment: string; taskOwnerId?: string; taskOwnerName?: string; contributors?: ContributorInput[] };
  targetStart?: string | Date;
  targetResolution?: string | Date;
  baselineExposure?: number;
  exposureUnit?: string;
  at?: Date;
}

export async function approveCandidate(db: PrismaClient, ctx: Ctx, actor: WorkflowActor, candidateId: string, input: ApproveInput) {
  return runOperation(db, ctx, actor, candidateId, { operation: "MANAGEMENT_APPROVED", at: input.at }, async (env) => {
    const { tx, wf, candidate, em, at } = env;
    requireDecisionAuthority(actor, wf, "Approving a candidate", "ANY");
    assertWorkflowState(wf, ["PRESENTED", "ESCALATED"], "Approving a candidate");
    if (input.assignment?.taskOwnerId && !input.assignment.responsibleDepartment?.trim()) {
      throw new DposError("DEPARTMENT_REQUIRED", "A responsible department is required before a task owner can be assigned.", 400);
    }
    const reason = optionalText(input.reason, "reason");
    const { plan, recommendation, deviates, previous } = await createApprovedPlan(env, candidateId, input.plan);
    await ensureTracking(env, candidate, input);
    const decision = await recordDecision(tx, ctx, candidateId, {
      decisionType: "APPROVE",
      reason,
      at,
      actor,
      groupedConditionKey: candidate.groupedConditionKey,
      systemRecommendationId: recommendation.recommendationId,
      recommendationVersion: recommendation.recommendationVersion,
      planId: plan.planId,
      planVersion: plan.planVersion,
      detail: { deviatesFromRecommendation: deviates },
    });
    await transition(tx, wf, "APPROVED_ASSIGNED", { operation: "MANAGEMENT_APPROVED", actor, at, reason, detail: { planId: plan.planId, planVersion: plan.planVersion }, patch: { reReviewRequired: false } });
    await em.emit(
      "MANAGEMENT_APPROVED",
      {
        management: { lifecycleState: "APPROVED", decidedBy: actor.actorId, decidedAt: at.toISOString(), decisionReason: reason ?? undefined },
        plan: {
          approvedPlanStatus: "APPROVED",
          approvedPlanRef: plan.planId,
          planSummary: plan.planSummary ?? undefined,
          planApprovedAt: at.toISOString(),
          planApprovedBy: actor.actorId,
          deviatesFromSystemRecommendation: deviates,
          deviationReason: plan.deviationReason ?? undefined,
        },
      },
      decision.decisionId,
    );
    if (previous) {
      // 4D-D6: approving again after an earlier approved plan (for example after a return for review) is a plan REVISION, so it
      // emits the dedicated PLAN_REVISED governance event too. It is never carried only by the generic approval event.
      await em.emit(
        "PLAN_REVISED",
        {
          plan: {
            planVersion: plan.planVersion,
            previousPlanVersion: previous.planVersion,
            revisionReason: reason ?? "The candidate was approved again with a new plan version.",
            revisedBy: actor.actorId,
            revisedAt: at.toISOString(),
            approvedPlanRef: plan.planId,
            approvedPlanStatus: "APPROVED",
          },
        },
        plan.planId,
      );
    }
    let ownerAssigned = false;
    if (input.assignment) {
      const a = input.assignment;
      const r = await applyAssignment(
        env,
        { department: a.responsibleDepartment, ownerId: a.taskOwnerId ?? null, ownerName: a.taskOwnerName ?? null, contributors: a.contributors },
        { reassignment: false, reason, targetDate: toDateOnly(input.targetResolution, "targetResolution") },
      );
      ownerAssigned = r.ownerChanged && !!a.taskOwnerId;
      if (ownerAssigned) {
        const fresh = await tx.iamCoreWorkflowState.findUniqueOrThrow({ where: { candidateId } });
        await transition(tx, fresh, "PENDING_OWNER_ACCEPTANCE", { operation: "OWNER_ASSIGNED", actor, at, reason: "Task owner assigned at approval." });
      }
    }
    return { decisionId: decision.decisionId, planId: plan.planId, planVersion: plan.planVersion, deviatesFromRecommendation: deviates, ownerAssigned };
  });
}

// ---- reject -------------------------------------------------------------------------------------------------------------------

export interface RejectInput {
  /** A reason is REQUIRED. */
  reason: string;
  /** False when the rejection is because the condition no longer qualifies (that is not a qualified rejection). */
  conditionStillQualifies?: boolean;
  at?: Date;
}

export async function rejectCandidate(db: PrismaClient, ctx: Ctx, actor: WorkflowActor, candidateId: string, input: RejectInput) {
  return runOperation(db, ctx, actor, candidateId, { operation: "MANAGEMENT_REJECTED", at: input.at }, async (env) => {
    const { tx, wf, candidate, em, at } = env;
    const reason = requireText(input.reason, "A rejection reason");
    requireDecisionAuthority(actor, wf, "Rejecting a candidate", "AVOIDANCE");
    assertWorkflowState(wf, ["PRESENTED", "ESCALATED"], "Rejecting a candidate");
    const qualified = input.conditionStillQualifies !== false;
    const prior = qualified ? await countQualifiedRejections(tx, ctx, candidate.groupedConditionKey) : 0;
    const ordinal = qualified ? prior + 1 : null;
    const flagged = qualified && ordinal! >= WORKFLOW_POLICY.repeatedRejectionThreshold;
    const decision = await recordDecision(tx, ctx, candidateId, {
      decisionType: "REJECT",
      reason,
      at,
      actor,
      groupedConditionKey: candidate.groupedConditionKey,
      qualifiedRejection: qualified,
      rejectionOrdinal: ordinal,
      repeatedRejectionFlagged: flagged,
      detail: { conditionStillQualifies: qualified },
    });
    await transition(tx, wf, "REJECTED", {
      operation: "MANAGEMENT_REJECTED",
      actor,
      at,
      reason,
      detail: { qualified, ordinal, flagged },
      patch: flagged ? { repeatedRejectionFlag: true, seniorReviewRequired: true } : {},
    });
    await em.emit(
      "MANAGEMENT_REJECTED",
      { management: { lifecycleState: "REJECTED", decidedBy: actor.actorId, decidedAt: at.toISOString(), decisionReason: reason } },
      decision.decisionId,
    );
    await closeCandidate(tx, candidateId, at, "REJECTED");
    return { decisionId: decision.decisionId, qualifiedRejection: qualified, rejectionOrdinal: ordinal, repeatedRejectionFlagged: flagged, seniorReviewRequiredForNextCandidate: flagged };
  });
}

// ---- risk accept --------------------------------------------------------------------------------------------------------------

export async function riskAcceptCandidate(db: PrismaClient, ctx: Ctx, actor: WorkflowActor, candidateId: string, input: { reason: string; at?: Date }) {
  return runOperation(db, ctx, actor, candidateId, { operation: "RISK_ACCEPTED", at: input.at }, async (env) => {
    const { tx, wf, candidate, em, at } = env;
    const reason = requireText(input.reason, "A risk-acceptance reason");
    requireDecisionAuthority(actor, wf, "Accepting the risk of a candidate", "AVOIDANCE");
    assertWorkflowState(wf, ["PRESENTED", "ESCALATED"], "Accepting the risk of a candidate");
    const decision = await recordDecision(tx, ctx, candidateId, { decisionType: "RISK_ACCEPT", reason, at, actor, groupedConditionKey: candidate.groupedConditionKey });
    await transition(tx, wf, "RISK_ACCEPTED", { operation: "RISK_ACCEPTED", actor, at, reason });
    await em.emit(
      "RISK_ACCEPTED",
      { management: { lifecycleState: "RISK_ACCEPTED", decidedBy: actor.actorId, decidedAt: at.toISOString(), decisionReason: reason } },
      decision.decisionId,
    );
    await closeCandidate(tx, candidateId, at, "RISK_ACCEPTED");
    return { decisionId: decision.decisionId };
  });
}

// ---- escalate -----------------------------------------------------------------------------------------------------------------

export async function escalateCandidate(db: PrismaClient, ctx: Ctx, actor: WorkflowActor, candidateId: string, input: { escalatedTo: string; reason: string; at?: Date }) {
  return runOperation(db, ctx, actor, candidateId, { operation: "ESCALATED", at: input.at }, async (env) => {
    const { tx, wf, candidate, em, at } = env;
    requireManagement(actor, "Escalating a candidate");
    const reason = requireText(input.reason, "An escalation reason");
    const escalatedTo = requireText(input.escalatedTo, "escalatedTo", 500);
    assertWorkflowState(wf, ["PRESENTED"], "Escalating a candidate");
    const decision = await recordDecision(tx, ctx, candidateId, { decisionType: "ESCALATE", reason, at, actor, groupedConditionKey: candidate.groupedConditionKey, detail: { escalatedTo } });
    await transition(tx, wf, "ESCALATED", { operation: "ESCALATED", actor, at, reason, detail: { escalatedTo }, patch: { escalatedTo } });
    await em.emit(
      "ESCALATED",
      { management: { lifecycleState: "ESCALATED", escalatedTo, decidedBy: actor.actorId, decidedAt: at.toISOString(), decisionReason: reason } },
      decision.decisionId,
    );
    return { decisionId: decision.decisionId };
  });
}

// ---- return for review / discussion ------------------------------------------------------------------------------------------------

export async function returnForReview(db: PrismaClient, ctx: Ctx, actor: WorkflowActor, candidateId: string, input: { reason: string; at?: Date }) {
  return runOperation(db, ctx, actor, candidateId, { operation: "RETURNED_FOR_REVIEW", at: input.at }, async (env) => {
    const { tx, wf, candidate, at, em } = env;
    requireManagement(actor, "Returning a candidate for review");
    const reason = requireText(input.reason, "A review/discussion note");
    assertWorkflowState(wf, ["PRESENTED"], "Returning a candidate for review");
    const decision = await recordDecision(tx, ctx, candidateId, { decisionType: "RETURN_FOR_REVIEW", reason, at, actor, groupedConditionKey: candidate.groupedConditionKey });
    await transition(tx, wf, "NEW_CANDIDATE", { operation: "RETURNED_FOR_REVIEW", actor, at, reason, patch: { reReviewRequired: true, reReviewReason: "RETURNED_FOR_REVIEW", reReviewRaisedAt: at } });
    // Dedicated governance event (4C-D6). The Data Hub lifecycle stays CANDIDATE; the event records who returned it, when and why.
    await em.emit("RETURNED_FOR_REVIEW", { management: { decidedBy: actor.actorId, decidedAt: at.toISOString(), decisionReason: reason } }, decision.decisionId);
    return { decisionId: decision.decisionId };
  });
}

// ---- suppression --------------------------------------------------------------------------------------------------------------------

export interface SuppressInput {
  reason: string;
  /** Weekly cycles (default and maximum: 4). */
  cycles?: number;
  policy?: Partial<Pick<WorkflowPolicy, "suppressionMaxCycles" | "suppressionCycleDays">>;
  at?: Date;
}

export async function suppressCandidate(db: PrismaClient, ctx: Ctx, actor: WorkflowActor, candidateId: string, input: SuppressInput) {
  return runOperation(db, ctx, actor, candidateId, { operation: "SUPPRESSED", at: input.at }, async (env) => {
    const { tx, wf, candidate, em, at } = env;
    const reason = requireText(input.reason, "A suppression reason");
    requireDecisionAuthority(actor, wf, "Suppressing a candidate", "AVOIDANCE");
    assertWorkflowState(wf, ["PRESENTED", "ESCALATED"], "Suppressing a candidate");
    const maxCycles = input.policy?.suppressionMaxCycles ?? WORKFLOW_POLICY.suppressionMaxCycles;
    const cycleDays = input.policy?.suppressionCycleDays ?? WORKFLOW_POLICY.suppressionCycleDays;
    const cycles = input.cycles ?? maxCycles;
    if (!Number.isInteger(cycles) || cycles < 1) throw new DposError("SUPPRESSION_CYCLES_INVALID", "Suppression must run for at least one weekly cycle.", 400);
    if (cycles > maxCycles) {
      throw new DposError("SUPPRESSION_EXCEEDS_MAXIMUM", `A suppression may last at most ${maxCycles} weekly cycles; a longer deferral is a risk-acceptance decision.`, 409, { cycles, maxCycles });
    }
    const reviewDueAt = addDays(at, cycles * cycleDays);
    const decision = await recordDecision(tx, ctx, candidateId, { decisionType: "SUPPRESS", reason, at, actor, groupedConditionKey: candidate.groupedConditionKey, detail: { cycles, maxCycles, reviewDueAt: reviewDueAt.toISOString() } });
    const suppression = await tx.iamCoreSuppression.create({
      data: { candidateId, dposCompanyId: ctx.dposCompanyId, reason, actorId: actor.actorId, startedAt: at, maxCycles, cycles, reviewDueAt, status: "ACTIVE" },
    });
    await transition(tx, wf, "SUPPRESSED", { operation: "SUPPRESSED", actor, at, reason, detail: { suppressionId: suppression.suppressionId, cycles, reviewDueAt: reviewDueAt.toISOString() } });
    await em.emit(
      "SUPPRESSED",
      { management: { lifecycleState: "SUPPRESSED", decidedBy: actor.actorId, decidedAt: at.toISOString(), decisionReason: reason, suppressedUntil: isoDate(reviewDueAt) } },
      suppression.suppressionId,
    );
    return { decisionId: decision.decisionId, suppressionId: suppression.suppressionId, cycles, reviewDueAt };
  });
}

/**
 * End an ACTIVE suppression and force a management re-review. The candidate, its recommendation, score and history are
 * never erased: it returns to PRESENTED with the re-review reason.
 */
export async function endSuppressionTx(
  env: Pick<OperationEnv, "tx" | "ctx" | "actor" | "em" | "at">,
  candidate: Pick<CandidateRow, "candidateId" | "groupedConditionKey">,
  wf: WorkflowRow,
  trigger: SuppressionEndTrigger,
  reason: string,
): Promise<SuppressionEndTrigger> {
  const { tx, ctx, actor, em, at } = env;
  assertWorkflowState(wf, ["SUPPRESSED"], "Ending a suppression");
  const active = await tx.iamCoreSuppression.findFirst({ where: { candidateId: candidate.candidateId, status: "ACTIVE" } });
  if (!active) throw new DposError("NO_ACTIVE_SUPPRESSION", "There is no active suppression to end.", 409);
  await tx.iamCoreSuppression.update({
    where: { suppressionId: active.suppressionId },
    data: { status: trigger === "EXPIRED" ? "EXPIRED" : "RELEASED", endedAt: at, endedBy: actor.actorId, endTrigger: trigger, endReason: reason },
  });
  const decision = await recordDecision(tx, ctx, candidate.candidateId, {
    decisionType: "RELEASE_SUPPRESSION",
    reason,
    at,
    actor,
    groupedConditionKey: candidate.groupedConditionKey,
    detail: { trigger, suppressionId: active.suppressionId },
  });
  await transition(tx, wf, "PRESENTED", {
    operation: "SUPPRESSION_ENDED",
    actor,
    at,
    reason,
    detail: { trigger },
    patch: { reReviewRequired: true, reReviewReason: trigger, reReviewRaisedAt: at, presentedAt: at, presentationCount: { increment: 1 } },
  });
  await em.emit(
    "SUPPRESSION_RELEASED",
    { management: { lifecycleState: "CANDIDATE", decidedBy: actor.actorId, decidedAt: at.toISOString(), decisionReason: reason } },
    decision.decisionId,
  );
  return trigger;
}

export async function releaseSuppression(db: PrismaClient, ctx: Ctx, actor: WorkflowActor, candidateId: string, input: { reason: string; at?: Date }) {
  return runOperation(db, ctx, actor, candidateId, { operation: "SUPPRESSION_RELEASED", at: input.at }, async (env) => {
    requireManagement(actor, "Releasing a suppression");
    const reason = requireText(input.reason, "A release reason");
    const trigger = await endSuppressionTx(env, env.candidate, env.wf, "MANAGEMENT_RELEASE", reason);
    return { trigger };
  });
}

/** A condition signal arriving outside evidence ingest (became Critical / materially worsened / re-entered). */
export async function signalConditionChange(
  db: PrismaClient,
  ctx: Ctx,
  actor: WorkflowActor,
  candidateId: string,
  input: { becameCritical?: boolean; materiallyWorsened?: boolean; reEntered?: boolean; note?: string; at?: Date },
) {
  return runOperation(db, ctx, actor, candidateId, { operation: "CONDITION_SIGNAL", at: input.at }, async (env) => {
    if (actor.role !== "SYSTEM") requireManagement(actor, "Signalling a condition change");
    const trigger: SuppressionEndTrigger | null = input.becameCritical ? "BECAME_CRITICAL" : input.materiallyWorsened ? "MATERIALLY_WORSENED" : input.reEntered ? "RE_ENTERED" : null;
    if (!trigger) throw new DposError("SIGNAL_REQUIRED", "Name the condition change: becameCritical, materiallyWorsened or reEntered.", 400);
    if (env.wf.workflowState !== "SUPPRESSED") return { trigger: null as SuppressionEndTrigger | null, suppressionEnded: false };
    const ended = await endSuppressionTx(env, env.candidate, env.wf, trigger, optionalText(input.note, "note") ?? `Condition signal while suppressed: ${trigger}`);
    return { trigger: ended as SuppressionEndTrigger | null, suppressionEnded: true };
  });
}

/** Scheduled/system step: every ACTIVE suppression past its review date expires and the candidate returns for re-review. */
export async function evaluateSuppressions(db: PrismaClient, ctx: Ctx, input: { now?: Date } = {}): Promise<{ expired: string[] }> {
  const now = input.now ?? new Date();
  const due = await db.iamCoreSuppression.findMany({ where: { dposCompanyId: ctx.dposCompanyId, status: "ACTIVE", reviewDueAt: { lte: now } }, orderBy: { reviewDueAt: "asc" } });
  const expired: string[] = [];
  for (const s of due) {
    await runOperation(db, ctx, SYSTEM_ACTOR, s.candidateId, { operation: "SUPPRESSION_EXPIRED", at: now }, async (env) => {
      await endSuppressionTx(env, env.candidate, env.wf, "EXPIRED", `The suppression reached its review date (${isoDate(s.reviewDueAt)}); management must re-review the candidate.`);
      return {};
    });
    expired.push(s.candidateId);
  }
  return { expired };
}

// ---- Management Decision Required: resolution ------------------------------------------------------------------------------------------

const DEDICATED_WORKFLOWS: Record<string, string> = {
  PAUSE_REQUEST: "decidePause",
  COMPLETION_VALIDATION: "validateCompletion",
  BLOCKED: "clearBlocker",
};

/**
 * Management records its decision on an open Management Decision Required flag (for example "continue with a revised
 * target"). Pause requests, completion validation and blockers have their own dedicated workflow and cannot be dismissed here.
 */
export async function resolveDecisionRequired(
  db: PrismaClient,
  ctx: Ctx,
  actor: WorkflowActor,
  candidateId: string,
  input: { flagId?: string; reasonCode?: DecisionRequiredReason; resolution: string; at?: Date },
) {
  return runOperation(db, ctx, actor, candidateId, { operation: "DECISION_REQUIRED_RESOLVED", at: input.at }, async (env) => {
    const { tx, candidate, at } = env;
    requireManagement(actor, "Resolving a management decision requirement");
    const resolution = requireText(input.resolution, "A resolution");
    if (input.reasonCode && !(DECISION_REQUIRED_REASONS as readonly string[]).includes(input.reasonCode)) {
      throw new DposError("VOCABULARY_VIOLATION", `reasonCode must be one of ${DECISION_REQUIRED_REASONS.join(", ")}`, 400);
    }
    const flag = await tx.iamCoreDecisionRequired.findFirst({
      where: { candidateId, status: "OPEN", ...(input.flagId ? { flagId: input.flagId } : {}), ...(input.reasonCode ? { reasonCode: input.reasonCode } : {}) },
      orderBy: { raisedAt: "asc" },
    });
    if (!flag) throw new DposError("DECISION_REQUIRED_NOT_FOUND", "No matching open Management Decision Required flag.", 404);
    const dedicated = DEDICATED_WORKFLOWS[flag.reasonCode];
    if (dedicated) throw new DposError("DEDICATED_WORKFLOW_REQUIRED", `A ${flag.reasonCode} requirement is resolved through ${dedicated}.`, 409, { reasonCode: flag.reasonCode });
    await tx.iamCoreDecisionRequired.update({ where: { flagId: flag.flagId }, data: { status: "RESOLVED", resolvedAt: at, resolvedBy: actor.actorId, resolution } });
    const decision = await recordDecision(tx, ctx, candidateId, {
      decisionType: "DECISION_RESOLVED",
      reason: resolution,
      at,
      actor,
      groupedConditionKey: candidate.groupedConditionKey,
      detail: { flagId: flag.flagId, reasonCode: flag.reasonCode },
    });
    return { flagId: flag.flagId, reasonCode: flag.reasonCode, decisionId: decision.decisionId };
  });
}
