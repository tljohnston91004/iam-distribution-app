/**
 * Canonical IAM core persistence (Stage 4A) — STRUCTURE ONLY.
 *
 * Six separate pieces, each in its own table, so the original system recommendation is never overwritten by what
 * management decides or what happens afterwards:
 *   A) candidate identity            (iam_core_candidates)
 *   B) system recommendation         (iam_core_system_recommendations — append-only, DB-enforced immutable)
 *   C) management-approved plan      (iam_core_management_plans — separate, versioned)
 *   D) ownership                     (iam_core_ownerships / iam_core_contributors)
 *   E) execution-state structure     (iam_core_execution_states — values supplied, never calculated here)
 *   F) closeout / outcome structure  (iam_core_outcomes — values supplied, never calculated here)
 *
 * Nothing in this file scores, ranks, recommends, measures or learns. Closed candidates are never silently reopened
 * (service check here + database triggers); a recurrence is a NEW candidate linked to the closed one.
 * V1.5 tables are not referenced: legacy records stay readable and untouched.
 */
import type { Prisma, PrismaClient } from "@prisma/client";
import type { DposCompanyContext } from "./company-context";
import { IAM_ACTION_STATUSES, IAM_LIFECYCLE_STATES, IAM_PLAN_STATUSES, IAM_FINAL_RESOLUTION_STATES, IAM_ATTRIBUTION_CONFIDENCES } from "./contract/iam-results-return";
import { DposError } from "./errors";

type Ctx = Pick<DposCompanyContext, "dposCompanyId">;
type Tx = Prisma.TransactionClient;

const json = (v: unknown) => (v === undefined || v === null ? null : JSON.stringify(v));

async function loadCandidate(db: Tx | PrismaClient, ctx: Ctx, candidateId: string) {
  const c = await db.iamCoreCandidate.findUnique({ where: { candidateId } });
  if (!c || c.dposCompanyId !== ctx.dposCompanyId) throw new DposError("CANDIDATE_NOT_FOUND", "Unknown candidate.", 404);
  return c;
}

function assertOpen(c: { closedAt: Date | null }) {
  if (c.closedAt) throw new DposError("CLOSED_CANDIDATE_NO_REOPEN", "This candidate is closed and is never reopened; a recurrence is a new candidate.", 409);
}

function assertVocab(value: string | null | undefined, allowed: readonly string[], field: string) {
  if (value !== null && value !== undefined && !allowed.includes(value)) {
    throw new DposError("VOCABULARY_VIOLATION", `${field} must be one of ${allowed.join(", ")}`, 400);
  }
}

function assertPct(value: number | null | undefined, field: string) {
  if (value !== null && value !== undefined && (!Number.isFinite(value) || value < 0 || value > 100)) {
    throw new DposError("OUT_OF_RANGE", `${field} must be between 0 and 100`, 400);
  }
}

// ---- A) candidate identity ----------------------------------------------------------------------------------------

export interface CreateCandidateInput {
  groupedConditionKey: string;
  groupedCondition?: unknown;
  sourceRunId?: string | null;
  sourceRefreshAttemptId?: string | null;
  evidenceRefs?: string[];
  originalCreatedAt?: Date;
  /** Optional explicit recurrence link; otherwise a prior CLOSED candidate for the same condition is linked automatically. */
  recurrenceOfCandidateId?: string | null;
}

export async function createCandidate(db: PrismaClient, ctx: Ctx, input: CreateCandidateInput) {
  if (!input.groupedConditionKey.trim()) throw new DposError("GROUPED_CONDITION_REQUIRED", "A grouped-condition identity is required.", 400);
  return db.$transaction(async (tx) => {
    const open = await tx.iamCoreCandidate.findFirst({
      where: { dposCompanyId: ctx.dposCompanyId, groupedConditionKey: input.groupedConditionKey, closedAt: null },
    });
    if (open) throw new DposError("CANDIDATE_ALREADY_OPEN", "An open candidate already exists for this grouped condition.", 409, { candidateId: open.candidateId });
    let recurrenceOf: string | null = null;
    if (input.recurrenceOfCandidateId) {
      const prior = await loadCandidate(tx, ctx, input.recurrenceOfCandidateId);
      if (!prior.closedAt) throw new DposError("RECURRENCE_TARGET_NOT_CLOSED", "A recurrence can only follow a closed candidate.", 409);
      if (prior.groupedConditionKey !== input.groupedConditionKey) throw new DposError("RECURRENCE_CONDITION_MISMATCH", "The recurrence link must name a candidate of the same grouped condition.", 409);
      recurrenceOf = prior.candidateId;
    } else {
      const latestClosed = await tx.iamCoreCandidate.findFirst({
        where: { dposCompanyId: ctx.dposCompanyId, groupedConditionKey: input.groupedConditionKey, closedAt: { not: null } },
        orderBy: { closedAt: "desc" },
      });
      recurrenceOf = latestClosed?.candidateId ?? null;
    }
    return tx.iamCoreCandidate.create({
      data: {
        dposCompanyId: ctx.dposCompanyId,
        groupedConditionKey: input.groupedConditionKey,
        groupedConditionJson: json(input.groupedCondition),
        sourceRunId: input.sourceRunId ?? null,
        sourceRefreshAttemptId: input.sourceRefreshAttemptId ?? null,
        sourceEvidenceRefsJson: json(input.evidenceRefs),
        lifecycleState: "CANDIDATE",
        recurrenceOfCandidateId: recurrenceOf,
        originalCreatedAt: input.originalCreatedAt ?? new Date(),
      },
    });
  });
}

/** Vocabulary-checked lifecycle state change on an open candidate (no transition rules — those are a later stage). */
export async function setLifecycleState(db: PrismaClient, ctx: Ctx, candidateId: string, state: string) {
  assertVocab(state, IAM_LIFECYCLE_STATES, "lifecycleState");
  const c = await loadCandidate(db, ctx, candidateId);
  assertOpen(c);
  return db.iamCoreCandidate.update({ where: { candidateId }, data: { lifecycleState: state } });
}

// ---- B) system recommendation (append-only) -----------------------------------------------------------------------

export interface RecordRecommendationInput {
  recommendedActionDirection: string;
  title?: string;
  summary?: string;
  evidenceRefs?: string[];
  recommendedBy: string;
  recommendedAt?: Date;
  /** Supplied by the later scoring stage; Stage 4A never computes these. */
  domainScore?: number | null;
  domainRank?: number | null;
  recommendation?: unknown;
}

export async function recordSystemRecommendation(db: PrismaClient, ctx: Ctx, candidateId: string, input: RecordRecommendationInput) {
  if (!input.recommendedActionDirection.trim()) throw new DposError("DIRECTION_REQUIRED", "A recommended action direction is required.", 400);
  return db.$transaction(async (tx) => {
    const c = await loadCandidate(tx, ctx, candidateId);
    assertOpen(c);
    const last = await tx.iamCoreSystemRecommendation.findFirst({ where: { candidateId }, orderBy: { recommendationVersion: "desc" } });
    return tx.iamCoreSystemRecommendation.create({
      data: {
        candidateId,
        recommendationVersion: (last?.recommendationVersion ?? 0) + 1,
        recommendedAt: input.recommendedAt ?? new Date(),
        recommendedActionDirection: input.recommendedActionDirection,
        title: input.title ?? null,
        summary: input.summary ?? null,
        supportingEvidenceRefsJson: json(input.evidenceRefs),
        domainScore: input.domainScore ?? null,
        domainRank: input.domainRank ?? null,
        recommendationJson: json(input.recommendation),
        recommendedBy: input.recommendedBy,
      },
    });
  });
}

// ---- C) management-approved plan (separate from the recommendation) -----------------------------------------------

export async function proposePlan(
  db: PrismaClient,
  ctx: Ctx,
  candidateId: string,
  input: { createdBy: string; planSummary?: string; plan?: unknown; basedOnRecommendationId?: string },
) {
  return db.$transaction(async (tx) => {
    const c = await loadCandidate(tx, ctx, candidateId);
    assertOpen(c);
    const rec = input.basedOnRecommendationId
      ? await tx.iamCoreSystemRecommendation.findUnique({ where: { recommendationId: input.basedOnRecommendationId } })
      : await tx.iamCoreSystemRecommendation.findFirst({ where: { candidateId }, orderBy: { recommendationVersion: "desc" } });
    if (!rec || rec.candidateId !== candidateId) throw new DposError("RECOMMENDATION_REQUIRED", "A plan must be based on a system recommendation of this candidate.", 409);
    const last = await tx.iamCoreManagementPlan.findFirst({ where: { candidateId }, orderBy: { planVersion: "desc" } });
    return tx.iamCoreManagementPlan.create({
      data: {
        candidateId,
        planVersion: (last?.planVersion ?? 0) + 1,
        basedOnRecommendationId: rec.recommendationId,
        approvalState: "PROPOSED",
        planSummary: input.planSummary ?? null,
        planJson: json(input.plan),
        createdBy: input.createdBy,
      },
    });
  });
}

export async function decidePlan(
  db: PrismaClient,
  ctx: Ctx,
  planId: string,
  input: { approver: string; decision: "APPROVED" | "REJECTED"; managementDecision?: string; deviatesFromRecommendation?: boolean; deviationReason?: string; decidedAt?: Date },
) {
  assertVocab(input.decision, IAM_PLAN_STATUSES, "decision");
  return db.$transaction(async (tx) => {
    const plan = await tx.iamCoreManagementPlan.findUnique({ where: { planId } });
    if (!plan) throw new DposError("PLAN_NOT_FOUND", "Unknown plan.", 404);
    const c = await loadCandidate(tx, ctx, plan.candidateId);
    assertOpen(c);
    if (plan.approvalState !== "PROPOSED") throw new DposError("PLAN_NOT_PENDING", `Plan is ${plan.approvalState}; only a proposed plan can be decided.`, 409);
    if (input.deviatesFromRecommendation && !input.deviationReason?.trim()) {
      throw new DposError("DEVIATION_REASON_REQUIRED", "A reason is required when the approved plan deviates from the system recommendation.", 400);
    }
    if (input.decision === "APPROVED") {
      await tx.iamCoreManagementPlan.updateMany({ where: { candidateId: plan.candidateId, approvalState: "APPROVED" }, data: { approvalState: "SUPERSEDED" } });
    }
    return tx.iamCoreManagementPlan.update({
      where: { planId },
      data: {
        approvalState: input.decision,
        managementDecision: input.managementDecision ?? input.decision,
        deviatesFromRecommendation: input.deviatesFromRecommendation ?? false,
        deviationReason: input.deviationReason ?? null,
        approver: input.approver,
        approvedAt: input.decidedAt ?? new Date(),
      },
    });
  });
}

// ---- D) ownership --------------------------------------------------------------------------------------------------

export async function assignOwnership(
  db: PrismaClient,
  ctx: Ctx,
  candidateId: string,
  input: { responsibleDepartment: string; taskOwnerId?: string; taskOwnerName?: string; contributors?: Array<{ userId: string; displayName?: string }>; assignedBy: string; assignedAt?: Date },
) {
  if (!input.responsibleDepartment.trim()) throw new DposError("DEPARTMENT_REQUIRED", "A responsible department is required.", 400);
  return db.$transaction(async (tx) => {
    const c = await loadCandidate(tx, ctx, candidateId);
    assertOpen(c);
    const assignedAt = input.assignedAt ?? new Date();
    await tx.iamCoreOwnership.updateMany({ where: { candidateId, endedAt: null }, data: { endedAt: assignedAt } });
    const o = await tx.iamCoreOwnership.create({
      data: {
        candidateId,
        responsibleDepartment: input.responsibleDepartment,
        taskOwnerId: input.taskOwnerId ?? null,
        taskOwnerName: input.taskOwnerName ?? null,
        assignedAt,
        assignedBy: input.assignedBy,
      },
    });
    for (const k of input.contributors ?? []) {
      await tx.iamCoreContributor.create({ data: { ownershipId: o.ownershipId, userId: k.userId, displayName: k.displayName ?? null } });
    }
    return tx.iamCoreOwnership.findUniqueOrThrow({ where: { ownershipId: o.ownershipId }, include: { contributors: true } });
  });
}

// ---- E) execution-state structure ------------------------------------------------------------------------------------

export interface ExecutionStateInput {
  actionStatus?: string | null;
  actionCompletionPct?: number | null;
  conditionReductionPct?: number | null;
  remainingExposure?: number | null;
  remainingExposureUnit?: string | null;
  targetStart?: Date | null;
  targetResolution?: Date | null;
  blockers?: unknown;
  updatedBy?: string;
}

export async function saveExecutionState(db: PrismaClient, ctx: Ctx, candidateId: string, input: ExecutionStateInput) {
  assertVocab(input.actionStatus, IAM_ACTION_STATUSES, "actionStatus");
  assertPct(input.actionCompletionPct, "actionCompletionPct");
  assertPct(input.conditionReductionPct, "conditionReductionPct");
  return db.$transaction(async (tx) => {
    const c = await loadCandidate(tx, ctx, candidateId);
    assertOpen(c);
    const data = {
      actionStatus: input.actionStatus ?? null,
      actionCompletionPct: input.actionCompletionPct ?? null,
      conditionReductionPct: input.conditionReductionPct ?? null,
      remainingExposure: input.remainingExposure ?? null,
      remainingExposureUnit: input.remainingExposureUnit ?? null,
      targetStart: input.targetStart ?? null,
      targetResolution: input.targetResolution ?? null,
      blockersJson: json(input.blockers),
      updatedBy: input.updatedBy ?? null,
    };
    return tx.iamCoreExecutionState.upsert({ where: { candidateId }, create: { candidateId, ...data }, update: data });
  });
}

// ---- F) closeout / outcome structure ---------------------------------------------------------------------------------

export interface OutcomeInput {
  finalResolutionState?: string | null;
  measuredResult?: unknown;
  attribution?: unknown;
  attributionConfidence?: string | null;
  residualExposure?: number | null;
  lessonsRef?: string | null;
}

/** Store outcome placeholder values (draft). Nothing is measured or attributed by IAM in Stage 4A. */
export async function saveOutcomeStructure(db: PrismaClient, ctx: Ctx, candidateId: string, input: OutcomeInput) {
  assertVocab(input.finalResolutionState, IAM_FINAL_RESOLUTION_STATES, "finalResolutionState");
  assertVocab(input.attributionConfidence, IAM_ATTRIBUTION_CONFIDENCES, "attributionConfidence");
  return db.$transaction(async (tx) => {
    const c = await loadCandidate(tx, ctx, candidateId);
    assertOpen(c);
    const data = {
      finalResolutionState: input.finalResolutionState ?? null,
      measuredResultJson: json(input.measuredResult),
      attributionJson: json(input.attribution),
      attributionConfidence: input.attributionConfidence ?? null,
      residualExposure: input.residualExposure ?? null,
      lessonsRef: input.lessonsRef ?? null,
    };
    return tx.iamCoreOutcome.upsert({ where: { candidateId }, create: { candidateId, ...data }, update: data });
  });
}

/**
 * Record that a candidate is formally closed: stamps the outcome's closeoutAt and the candidate's closedAt and lifecycle
 * state in one transaction. This is the persistence step only; deciding WHEN a candidate may close is later-stage logic.
 */
export async function recordCloseout(db: PrismaClient, ctx: Ctx, candidateId: string, input: { closeoutAt?: Date; finalResolutionState: string }) {
  assertVocab(input.finalResolutionState, IAM_FINAL_RESOLUTION_STATES, "finalResolutionState");
  return db.$transaction(async (tx) => {
    const c = await loadCandidate(tx, ctx, candidateId);
    assertOpen(c);
    const closeoutAt = input.closeoutAt ?? new Date();
    await tx.iamCoreOutcome.upsert({
      where: { candidateId },
      create: { candidateId, finalResolutionState: input.finalResolutionState, closeoutAt },
      update: { finalResolutionState: input.finalResolutionState, closeoutAt },
    });
    return tx.iamCoreCandidate.update({ where: { candidateId }, data: { closedAt: closeoutAt, lifecycleState: "CLOSED" } });
  });
}

/** Full read of one candidate with every separate part (for the later Decision Board and for Results Return). */
export async function readCandidate(db: PrismaClient, ctx: Ctx, candidateId: string) {
  await loadCandidate(db, ctx, candidateId);
  return db.iamCoreCandidate.findUniqueOrThrow({
    where: { candidateId },
    include: {
      recommendations: { orderBy: { recommendationVersion: "asc" } },
      managementPlans: { orderBy: { planVersion: "asc" } },
      ownerships: { orderBy: { assignedAt: "asc" }, include: { contributors: true } },
      executionState: true,
      outcome: true,
    },
  });
}
