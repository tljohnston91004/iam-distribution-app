/**
 * Transaction-level building blocks shared by the management, assignment and action services: the management-approved
 * plan (kept separate from, and never overwriting, the system recommendation), ownership rows with contributors, the
 * assignment ledger, and the action-tracking record.
 */
import { DposError } from "../errors";
import {
  addDays,
  contractStatusOf,
  currentOwnership,
  isoDate,
  latestRecommendation,
  optionalText,
  requireText,
  syncExecutionState,
  toDateOnly,
  toJson,
  type CandidateRow,
  type OperationEnv,
  type Tx,
} from "./internal";
import type { ActionStatus } from "./vocab";

export const normalizeText = (s: string) => s.trim().replace(/\s+/g, " ").toLowerCase();

export interface PlanInput {
  summary: string;
  /** The direction of the plan. When it differs from the original recommendation direction the plan deviates. */
  actionDirection?: string;
  detail?: unknown;
  deviatesFromRecommendation?: boolean;
  deviationReason?: string;
}

/**
 * Store a management-approved plan as a NEW version. The system recommendation row is never touched; a previously approved
 * plan becomes SUPERSEDED (history kept). A deviation from the recommendation requires a reason.
 */
export async function createApprovedPlan(env: Pick<OperationEnv, "tx" | "actor" | "at">, candidateId: string, plan: PlanInput) {
  const { tx, actor, at } = env;
  const rec = await latestRecommendation(tx, candidateId);
  if (!rec) throw new DposError("RECOMMENDATION_REQUIRED", "A plan must be based on the system recommendation of this candidate.", 409);
  const summary = requireText(plan.summary, "plan.summary");
  const direction = optionalText(plan.actionDirection, "plan.actionDirection");
  const deviates = plan.deviatesFromRecommendation ?? (direction !== null && normalizeText(direction) !== normalizeText(rec.recommendedActionDirection));
  const deviationReason = optionalText(plan.deviationReason, "plan.deviationReason");
  if (deviates && !deviationReason) {
    throw new DposError("DEVIATION_REASON_REQUIRED", "A reason is required when the approved plan materially deviates from the system recommendation.", 400);
  }
  const last = await tx.iamCoreManagementPlan.findFirst({ where: { candidateId }, orderBy: { planVersion: "desc" } });
  await tx.iamCoreManagementPlan.updateMany({ where: { candidateId, approvalState: "APPROVED" }, data: { approvalState: "SUPERSEDED" } });
  const created = await tx.iamCoreManagementPlan.create({
    data: {
      candidateId,
      planVersion: (last?.planVersion ?? 0) + 1,
      basedOnRecommendationId: rec.recommendationId,
      approvalState: "APPROVED",
      managementDecision: "APPROVED",
      deviatesFromRecommendation: deviates,
      deviationReason: deviates ? deviationReason : null,
      approver: actor.actorId,
      approvedAt: at,
      planSummary: summary,
      planJson: toJson({ actionDirection: direction, detail: plan.detail ?? null }),
      createdBy: actor.actorId,
    },
  });
  return { plan: created, recommendation: rec, deviates };
}

export interface ContributorInput {
  userId: string;
  displayName?: string;
}

/** End the current ownership row (never rewritten) and write a new one, carrying contributors forward unless replaced. */
export async function writeOwnership(
  tx: Tx,
  candidateId: string,
  p: { department: string; ownerId?: string | null; ownerName?: string | null; contributors?: ContributorInput[]; assignedBy: string; at: Date },
) {
  const prev = await currentOwnership(tx, candidateId);
  if (prev) await tx.iamCoreOwnership.update({ where: { ownershipId: prev.ownershipId }, data: { endedAt: p.at } });
  const created = await tx.iamCoreOwnership.create({
    data: {
      candidateId,
      responsibleDepartment: requireText(p.department, "responsibleDepartment", 500),
      taskOwnerId: p.ownerId ?? null,
      taskOwnerName: p.ownerName ?? null,
      assignedAt: p.at,
      assignedBy: p.assignedBy,
    },
  });
  const contributors = p.contributors ?? (prev?.contributors ?? []).map((c) => ({ userId: c.userId, displayName: c.displayName ?? undefined }));
  const seen = new Set<string>();
  for (const c of contributors) {
    const userId = requireText(c.userId, "contributor userId", 500);
    if (seen.has(userId)) continue;
    seen.add(userId);
    if (p.ownerId && userId === p.ownerId) continue; // the primary owner is not also a contributor
    await tx.iamCoreContributor.create({ data: { ownershipId: created.ownershipId, userId, displayName: c.displayName ?? null } });
  }
  return { ownership: created, previous: prev };
}

export async function recordAssignmentEvent(
  env: Pick<OperationEnv, "tx" | "ctx" | "actor" | "at">,
  candidateId: string,
  e: {
    kind: string;
    fromDepartment?: string | null;
    toDepartment?: string | null;
    fromOwnerId?: string | null;
    toOwnerId?: string | null;
    toOwnerName?: string | null;
    reason?: string | null;
    note?: string | null;
    onBehalf?: boolean;
    planVersionBefore?: number | null;
    planVersionAfter?: number | null;
  },
) {
  return env.tx.iamCoreAssignmentEvent.create({
    data: {
      candidateId,
      dposCompanyId: env.ctx.dposCompanyId,
      kind: e.kind,
      fromDepartment: e.fromDepartment ?? null,
      toDepartment: e.toDepartment ?? null,
      fromOwnerId: e.fromOwnerId ?? null,
      toOwnerId: e.toOwnerId ?? null,
      toOwnerName: e.toOwnerName ?? null,
      reason: e.reason ?? null,
      note: e.note ?? null,
      actorId: env.actor.actorId,
      actorRole: env.actor.role,
      onBehalf: e.onBehalf ?? false,
      planVersionBefore: e.planVersionBefore ?? null,
      planVersionAfter: e.planVersionAfter ?? null,
      at: env.at,
    },
  });
}

export interface AssignmentChange {
  department?: string;
  ownerId?: string | null;
  ownerName?: string | null;
  contributors?: ContributorInput[];
}

/**
 * Apply an assignment (initial or reassignment): writes the ownership row, the assignment ledger and the DEPARTMENT_ASSIGNED /
 * TASK_OWNER_ASSIGNED events (with the previous department / owner when there was one).
 */
export async function applyAssignment(
  env: OperationEnv,
  change: AssignmentChange,
  opts: { reassignment: boolean; reason?: string | null; planVersionBefore?: number | null; planVersionAfter?: number | null; targetDate?: Date | null },
): Promise<{ departmentChanged: boolean; ownerChanged: boolean; ownershipId: string }> {
  const { tx, em, at, actor } = env;
  const candidateId = env.candidate.candidateId;
  const prev = await currentOwnership(tx, candidateId);
  const department = change.department ?? prev?.responsibleDepartment;
  if (!department) throw new DposError("DEPARTMENT_REQUIRED", "A responsible department is required before a task owner can be assigned.", 400);
  const ownerId = change.ownerId !== undefined ? change.ownerId : (prev?.taskOwnerId ?? null);
  const ownerName = change.ownerId !== undefined ? (change.ownerName ?? null) : (prev?.taskOwnerName ?? null);
  const departmentChanged = (prev?.responsibleDepartment ?? null) !== department;
  const ownerChanged = (prev?.taskOwnerId ?? null) !== (ownerId ?? null);
  if (!departmentChanged && !ownerChanged && !change.contributors) {
    throw new DposError("NOTHING_TO_ASSIGN", "The requested assignment is identical to the current assignment.", 409);
  }
  const { ownership } = await writeOwnership(tx, candidateId, { department, ownerId, ownerName, contributors: change.contributors, assignedBy: actor.actorId, at });
  const targetDate = isoDate(opts.targetDate ?? null);

  const ledger = async (kind: string, extra: Parameters<typeof recordAssignmentEvent>[2]) =>
    recordAssignmentEvent(env, candidateId, { ...extra, kind, reason: opts.reason ?? null, planVersionBefore: opts.planVersionBefore, planVersionAfter: opts.planVersionAfter });

  if (opts.reassignment) {
    const row = await ledger("REASSIGNED", {
      kind: "REASSIGNED",
      fromDepartment: prev?.responsibleDepartment ?? null,
      toDepartment: department,
      fromOwnerId: prev?.taskOwnerId ?? null,
      toOwnerId: ownerId,
      toOwnerName: ownerName,
    });
    if (departmentChanged) {
      await em.emit(
        "DEPARTMENT_ASSIGNED",
        { assignment: { responsibleDepartment: department, previousResponsibleDepartment: prev?.responsibleDepartment, targetDate } },
        `${row.assignmentEventId}:department`,
      );
    }
    if (ownerChanged && ownerId) {
      await em.emit(
        "TASK_OWNER_ASSIGNED",
        { assignment: { taskOwner: ownerName ?? ownerId, previousTaskOwner: prev?.taskOwnerName ?? prev?.taskOwnerId ?? undefined, taskOwnerId: ownerId, previousTaskOwnerId: prev?.taskOwnerId ?? undefined, responsibleDepartment: department, targetDate } },
        `${row.assignmentEventId}:owner`,
      );
    }
  } else {
    if (departmentChanged) {
      const row = await ledger("DEPARTMENT_ASSIGNED", { kind: "DEPARTMENT_ASSIGNED", fromDepartment: prev?.responsibleDepartment ?? null, toDepartment: department });
      await em.emit("DEPARTMENT_ASSIGNED", { assignment: { responsibleDepartment: department, previousResponsibleDepartment: prev?.responsibleDepartment, targetDate } }, row.assignmentEventId);
    }
    if (ownerChanged && ownerId) {
      const row = await ledger("OWNER_ASSIGNED", { kind: "OWNER_ASSIGNED", fromOwnerId: prev?.taskOwnerId ?? null, toOwnerId: ownerId, toOwnerName: ownerName, toDepartment: department });
      await em.emit(
        "TASK_OWNER_ASSIGNED",
        { assignment: { taskOwner: ownerName ?? ownerId, previousTaskOwner: prev?.taskOwnerName ?? prev?.taskOwnerId ?? undefined, taskOwnerId: ownerId, previousTaskOwnerId: prev?.taskOwnerId ?? undefined, responsibleDepartment: department, targetDate } },
        row.assignmentEventId,
      );
    }
    if (change.contributors && !departmentChanged && !ownerChanged) {
      await ledger("CONTRIBUTORS_CHANGED", { kind: "CONTRIBUTORS_CHANGED", note: change.contributors.map((c) => c.userId).join(", ") });
    }
  }
  return { departmentChanged, ownerChanged, ownershipId: ownership.ownershipId };
}

/** Create the 1:1 action-tracking record at approval (NOT_STARTED) and mirror it into the 4A execution state. */
export async function ensureTracking(
  env: OperationEnv,
  candidate: CandidateRow,
  p: { targetStart?: string | Date | null; targetResolution?: string | Date | null; baselineExposure?: number | null; exposureUnit?: string | null },
) {
  const { tx, ctx, actor, at } = env;
  const existing = await tx.iamCoreActionTracking.findUnique({ where: { candidateId: candidate.candidateId } });
  if (existing) return existing;
  const targetStart = toDateOnly(p.targetStart, "targetStart");
  const targetResolution = toDateOnly(p.targetResolution, "targetResolution");
  if (targetStart && targetResolution && targetResolution.getTime() < targetStart.getTime()) {
    throw new DposError("TARGET_DATES_INVALID", "targetResolution must not be before targetStart.", 400);
  }
  const baseline = p.baselineExposure ?? null;
  if (baseline !== null && (typeof baseline !== "number" || !Number.isFinite(baseline) || baseline < 0)) {
    throw new DposError("BASELINE_INVALID", "baselineExposure must be a finite, non-negative number.", 400);
  }
  const tracking = await tx.iamCoreActionTracking.create({
    data: {
      candidateId: candidate.candidateId,
      dposCompanyId: ctx.dposCompanyId,
      actionStatus: "NOT_STARTED" satisfies ActionStatus,
      statusEvaluatedAt: at,
      targetStart,
      targetResolution,
      baselineExposure: baseline,
      exposureUnit: optionalText(p.exposureUnit, "exposureUnit", 500),
      // The condition reduction stays NOT YET MEASURED until a current exposure is reported (never assumed to be 0).
      conditionReductionPct: null,
      conditionReductionStatus: "NOT_YET_MEASURED",
      resolutionStatus: "NOT_YET_MEASURED",
    },
  });
  await tx.iamCoreActionStatusHistory.create({
    data: { candidateId: candidate.candidateId, dposCompanyId: ctx.dposCompanyId, fromStatus: null, toStatus: "NOT_STARTED", trigger: "TRACKING_CREATED", actorId: actor.actorId, at },
  });
  if (baseline !== null) {
    await tx.iamCoreProgressUpdate.create({
      data: { candidateId: candidate.candidateId, dposCompanyId: ctx.dposCompanyId, kind: "BASELINE", official: true, actorId: actor.actorId, actorRole: actor.role, at, priorValueJson: null, newValueJson: toJson({ baselineExposure: baseline, exposureUnit: tracking.exposureUnit }) },
    });
  }
  await syncExecutionState(tx, candidate.candidateId, actor.actorId);
  return tracking;
}

export { addDays, contractStatusOf };
