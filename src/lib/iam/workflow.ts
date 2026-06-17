import { prisma } from "@/lib/db";
import { assertTransition } from "./workflow-states";
import type { ActionWorkflowState } from "./enums";

export async function transitionAction(
  actionId: string,
  toState: ActionWorkflowState,
  opts?: {
    ownerRole?: string;
    ownerName?: string;
    dueDate?: Date;
    reviewDate?: Date;
    changedBy?: string;
  }
) {
  const action = await prisma.action.findUnique({ where: { id: actionId } });
  if (!action) throw new Error("Action not found");

  const from = action.workflowState as ActionWorkflowState;
  if (from === "Archived") {
    throw new Error("Completed or archived actions cannot change state");
  }
  if (from === "Completed" && toState !== "Archived") {
    throw new Error("Completed or archived actions cannot change state");
  }

  assertTransition(from, toState);

  if (from === "Featured" && toState !== "Rejected for Cycle") {
    if (!opts?.ownerRole && !opts?.ownerName && !action.ownerRole && !action.ownerName) {
      throw new Error("Owner required before leaving featured status");
    }
    if (!opts?.dueDate && !opts?.reviewDate && !action.dueDate && !action.reviewDate) {
      throw new Error("Due or review date required before leaving featured status");
    }
  }

  const data: Record<string, unknown> = {
    workflowState: toState,
    rejectedForCycle: toState === "Rejected for Cycle",
  };

  if (toState === "Rejected for Cycle") {
    data.featuredSlot = null;
  }
  if (opts?.ownerRole) data.ownerRole = opts.ownerRole;
  if (opts?.ownerName) data.ownerName = opts.ownerName;
  if (opts?.dueDate) data.dueDate = opts.dueDate;
  if (opts?.reviewDate) data.reviewDate = opts.reviewDate;
  if (toState === "Featured" && !action.firstSurfacedDate) {
    data.firstSurfacedDate = new Date();
  }
  if (toState === "Completed") data.completedDate = new Date();
  if (toState === "Archived") {
    data.archivedDate = new Date();
    await archiveAction(action.id, action.iamRunId);
  }

  const updated = await prisma.action.update({
    where: { id: actionId },
    data,
  });

  await prisma.changeLog.create({
    data: {
      iamRunId: action.iamRunId,
      entityType: "Action",
      entityId: actionId,
      action: `transition:${from}->${toState}`,
      changedBy: opts?.changedBy ?? "pilot-user",
    },
  });

  return updated;
}

async function archiveAction(actionId: string, iamRunId: string) {
  const action = await prisma.action.findUnique({ where: { id: actionId } });
  if (!action || !action.firstSurfacedDate) return;

  await prisma.actionHistoryArchive.upsert({
    where: { actionId },
    create: {
      actionId,
      iamRunId,
      actionTitle: action.actionTitle,
      actionType: action.actionType,
      ownerRoleOrUser: action.ownerRole ?? action.ownerName,
      firstSurfacedDate: action.firstSurfacedDate,
      completedDate: action.completedDate,
      archivedDate: new Date(),
      originalEstimatedImpact: action.originalEstimatedImpact,
      actualAchievedImpact: action.actualAchievedImpact,
    },
    update: {
      archivedDate: new Date(),
      completedDate: action.completedDate,
    },
  });
}

/** Rejected top priorities do not auto-backfill — explicit helper for cycle close */
export async function closeWeeklyCycle(iamRunId: string) {
  const featured = await prisma.action.findMany({
    where: {
      iamRunId,
      workflowState: "Featured",
      priorityCategory: "new_priority",
    },
  });

  for (const action of featured) {
    await transitionAction(action.id, "Holdover", { changedBy: "system-cycle-close" });
  }

  await prisma.iamRun.update({
    where: { id: iamRunId },
    data: { cycleStatus: "Closed" },
  });
}
