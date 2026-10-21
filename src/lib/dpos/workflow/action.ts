/**
 * Stage 4B active action workflow: start, official progress, condition reduction, status evaluation (aging / escalation
 * foundation), pause / reactivation, blockers, management attention flags, completion, validation and Completed History.
 *
 * Two measures are tracked SEPARATELY and never combined:
 *   - Action Completion  (how much of the planned work is done; official, owner-controlled)
 *   - Condition Reduction ((baseline - current) / baseline x 100; only with a valid quantitative baseline)
 *
 * Only the primary task owner (or an authorized manager, or a contributor management explicitly authorized) writes official
 * values. Contributors add notes, supporting work and evidence only. Every change stores who / what / when / prior / new.
 */
import { randomUUID } from "crypto";
import type { PrismaClient } from "@prisma/client";
import { DposError } from "../errors";
import {
  addDays,
  assertPct,
  assertWorkflowState,
  isoDate,
  loadTracking,
  optionalText,
  ownershipFacts,
  raiseDecisionRequired,
  recordDecision,
  requireText,
  resolveDecisionFlags,
  runOperation,
  syncExecutionState,
  toDateOnly,
  toJson,
  transition,
  type Ctx,
  type OperationEnv,
} from "./internal";
import { evaluateActionStatus, type AgingResult } from "./aging";
import { computeConditionReduction } from "./condition-reduction";
import {
  requireContributorOrAbove,
  requireManagement,
  requireOfficialWriter,
  requireOwnerOrManager,
  SYSTEM_ACTOR,
  type WorkflowActor,
} from "./permissions";
import {
  ACTION_STATUS_TO_CONTRACT,
  ESCALATING_STATUSES,
  FINAL_RESOLUTION_STATUSES,
  IN_FLIGHT_RESOLUTION_STATUSES,
  WORKFLOW_POLICY,
  isValidStatusTransition,
  type ActionStatus,
  type AgingPolicy,
  type DecisionRequiredReason,
  type ResolutionStatus,
} from "./vocab";

// ---- status evaluation --------------------------------------------------------------------------------------------------------

export interface StatusChange {
  changed: boolean;
  from: ActionStatus;
  to: ActionStatus;
  reasons: string[];
  decisionRequiredRaised: boolean;
  includeInWhatChanged: boolean;
}

interface EvalOptions {
  trigger: string;
  /** The caller emits its own event for this transition (start, reactivation). */
  skipStatusEvent?: boolean;
  aging?: Partial<AgingPolicy>;
  reasonText?: string;
  extraProgress?: Record<string, unknown>;
}

const STATUS_FLAG_REASONS: Record<string, DecisionRequiredReason> = { AT_RISK: "AT_RISK", OVERDUE: "OVERDUE", BLOCKED: "BLOCKED" };
const NOT_COUNTED_AS_PENDING: DecisionRequiredReason[] = ["AT_RISK", "OVERDUE", "BLOCKED", "COMPLETION_VALIDATION"];

async function gatherAgingInput(env: OperationEnv, nowOverride?: Date) {
  const { tx } = env;
  const candidateId = env.candidate.candidateId;
  const tracking = await loadTracking(tx, candidateId);
  const pause = await tx.iamCorePauseRequest.findFirst({ where: { candidateId, status: "APPROVED" } });
  const blocker = await tx.iamCoreBlocker.findFirst({ where: { candidateId, status: "OPEN" } });
  const pending = await tx.iamCoreDecisionRequired.count({ where: { candidateId, status: "OPEN", reasonCode: { notIn: NOT_COUNTED_AS_PENDING } } });
  return {
    tracking,
    input: {
      now: nowOverride ?? env.at,
      started: !!tracking.startedAt,
      completed: tracking.actionStatus === "COMPLETED",
      paused: !!pause,
      blocked: !!blocker,
      targetStart: tracking.targetStart,
      targetResolution: tracking.targetResolution,
      actionCompletionPct: tracking.actionCompletionPct,
      conditionReductionPct: tracking.conditionReductionStatus === "MEASURED" ? tracking.conditionReductionPct : null,
      latestOwnerUpdateAt: tracking.latestOwnerUpdateAt,
      startedAt: tracking.startedAt,
      nextMilestoneDue: tracking.nextMilestoneDue,
      pendingManagementDecisions: pending,
    },
  };
}

/**
 * Evaluate the action status from the current facts and apply it: tracking row, append-only status history (with the
 * What-Changed marker), Results Return event(s) and - for AT_RISK / OVERDUE / BLOCKED - the Management Decision Required flag.
 */
export async function applyStatusEvaluation(env: OperationEnv, opts: EvalOptions): Promise<StatusChange & { evaluation: AgingResult }> {
  const { tx, ctx, actor, em, at } = env;
  const candidateId = env.candidate.candidateId;
  const { tracking, input } = await gatherAgingInput(env);
  const from = tracking.actionStatus as ActionStatus;
  const evaluation = evaluateActionStatus(input, opts.aging);
  const to = evaluation.status;
  const reasonText = (opts.reasonText ?? evaluation.reasons.join(", ")).slice(0, 4000);

  if (from === "COMPLETED") {
    return { changed: false, from, to: from, reasons: [], decisionRequiredRaised: false, includeInWhatChanged: false, evaluation };
  }
  await tx.iamCoreActionTracking.update({ where: { candidateId }, data: { statusReasonsJson: toJson(evaluation.reasons), statusEvaluatedAt: at } });
  if (from === to) {
    return { changed: false, from, to, reasons: evaluation.reasons, decisionRequiredRaised: false, includeInWhatChanged: false, evaluation };
  }
  if (!isValidStatusTransition(from, to, input.started)) {
    throw new DposError("INVALID_STATUS_TRANSITION", `The action status cannot move from ${from} to ${to}.`, 409, { from, to });
  }
  await tx.iamCoreActionTracking.update({ where: { candidateId }, data: { actionStatus: to } });
  await syncExecutionState(tx, candidateId, actor.actorId);
  const historyId = randomUUID();
  const escalating = ESCALATING_STATUSES.includes(to);

  // Leaving AT_RISK / OVERDUE / BLOCKED supersedes the flag that status had raised.
  const leaving = STATUS_FLAG_REASONS[from];
  if (leaving) await resolveDecisionFlags(tx, candidateId, [leaving], actor.actorId, `Status changed to ${to}.`, at);

  const contractStatus = ACTION_STATUS_TO_CONTRACT[to];
  if (!opts.skipStatusEvent && contractStatus) {
    if (to === "PAUSED") {
      await em.emit("ACTION_PAUSED", { progress: { actionStatus: "PAUSED", statusReason: reasonText, ...(opts.extraProgress ?? {}) } }, historyId);
    } else if (to === "BLOCKED") {
      await em.emit("ACTION_BLOCKED", { progress: { actionStatus: "BLOCKED", blockedReason: reasonText, ...(opts.extraProgress ?? {}) } }, historyId);
    } else {
      await em.emit("ACTION_STATUS_CHANGED", { progress: { actionStatus: contractStatus, statusReason: reasonText } }, historyId);
    }
  }
  let raised = false;
  if (escalating) {
    const r = await raiseDecisionRequired(env, candidateId, STATUS_FLAG_REASONS[to]!, reasonText);
    raised = r.raised;
  }
  await tx.iamCoreActionStatusHistory.create({
    data: {
      statusHistoryId: historyId,
      candidateId,
      dposCompanyId: ctx.dposCompanyId,
      fromStatus: from,
      toStatus: to,
      trigger: opts.trigger,
      reasonsJson: toJson(evaluation.reasons),
      actorId: actor.actorId,
      at,
      includeInWhatChanged: escalating,
      decisionRequiredRaised: raised,
    },
  });
  return { changed: true, from, to, reasons: evaluation.reasons, decisionRequiredRaised: raised, includeInWhatChanged: escalating, evaluation };
}

function assertActive(env: OperationEnv, operation: string) {
  assertWorkflowState(env.wf, ["ACTIVE_ACTION"], operation);
}

async function assertNotCompleted(env: OperationEnv, operation: string) {
  const t = await loadTracking(env.tx, env.candidate.candidateId);
  if (t.actionStatus === "COMPLETED") throw new DposError("ACTION_ALREADY_COMPLETED", `${operation}: the action is already completed.`, 409);
  return t;
}

const MATERIAL = WORKFLOW_POLICY.materialChangePoints;
function isMaterialChange(last: number | null, next: number): boolean {
  if (last === null) return true;
  if (Math.abs(next - last) >= MATERIAL) return true;
  return (next === 100 && last !== 100) || (next === 0 && last !== 0);
}

// ---- start ------------------------------------------------------------------------------------------------------------------------

/** Begin work. Allowed only after management approval and owner acceptance (workflow state ACTIVE_ACTION). */
export async function startAction(db: PrismaClient, ctx: Ctx, actor: WorkflowActor, candidateId: string, input: { note?: string; at?: Date; aging?: Partial<AgingPolicy> } = {}) {
  return runOperation(db, ctx, actor, candidateId, { operation: "ACTION_STARTED", at: input.at }, async (env) => {
    const { tx, em, at } = env;
    assertActive(env, "Starting the action");
    const { facts } = await ownershipFacts(tx, candidateId);
    const { onBehalf } = requireOwnerOrManager(actor, facts, "Starting the action");
    const t = await assertNotCompleted(env, "Starting the action");
    if (t.startedAt) throw new DposError("ACTION_ALREADY_STARTED", "The action has already been started.", 409);
    const paused = await tx.iamCorePauseRequest.findFirst({ where: { candidateId, status: "APPROVED" } });
    if (paused) throw new DposError("ACTION_PAUSED", "The action is paused; reactivate it before starting.", 409);
    const note = optionalText(input.note, "note");
    await tx.iamCoreActionTracking.update({
      where: { candidateId },
      data: { startedAt: at, actionCompletionPct: t.actionCompletionPct ?? 0, latestOwnerUpdateAt: at, latestOwnerUpdateBy: actor.actorId, latestOwnerUpdateNote: note },
    });
    await tx.iamCoreProgressUpdate.create({
      data: { candidateId, dposCompanyId: ctx.dposCompanyId, kind: "START", official: true, actorId: actor.actorId, actorRole: actor.role, at, priorValueJson: toJson({ startedAt: null }), newValueJson: toJson({ startedAt: at.toISOString(), onBehalf }), note },
    });
    const change = await applyStatusEvaluation(env, { trigger: "ACTION_STARTED", skipStatusEvent: true, aging: input.aging });
    const fresh = await loadTracking(tx, candidateId);
    const contractStatus = ACTION_STATUS_TO_CONTRACT[fresh.actionStatus as ActionStatus];
    await em.emit(
      "ACTION_STARTED",
      { progress: { startedAt: at.toISOString(), actionStatus: contractStatus ?? undefined, actionCompletionPct: fresh.actionCompletionPct ?? 0 }, assignment: { targetDate: isoDate(fresh.targetResolution) } },
      candidateId,
    );
    await tx.iamCoreActionTracking.update({ where: { candidateId }, data: { lastProgressEventPct: fresh.actionCompletionPct ?? 0 } });
    return { status: fresh.actionStatus as ActionStatus, statusChange: change.changed, onBehalf };
  });
}

// ---- official progress ------------------------------------------------------------------------------------------------------------

export interface ProgressInput {
  actionCompletionPct?: number;
  nextMilestone?: string | null;
  nextMilestoneDue?: string | Date | null;
  note?: string;
  at?: Date;
  aging?: Partial<AgingPolicy>;
}

/** Official action-completion update (primary owner, authorized manager or management-authorized contributor). */
export async function updateProgress(db: PrismaClient, ctx: Ctx, actor: WorkflowActor, candidateId: string, input: ProgressInput) {
  return runOperation(db, ctx, actor, candidateId, { operation: "PROGRESS_UPDATED", at: input.at }, async (env) => {
    const { tx, em, at } = env;
    assertActive(env, "Updating progress");
    const { facts } = await ownershipFacts(tx, candidateId);
    const writer = requireOfficialWriter(actor, facts, "Updating official progress");
    const t = await assertNotCompleted(env, "Updating progress");
    if (!t.startedAt) throw new DposError("ACTION_NOT_STARTED", "The action has not been started; start it before reporting progress.", 409);
    assertPct(input.actionCompletionPct, "actionCompletionPct");
    const note = optionalText(input.note, "note");
    const data: Record<string, unknown> = { latestOwnerUpdateAt: at, latestOwnerUpdateBy: actor.actorId };
    if (note) data.latestOwnerUpdateNote = note;
    const base = { candidateId, dposCompanyId: ctx.dposCompanyId, official: true, actorId: actor.actorId, actorRole: actor.role, at };
    let progressRecordId: string | null = null;
    if (input.actionCompletionPct !== undefined && input.actionCompletionPct !== t.actionCompletionPct) {
      data.actionCompletionPct = input.actionCompletionPct;
      const row = await tx.iamCoreProgressUpdate.create({
        data: { ...base, kind: "OFFICIAL_PROGRESS", priorValueJson: toJson({ actionCompletionPct: t.actionCompletionPct }), newValueJson: toJson({ actionCompletionPct: input.actionCompletionPct, viaAuthorization: writer.viaAuthorization, onBehalf: writer.onBehalf }), note },
      });
      progressRecordId = row.updateId;
    }
    if (input.nextMilestone !== undefined || input.nextMilestoneDue !== undefined) {
      const due = input.nextMilestoneDue === undefined ? t.nextMilestoneDue : toDateOnly(input.nextMilestoneDue, "nextMilestoneDue");
      const milestone = input.nextMilestone === undefined ? t.nextMilestone : optionalText(input.nextMilestone, "nextMilestone", 500);
      data.nextMilestone = milestone;
      data.nextMilestoneDue = due;
      await tx.iamCoreProgressUpdate.create({
        data: { ...base, kind: "MILESTONE", priorValueJson: toJson({ nextMilestone: t.nextMilestone, nextMilestoneDue: isoDate(t.nextMilestoneDue) }), newValueJson: toJson({ nextMilestone: milestone, nextMilestoneDue: isoDate(due ?? null) }), note },
      });
    }
    if (!progressRecordId && !("nextMilestone" in data) && note) {
      await tx.iamCoreProgressUpdate.create({ data: { ...base, kind: "NOTE", priorValueJson: null, newValueJson: null, note } });
    }
    await tx.iamCoreActionTracking.update({ where: { candidateId }, data });
    let eventSent = false;
    if (input.actionCompletionPct !== undefined && isMaterialChange(t.lastProgressEventPct, input.actionCompletionPct)) {
      await em.emit("PROGRESS_UPDATED", { progress: { actionCompletionPct: input.actionCompletionPct } }, progressRecordId ?? `${candidateId}:${at.toISOString()}`);
      await tx.iamCoreActionTracking.update({ where: { candidateId }, data: { lastProgressEventPct: input.actionCompletionPct } });
      eventSent = true;
    }
    await syncExecutionState(tx, candidateId, actor.actorId);
    const change = await applyStatusEvaluation(env, { trigger: "PROGRESS_UPDATED", aging: input.aging });
    return { progressEventSent: eventSent, status: change.to, statusChanged: change.changed };
  });
}

/** Notes, supporting work and evidence: owner, any listed contributor or a manager. Never changes official values. */
export async function addSupportEntry(
  db: PrismaClient,
  ctx: Ctx,
  actor: WorkflowActor,
  candidateId: string,
  input: { kind?: "NOTE" | "SUPPORTING_WORK" | "EVIDENCE"; note: string; evidenceRef?: string; at?: Date },
) {
  return runOperation(db, ctx, actor, candidateId, { operation: "SUPPORT_ENTRY_ADDED", at: input.at }, async (env) => {
    assertActive(env, "Adding a note");
    const { facts } = await ownershipFacts(env.tx, candidateId);
    requireContributorOrAbove(actor, facts, "Adding a note, supporting work or evidence");
    const kind = input.kind ?? "NOTE";
    if (!["NOTE", "SUPPORTING_WORK", "EVIDENCE"].includes(kind)) throw new DposError("VOCABULARY_VIOLATION", "kind must be NOTE, SUPPORTING_WORK or EVIDENCE.", 400);
    const row = await env.tx.iamCoreProgressUpdate.create({
      data: {
        candidateId,
        dposCompanyId: ctx.dposCompanyId,
        kind,
        official: false,
        actorId: actor.actorId,
        actorRole: actor.role,
        at: env.at,
        note: requireText(input.note, "note"),
        evidenceRef: optionalText(input.evidenceRef, "evidenceRef", 500),
      },
    });
    return { updateId: row.updateId };
  });
}

// ---- condition reduction -----------------------------------------------------------------------------------------------------------

export interface ConditionReductionInput {
  baselineExposure?: number;
  currentExposure?: number;
  exposureUnit?: string;
  /** In-flight resolution status the owner reports (final statuses are set at completion validation). */
  resolutionStatus?: ResolutionStatus;
  note?: string;
  at?: Date;
  aging?: Partial<AgingPolicy>;
}

/**
 * Record the baseline and/or current exposure. Condition reduction = (baseline - current) / baseline x 100, computed only
 * with a valid quantitative baseline; otherwise it stays "Not Yet Measured" and NO percentage is created.
 */
export async function updateConditionReduction(db: PrismaClient, ctx: Ctx, actor: WorkflowActor, candidateId: string, input: ConditionReductionInput) {
  return runOperation(db, ctx, actor, candidateId, { operation: "CONDITION_REDUCTION_UPDATED", at: input.at }, async (env) => {
    const { tx, em, at } = env;
    assertActive(env, "Updating condition reduction");
    const { facts } = await ownershipFacts(tx, candidateId);
    const writer = requireOfficialWriter(actor, facts, "Updating condition reduction");
    const t = await assertNotCompleted(env, "Updating condition reduction");
    const note = optionalText(input.note, "note");
    for (const [field, v] of [["baselineExposure", input.baselineExposure], ["currentExposure", input.currentExposure]] as const) {
      if (v !== undefined && (typeof v !== "number" || !Number.isFinite(v) || v < 0)) throw new DposError("OUT_OF_RANGE", `${field} must be a finite, non-negative number.`, 400, { field });
    }
    if (input.resolutionStatus !== undefined && !IN_FLIGHT_RESOLUTION_STATUSES.includes(input.resolutionStatus)) {
      throw new DposError("RESOLUTION_STATUS_NOT_IN_FLIGHT", `While the action is active the resolution status can be ${IN_FLIGHT_RESOLUTION_STATUSES.join(", ")}; final resolution is set when completion is validated.`, 400);
    }
    const base = { candidateId, dposCompanyId: ctx.dposCompanyId, official: true, actorId: actor.actorId, actorRole: actor.role, at };

    let baseline = t.baselineExposure;
    if (input.baselineExposure !== undefined && input.baselineExposure !== baseline) {
      if (baseline !== null && baseline > 0) {
        requireManagement(actor, "Changing an established baseline");
        if (!note) throw new DposError("REASON_REQUIRED", "A note is required to change an established baseline.", 400);
      }
      await tx.iamCoreProgressUpdate.create({ data: { ...base, kind: "BASELINE", priorValueJson: toJson({ baselineExposure: baseline }), newValueJson: toJson({ baselineExposure: input.baselineExposure }), note } });
      baseline = input.baselineExposure;
    }
    const current = input.currentExposure !== undefined ? input.currentExposure : t.currentExposure;
    const reduction = computeConditionReduction(baseline, current);
    const unit = input.exposureUnit !== undefined ? optionalText(input.exposureUnit, "exposureUnit", 500) : t.exposureUnit;

    let resolutionStatus = (input.resolutionStatus ?? t.resolutionStatus) as ResolutionStatus;
    if (input.resolutionStatus === undefined && reduction.status === "MEASURED" && reduction.pct > 0 && resolutionStatus === "NOT_YET_MEASURED") resolutionStatus = "IMPROVING";
    if (input.resolutionStatus !== undefined || resolutionStatus !== t.resolutionStatus) {
      await tx.iamCoreProgressUpdate.create({ data: { ...base, kind: "RESOLUTION_STATUS", priorValueJson: toJson({ resolutionStatus: t.resolutionStatus }), newValueJson: toJson({ resolutionStatus }), note } });
    }

    let recordId: string | null = null;
    const changedExposure = input.currentExposure !== undefined && input.currentExposure !== t.currentExposure;
    if (changedExposure || baseline !== t.baselineExposure) {
      const row = await tx.iamCoreProgressUpdate.create({
        data: {
          ...base,
          kind: "CONDITION_REDUCTION",
          priorValueJson: toJson({ currentExposure: t.currentExposure, conditionReductionPct: t.conditionReductionPct, status: t.conditionReductionStatus }),
          newValueJson: toJson({ baselineExposure: baseline, currentExposure: current, conditionReductionPct: reduction.pct, status: reduction.status, viaAuthorization: writer.viaAuthorization, onBehalf: writer.onBehalf }),
          note,
        },
      });
      recordId = row.updateId;
    }
    await tx.iamCoreActionTracking.update({
      where: { candidateId },
      data: {
        baselineExposure: baseline,
        currentExposure: current,
        exposureUnit: unit,
        conditionReductionPct: reduction.pct,
        conditionReductionStatus: reduction.status,
        resolutionStatus,
        latestOwnerUpdateAt: at,
        latestOwnerUpdateBy: actor.actorId,
        ...(note ? { latestOwnerUpdateNote: note } : {}),
      },
    });

    let eventSent = false;
    if (reduction.status === "MEASURED" && recordId && isMaterialChange(t.lastReductionEventPct, reduction.contractPct)) {
      await em.emit(
        "CONDITION_REDUCTION_UPDATED",
        { progress: { conditionReductionPct: reduction.contractPct, remainingExposure: current ?? undefined, remainingExposureUnit: unit ?? undefined } },
        recordId,
      );
      await tx.iamCoreActionTracking.update({ where: { candidateId }, data: { lastReductionEventPct: reduction.contractPct } });
      eventSent = true;
    }
    if (reduction.worseThanBaseline) {
      await raiseDecisionRequired(env, candidateId, "CONDITION_WORSENED", `The condition is worse than its baseline (${reduction.pct}% reduction; current ${current} vs baseline ${baseline}).`);
    } else if (reduction.status === "MEASURED") {
      await resolveDecisionFlags(tx, candidateId, ["CONDITION_WORSENED"], actor.actorId, "The condition is no longer worse than its baseline.", at);
    }
    await syncExecutionState(tx, candidateId, actor.actorId);
    const change = await applyStatusEvaluation(env, { trigger: "CONDITION_REDUCTION_UPDATED", aging: input.aging });
    return { conditionReductionStatus: reduction.status, conditionReductionPct: reduction.pct, reductionEventSent: eventSent, resolutionStatus, status: change.to };
  });
}

// ---- pause / reactivation -----------------------------------------------------------------------------------------------------------

export interface PauseRequestInput {
  reason: string;
  requestedDate?: string | Date;
  expectedDurationDays?: number;
  reactivationCondition?: string;
  at?: Date;
}

/** The owner REQUESTS a pause; it takes effect only when management approves it. */
export async function requestPause(db: PrismaClient, ctx: Ctx, actor: WorkflowActor, candidateId: string, input: PauseRequestInput) {
  return runOperation(db, ctx, actor, candidateId, { operation: "PAUSE_REQUESTED", at: input.at }, async (env) => {
    const { tx, at } = env;
    assertActive(env, "Requesting a pause");
    const { facts } = await ownershipFacts(tx, candidateId);
    requireOwnerOrManager(actor, facts, "Requesting a pause");
    await assertNotCompleted(env, "Requesting a pause");
    const reason = requireText(input.reason, "A pause reason");
    if (input.expectedDurationDays !== undefined && (!Number.isInteger(input.expectedDurationDays) || input.expectedDurationDays < 1)) {
      throw new DposError("OUT_OF_RANGE", "expectedDurationDays must be a positive whole number.", 400);
    }
    const live = await tx.iamCorePauseRequest.findFirst({ where: { candidateId, status: { in: ["REQUESTED", "APPROVED"] } } });
    if (live) throw new DposError("PAUSE_ALREADY_LIVE", `A pause is already ${live.status === "APPROVED" ? "in force" : "awaiting a management decision"}.`, 409);
    const pause = await tx.iamCorePauseRequest.create({
      data: {
        candidateId,
        dposCompanyId: ctx.dposCompanyId,
        requestedBy: actor.actorId,
        requestedAt: at,
        requestedDate: toDateOnly(input.requestedDate ?? at, "requestedDate")!,
        reason,
        expectedDurationDays: input.expectedDurationDays ?? null,
        reactivationCondition: optionalText(input.reactivationCondition, "reactivationCondition"),
        status: "REQUESTED",
      },
    });
    await raiseDecisionRequired(env, candidateId, "PAUSE_REQUEST", `Pause requested: ${reason}`, pause.pauseRequestId);
    const change = await applyStatusEvaluation(env, { trigger: "PAUSE_REQUESTED" });
    return { pauseRequestId: pause.pauseRequestId, status: change.to };
  });
}

export interface PauseDecisionInput {
  decision: "APPROVE" | "DENY";
  reason: string;
  pauseRequestId?: string;
  reviewDueAt?: Date;
  at?: Date;
}

/** Management approves or denies a pause. The requester can never decide their own request. */
export async function decidePause(db: PrismaClient, ctx: Ctx, actor: WorkflowActor, candidateId: string, input: PauseDecisionInput) {
  return runOperation(db, ctx, actor, candidateId, { operation: input.decision === "APPROVE" ? "PAUSE_APPROVED" : "PAUSE_DENIED", at: input.at }, async (env) => {
    const { tx, candidate, at } = env;
    requireManagement(actor, "Deciding a pause request");
    assertActive(env, "Deciding a pause request");
    if (input.decision !== "APPROVE" && input.decision !== "DENY") throw new DposError("VOCABULARY_VIOLATION", "decision must be APPROVE or DENY.", 400);
    const reason = requireText(input.reason, "A decision reason");
    const pause = await tx.iamCorePauseRequest.findFirst({ where: { candidateId, status: "REQUESTED", ...(input.pauseRequestId ? { pauseRequestId: input.pauseRequestId } : {}) } });
    if (!pause) throw new DposError("PAUSE_REQUEST_NOT_FOUND", "There is no pause request awaiting a decision.", 404);
    if (pause.requestedBy === actor.actorId) {
      throw new DposError("SELF_APPROVAL_NOT_PERMITTED", "A pause cannot be approved or denied by the person who requested it; another manager must decide.", 403);
    }
    const approve = input.decision === "APPROVE";
    const reviewDueAt = approve ? (input.reviewDueAt ?? addDays(at, pause.expectedDurationDays ?? WORKFLOW_POLICY.pauseDefaultReviewDays)) : null;
    await tx.iamCorePauseRequest.update({
      where: { pauseRequestId: pause.pauseRequestId },
      data: { status: approve ? "APPROVED" : "DENIED", decidedBy: actor.actorId, decidedAt: at, decisionReason: reason, pausedAt: approve ? at : null, reviewDueAt },
    });
    await resolveDecisionFlags(tx, candidateId, ["PAUSE_REQUEST"], actor.actorId, `Pause ${approve ? "approved" : "denied"}: ${reason}`, at);
    const decision = await recordDecision(tx, ctx, candidateId, {
      decisionType: approve ? "PAUSE_APPROVED" : "PAUSE_DENIED",
      reason,
      at,
      actor,
      groupedConditionKey: candidate.groupedConditionKey,
      detail: { pauseRequestId: pause.pauseRequestId, requestedBy: pause.requestedBy, reviewDueAt: reviewDueAt?.toISOString() ?? null },
    });
    const change = await applyStatusEvaluation(env, {
      trigger: approve ? "PAUSE_APPROVED" : "PAUSE_DENIED",
      reasonText: approve ? `Pause approved: ${pause.reason}` : undefined,
      extraProgress: approve && pause.reactivationCondition ? { reactivationCondition: pause.reactivationCondition } : undefined,
    });
    return { decisionId: decision.decisionId, pauseRequestId: pause.pauseRequestId, approved: approve, reviewDueAt, status: change.to };
  });
}

/** Reactivate a paused action (owner or manager). Ownership, progress and history are exactly as they were. */
export async function reactivateAction(db: PrismaClient, ctx: Ctx, actor: WorkflowActor, candidateId: string, input: { note?: string; at?: Date } = {}) {
  return runOperation(db, ctx, actor, candidateId, { operation: "ACTION_REACTIVATED", at: input.at }, async (env) => {
    const { tx, em, at } = env;
    assertActive(env, "Reactivating");
    const { facts } = await ownershipFacts(tx, candidateId);
    requireOwnerOrManager(actor, facts, "Reactivating the action");
    const pause = await tx.iamCorePauseRequest.findFirst({ where: { candidateId, status: "APPROVED" } });
    if (!pause) throw new DposError("NOT_PAUSED", "The action is not paused.", 409);
    const note = optionalText(input.note, "note");
    await tx.iamCorePauseRequest.update({ where: { pauseRequestId: pause.pauseRequestId }, data: { status: "REACTIVATED", reactivatedAt: at, reactivatedBy: actor.actorId, reactivationNote: note } });
    await resolveDecisionFlags(tx, candidateId, ["PAUSE_REVIEW_DUE"], actor.actorId, "The action was reactivated.", at);
    const change = await applyStatusEvaluation(env, { trigger: "ACTION_REACTIVATED", skipStatusEvent: true });
    const contractStatus = ACTION_STATUS_TO_CONTRACT[change.to];
    await em.emit("ACTION_REACTIVATED", { progress: { actionStatus: contractStatus ?? undefined, statusReason: note ?? undefined } }, pause.pauseRequestId);
    return { pauseRequestId: pause.pauseRequestId, status: change.to };
  });
}

// ---- blockers and management-attention flags -----------------------------------------------------------------------------------------------

export async function raiseBlocker(db: PrismaClient, ctx: Ctx, actor: WorkflowActor, candidateId: string, input: { reason: string; dependency?: string; material?: boolean; at?: Date }) {
  return runOperation(db, ctx, actor, candidateId, { operation: "ACTION_BLOCKED", at: input.at }, async (env) => {
    const { tx, at } = env;
    assertActive(env, "Raising a blocker");
    const { facts } = await ownershipFacts(tx, candidateId);
    requireOwnerOrManager(actor, facts, "Raising a blocker");
    await assertNotCompleted(env, "Raising a blocker");
    const reason = requireText(input.reason, "A blocker reason");
    const open = await tx.iamCoreBlocker.findFirst({ where: { candidateId, status: "OPEN" } });
    if (open) throw new DposError("BLOCKER_ALREADY_OPEN", "A blocker is already open for this action.", 409);
    const blocker = await tx.iamCoreBlocker.create({
      data: { candidateId, dposCompanyId: ctx.dposCompanyId, reason, dependency: optionalText(input.dependency, "dependency", 500), material: input.material !== false, raisedBy: actor.actorId, raisedAt: at, status: "OPEN" },
    });
    await tx.iamCoreActionTracking.update({ where: { candidateId }, data: { latestOwnerUpdateAt: at, latestOwnerUpdateBy: actor.actorId, latestOwnerUpdateNote: `Blocked: ${reason}`.slice(0, 4000) } });
    const change = await applyStatusEvaluation(env, { trigger: "BLOCKER_RAISED", reasonText: input.dependency ? `${reason} (dependency: ${input.dependency})` : reason });
    return { blockerId: blocker.blockerId, status: change.to, decisionRequiredRaised: change.decisionRequiredRaised };
  });
}

export async function clearBlocker(db: PrismaClient, ctx: Ctx, actor: WorkflowActor, candidateId: string, input: { note?: string; at?: Date; aging?: Partial<AgingPolicy> } = {}) {
  return runOperation(db, ctx, actor, candidateId, { operation: "BLOCKER_CLEARED", at: input.at }, async (env) => {
    const { tx, at } = env;
    assertActive(env, "Clearing a blocker");
    const { facts } = await ownershipFacts(tx, candidateId);
    requireOwnerOrManager(actor, facts, "Clearing a blocker");
    const open = await tx.iamCoreBlocker.findFirst({ where: { candidateId, status: "OPEN" } });
    if (!open) throw new DposError("NO_OPEN_BLOCKER", "There is no open blocker.", 409);
    await tx.iamCoreBlocker.update({ where: { blockerId: open.blockerId }, data: { status: "CLEARED", clearedBy: actor.actorId, clearedAt: at, clearNote: optionalText(input.note, "note") } });
    await tx.iamCoreActionTracking.update({ where: { candidateId }, data: { latestOwnerUpdateAt: at, latestOwnerUpdateBy: actor.actorId } });
    const change = await applyStatusEvaluation(env, { trigger: "BLOCKER_CLEARED", aging: input.aging });
    return { blockerId: open.blockerId, status: change.to };
  });
}

/** Material dependency / material plan deviation / escalation request: put the item in front of management. */
export async function raiseManagementAttention(
  db: PrismaClient,
  ctx: Ctx,
  actor: WorkflowActor,
  candidateId: string,
  input: { reason: "MATERIAL_DEPENDENCY" | "MATERIAL_PLAN_DEVIATION" | "ESCALATION_REQUEST"; detail: string; at?: Date },
) {
  return runOperation(db, ctx, actor, candidateId, { operation: `MANAGEMENT_ATTENTION_${input.reason}`, at: input.at }, async (env) => {
    assertActive(env, "Requesting management attention");
    const { facts } = await ownershipFacts(env.tx, candidateId);
    requireOwnerOrManager(actor, facts, "Requesting management attention");
    if (!["MATERIAL_DEPENDENCY", "MATERIAL_PLAN_DEVIATION", "ESCALATION_REQUEST"].includes(input.reason)) throw new DposError("VOCABULARY_VIOLATION", "Unsupported reason.", 400);
    await assertNotCompleted(env, "Requesting management attention");
    const flag = await raiseDecisionRequired(env, candidateId, input.reason, requireText(input.detail, "detail"));
    const change = await applyStatusEvaluation(env, { trigger: `MANAGEMENT_ATTENTION_${input.reason}` });
    return { flagId: flag.flagId, raised: flag.raised, status: change.to };
  });
}

// ---- evaluation (aging / escalation) ---------------------------------------------------------------------------------------------------------

/** Re-evaluate one active action at `now` (system or management). Also raises PAUSE_REVIEW_DUE for an overdue pause review. */
export async function evaluateAction(db: PrismaClient, ctx: Ctx, actor: WorkflowActor, candidateId: string, input: { now?: Date; aging?: Partial<AgingPolicy> } = {}) {
  return runOperation(db, ctx, actor, candidateId, { operation: "ACTION_EVALUATED", at: input.now }, async (env) => {
    if (actor.role !== "SYSTEM") requireManagement(actor, "Evaluating an action");
    assertActive(env, "Evaluating the action");
    const pause = await env.tx.iamCorePauseRequest.findFirst({ where: { candidateId, status: "APPROVED" } });
    let reviewFlag = false;
    if (pause?.reviewDueAt && pause.reviewDueAt.getTime() <= env.at.getTime()) {
      const r = await raiseDecisionRequired(env, candidateId, "PAUSE_REVIEW_DUE", `The approved pause reached its review date (${isoDate(pause.reviewDueAt)}); it must be reviewed or reactivated.`, pause.pauseRequestId);
      reviewFlag = r.raised;
    }
    const change = await applyStatusEvaluation(env, { trigger: "SCHEDULED_EVALUATION", aging: input.aging });
    return { from: change.from, to: change.to, changed: change.changed, reasons: change.reasons, decisionRequiredRaised: change.decisionRequiredRaised, pauseReviewFlagRaised: reviewFlag, expectedCompletionPct: change.evaluation.expectedCompletionPct };
  });
}

/** Evaluate every active, unfinished action (system schedule). Returns the candidates whose status changed. */
export async function evaluateAllActions(db: PrismaClient, ctx: Ctx, input: { now?: Date; aging?: Partial<AgingPolicy> } = {}) {
  const now = input.now ?? new Date();
  const rows = await db.iamCoreWorkflowState.findMany({ where: { dposCompanyId: ctx.dposCompanyId, workflowState: "ACTIVE_ACTION" }, select: { candidateId: true } });
  const changed: Array<{ candidateId: string; from: ActionStatus; to: ActionStatus }> = [];
  let evaluated = 0;
  for (const r of rows) {
    const t = await db.iamCoreActionTracking.findUnique({ where: { candidateId: r.candidateId } });
    if (!t || t.actionStatus === "COMPLETED") continue;
    const res = await evaluateAction(db, ctx, SYSTEM_ACTOR, r.candidateId, { now, aging: input.aging });
    evaluated++;
    if (res.changed) changed.push({ candidateId: r.candidateId, from: res.from, to: res.to });
  }
  return { evaluated, changed };
}

// ---- completion ------------------------------------------------------------------------------------------------------------------------------------

/**
 * The owner (or authorized manager) marks the action complete: 100% action completion, status COMPLETED, ACTION_COMPLETED to the
 * Data Hub, and a COMPLETION_VALIDATION requirement for management. The condition reduction is whatever was measured.
 */
export async function completeAction(db: PrismaClient, ctx: Ctx, actor: WorkflowActor, candidateId: string, input: { note?: string; at?: Date } = {}) {
  return runOperation(db, ctx, actor, candidateId, { operation: "ACTION_COMPLETED", at: input.at }, async (env) => {
    const { tx, em, at } = env;
    assertActive(env, "Completing the action");
    const { facts } = await ownershipFacts(tx, candidateId);
    const writer = requireOfficialWriter(actor, facts, "Completing the action");
    const t = await assertNotCompleted(env, "Completing the action");
    if (!t.startedAt) throw new DposError("ACTION_NOT_STARTED", "The action has not been started.", 409);
    const live = await tx.iamCorePauseRequest.findFirst({ where: { candidateId, status: { in: ["REQUESTED", "APPROVED"] } } });
    if (live) throw new DposError("PAUSE_LIVE", "Resolve the pause (decision or reactivation) before completing the action.", 409);
    const blocker = await tx.iamCoreBlocker.findFirst({ where: { candidateId, status: "OPEN" } });
    if (blocker) throw new DposError("BLOCKER_OPEN", "Clear the open blocker before completing the action.", 409);
    const note = optionalText(input.note, "note");
    await tx.iamCoreActionTracking.update({
      where: { candidateId },
      data: { actionStatus: "COMPLETED", actionCompletionPct: 100, completedAt: at, completionRequestedAt: at, completionRequestedBy: actor.actorId, latestOwnerUpdateAt: at, latestOwnerUpdateBy: actor.actorId, ...(note ? { latestOwnerUpdateNote: note } : {}), lastProgressEventPct: 100 },
    });
    const row = await tx.iamCoreProgressUpdate.create({
      data: { candidateId, dposCompanyId: ctx.dposCompanyId, kind: "OFFICIAL_PROGRESS", official: true, actorId: actor.actorId, actorRole: actor.role, at, priorValueJson: toJson({ actionCompletionPct: t.actionCompletionPct, actionStatus: t.actionStatus }), newValueJson: toJson({ actionCompletionPct: 100, actionStatus: "COMPLETED", viaAuthorization: writer.viaAuthorization, onBehalf: writer.onBehalf }), note },
    });
    await tx.iamCoreActionStatusHistory.create({
      data: { candidateId, dposCompanyId: ctx.dposCompanyId, fromStatus: t.actionStatus, toStatus: "COMPLETED", trigger: "ACTION_COMPLETED", actorId: actor.actorId, at, includeInWhatChanged: false, decisionRequiredRaised: false },
    });
    await resolveDecisionFlags(tx, candidateId, ["AT_RISK", "OVERDUE", "BLOCKED", "OWNER_DISCUSSION", "MATERIAL_DEPENDENCY", "ESCALATION_REQUEST"], actor.actorId, "The action was completed.", at);
    await tx.iamCoreCandidate.update({ where: { candidateId }, data: { lifecycleState: "COMPLETED" } });
    await syncExecutionState(tx, candidateId, actor.actorId);
    const reduction = computeConditionReduction(t.baselineExposure, t.currentExposure);
    await em.emit(
      "ACTION_COMPLETED",
      {
        progress: {
          actionStatus: "COMPLETED",
          actionCompletionPct: 100,
          completedAt: at.toISOString(),
          conditionReductionPct: reduction.contractPct ?? undefined,
          remainingExposure: t.currentExposure ?? undefined,
          remainingExposureUnit: t.exposureUnit ?? undefined,
        },
      },
      row.updateId,
    );
    await raiseDecisionRequired(env, candidateId, "COMPLETION_VALIDATION", "The owner reports the action complete; management must validate the completion.");
    return { completedAt: at, conditionReductionStatus: reduction.status, conditionReductionPct: reduction.pct };
  });
}

/** Management validates the completion: the action becomes Completed and Validated (local; formal closeout is a later stage). */
export async function validateCompletion(
  db: PrismaClient,
  ctx: Ctx,
  actor: WorkflowActor,
  candidateId: string,
  input: { finalResolutionStatus: ResolutionStatus; note?: string; at?: Date },
) {
  return runOperation(db, ctx, actor, candidateId, { operation: "COMPLETION_VALIDATED", at: input.at }, async (env) => {
    const { tx, wf, candidate, at } = env;
    requireManagement(actor, "Validating a completion");
    assertActive(env, "Validating a completion");
    const t = await loadTracking(tx, candidateId);
    if (t.actionStatus !== "COMPLETED") throw new DposError("ACTION_NOT_COMPLETED", "The owner has not marked the action complete.", 409);
    if (!FINAL_RESOLUTION_STATUSES.includes(input.finalResolutionStatus)) {
      throw new DposError("VOCABULARY_VIOLATION", `finalResolutionStatus must be one of ${FINAL_RESOLUTION_STATUSES.join(", ")}.`, 400);
    }
    const note = optionalText(input.note, "note");
    await tx.iamCoreActionTracking.update({ where: { candidateId }, data: { resolutionStatus: input.finalResolutionStatus, completionValidatedAt: at, completionValidatedBy: actor.actorId } });
    await resolveDecisionFlags(tx, candidateId, ["COMPLETION_VALIDATION"], actor.actorId, `Completion validated (${input.finalResolutionStatus}).`, at);
    const decision = await recordDecision(tx, ctx, candidateId, {
      decisionType: "COMPLETION_VALIDATED",
      reason: note ?? input.finalResolutionStatus,
      at,
      actor,
      groupedConditionKey: candidate.groupedConditionKey,
      detail: { finalResolutionStatus: input.finalResolutionStatus },
    });
    await transition(tx, wf, "COMPLETED_VALIDATED", { operation: "COMPLETION_VALIDATED", actor, at, reason: note, detail: { finalResolutionStatus: input.finalResolutionStatus } });
    // The shared contract's COMPLETED lifecycle is already in the Data Hub (ACTION_COMPLETED); outcome validation is a later stage.
    await tx.iamCoreCandidate.update({ where: { candidateId }, data: { lifecycleState: "COMPLETED" } });
    return { decisionId: decision.decisionId, finalResolutionStatus: input.finalResolutionStatus };
  });
}

/**
 * Completed and Validated -> Completed History (4B-D4). EXECUTION is complete and the action appears in Completed History, but the
 * candidate is NOT formally closed: `closedAt`, the outcome record and CLOSEOUT_COMPLETED belong to the later outcome / closeout
 * workflow (executionCompleted = true, closeoutCompleted = false). No event is produced here, no outcome is written and the
 * candidate keeps lifecycle COMPLETED; nothing may be added to it except by that later workflow.
 */
export async function archiveToHistory(db: PrismaClient, ctx: Ctx, actor: WorkflowActor, candidateId: string, input: { note?: string; at?: Date } = {}) {
  return runOperation(db, ctx, actor, candidateId, { operation: "COMPLETED_HISTORY", at: input.at }, async (env) => {
    const { tx, wf, at } = env;
    requireManagement(actor, "Moving a completed action to history");
    assertWorkflowState(wf, ["COMPLETED_VALIDATED"], "Moving to Completed History");
    const t = await loadTracking(tx, candidateId);
    const note = optionalText(input.note, "note");
    await transition(tx, wf, "COMPLETED_HISTORY", { operation: "COMPLETED_HISTORY", actor, at, reason: note, detail: { finalResolutionStatus: t.resolutionStatus, executionCompleted: true, closeoutCompleted: false } });
    return { finalResolutionStatus: t.resolutionStatus, executionCompleted: true, closeoutCompleted: false };
  });
}
