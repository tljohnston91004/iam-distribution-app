/**
 * Recommendation lifecycle & governance engine (Phase 3 + Closure).
 * ADR-IAM-001: Core-owned; no Keystroke/adapter imports.
 *
 * Atomicity (DF-02): validate fully, then commit LS + workflow + audit + governance
 * in one transaction — or write only a rejection audit (DF-01) and throw.
 */

import { prisma } from "@/lib/db";
import {
  LS,
  isLifecycleState,
  type LifecycleState,
  NON_LIFECYCLE_OUTCOMES,
} from "./states";
import { assertLifecycleTransition, LifecycleTransitionError } from "./transitions";

export type GovernanceDecisionType =
  | "Approve"
  | "Reject"
  | "Defer"
  | "ReactivateFromDefer"
  | "Pause"
  | "Escalate"
  | "OutcomeValidationPass"
  | "Assign"
  | "Accept"
  | "Resume"
  | "PresentForReview"
  | "StartAssignment"
  | "Complete"
  | "StartOutcomeValidation"
  | "Archive"
  | "LockCycle"
  /** Deferred outside Phase 3 (DF-04) — not implemented. */
  | "UnlockCycle";

type GovernanceWrite = {
  decisionType: GovernanceDecisionType;
  reason?: string | null;
  detail?: Record<string, unknown>;
};

function parseState(raw: string): LifecycleState {
  if (NON_LIFECYCLE_OUTCOMES.includes(raw as (typeof NON_LIFECYCLE_OUTCOMES)[number])) {
    throw new LifecycleTransitionError(
      `"${raw}" is not a lifecycle state (governance outcome / presentation lane)`,
      "VALIDATION"
    );
  }
  if (!isLifecycleState(raw)) {
    throw new LifecycleTransitionError(`Unknown lifecycle state: ${raw}`, "VALIDATION");
  }
  return raw;
}

async function assertCycleOpen(iamRunId: string) {
  const run = await prisma.iamRun.findUnique({ where: { id: iamRunId } });
  if (!run) throw new LifecycleTransitionError("Review cycle not found", "NOT_FOUND");
  if (run.cycleLockedAt || run.cycleStatus === "Locked" || run.cycleStatus === "Closed") {
    throw new LifecycleTransitionError(
      `Review cycle is ${run.cycleStatus === "Closed" ? "closed" : "locked"}; governed transitions are not allowed`,
      "CYCLE_LOCKED"
    );
  }
  return run;
}

async function assertNoBlockingOutcome(recommendationId: string) {
  // Reject always blocks. Defer blocks only while active (not superseded by ReactivateFromDefer).
  const latestRejectOrDefer = await prisma.governanceDecision.findFirst({
    where: {
      recommendationId,
      decisionType: { in: ["Reject", "Defer", "ReactivateFromDefer"] },
    },
    orderBy: { performedAt: "desc" },
  });
  if (!latestRejectOrDefer) return;
  if (latestRejectOrDefer.decisionType === "ReactivateFromDefer") return;
  throw new LifecycleTransitionError(
    `Recommendation has governance outcome ${latestRejectOrDefer.decisionType}; further lifecycle transitions are blocked this cycle`,
    "GOVERNANCE_BLOCK"
  );
}

/** DF-01: persist rejected transition attempts when a Review Cycle context exists. */
async function auditRejection(opts: {
  iamRunId?: string | null;
  recommendationId: string;
  performedBy: string;
  fromState?: string | null;
  requestedToState?: string | null;
  action?: string | null;
  reason: string;
  code: string;
}) {
  if (!opts.iamRunId) return;
  try {
    await prisma.auditEvent.create({
      data: {
        iamRunId: opts.iamRunId,
        entityType: "Recommendation",
        entityId: opts.recommendationId,
        action: "lifecycle:rejected",
        performedBy: opts.performedBy,
        detailJson: JSON.stringify({
          timestamp: new Date().toISOString(),
          requestingUser: opts.performedBy,
          fromState: opts.fromState ?? null,
          requestedTransition: opts.requestedToState
            ? `${opts.fromState ?? "?"}→${opts.requestedToState}`
            : opts.action ?? null,
          rejectionReason: opts.reason,
          code: opts.code,
        }),
      },
    });
  } catch {
    // Never mask the original lifecycle error if audit write fails.
  }
}

async function rejectAndThrow(
  err: LifecycleTransitionError,
  ctx: {
    iamRunId?: string | null;
    recommendationId: string;
    performedBy: string;
    fromState?: string | null;
    requestedToState?: string | null;
    action?: string | null;
  }
): Promise<never> {
  await auditRejection({
    iamRunId: ctx.iamRunId,
    recommendationId: ctx.recommendationId,
    performedBy: ctx.performedBy,
    fromState: ctx.fromState,
    requestedToState: ctx.requestedToState,
    action: ctx.action,
    reason: err.message,
    code: err.code,
  });
  throw err;
}

/**
 * Validate all LS gates without writing. Throws LifecycleTransitionError on failure.
 */
async function validateLifecycleMove(opts: {
  recommendationId: string;
  toState: LifecycleState;
  reason?: string | null;
  skipGovernanceBlockCheck?: boolean;
}): Promise<{
  iamRunId: string;
  from: LifecycleState;
  to: LifecycleState;
}> {
  const rec = await prisma.recommendation.findUnique({ where: { id: opts.recommendationId } });
  if (!rec) throw new LifecycleTransitionError("Recommendation not found", "NOT_FOUND");

  await assertCycleOpen(rec.iamRunId);
  if (!opts.skipGovernanceBlockCheck) {
    await assertNoBlockingOutcome(rec.id);
  }

  const from = parseState(rec.lifecycleState);
  const to = opts.toState;
  assertLifecycleTransition(from, to);

  if (from === LS.LS_05 && to === LS.LS_06) {
    const assignment = await prisma.recommendationAssignment.findFirst({
      where: { recommendationId: rec.id, active: true },
    });
    if (!assignment?.accepted) {
      throw new LifecycleTransitionError(
        "Primary Owner acceptance is required before Active (IAM-007B)",
        "VALIDATION"
      );
    }
  }

  if (from === LS.LS_04 && to === LS.LS_05) {
    const assignment = await prisma.recommendationAssignment.findFirst({
      where: { recommendationId: rec.id, active: true },
    });
    if (!assignment) {
      throw new LifecycleTransitionError(
        "Primary Owner must be assigned before Awaiting Acceptance",
        "VALIDATION"
      );
    }
  }

  if (to === LS.LS_07 && !opts.reason?.trim()) {
    throw new LifecycleTransitionError("Pause requires documented justification", "VALIDATION");
  }
  if (to === LS.LS_08 && !opts.reason?.trim()) {
    throw new LifecycleTransitionError("Escalate requires documented justification", "VALIDATION");
  }

  return { iamRunId: rec.iamRunId, from, to };
}

/**
 * Atomic LS commit (DF-02): recommendation state + workflow + success audit + optional governance.
 */
async function commitLifecycleMove(opts: {
  recommendationId: string;
  toState: LifecycleState;
  performedBy: string;
  reason?: string | null;
  governance?: GovernanceWrite;
  skipGovernanceBlockCheck?: boolean;
  actionLabel?: string;
}) {
  const performedBy = opts.performedBy;
  let validated: { iamRunId: string; from: LifecycleState; to: LifecycleState };
  try {
    validated = await validateLifecycleMove({
      recommendationId: opts.recommendationId,
      toState: opts.toState,
      reason: opts.reason,
      skipGovernanceBlockCheck: opts.skipGovernanceBlockCheck,
    });
  } catch (e) {
    if (e instanceof LifecycleTransitionError) {
      const rec = await prisma.recommendation.findUnique({
        where: { id: opts.recommendationId },
      });
      await rejectAndThrow(e, {
        iamRunId: rec?.iamRunId,
        recommendationId: opts.recommendationId,
        performedBy,
        fromState: rec?.lifecycleState,
        requestedToState: opts.toState,
        action: opts.actionLabel ?? `transition→${opts.toState}`,
      });
    }
    throw e;
  }

  const { iamRunId, from, to } = validated;

  const updated = await prisma.$transaction(async (tx) => {
    const row = await tx.recommendation.update({
      where: { id: opts.recommendationId },
      data: { lifecycleState: to },
    });
    await tx.workflowEvent.create({
      data: {
        iamRunId,
        recommendationId: opts.recommendationId,
        fromState: from,
        toState: to,
        performedBy,
        reason: opts.reason ?? null,
      },
    });
    await tx.auditEvent.create({
      data: {
        iamRunId,
        entityType: "Recommendation",
        entityId: opts.recommendationId,
        action: `lifecycle:${from}->${to}`,
        performedBy,
        detailJson: JSON.stringify({ from, to, reason: opts.reason ?? null }),
      },
    });
    if (opts.governance) {
      await tx.governanceDecision.create({
        data: {
          iamRunId,
          recommendationId: opts.recommendationId,
          decisionType: opts.governance.decisionType,
          reason: opts.governance.reason ?? opts.reason ?? null,
          performedBy,
          detailJson: opts.governance.detail
            ? JSON.stringify(opts.governance.detail)
            : null,
        },
      });
    }
    return row;
  });

  return updated;
}

/** Internal/engine use — always validates through the same gates; not exposed as raw HTTP. */
export async function transitionRecommendation(opts: {
  recommendationId: string;
  toState: LifecycleState;
  performedBy?: string;
  reason?: string | null;
  skipGovernanceBlockCheck?: boolean;
  governance?: GovernanceWrite;
  actionLabel?: string;
}) {
  return commitLifecycleMove({
    recommendationId: opts.recommendationId,
    toState: opts.toState,
    performedBy: opts.performedBy ?? "pilot-user",
    reason: opts.reason,
    skipGovernanceBlockCheck: opts.skipGovernanceBlockCheck,
    governance: opts.governance,
    actionLabel: opts.actionLabel,
  });
}

export async function presentForReview(recommendationId: string, performedBy?: string) {
  const actor = performedBy ?? "pilot-user";
  const existing = await prisma.recommendation.findUnique({ where: { id: recommendationId } });
  if (!existing) {
    await rejectAndThrow(new LifecycleTransitionError("Recommendation not found", "NOT_FOUND"), {
      recommendationId,
      performedBy: actor,
      action: "present_for_review",
    });
  }
  // Idempotent: already in Management Review is success (avoids confusing UI double-click errors).
  if (parseState(existing.lifecycleState) === LS.LS_02) {
    return existing;
  }
  return commitLifecycleMove({
    recommendationId,
    toState: LS.LS_02,
    performedBy: actor,
    governance: { decisionType: "PresentForReview" },
    actionLabel: "present_for_review",
  });
}

export async function approveRecommendation(
  recommendationId: string,
  opts?: { performedBy?: string; reason?: string }
) {
  const performedBy = opts?.performedBy ?? "pilot-user";
  const rec = await prisma.recommendation.findUnique({ where: { id: recommendationId } });
  if (!rec) {
    await rejectAndThrow(new LifecycleTransitionError("Recommendation not found", "NOT_FOUND"), {
      recommendationId,
      performedBy,
      action: "approve",
    });
  }
  try {
    await assertCycleOpen(rec.iamRunId);
    await assertNoBlockingOutcome(rec.id);
    if (parseState(rec.lifecycleState) !== LS.LS_02) {
      throw new LifecycleTransitionError("Approve is only valid from Management Review", "VALIDATION");
    }
  } catch (e) {
    if (e instanceof LifecycleTransitionError) {
      await rejectAndThrow(e, {
        iamRunId: rec.iamRunId,
        recommendationId,
        performedBy,
        fromState: rec.lifecycleState,
        requestedToState: LS.LS_03,
        action: "approve",
      });
    }
    throw e;
  }

  return commitLifecycleMove({
    recommendationId,
    toState: LS.LS_03,
    performedBy,
    reason: opts?.reason,
    governance: { decisionType: "Approve", reason: opts?.reason },
    actionLabel: "approve",
  });
}

export async function deferRecommendation(
  recommendationId: string,
  opts: { performedBy?: string; reason: string }
) {
  const performedBy = opts.performedBy ?? "pilot-user";
  if (!opts.reason?.trim()) {
    const rec = await prisma.recommendation.findUnique({ where: { id: recommendationId } });
    await rejectAndThrow(new LifecycleTransitionError("Defer requires a reason", "VALIDATION"), {
      iamRunId: rec?.iamRunId,
      recommendationId,
      performedBy,
      fromState: rec?.lifecycleState,
      action: "defer",
    });
  }

  const rec = await prisma.recommendation.findUnique({ where: { id: recommendationId } });
  if (!rec) {
    await rejectAndThrow(new LifecycleTransitionError("Recommendation not found", "NOT_FOUND"), {
      recommendationId,
      performedBy,
      action: "defer",
    });
  }

  try {
    await assertCycleOpen(rec.iamRunId);
    if (parseState(rec.lifecycleState) !== LS.LS_02) {
      throw new LifecycleTransitionError("Defer is only valid from Management Review", "VALIDATION");
    }
  } catch (e) {
    if (e instanceof LifecycleTransitionError) {
      await rejectAndThrow(e, {
        iamRunId: rec.iamRunId,
        recommendationId,
        performedBy,
        fromState: rec.lifecycleState,
        action: "defer",
      });
    }
    throw e;
  }

  // No LS change — governance + audit + deferred Board lane (V1.5 presentation rule).
  // Priority Score / evidence / audit history retained. Re-assign lanes without rescoring.
  const decision = await prisma.$transaction(async (tx) => {
    await tx.recommendation.update({
      where: { id: recommendationId },
      data: { presentationCategory: "deferred", presentationRank: null },
    });
    const d = await tx.governanceDecision.create({
      data: {
        iamRunId: rec.iamRunId,
        recommendationId,
        decisionType: "Defer",
        reason: opts.reason,
        performedBy,
        detailJson: JSON.stringify({
          lifecycleUnchanged: rec.lifecycleState,
          presentationCategory: "deferred",
          note:
            "Deferred is a governance outcome, not a lifecycle state. V1.5: visible in Deferred Board section; does not compete for Top 2 while Defer is active. Reactivate via ReactivateFromDefer.",
        }),
      },
    });
    await tx.auditEvent.create({
      data: {
        iamRunId: rec.iamRunId,
        entityType: "Recommendation",
        entityId: recommendationId,
        action: "governance:Defer",
        performedBy,
        detailJson: JSON.stringify({
          reason: opts.reason,
          lifecycleState: rec.lifecycleState,
          presentationCategory: "deferred",
        }),
      },
    });
    return d;
  });

  const { assignPresentation } = await import("@/lib/iam/presentation");
  const lanes = await assignPresentation(rec.iamRunId);

  const updated = await prisma.recommendation.findUnique({ where: { id: recommendationId } });
  return {
    recommendation: updated ?? rec,
    decision,
    lifecycleState: rec.lifecycleState,
    presentationCategory: updated?.presentationCategory ?? "deferred",
    lanes,
  };
}

/**
 * Reactivate a Deferred Recommendation for normal Board ranking (V1.5 product rule).
 * Does not recalculate Priority Score unless the caller separately re-scores after data changes.
 * Clears active Defer (ReactivateFromDefer) and re-assigns presentation lanes.
 */
export async function reactivateDeferredRecommendation(
  recommendationId: string,
  opts?: { performedBy?: string; reason?: string }
) {
  const performedBy = opts?.performedBy ?? "pilot-user";
  const rec = await prisma.recommendation.findUnique({ where: { id: recommendationId } });
  if (!rec) {
    await rejectAndThrow(new LifecycleTransitionError("Recommendation not found", "NOT_FOUND"), {
      recommendationId,
      performedBy,
      action: "reactivate_defer",
    });
  }

  try {
    await assertCycleOpen(rec.iamRunId);
  } catch (e) {
    if (e instanceof LifecycleTransitionError) {
      await rejectAndThrow(e, {
        iamRunId: rec.iamRunId,
        recommendationId,
        performedBy,
        fromState: rec.lifecycleState,
        action: "reactivate_defer",
      });
    }
    throw e;
  }

  const { isDeferActive } = await import("@/lib/iam/presentation");
  if (!(await isDeferActive(recommendationId))) {
    await rejectAndThrow(
      new LifecycleTransitionError("Recommendation does not have an active Defer", "VALIDATION"),
      {
        iamRunId: rec.iamRunId,
        recommendationId,
        performedBy,
        fromState: rec.lifecycleState,
        action: "reactivate_defer",
      }
    );
  }

  const priorScore = rec.priorityScore;

  const decision = await prisma.$transaction(async (tx) => {
    const d = await tx.governanceDecision.create({
      data: {
        iamRunId: rec.iamRunId,
        recommendationId,
        decisionType: "ReactivateFromDefer",
        reason: opts?.reason ?? "Management reactivation",
        performedBy,
        detailJson: JSON.stringify({
          lifecycleUnchanged: rec.lifecycleState,
          priorityScoreRetained: priorScore,
          note: "Eligible for Top 2 / backlog ranking without recalculation unless Recommendation data changed.",
        }),
      },
    });
    await tx.auditEvent.create({
      data: {
        iamRunId: rec.iamRunId,
        entityType: "Recommendation",
        entityId: recommendationId,
        action: "governance:ReactivateFromDefer",
        performedBy,
        detailJson: JSON.stringify({
          priorityScoreRetained: priorScore,
          lifecycleState: rec.lifecycleState,
        }),
      },
    });
    return d;
  });

  const { assignPresentation } = await import("@/lib/iam/presentation");
  const lanes = await assignPresentation(rec.iamRunId);
  const updated = await prisma.recommendation.findUnique({ where: { id: recommendationId } });

  return {
    recommendation: updated ?? rec,
    decision,
    lifecycleState: rec.lifecycleState,
    priorityScore: updated?.priorityScore ?? priorScore,
    presentationCategory: updated?.presentationCategory,
    lanes,
  };
}

export async function rejectRecommendation(
  recommendationId: string,
  opts: { performedBy?: string; reason: string }
) {
  const performedBy = opts.performedBy ?? "pilot-user";
  if (!opts.reason?.trim()) {
    const rec0 = await prisma.recommendation.findUnique({ where: { id: recommendationId } });
    await rejectAndThrow(new LifecycleTransitionError("Reject requires a reason", "VALIDATION"), {
      iamRunId: rec0?.iamRunId,
      recommendationId,
      performedBy,
      fromState: rec0?.lifecycleState,
      action: "reject",
    });
  }

  const rec = await prisma.recommendation.findUnique({ where: { id: recommendationId } });
  if (!rec) {
    await rejectAndThrow(new LifecycleTransitionError("Recommendation not found", "NOT_FOUND"), {
      recommendationId,
      performedBy,
      action: "reject",
    });
  }

  try {
    await assertCycleOpen(rec.iamRunId);
    if (parseState(rec.lifecycleState) !== LS.LS_02) {
      throw new LifecycleTransitionError("Reject is only valid from Management Review", "VALIDATION");
    }
  } catch (e) {
    if (e instanceof LifecycleTransitionError) {
      await rejectAndThrow(e, {
        iamRunId: rec.iamRunId,
        recommendationId,
        performedBy,
        fromState: rec.lifecycleState,
        action: "reject",
      });
    }
    throw e;
  }

  const decision = await prisma.$transaction(async (tx) => {
    await tx.recommendation.update({
      where: { id: recommendationId },
      data: { presentationCategory: "completed_presentation" },
    });
    const d = await tx.governanceDecision.create({
      data: {
        iamRunId: rec.iamRunId,
        recommendationId,
        decisionType: "Reject",
        reason: opts.reason,
        performedBy,
        detailJson: JSON.stringify({
          lifecycleUnchanged: rec.lifecycleState,
          note: "Rejected is a governance outcome, not a lifecycle state.",
        }),
      },
    });
    await tx.auditEvent.create({
      data: {
        iamRunId: rec.iamRunId,
        entityType: "Recommendation",
        entityId: recommendationId,
        action: "governance:Reject",
        performedBy,
        detailJson: JSON.stringify({ reason: opts.reason, lifecycleState: rec.lifecycleState }),
      },
    });
    return d;
  });

  return { recommendation: rec, decision, lifecycleState: rec.lifecycleState };
}

export async function startAssignment(recommendationId: string, performedBy?: string) {
  return commitLifecycleMove({
    recommendationId,
    toState: LS.LS_04,
    performedBy: performedBy ?? "pilot-user",
    governance: { decisionType: "StartAssignment" },
    actionLabel: "start_assignment",
  });
}

export async function assignPrimaryOwner(
  recommendationId: string,
  opts: {
    primaryOwnerUserId: string;
    primaryOwnerName?: string;
    performedBy?: string;
  }
) {
  const performedBy = opts.performedBy ?? "pilot-user";
  if (!opts.primaryOwnerUserId?.trim()) {
    const rec0 = await prisma.recommendation.findUnique({ where: { id: recommendationId } });
    await rejectAndThrow(
      new LifecycleTransitionError("primaryOwnerUserId is required", "VALIDATION"),
      {
        iamRunId: rec0?.iamRunId,
        recommendationId,
        performedBy,
        fromState: rec0?.lifecycleState,
        action: "assign",
      }
    );
  }

  const rec = await prisma.recommendation.findUnique({ where: { id: recommendationId } });
  if (!rec) {
    await rejectAndThrow(new LifecycleTransitionError("Recommendation not found", "NOT_FOUND"), {
      recommendationId,
      performedBy,
      action: "assign",
    });
  }

  try {
    await assertCycleOpen(rec.iamRunId);
    await assertNoBlockingOutcome(rec.id);
    const state = parseState(rec.lifecycleState);
    if (state !== LS.LS_03 && state !== LS.LS_04 && state !== LS.LS_05) {
      throw new LifecycleTransitionError(
        "Assignment is only valid from Approved, Assignment Pending, or Awaiting Acceptance",
        "VALIDATION"
      );
    }
  } catch (e) {
    if (e instanceof LifecycleTransitionError) {
      await rejectAndThrow(e, {
        iamRunId: rec.iamRunId,
        recommendationId,
        performedBy,
        fromState: rec.lifecycleState,
        action: "assign",
      });
    }
    throw e;
  }

  if (parseState(rec.lifecycleState) === LS.LS_03) {
    await commitLifecycleMove({
      recommendationId,
      toState: LS.LS_04,
      performedBy,
      actionLabel: "assign:to_assignment_pending",
    });
  }

  const assignment = await prisma.$transaction(async (tx) => {
    await tx.recommendationAssignment.updateMany({
      where: { recommendationId, active: true },
      data: { active: false },
    });
    const created = await tx.recommendationAssignment.create({
      data: {
        recommendationId,
        primaryOwnerUserId: opts.primaryOwnerUserId,
        primaryOwnerName: opts.primaryOwnerName ?? null,
        accepted: false,
        active: true,
      },
    });
    await tx.recommendationAssignmentHistory.create({
      data: {
        recommendationId,
        eventType: "assigned",
        primaryOwnerUserId: opts.primaryOwnerUserId,
        primaryOwnerName: opts.primaryOwnerName ?? null,
        performedBy,
      },
    });
    await tx.governanceDecision.create({
      data: {
        iamRunId: rec.iamRunId,
        recommendationId,
        decisionType: "Assign",
        performedBy,
        detailJson: JSON.stringify({ primaryOwnerUserId: opts.primaryOwnerUserId }),
      },
    });
    await tx.auditEvent.create({
      data: {
        iamRunId: rec.iamRunId,
        entityType: "Recommendation",
        entityId: recommendationId,
        action: "assignment:assign",
        performedBy,
        detailJson: JSON.stringify({ primaryOwnerUserId: opts.primaryOwnerUserId }),
      },
    });
    return created;
  });

  const current = await prisma.recommendation.findUnique({ where: { id: recommendationId } });
  if (current && parseState(current.lifecycleState) === LS.LS_04) {
    await commitLifecycleMove({
      recommendationId,
      toState: LS.LS_05,
      performedBy,
      actionLabel: "assign:to_awaiting_acceptance",
    });
  }

  return assignment;
}

export async function acceptAssignment(
  recommendationId: string,
  opts?: { performedBy?: string; ownerUserId?: string }
) {
  const performedBy = opts?.performedBy ?? "pilot-user";
  const rec = await prisma.recommendation.findUnique({ where: { id: recommendationId } });
  if (!rec) {
    await rejectAndThrow(new LifecycleTransitionError("Recommendation not found", "NOT_FOUND"), {
      recommendationId,
      performedBy,
      action: "accept",
    });
  }

  try {
    await assertCycleOpen(rec.iamRunId);
    await assertNoBlockingOutcome(rec.id);
    if (parseState(rec.lifecycleState) !== LS.LS_05) {
      throw new LifecycleTransitionError("Accept is only valid from Awaiting Acceptance", "VALIDATION");
    }
    const assignment = await prisma.recommendationAssignment.findFirst({
      where: { recommendationId, active: true },
    });
    if (!assignment) {
      throw new LifecycleTransitionError("No active assignment to accept", "VALIDATION");
    }
    if (opts?.ownerUserId && opts.ownerUserId !== assignment.primaryOwnerUserId) {
      throw new LifecycleTransitionError("Only the Primary Owner may accept", "VALIDATION");
    }
  } catch (e) {
    if (e instanceof LifecycleTransitionError) {
      await rejectAndThrow(e, {
        iamRunId: rec.iamRunId,
        recommendationId,
        performedBy,
        fromState: rec.lifecycleState,
        requestedToState: LS.LS_06,
        action: "accept",
      });
    }
    throw e;
  }

  const assignment = await prisma.recommendationAssignment.findFirst({
    where: { recommendationId, active: true },
  });

  await prisma.$transaction(async (tx) => {
    await tx.recommendationAssignment.update({
      where: { id: assignment!.id },
      data: { accepted: true },
    });
    await tx.recommendationAssignmentHistory.create({
      data: {
        recommendationId,
        eventType: "accepted",
        primaryOwnerUserId: assignment!.primaryOwnerUserId,
        primaryOwnerName: assignment!.primaryOwnerName,
        performedBy,
      },
    });
  });

  return commitLifecycleMove({
    recommendationId,
    toState: LS.LS_06,
    performedBy,
    governance: { decisionType: "Accept" },
    actionLabel: "accept",
  });
}

export async function addContributor(
  recommendationId: string,
  opts: { userId: string; displayName?: string; performedBy?: string }
) {
  const performedBy = opts.performedBy ?? "pilot-user";
  const rec = await prisma.recommendation.findUnique({ where: { id: recommendationId } });
  if (!rec) throw new LifecycleTransitionError("Recommendation not found", "NOT_FOUND");
  await assertCycleOpen(rec.iamRunId);

  const row = await prisma.recommendationContributor.upsert({
    where: {
      recommendationId_userId: { recommendationId, userId: opts.userId },
    },
    create: {
      recommendationId,
      userId: opts.userId,
      displayName: opts.displayName ?? null,
      active: true,
    },
    update: { active: true, displayName: opts.displayName ?? undefined },
  });

  await prisma.auditEvent.create({
    data: {
      iamRunId: rec.iamRunId,
      entityType: "Recommendation",
      entityId: recommendationId,
      action: "contributor:add",
      performedBy,
      detailJson: JSON.stringify({ userId: opts.userId }),
    },
  });
  return row;
}

export async function pauseRecommendation(
  recommendationId: string,
  opts: { reason: string; approvedBy: string; performedBy?: string }
) {
  const performedBy = opts.performedBy ?? "pilot-user";
  const rec = await prisma.recommendation.findUnique({ where: { id: recommendationId } });

  try {
    if (!opts.reason?.trim()) {
      throw new LifecycleTransitionError("Pause requires documented justification", "VALIDATION");
    }
    if (!opts.approvedBy?.trim()) {
      throw new LifecycleTransitionError("Pause requires management approval identity", "VALIDATION");
    }
    if (!rec) throw new LifecycleTransitionError("Recommendation not found", "NOT_FOUND");
    await assertCycleOpen(rec.iamRunId);
    await assertNoBlockingOutcome(rec.id);
    if (parseState(rec.lifecycleState) !== LS.LS_06) {
      throw new LifecycleTransitionError("Pause is only valid from Active", "VALIDATION");
    }
  } catch (e) {
    if (e instanceof LifecycleTransitionError) {
      await rejectAndThrow(e, {
        iamRunId: rec?.iamRunId,
        recommendationId,
        performedBy,
        fromState: rec?.lifecycleState,
        requestedToState: LS.LS_07,
        action: "pause",
      });
    }
    throw e;
  }

  return commitLifecycleMove({
    recommendationId,
    toState: LS.LS_07,
    performedBy,
    reason: opts.reason,
    governance: {
      decisionType: "Pause",
      reason: opts.reason,
      detail: { approvedBy: opts.approvedBy },
    },
    actionLabel: "pause",
  });
}

export async function resumeRecommendation(recommendationId: string, performedBy?: string) {
  const actor = performedBy ?? "pilot-user";
  const rec = await prisma.recommendation.findUnique({ where: { id: recommendationId } });
  try {
    if (!rec) throw new LifecycleTransitionError("Recommendation not found", "NOT_FOUND");
    const from = parseState(rec.lifecycleState);
    if (from !== LS.LS_07 && from !== LS.LS_08) {
      throw new LifecycleTransitionError("Resume/return to Active is only valid from Paused or Escalated", "VALIDATION");
    }
  } catch (e) {
    if (e instanceof LifecycleTransitionError) {
      await rejectAndThrow(e, {
        iamRunId: rec?.iamRunId,
        recommendationId,
        performedBy: actor,
        fromState: rec?.lifecycleState,
        requestedToState: LS.LS_06,
        action: "resume",
      });
    }
    throw e;
  }

  return commitLifecycleMove({
    recommendationId,
    toState: LS.LS_06,
    performedBy: actor,
    governance: { decisionType: "Resume" },
    actionLabel: "resume",
  });
}

export async function escalateRecommendation(
  recommendationId: string,
  opts: { reason: string; performedBy?: string }
) {
  const performedBy = opts.performedBy ?? "pilot-user";
  const rec = await prisma.recommendation.findUnique({ where: { id: recommendationId } });

  try {
    if (!opts.reason?.trim()) {
      throw new LifecycleTransitionError("Escalate requires documented justification", "VALIDATION");
    }
    if (!rec) throw new LifecycleTransitionError("Recommendation not found", "NOT_FOUND");
    await assertCycleOpen(rec.iamRunId);
    await assertNoBlockingOutcome(rec.id);
    if (parseState(rec.lifecycleState) !== LS.LS_06) {
      throw new LifecycleTransitionError("Escalate is only valid from Active", "VALIDATION");
    }
  } catch (e) {
    if (e instanceof LifecycleTransitionError) {
      await rejectAndThrow(e, {
        iamRunId: rec?.iamRunId,
        recommendationId,
        performedBy,
        fromState: rec?.lifecycleState,
        requestedToState: LS.LS_08,
        action: "escalate",
      });
    }
    throw e;
  }

  return commitLifecycleMove({
    recommendationId,
    toState: LS.LS_08,
    performedBy,
    reason: opts.reason,
    governance: { decisionType: "Escalate", reason: opts.reason },
    actionLabel: "escalate",
  });
}

export async function completeRecommendation(recommendationId: string, performedBy?: string) {
  const actor = performedBy ?? "pilot-user";
  const rec = await prisma.recommendation.findUnique({ where: { id: recommendationId } });
  try {
    if (!rec) throw new LifecycleTransitionError("Recommendation not found", "NOT_FOUND");
    const from = parseState(rec.lifecycleState);
    if (from !== LS.LS_06 && from !== LS.LS_08) {
      throw new LifecycleTransitionError("Complete is only valid from Active or Escalated", "VALIDATION");
    }
  } catch (e) {
    if (e instanceof LifecycleTransitionError) {
      await rejectAndThrow(e, {
        iamRunId: rec?.iamRunId,
        recommendationId,
        performedBy: actor,
        fromState: rec?.lifecycleState,
        requestedToState: LS.LS_09,
        action: "complete",
      });
    }
    throw e;
  }

  return commitLifecycleMove({
    recommendationId,
    toState: LS.LS_09,
    performedBy: actor,
    governance: { decisionType: "Complete" },
    actionLabel: "complete",
  });
}

export async function startOutcomeValidation(recommendationId: string, performedBy?: string) {
  return commitLifecycleMove({
    recommendationId,
    toState: LS.LS_10,
    performedBy: performedBy ?? "pilot-user",
    governance: { decisionType: "StartOutcomeValidation" },
    actionLabel: "start_outcome_validation",
  });
}

export async function passOutcomeValidation(
  recommendationId: string,
  opts?: { performedBy?: string; reason?: string }
) {
  const performedBy = opts?.performedBy ?? "pilot-user";
  const rec = await prisma.recommendation.findUnique({ where: { id: recommendationId } });
  try {
    if (!rec) throw new LifecycleTransitionError("Recommendation not found", "NOT_FOUND");
    if (parseState(rec.lifecycleState) !== LS.LS_10) {
      throw new LifecycleTransitionError(
        "Outcome Validation pass is only valid from Outcome Validation state",
        "VALIDATION"
      );
    }
  } catch (e) {
    if (e instanceof LifecycleTransitionError) {
      await rejectAndThrow(e, {
        iamRunId: rec?.iamRunId,
        recommendationId,
        performedBy,
        fromState: rec?.lifecycleState,
        requestedToState: LS.LS_11,
        action: "pass_outcome_validation",
      });
    }
    throw e;
  }

  return commitLifecycleMove({
    recommendationId,
    toState: LS.LS_11,
    performedBy,
    reason: opts?.reason,
    governance: { decisionType: "OutcomeValidationPass", reason: opts?.reason },
    actionLabel: "pass_outcome_validation",
  });
}

/** Archive attempt — only succeeds from Outcome Validation (graph-enforced). */
export async function archiveRecommendation(recommendationId: string, performedBy?: string) {
  return commitLifecycleMove({
    recommendationId,
    toState: LS.LS_11,
    performedBy: performedBy ?? "pilot-user",
    actionLabel: "archive",
  });
}

/**
 * Close/lock Review Cycle — does NOT set Holdover as a lifecycle state.
 * UnlockCycle (DF-04) intentionally deferred outside Phase 3.
 */
export async function lockReviewCycle(
  iamRunId: string,
  opts?: { performedBy?: string; close?: boolean }
) {
  const performedBy = opts?.performedBy ?? "pilot-user";
  const run = await prisma.iamRun.findUnique({ where: { id: iamRunId } });
  if (!run) throw new LifecycleTransitionError("Review cycle not found", "NOT_FOUND");

  const status = opts?.close ? "Closed" : "Locked";
  return prisma.$transaction(async (tx) => {
    const updated = await tx.iamRun.update({
      where: { id: iamRunId },
      data: {
        cycleStatus: status,
        cycleLockedAt: new Date(),
        cycleLockedBy: performedBy,
        runStatus: opts?.close ? "Closed" : run.runStatus,
      },
    });
    await tx.auditEvent.create({
      data: {
        iamRunId,
        entityType: "IamRun",
        entityId: iamRunId,
        action: opts?.close ? "review_cycle:close" : "review_cycle:lock",
        performedBy,
        detailJson: JSON.stringify({
          note: "Holdover is not applied as a lifecycle state; UnlockCycle deferred (DF-04).",
        }),
      },
    });
    await tx.governanceDecision.create({
      data: {
        iamRunId,
        recommendationId: null,
        decisionType: "LockCycle",
        performedBy,
        detailJson: JSON.stringify({ cycleStatus: status }),
      },
    });
    return updated;
  });
}

export { LifecycleTransitionError, LS, LIFECYCLE_STATES, isLifecycleState };
export type { LifecycleState };
