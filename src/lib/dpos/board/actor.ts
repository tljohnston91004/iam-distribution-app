/**
 * Stage 4D: the board's actor, taken from the trusted DPOS front-door identity - never from a name or an email address.
 *
 * `actorId` is the stable DPOS user id (`x-user-id`; the identity id when no user id is supplied). The role is the highest recognised
 * workflow role among the front door's `x-roles`; any other role set is VIEW_ONLY (it can read the board but act on nothing).
 * Capability boundaries stay exactly those of the Stage 4B workflow (management actions need a management role; owner actions need
 * the assigned owner or a manager; contributors are limited) - this mapping only supplies WHO is asking.
 */
import { DposError } from "../errors";
import type { WorkflowActor, WorkflowRole } from "../workflow/permissions";

const ORDER: WorkflowRole[] = ["OWNER", "ADMINISTRATOR", "MANAGER", "OPERATOR", "VIEW_ONLY"];

export function actorFromFrontDoor(user: { userId: string | null; identityId: string | null; roles: string[] }): WorkflowActor {
  const id = (user.userId ?? user.identityId ?? "").trim();
  if (!id) throw new DposError("END_USER_CONTEXT_REQUIRED", "No end-user identity was supplied by the front door.", 401);
  if (/[\s@]/.test(id)) {
    throw new DposError("STABLE_USER_ID_REQUIRED", "The front door must supply the stable DPOS user id, not a name or an email address.", 400);
  }
  const roles = user.roles.map((r) => r.toUpperCase());
  const role = ORDER.find((r) => roles.includes(r)) ?? "VIEW_ONLY";
  return { actorId: id, role };
}

export const isManagementActor = (a: WorkflowActor): boolean => a.role === "OWNER" || a.role === "ADMINISTRATOR" || a.role === "MANAGER";
