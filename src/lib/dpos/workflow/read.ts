/**
 * Stage 4B read models (no writes): the full workflow view of one candidate, the Management Decision Required list, the
 * What-Changed markers, and the active-action CAPACITY FOUNDATION.
 *
 * Capacity is information only. Nothing in the workflow reads it to hide, suppress, delay, re-order or lower a candidate:
 * management decides what to approve with the capacity picture in front of it, never through it.
 */
import type { PrismaClient } from "@prisma/client";
import { DposError } from "../errors";
import { parseJson, type Ctx } from "./internal";
import { ACTION_STATUSES, type ActionStatus } from "./vocab";

export interface CapacityBucket {
  activePrograms: number;
  notStarted: number;
  onTrack: number;
  attention: number;
  atRisk: number;
  overdue: number;
  paused: number;
  blocked: number;
  awaitingManagementDecision: number;
}

const emptyBucket = (): CapacityBucket => ({ activePrograms: 0, notStarted: 0, onTrack: 0, attention: 0, atRisk: 0, overdue: 0, paused: 0, blocked: 0, awaitingManagementDecision: 0 });

const BUCKET_FIELD: Partial<Record<ActionStatus, keyof CapacityBucket>> = {
  NOT_STARTED: "notStarted",
  ON_TRACK: "onTrack",
  ATTENTION: "attention",
  AT_RISK: "atRisk",
  OVERDUE: "overdue",
  PAUSED: "paused",
  BLOCKED: "blocked",
};

export interface CapacitySnapshot {
  overall: CapacityBucket;
  byDepartment: Record<string, CapacityBucket>;
  /** New candidates awaiting their INITIAL approval are a different thing from active actions needing a decision. */
  newCandidatesAwaitingInitialDecision: number;
  generatedAt: Date;
}

/** Active programs (accepted actions that are not yet completed) overall and by responsible department. */
export async function computeCapacity(db: PrismaClient, ctx: Ctx, now: Date = new Date()): Promise<CapacitySnapshot> {
  const active = await db.iamCoreWorkflowState.findMany({ where: { dposCompanyId: ctx.dposCompanyId, workflowState: "ACTIVE_ACTION" }, select: { candidateId: true } });
  const overall = emptyBucket();
  const byDepartment: Record<string, CapacityBucket> = {};
  for (const { candidateId } of active) {
    const t = await db.iamCoreActionTracking.findUnique({ where: { candidateId } });
    if (!t || t.actionStatus === "COMPLETED") continue;
    const owner = await db.iamCoreOwnership.findFirst({ where: { candidateId, endedAt: null } });
    const dept = owner?.responsibleDepartment ?? "UNASSIGNED";
    const open = await db.iamCoreDecisionRequired.count({ where: { candidateId, status: "OPEN" } });
    for (const bucket of [overall, (byDepartment[dept] ??= emptyBucket())]) {
      bucket.activePrograms++;
      const f = BUCKET_FIELD[t.actionStatus as ActionStatus];
      if (f) bucket[f]++;
      if (open > 0) bucket.awaitingManagementDecision++;
    }
  }
  const newCandidatesAwaitingInitialDecision = await db.iamCoreWorkflowState.count({ where: { dposCompanyId: ctx.dposCompanyId, workflowState: { in: ["NEW_CANDIDATE", "PRESENTED"] } } });
  return { overall, byDepartment, newCandidatesAwaitingInitialDecision, generatedAt: now };
}

/** Open Management Decision Required flags (active-action interventions), oldest first. */
export async function listDecisionRequired(db: PrismaClient, ctx: Ctx, opts: { status?: "OPEN" | "RESOLVED"; candidateId?: string } = {}) {
  return db.iamCoreDecisionRequired.findMany({
    where: { dposCompanyId: ctx.dposCompanyId, status: opts.status ?? "OPEN", ...(opts.candidateId ? { candidateId: opts.candidateId } : {}) },
    orderBy: { raisedAt: "asc" },
  });
}

/** Status transitions marked for the later "What Changed Since Last Review" section (AT_RISK / OVERDUE / BLOCKED). */
export async function listWhatChangedMarkers(db: PrismaClient, ctx: Ctx, opts: { since?: Date } = {}) {
  return db.iamCoreActionStatusHistory.findMany({
    where: { dposCompanyId: ctx.dposCompanyId, includeInWhatChanged: true, ...(opts.since ? { at: { gte: opts.since } } : {}) },
    orderBy: { at: "asc" },
  });
}

/** Everything the workflow knows about one candidate (for tests, administration and the later Decision Board). */
export async function readWorkflowView(db: PrismaClient, ctx: Ctx, candidateId: string) {
  const candidate = await db.iamCoreCandidate.findUnique({
    where: { candidateId },
    include: {
      workflowState: true,
      workflowHistory: { orderBy: { at: "asc" } },
      managementDecisions: { orderBy: { decidedAt: "asc" } },
      suppressions: { orderBy: { startedAt: "asc" } },
      evidence: { orderBy: { evidenceRef: "asc" } },
      assignmentEvents: { orderBy: { at: "asc" } },
      actionTracking: true,
      progressUpdates: { orderBy: { at: "asc" } },
      actionStatusHistory: { orderBy: { at: "asc" } },
      decisionRequired: { orderBy: { raisedAt: "asc" } },
      pauseRequests: { orderBy: { requestedAt: "asc" } },
      blockers: { orderBy: { raisedAt: "asc" } },
      contributorAuthorizations: { orderBy: { grantedAt: "asc" } },
      recommendations: { orderBy: { recommendationVersion: "asc" } },
      managementPlans: { orderBy: { planVersion: "asc" } },
      ownerships: { orderBy: { assignedAt: "asc" }, include: { contributors: true } },
      executionState: true,
      outcome: true,
    },
  });
  if (!candidate || candidate.dposCompanyId !== ctx.dposCompanyId) throw new DposError("CANDIDATE_NOT_FOUND", "Unknown candidate.", 404);
  return {
    ...candidate,
    currentOwnership: candidate.ownerships.find((o) => o.endedAt === null) ?? null,
    /**
     * Execution completion and formal closeout are separate facts (4B-D4). Completed History sets executionCompleted only;
     * closeoutCompleted becomes true solely through the later outcome / closeout workflow (closedAt + outcome.closeoutAt).
     */
    executionCompleted: !!candidate.actionTracking?.completedAt,
    closeoutCompleted: candidate.closedAt !== null && candidate.outcome?.closeoutAt != null,
    statusReasons: parseJson<string[]>(candidate.actionTracking?.statusReasonsJson, []),
  };
}

/** Actions whose execution is complete (Completed History) and which wait for the later outcome / closeout workflow. */
export async function listCompletedHistory(db: PrismaClient, ctx: Ctx) {
  return db.iamCoreWorkflowState.findMany({
    where: { dposCompanyId: ctx.dposCompanyId, workflowState: "COMPLETED_HISTORY" },
    orderBy: { updatedAt: "asc" },
  });
}

/** The recurrence chain of a grouped condition, oldest first (candidate ids with their closing state). */
export async function readRecurrenceChain(db: PrismaClient, ctx: Ctx, groupedConditionKey: string) {
  return db.iamCoreCandidate.findMany({
    where: { dposCompanyId: ctx.dposCompanyId, groupedConditionKey },
    orderBy: { originalCreatedAt: "asc" },
    select: { candidateId: true, lifecycleState: true, recurrenceOfCandidateId: true, closedAt: true, originalCreatedAt: true },
  });
}

export const ACTION_STATUS_ORDER = ACTION_STATUSES;
