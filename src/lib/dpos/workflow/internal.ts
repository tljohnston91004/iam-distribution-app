/**
 * Shared transaction-level machinery for the Stage 4B workflow services.
 *
 * Every public workflow operation runs inside ONE database transaction: the business change, its history ledger rows,
 * its audit row and its Results Return outbox events commit together or not at all (outbox pattern from Stage 4A).
 * The functions here take the transaction client; nothing here knows about pages, routes or sessions.
 */
import type { Prisma, PrismaClient } from "@prisma/client";
import type { DposCompanyContext } from "../company-context";
import { writeAudit } from "../audit";
import { DposError } from "../errors";
import { enqueueResultsReturnEvent } from "../outbox";
import type { IamEventType } from "../contract/iam-results-return";
import { assertActor, type OwnershipFacts, type WorkflowActor } from "./permissions";
import {
  ACTION_STATUS_TO_CONTRACT,
  WORKFLOW_TO_CONTRACT_LIFECYCLE,
  type ActionStatus,
  type DecisionRequiredReason,
  type WorkflowState,
} from "./vocab";
import { computeConditionReduction } from "./condition-reduction";

export type Tx = Prisma.TransactionClient;
export type Ctx = Pick<DposCompanyContext, "dposCompanyId">;

export const DAY_MS = 24 * 60 * 60 * 1000;

export const toJson = (v: unknown): string | null => (v === undefined || v === null ? null : JSON.stringify(v));
export function parseJson<T>(text: string | null | undefined, fallback: T): T {
  if (!text) return fallback;
  try {
    return JSON.parse(text) as T;
  } catch {
    return fallback;
  }
}

export const addDays = (d: Date, days: number) => new Date(d.getTime() + days * DAY_MS);

/** Calendar dates (target dates) are stored as midnight UTC. Accepts YYYY-MM-DD or a Date. */
export function toDateOnly(value: string | Date | null | undefined, field: string): Date | null {
  if (value === null || value === undefined || value === "") return null;
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) throw new DposError("INVALID_DATE", `${field} is not a valid date.`, 400);
    return new Date(Date.UTC(value.getUTCFullYear(), value.getUTCMonth(), value.getUTCDate()));
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new DposError("INVALID_DATE", `${field} must be a YYYY-MM-DD date.`, 400);
  const d = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== value) throw new DposError("INVALID_DATE", `${field} must be a valid calendar date.`, 400);
  return d;
}
export const isoDate = (d: Date | null | undefined): string | undefined => (d ? d.toISOString().slice(0, 10) : undefined);

export function requireText(value: string | null | undefined, field: string, max = 4000): string {
  const v = typeof value === "string" ? value.trim() : "";
  if (!v) throw new DposError("REASON_REQUIRED", `${field} is required.`, 400, { field });
  if (v.length > max) throw new DposError("TEXT_TOO_LONG", `${field} exceeds ${max} characters.`, 400, { field });
  return v;
}
export function optionalText(value: string | null | undefined, field: string, max = 4000): string | null {
  if (value === null || value === undefined) return null;
  const v = value.trim();
  if (!v) return null;
  if (v.length > max) throw new DposError("TEXT_TOO_LONG", `${field} exceeds ${max} characters.`, 400, { field });
  return v;
}

export function assertPct(value: number | null | undefined, field: string) {
  if (value !== null && value !== undefined && (typeof value !== "number" || !Number.isFinite(value) || value < 0 || value > 100)) {
    throw new DposError("OUT_OF_RANGE", `${field} must be between 0 and 100.`, 400, { field });
  }
}

// ---- loading ------------------------------------------------------------------------------------------------------------

export type CandidateRow = NonNullable<Awaited<ReturnType<Tx["iamCoreCandidate"]["findUnique"]>>>;
export type WorkflowRow = NonNullable<Awaited<ReturnType<Tx["iamCoreWorkflowState"]["findUnique"]>>>;
export type TrackingRow = NonNullable<Awaited<ReturnType<Tx["iamCoreActionTracking"]["findUnique"]>>>;

export async function loadWorkflowCandidate(tx: Tx, ctx: Ctx, candidateId: string): Promise<{ candidate: CandidateRow; wf: WorkflowRow }> {
  const candidate = await tx.iamCoreCandidate.findUnique({ where: { candidateId } });
  if (!candidate || candidate.dposCompanyId !== ctx.dposCompanyId) throw new DposError("CANDIDATE_NOT_FOUND", "Unknown candidate.", 404);
  const wf = await tx.iamCoreWorkflowState.findUnique({ where: { candidateId } });
  if (!wf) throw new DposError("CANDIDATE_NOT_IN_WORKFLOW", "This candidate has no Stage 4B workflow record.", 409);
  return { candidate, wf };
}

export function assertOpenCandidate(candidate: { closedAt: Date | null }) {
  if (candidate.closedAt) throw new DposError("CLOSED_CANDIDATE_NO_REOPEN", "This candidate is closed and is never reopened; a returning condition is a new candidate linked as a recurrence.", 409);
}

export function assertWorkflowState(wf: { workflowState: string }, allowed: readonly WorkflowState[], operation: string) {
  if (!(allowed as readonly string[]).includes(wf.workflowState)) {
    throw new DposError("INVALID_WORKFLOW_STATE", `${operation} is not allowed while the candidate is in state ${wf.workflowState}.`, 409, { state: wf.workflowState, allowed: [...allowed] });
  }
}

export async function loadTracking(tx: Tx, candidateId: string): Promise<TrackingRow> {
  const t = await tx.iamCoreActionTracking.findUnique({ where: { candidateId } });
  if (!t) throw new DposError("ACTION_TRACKING_MISSING", "This candidate has no action tracking record (it has not been approved).", 409);
  return t;
}

export async function currentOwnership(tx: Tx, candidateId: string) {
  return tx.iamCoreOwnership.findFirst({ where: { candidateId, endedAt: null }, include: { contributors: true }, orderBy: { assignedAt: "desc" } });
}

export async function ownershipFacts(tx: Tx, candidateId: string): Promise<{ ownership: Awaited<ReturnType<typeof currentOwnership>>; facts: OwnershipFacts }> {
  const ownership = await currentOwnership(tx, candidateId);
  const auths = await tx.iamCoreContributorAuthorization.findMany({ where: { candidateId, revokedAt: null } });
  return {
    ownership,
    facts: {
      taskOwnerId: ownership?.taskOwnerId ?? null,
      contributorIds: (ownership?.contributors ?? []).map((c) => c.userId),
      authorizedOfficialWriterIds: auths.map((a) => a.userId),
    },
  };
}

export const latestRecommendation = (tx: Tx, candidateId: string) =>
  tx.iamCoreSystemRecommendation.findFirst({ where: { candidateId }, orderBy: { recommendationVersion: "desc" } });
export const latestApprovedPlan = (tx: Tx, candidateId: string) =>
  tx.iamCoreManagementPlan.findFirst({ where: { candidateId, approvalState: "APPROVED" }, orderBy: { planVersion: "desc" } });

// ---- workflow transitions -----------------------------------------------------------------------------------------------

const ALLOWED_TRANSITIONS: Record<WorkflowState, readonly WorkflowState[]> = {
  NEW_CANDIDATE: ["PRESENTED"],
  PRESENTED: ["APPROVED_ASSIGNED", "REJECTED", "SUPPRESSED", "ESCALATED", "RISK_ACCEPTED", "NEW_CANDIDATE"],
  ESCALATED: ["APPROVED_ASSIGNED", "REJECTED", "SUPPRESSED", "RISK_ACCEPTED"],
  SUPPRESSED: ["PRESENTED"],
  APPROVED_ASSIGNED: ["PENDING_OWNER_ACCEPTANCE"],
  PENDING_OWNER_ACCEPTANCE: ["ACTIVE_ACTION"],
  ACTIVE_ACTION: ["COMPLETED_VALIDATED"],
  COMPLETED_VALIDATED: ["COMPLETED_HISTORY"],
  REJECTED: [],
  RISK_ACCEPTED: [],
  COMPLETED_HISTORY: [],
};
export const isAllowedWorkflowTransition = (from: WorkflowState, to: WorkflowState) => ALLOWED_TRANSITIONS[from].includes(to);

export interface TransitionInput {
  operation: string;
  actor: WorkflowActor;
  at: Date;
  reason?: string | null;
  detail?: unknown;
  /** Extra columns for the workflow row written in the same update. */
  patch?: Prisma.IamCoreWorkflowStateUpdateInput;
}

/** Move the candidate to `to`: validates the transition, writes the append-only history row and the contract lifecycle. */
export async function transition(tx: Tx, wf: WorkflowRow, to: WorkflowState, input: TransitionInput): Promise<WorkflowRow> {
  const from = wf.workflowState as WorkflowState;
  if (!isAllowedWorkflowTransition(from, to)) {
    throw new DposError("INVALID_WORKFLOW_TRANSITION", `The workflow cannot move from ${from} to ${to}.`, 409, { from, to, allowed: [...ALLOWED_TRANSITIONS[from]] });
  }
  const updated = await tx.iamCoreWorkflowState.update({ where: { candidateId: wf.candidateId }, data: { ...(input.patch ?? {}), workflowState: to } });
  await tx.iamCoreWorkflowHistory.create({
    data: {
      candidateId: wf.candidateId,
      dposCompanyId: wf.dposCompanyId,
      fromState: from,
      toState: to,
      operation: input.operation,
      actorId: input.actor.actorId,
      actorRole: input.actor.role,
      reason: input.reason ?? null,
      detailJson: toJson(input.detail),
      at: input.at,
    },
  });
  await tx.iamCoreCandidate.update({ where: { candidateId: wf.candidateId }, data: { lifecycleState: WORKFLOW_TO_CONTRACT_LIFECYCLE[to] } });
  return updated;
}

/** Final step of a terminal transition. Must run LAST in the transaction (a closed candidate accepts no further writes). */
export async function closeCandidate(tx: Tx, candidateId: string, at: Date, lifecycleState: string) {
  await tx.iamCoreCandidate.update({ where: { candidateId }, data: { closedAt: at, lifecycleState } });
}

/** Qualified rejections already recorded against this recurring condition (any earlier candidate of the same key). */
export async function countQualifiedRejections(tx: Tx, ctx: Ctx, groupedConditionKey: string): Promise<number> {
  return tx.iamCoreManagementDecision.count({
    where: { dposCompanyId: ctx.dposCompanyId, groupedConditionKey, decisionType: "REJECT", qualifiedRejection: true },
  });
}

// ---- management decision ledger ----------------------------------------------------------------------------------------

export interface DecisionInput {
  decisionType: string;
  reason?: string | null;
  at: Date;
  actor: WorkflowActor;
  groupedConditionKey: string;
  systemRecommendationId?: string | null;
  recommendationVersion?: number | null;
  planId?: string | null;
  planVersion?: number | null;
  qualifiedRejection?: boolean;
  rejectionOrdinal?: number | null;
  repeatedRejectionFlagged?: boolean;
  detail?: unknown;
}

export async function recordDecision(tx: Tx, ctx: Ctx, candidateId: string, input: DecisionInput) {
  const rec = input.systemRecommendationId === undefined ? await latestRecommendation(tx, candidateId) : null;
  return tx.iamCoreManagementDecision.create({
    data: {
      candidateId,
      dposCompanyId: ctx.dposCompanyId,
      groupedConditionKey: input.groupedConditionKey,
      decisionType: input.decisionType,
      reason: input.reason ?? null,
      actorId: input.actor.actorId,
      actorRole: input.actor.role,
      decidedAt: input.at,
      systemRecommendationId: input.systemRecommendationId ?? rec?.recommendationId ?? null,
      recommendationVersion: input.recommendationVersion ?? rec?.recommendationVersion ?? null,
      planId: input.planId ?? null,
      planVersion: input.planVersion ?? null,
      qualifiedRejection: input.qualifiedRejection ?? false,
      rejectionOrdinal: input.rejectionOrdinal ?? null,
      repeatedRejectionFlagged: input.repeatedRejectionFlagged ?? false,
      detailJson: toJson(input.detail),
    },
  });
}

// ---- Results Return emission -----------------------------------------------------------------------------------------------

/** Where an operation's events come from: the `originatingSource` audit tag and the operation-key prefix (idempotency). */
export interface EmitterOrigin {
  source: string;
  keyPrefix: string;
}
export const WORKFLOW_ORIGIN: EmitterOrigin = { source: "IAM_WORKFLOW_STAGE_4B", keyPrefix: "wf4b" };
export const SCORING_ORIGIN: EmitterOrigin = { source: "IAM_SCORING_STAGE_4C", keyPrefix: "sc4c" };

export interface EmittedEvent {
  eventType: IamEventType;
  outboxId: string;
  producerEventId: string;
  created: boolean;
  locallyValid: boolean;
  issues?: Array<{ path: string; code: string; message: string }>;
}

/**
 * Writes outbox events for ONE operation. Event times are `at`, `at+1ms`, ... and never earlier than the candidate's
 * latest outbox row, so the Data Hub's per-column watermark always sees a candidate's events in order. The operation key
 * (`wf4b:<EVENT>:<record id>`) makes the same business record produce at most one event of a type.
 */
export class Emitter {
  readonly results: EmittedEvent[] = [];
  private seq = 0;

  private constructor(
    private readonly tx: Tx,
    private readonly ctx: Ctx,
    private readonly candidateId: string,
    private readonly actor: WorkflowActor,
    private readonly base: Date,
    private readonly origin: EmitterOrigin,
  ) {}

  /** `origin` defaults to the Stage 4B workflow; the Stage 4C scoring service passes its own source tag and key prefix. */
  static async open(tx: Tx, ctx: Ctx, candidateId: string, actor: WorkflowActor, requested: Date, origin: EmitterOrigin = WORKFLOW_ORIGIN): Promise<Emitter> {
    const latest = await tx.dposResultsReturnOutbox.findFirst({ where: { dposCompanyId: ctx.dposCompanyId, candidateId }, orderBy: { createdAt: "desc" }, select: { createdAt: true } });
    const floor = latest ? latest.createdAt.getTime() + 1 : 0;
    return new Emitter(tx, ctx, candidateId, actor, new Date(Math.max(requested.getTime(), floor)), origin);
  }

  async emit(eventType: IamEventType, sections: Record<string, Record<string, unknown>>, recordId: string): Promise<EmittedEvent> {
    const at = new Date(this.base.getTime() + this.seq++);
    const res = await enqueueResultsReturnEvent(this.tx, this.ctx, {
      eventType,
      candidateId: this.candidateId,
      sections: {
        ...sections,
        auditReceipt: {
          originatingActor: this.actor.actorId,
          originatingSource: this.origin.source,
          authorizationProvenance: `workflow-role:${this.actor.role}`,
        },
      },
      operationKey: `${this.origin.keyPrefix}:${eventType}:${recordId}`,
      at,
    });
    const out: EmittedEvent = {
      eventType,
      outboxId: res.row.id,
      producerEventId: res.row.producerEventId,
      created: res.created,
      locallyValid: res.locallyValid,
      ...(res.issues ? { issues: res.issues } : {}),
    };
    this.results.push(out);
    return out;
  }
}

// ---- operation wrapper ---------------------------------------------------------------------------------------------------------

export interface OperationEnv {
  tx: Tx;
  ctx: Ctx;
  actor: WorkflowActor;
  candidate: CandidateRow;
  wf: WorkflowRow;
  em: Emitter;
  at: Date;
}

export type OperationResult<T> = T & { candidateId: string; workflowState: string; events: EmittedEvent[] };

/** Run one operation on an existing candidate inside a single transaction, with audit and event emission. */
export async function runOperation<T extends object>(
  db: PrismaClient,
  ctx: Ctx,
  actor: WorkflowActor,
  candidateId: string,
  meta: { operation: string; at?: Date; allowClosed?: boolean; origin?: EmitterOrigin },
  fn: (env: OperationEnv) => Promise<T>,
): Promise<OperationResult<T>> {
  assertActor(actor);
  return db.$transaction(
    async (tx) => {
      const { candidate, wf } = await loadWorkflowCandidate(tx, ctx, candidateId);
      if (!meta.allowClosed) assertOpenCandidate(candidate);
      const at = meta.at ?? new Date();
      const em = await Emitter.open(tx, ctx, candidateId, actor, at, meta.origin);
      const env: OperationEnv = { tx, ctx, actor, candidate, wf, em, at };
      const out = await fn(env);
      await syncDecisionRequiredState(env, candidateId);
      const finalWf = await tx.iamCoreWorkflowState.findUniqueOrThrow({ where: { candidateId } });
      await writeAudit(tx, {
        category: "WORKFLOW",
        action: meta.operation,
        outcome: "SUCCESS",
        actor: actor.actorId,
        dposCompanyId: ctx.dposCompanyId,
        subjectType: "IamCoreCandidate",
        subjectId: candidateId,
        detail: { role: actor.role, state: finalWf.workflowState, events: em.results.map((e) => e.eventType) },
        at,
      });
      return { ...out, candidateId, workflowState: finalWf.workflowState, events: em.results };
    },
    { maxWait: 10_000, timeout: 30_000 },
  );
}

// ---- Management Decision Required flags ------------------------------------------------------------------------------------------

/** Raise a flag unless one is already open for the same reason. Emits MANAGEMENT_DECISION_REQUIRED when it is new. */
export async function raiseDecisionRequired(
  env: Pick<OperationEnv, "tx" | "ctx" | "actor" | "em" | "at">,
  candidateId: string,
  reason: DecisionRequiredReason,
  detail: string,
  relatedEntityId?: string | null,
): Promise<{ raised: boolean; flagId: string }> {
  const { tx, ctx, actor, em, at } = env;
  const existing = await tx.iamCoreDecisionRequired.findFirst({ where: { candidateId, reasonCode: reason, status: "OPEN" } });
  if (existing) return { raised: false, flagId: existing.flagId };
  const flag = await tx.iamCoreDecisionRequired.create({
    data: { candidateId, dposCompanyId: ctx.dposCompanyId, reasonCode: reason, detail: detail.slice(0, 4000), raisedAt: at, raisedBy: actor.actorId, relatedEntityId: relatedEntityId ?? null },
  });
  await em.emit("MANAGEMENT_DECISION_REQUIRED", decisionRequiredSections(reason, detail), flag.flagId);
  return { raised: true, flagId: flag.flagId };
}

const decisionRequiredSections = (reason: DecisionRequiredReason | string, detail: string) => ({
  progress: { managementDecisionRequired: true, decisionRequiredCategory: reason, decisionRequiredReason: `${reason}: ${detail}`.slice(0, 4000) },
});

/**
 * Keep the Data Hub's explicit management-decision-required state (4B-D2) in step with the OPEN flags at the end of every
 * operation. Resolution is explicit: when the last open flag is resolved a MANAGEMENT_DECISION_RESOLVED event is written
 * (the original MANAGEMENT_DECISION_REQUIRED event is never touched). When other flags remain open but the one the Data Hub is
 * showing was resolved, the next open flag is re-announced. Idempotent: it writes nothing when the Data Hub is already right.
 */
export async function syncDecisionRequiredState(env: OperationEnv, candidateId: string): Promise<void> {
  const { tx, em } = env;
  const open = await tx.iamCoreDecisionRequired.findMany({ where: { candidateId, status: "OPEN" }, orderBy: [{ raisedAt: "desc" }, { flagId: "asc" }] });
  const last = await tx.dposResultsReturnOutbox.findFirst({
    where: { candidateId, eventType: { in: ["MANAGEMENT_DECISION_REQUIRED", "MANAGEMENT_DECISION_RESOLVED"] } },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    select: { id: true, eventType: true, operationKey: true },
  });
  const lastIsRequired = last?.eventType === "MANAGEMENT_DECISION_REQUIRED";
  const shown = lastIsRequired ? (/^wf4b:MANAGEMENT_DECISION_REQUIRED:([^:]+)/.exec(last?.operationKey ?? "")?.[1] ?? null) : null;
  if (open.length === 0) {
    if (lastIsRequired && shown) {
      const flag = await tx.iamCoreDecisionRequired.findUnique({ where: { flagId: shown } });
      await em.emit(
        "MANAGEMENT_DECISION_RESOLVED",
        { progress: { managementDecisionRequired: false, decisionResolution: (flag?.resolution ?? "The management decision requirement was resolved.").slice(0, 4000) } },
        shown,
      );
    }
    return;
  }
  if (shown && open.some((f) => f.flagId === shown)) return;
  const next = open[0]!;
  await em.emit("MANAGEMENT_DECISION_REQUIRED", decisionRequiredSections(next.reasonCode, next.detail ?? ""), `${next.flagId}:after:${shown ?? last?.id ?? "none"}`);
}

export async function resolveDecisionFlags(
  tx: Tx,
  candidateId: string,
  reasons: readonly DecisionRequiredReason[],
  by: string,
  resolution: string,
  at: Date,
): Promise<number> {
  const r = await tx.iamCoreDecisionRequired.updateMany({
    where: { candidateId, status: "OPEN", reasonCode: { in: [...reasons] } },
    data: { status: "RESOLVED", resolvedAt: at, resolvedBy: by, resolution },
  });
  return r.count;
}

// ---- tracking <-> Stage 4A execution-state projection -----------------------------------------------------------------------------------

/** Mirror the tracking record into the Stage 4A execution-state table (contract vocabulary). Never calls 4A functions. */
export async function syncExecutionState(tx: Tx, candidateId: string, updatedBy: string): Promise<void> {
  const t = await loadTracking(tx, candidateId);
  const reduction = computeConditionReduction(t.baselineExposure, t.currentExposure);
  const openBlocker = await tx.iamCoreBlocker.findFirst({ where: { candidateId, status: "OPEN" } });
  const data = {
    actionStatus: ACTION_STATUS_TO_CONTRACT[t.actionStatus as ActionStatus],
    actionCompletionPct: t.actionCompletionPct,
    conditionReductionPct: reduction.contractPct,
    remainingExposure: t.currentExposure,
    remainingExposureUnit: t.exposureUnit,
    targetStart: t.targetStart,
    targetResolution: t.targetResolution,
    blockersJson: openBlocker ? JSON.stringify([{ blockerId: openBlocker.blockerId, reason: openBlocker.reason, dependency: openBlocker.dependency }]) : null,
    updatedBy,
  };
  await tx.iamCoreExecutionState.upsert({ where: { candidateId }, create: { candidateId, ...data }, update: data });
}

export function contractStatusOf(status: ActionStatus) {
  return ACTION_STATUS_TO_CONTRACT[status];
}
