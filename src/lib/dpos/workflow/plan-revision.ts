/**
 * Stage 4D plan revision.
 *
 * A material revision of the management-approved plan creates a NEW plan version, preserves every prior version, requires a
 * management actor and a reason, records the decision and emits the dedicated PLAN_REVISED governance event. The original system
 * recommendation is never overwritten. This is a thin, named entry point over the Stage 4B reassignment path (which already owns
 * the transaction, the permission, the decision ledger and the PLAN_REVISED event) so there is exactly ONE implementation of a
 * plan revision: no second path can forget to emit the event (4D-D6).
 */
import type { PrismaClient } from "@prisma/client";
import { reassign } from "./assignment";
import type { Ctx } from "./internal";
import type { WorkflowActor } from "./permissions";
import type { PlanInput } from "./shared";

export interface RevisePlanInput {
  /** Required: why the plan is being revised. */
  reason: string;
  /** The revised plan. A deviation from the system recommendation also needs `deviationReason`. */
  plan: PlanInput;
  at?: Date;
}

export async function revisePlan(db: PrismaClient, ctx: Ctx, actor: WorkflowActor, candidateId: string, input: RevisePlanInput) {
  return reassign(db, ctx, actor, candidateId, { reason: input.reason, planChange: input.plan, at: input.at });
}
