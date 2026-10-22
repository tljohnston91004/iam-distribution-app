/**
 * Stage 4B ownership: Responsible Department -> Task Owner -> Contributors, owner acceptance / Request Discussion,
 * reassignment with history, contributor authorization.
 *
 * There is no DPOS Enterprise Sponsor and no owner "decline": an owner who disagrees uses Request Discussion, which keeps
 * the assignment and the plan, records the comment and puts the item in front of management.
 */
import type { PrismaClient } from "@prisma/client";
import { DposError } from "../errors";
import {
  assertWorkflowState,
  currentOwnership,
  isoDate,
  optionalText,
  ownershipFacts,
  raiseDecisionRequired,
  recordDecision,
  requireText,
  resolveDecisionFlags,
  runOperation,
  transition,
  type Ctx,
} from "./internal";
import { applyAssignment, createApprovedPlan, recordAssignmentEvent, type ContributorInput, type PlanInput } from "./shared";
import { requireManagement, requireOwnerOrManager, type WorkflowActor } from "./permissions";
import { ACTION_STATUS_TO_CONTRACT } from "./vocab";

export async function assignDepartment(db: PrismaClient, ctx: Ctx, actor: WorkflowActor, candidateId: string, input: { responsibleDepartment: string; reason?: string; at?: Date }) {
  return runOperation(db, ctx, actor, candidateId, { operation: "DEPARTMENT_ASSIGNED", at: input.at }, async (env) => {
    requireManagement(actor, "Assigning a responsible department");
    assertWorkflowState(env.wf, ["APPROVED_ASSIGNED"], "Assigning a responsible department");
    const prev = await currentOwnership(env.tx, candidateId);
    if (prev) throw new DposError("USE_REASSIGN", "A responsible department is already assigned; use reassign (it records the old and new department and the reason).", 409);
    const tracking = await env.tx.iamCoreActionTracking.findUnique({ where: { candidateId } });
    const r = await applyAssignment(env, { department: requireText(input.responsibleDepartment, "responsibleDepartment", 500) }, { reassignment: false, reason: optionalText(input.reason, "reason"), targetDate: tracking?.targetResolution ?? null });
    return { ownershipId: r.ownershipId };
  });
}

export async function assignOwner(
  db: PrismaClient,
  ctx: Ctx,
  actor: WorkflowActor,
  candidateId: string,
  input: { taskOwnerId: string; taskOwnerName?: string; contributors?: ContributorInput[]; reason?: string; at?: Date },
) {
  return runOperation(db, ctx, actor, candidateId, { operation: "TASK_OWNER_ASSIGNED", at: input.at }, async (env) => {
    requireManagement(actor, "Assigning a task owner");
    assertWorkflowState(env.wf, ["APPROVED_ASSIGNED"], "Assigning a task owner");
    const prev = await currentOwnership(env.tx, candidateId);
    if (!prev) throw new DposError("DEPARTMENT_REQUIRED", "Assign the responsible department before the task owner.", 409);
    if (prev.taskOwnerId) throw new DposError("USE_REASSIGN", "A task owner is already assigned; use reassign.", 409);
    const tracking = await env.tx.iamCoreActionTracking.findUnique({ where: { candidateId } });
    const r = await applyAssignment(
      env,
      { ownerId: requireText(input.taskOwnerId, "taskOwnerId", 500), ownerName: optionalText(input.taskOwnerName, "taskOwnerName", 500), contributors: input.contributors },
      { reassignment: false, reason: optionalText(input.reason, "reason"), targetDate: tracking?.targetResolution ?? null },
    );
    await transition(env.tx, env.wf, "PENDING_OWNER_ACCEPTANCE", { operation: "OWNER_ASSIGNED", actor, at: env.at, reason: optionalText(input.reason, "reason") });
    return { ownershipId: r.ownershipId };
  });
}

/** The assigned owner (or an authorized manager on the owner's behalf) accepts the action: the Active Action begins. */
export async function acceptOwnership(db: PrismaClient, ctx: Ctx, actor: WorkflowActor, candidateId: string, input: { note?: string; at?: Date } = {}) {
  return runOperation(db, ctx, actor, candidateId, { operation: "OWNER_ACCEPTED", at: input.at }, async (env) => {
    const { tx, wf, em, at } = env;
    assertWorkflowState(wf, ["PENDING_OWNER_ACCEPTANCE"], "Accepting ownership");
    const { ownership, facts } = await ownershipFacts(tx, candidateId);
    if (!ownership?.taskOwnerId) throw new DposError("OWNER_REQUIRED", "No task owner is assigned.", 409);
    const { onBehalf } = requireOwnerOrManager(actor, facts, "Accepting ownership");
    const note = optionalText(input.note, "note");
    const row = await recordAssignmentEvent(env, candidateId, { kind: "OWNER_ACCEPTED", toOwnerId: ownership.taskOwnerId, toOwnerName: ownership.taskOwnerName, toDepartment: ownership.responsibleDepartment, note, onBehalf });
    await resolveDecisionFlags(tx, candidateId, ["OWNER_DISCUSSION"], actor.actorId, "Owner accepted the assignment.", at);
    await transition(tx, wf, "ACTIVE_ACTION", { operation: "OWNER_ACCEPTED", actor, at, reason: note, detail: { onBehalf } });
    await em.emit(
      "OWNER_ACCEPTED",
      {
        assignment: { taskOwner: ownership.taskOwnerName ?? ownership.taskOwnerId, taskOwnerId: ownership.taskOwnerId, responsibleDepartment: ownership.responsibleDepartment, ownerResponseAt: at.toISOString() },
        // Accepted but not begun: NOT_STARTED is a governed status (4B-D3), never null.
        progress: { actionStatus: ACTION_STATUS_TO_CONTRACT.NOT_STARTED },
      },
      row.assignmentEventId,
    );
    return { assignmentEventId: row.assignmentEventId, onBehalf };
  });
}

/**
 * Request Discussion: keeps the assignment and the plan, records the owner's comments, and surfaces the item for management
 * attention (Management Decision Required: unresolved owner discussion).
 */
export async function requestDiscussion(db: PrismaClient, ctx: Ctx, actor: WorkflowActor, candidateId: string, input: { note: string; at?: Date }) {
  return runOperation(db, ctx, actor, candidateId, { operation: "OWNER_DISCUSSION_REQUESTED", at: input.at }, async (env) => {
    const { tx, wf, em, at } = env;
    assertWorkflowState(wf, ["PENDING_OWNER_ACCEPTANCE", "ACTIVE_ACTION"], "Requesting discussion");
    const { ownership, facts } = await ownershipFacts(tx, candidateId);
    if (!ownership?.taskOwnerId) throw new DposError("OWNER_REQUIRED", "No task owner is assigned.", 409);
    const { onBehalf } = requireOwnerOrManager(actor, facts, "Requesting discussion");
    const note = requireText(input.note, "A discussion note");
    const row = await recordAssignmentEvent(env, candidateId, { kind: "OWNER_DISCUSSION_REQUESTED", toOwnerId: ownership.taskOwnerId, toOwnerName: ownership.taskOwnerName, toDepartment: ownership.responsibleDepartment, note, onBehalf });
    await em.emit("OWNER_DISCUSSION_REQUESTED", { assignment: { taskOwner: ownership.taskOwnerName ?? ownership.taskOwnerId, taskOwnerId: ownership.taskOwnerId, discussionNote: note } }, row.assignmentEventId);
    const flag = await raiseDecisionRequired(env, candidateId, "OWNER_DISCUSSION", note, row.assignmentEventId);
    return { assignmentEventId: row.assignmentEventId, decisionRequiredRaised: flag.raised, flagId: flag.flagId, assignmentKept: true };
  });
}

/** Owners cannot simply decline. Always refused; the response names the supported path. */
export async function declineOwnership(_db: PrismaClient, _ctx: Ctx, _actor: WorkflowActor, _candidateId: string): Promise<never> {
  throw new DposError(
    "OWNER_DECLINE_NOT_PERMITTED",
    "A task owner cannot simply decline an assignment. Use Request Discussion: the assignment and plan are kept, your comments are recorded and management is asked to review.",
    409,
  );
}

export interface ReassignInput {
  reason: string;
  toDepartment?: string;
  toOwnerId?: string;
  toOwnerName?: string;
  contributors?: ContributorInput[];
  /** When the plan materially changes, a new approved plan VERSION is stored (the previous version is superseded). */
  planChange?: PlanInput;
  at?: Date;
}

export async function reassign(db: PrismaClient, ctx: Ctx, actor: WorkflowActor, candidateId: string, input: ReassignInput) {
  return runOperation(db, ctx, actor, candidateId, { operation: "REASSIGNED", at: input.at }, async (env) => {
    const { tx, wf, candidate, at } = env;
    requireManagement(actor, "Reassigning");
    const reason = requireText(input.reason, "A reassignment reason");
    assertWorkflowState(wf, ["APPROVED_ASSIGNED", "PENDING_OWNER_ACCEPTANCE", "ACTIVE_ACTION"], "Reassigning");
    const prev = await currentOwnership(tx, candidateId);
    if (!prev) throw new DposError("DEPARTMENT_REQUIRED", "Nothing is assigned yet; use assignDepartment / assignOwner.", 409);
    if (!input.toDepartment && !input.toOwnerId && !input.contributors && !input.planChange) {
      throw new DposError("NOTHING_TO_ASSIGN", "Name the new department, the new task owner, contributors or a plan change.", 400);
    }
    const planBefore = await tx.iamCoreManagementPlan.findFirst({ where: { candidateId, approvalState: "APPROVED" }, orderBy: { planVersion: "desc" } });
    // Stage 4E (plan-revision coverage): a change of the RESPONSIBLE DEPARTMENT is a material plan change even when no new plan text is
    // supplied. It carries the approved plan forward as a NEW version (the old version is superseded, never edited), records the actor and
    // reason, and emits PLAN_REVISED like every other material plan revision. A change of task owner or contributors alone is an
    // assignment change (recorded in the assignment ledger) and is not a plan revision.
    const departmentWillChange = !!input.toDepartment && input.toDepartment.trim() !== prev.responsibleDepartment;
    let planChange: PlanInput | undefined = input.planChange;
    if (!planChange && departmentWillChange && planBefore) {
      const before = JSON.parse(planBefore.planJson ?? "{}") as { actionDirection?: string | null; detail?: unknown };
      planChange = {
        summary: planBefore.planSummary ?? "Approved plan (carried forward)",
        ...(before.actionDirection ? { actionDirection: before.actionDirection } : {}),
        ...(before.detail !== undefined && before.detail !== null ? { detail: before.detail } : {}),
        deviatesFromRecommendation: planBefore.deviatesFromRecommendation,
        ...(planBefore.deviationReason ? { deviationReason: planBefore.deviationReason } : {}),
      };
    }
    let planAfterVersion: number | null = planBefore?.planVersion ?? null;
    let planId: string | null = planBefore?.planId ?? null;
    if (planChange) {
      const created = await createApprovedPlan(env, candidateId, planChange);
      planAfterVersion = created.plan.planVersion;
      planId = created.plan.planId;
    }
    const tracking = await tx.iamCoreActionTracking.findUnique({ where: { candidateId } });
    const hasOwnershipChange = !!(input.toDepartment || input.toOwnerId || input.contributors);
    let departmentChanged = false;
    let ownerChanged = false;
    if (hasOwnershipChange) {
      const r = await applyAssignment(
        env,
        {
          department: input.toDepartment ? requireText(input.toDepartment, "toDepartment", 500) : undefined,
          ownerId: input.toOwnerId ? requireText(input.toOwnerId, "toOwnerId", 500) : undefined,
          ownerName: input.toOwnerId ? optionalText(input.toOwnerName, "toOwnerName", 500) : undefined,
          contributors: input.contributors,
        },
        { reassignment: true, reason, planVersionBefore: planBefore?.planVersion ?? null, planVersionAfter: planAfterVersion, targetDate: tracking?.targetResolution ?? null },
      );
      departmentChanged = r.departmentChanged;
      ownerChanged = r.ownerChanged;
    } else {
      await recordAssignmentEvent(env, candidateId, { kind: "REASSIGNED", reason, note: "Plan revised without a change of ownership.", planVersionBefore: planBefore?.planVersion ?? null, planVersionAfter: planAfterVersion });
    }
    if (ownerChanged) {
      await resolveDecisionFlags(tx, candidateId, ["OWNER_DISCUSSION"], actor.actorId, "The task owner was reassigned.", at);
    }
    const decision = await recordDecision(tx, ctx, candidateId, {
      decisionType: planChange ? "PLAN_REVISED" : "REASSIGN",
      reason,
      at,
      actor,
      groupedConditionKey: candidate.groupedConditionKey,
      planId,
      planVersion: planAfterVersion,
      detail: { departmentChanged, ownerChanged, from: { department: prev.responsibleDepartment, ownerId: prev.taskOwnerId }, targetDate: isoDate(tracking?.targetResolution ?? null) },
    });
    if (planChange) {
      // Dedicated governance event (4C-D6): a plan revision is never buried in a generic status or assignment change.
      await env.em.emit(
        "PLAN_REVISED",
        {
          plan: {
            planVersion: planAfterVersion ?? undefined,
            previousPlanVersion: planBefore?.planVersion ?? undefined,
            revisionReason: reason,
            revisedBy: actor.actorId,
            revisedAt: at.toISOString(),
            approvedPlanRef: planId ?? undefined,
            approvedPlanStatus: "APPROVED",
          },
        },
        planId ?? decision.decisionId,
      );
    }
    return { decisionId: decision.decisionId, departmentChanged, ownerChanged, planVersion: planAfterVersion, planRevised: !!planChange };
  });
}

/** Replace the contributor list (primary owner or manager). Owner and department are unchanged; history is recorded. */
export async function setContributors(db: PrismaClient, ctx: Ctx, actor: WorkflowActor, candidateId: string, input: { contributors: ContributorInput[]; at?: Date }) {
  return runOperation(db, ctx, actor, candidateId, { operation: "CONTRIBUTORS_CHANGED", at: input.at }, async (env) => {
    assertWorkflowState(env.wf, ["APPROVED_ASSIGNED", "PENDING_OWNER_ACCEPTANCE", "ACTIVE_ACTION"], "Changing contributors");
    const { facts } = await ownershipFacts(env.tx, candidateId);
    requireOwnerOrManager(actor, facts, "Changing contributors");
    const tracking = await env.tx.iamCoreActionTracking.findUnique({ where: { candidateId } });
    const r = await applyAssignment(env, { contributors: input.contributors }, { reassignment: false, targetDate: tracking?.targetResolution ?? null });
    return { ownershipId: r.ownershipId };
  });
}

/** Management explicitly lets a LISTED contributor write official progress values (default: notes and evidence only). */
export async function authorizeContributor(db: PrismaClient, ctx: Ctx, actor: WorkflowActor, candidateId: string, input: { userId: string; reason: string; at?: Date }) {
  return runOperation(db, ctx, actor, candidateId, { operation: "CONTRIBUTOR_AUTHORIZED", at: input.at }, async (env) => {
    requireManagement(actor, "Authorizing a contributor");
    const reason = requireText(input.reason, "An authorization reason");
    const userId = requireText(input.userId, "userId", 500);
    const { facts } = await ownershipFacts(env.tx, candidateId);
    if (!facts.contributorIds.includes(userId)) throw new DposError("CONTRIBUTOR_NOT_LISTED", "Only a listed contributor can be authorized.", 409);
    const existing = await env.tx.iamCoreContributorAuthorization.findFirst({ where: { candidateId, userId, revokedAt: null } });
    if (existing) throw new DposError("CONTRIBUTOR_ALREADY_AUTHORIZED", "This contributor is already authorized.", 409);
    const auth = await env.tx.iamCoreContributorAuthorization.create({ data: { candidateId, userId, grantedBy: actor.actorId, grantedAt: env.at, reason } });
    await recordAssignmentEvent(env, candidateId, { kind: "CONTRIBUTOR_AUTHORIZED", toOwnerId: userId, reason });
    return { authorizationId: auth.authorizationId };
  });
}

export async function revokeContributorAuthorization(db: PrismaClient, ctx: Ctx, actor: WorkflowActor, candidateId: string, input: { userId: string; reason: string; at?: Date }) {
  return runOperation(db, ctx, actor, candidateId, { operation: "CONTRIBUTOR_AUTHORIZATION_REVOKED", at: input.at }, async (env) => {
    requireManagement(actor, "Revoking a contributor authorization");
    const reason = requireText(input.reason, "A revocation reason");
    const userId = requireText(input.userId, "userId", 500);
    const existing = await env.tx.iamCoreContributorAuthorization.findFirst({ where: { candidateId, userId, revokedAt: null } });
    if (!existing) throw new DposError("CONTRIBUTOR_NOT_AUTHORIZED", "This contributor holds no authorization.", 404);
    await env.tx.iamCoreContributorAuthorization.update({ where: { authorizationId: existing.authorizationId }, data: { revokedAt: env.at, revokedBy: actor.actorId } });
    await recordAssignmentEvent(env, candidateId, { kind: "CONTRIBUTOR_AUTHORIZATION_REVOKED", toOwnerId: userId, reason });
    return { authorizationId: existing.authorizationId };
  });
}
