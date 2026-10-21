/**
 * Stage 4B workflow capability boundary.
 *
 * The workflow services never read a request or a session: they receive an explicit `WorkflowActor`. That is the
 * domain capability boundary. How a DPOS front-door identity (user id + role headers, entitlement and the module-access
 * chain from Stage 1B) becomes a `WorkflowActor` is the DEFERRED production mapping: it belongs to the later route/UI
 * wiring (4A-D8 defers the front-door proxy) and, for finer-grained roles, to the platform's role design. bp022
 * (identity-context scoped access) is NOT implemented here and nothing in this file depends on it.
 *
 * Roles reuse the DPOS/IAM user role names already used by the Stage 4A service-identity module
 * (OWNER / ADMINISTRATOR / MANAGER / OPERATOR / VIEW_ONLY). Rules:
 *   - management decisions (approve, reject, suppress, escalate, risk accept, return, assign, reassign, pause decisions,
 *     completion validation, completed history)  -> management roles (OWNER, ADMINISTRATOR, MANAGER);
 *   - a candidate flagged for repeated rejection, or an ESCALATED candidate, needs a SENIOR actor (OWNER, ADMINISTRATOR);
 *   - owner actions (accept, request discussion, start, official progress, blocker, pause request, completion request)
 *     -> the assigned primary task owner, or an authorized manager acting on the owner's behalf (recorded as such);
 *   - contributors may add notes, supporting work and evidence only, unless management explicitly authorized them to
 *     write official values;
 *   - VIEW_ONLY can do nothing; a Data Hub service identity (iam-svc-*) is never a workflow actor.
 */
import { DposError } from "../errors";

export const WORKFLOW_ROLES = ["OWNER", "ADMINISTRATOR", "MANAGER", "OPERATOR", "VIEW_ONLY"] as const;
export type WorkflowRole = (typeof WORKFLOW_ROLES)[number];

export interface WorkflowActor {
  actorId: string;
  /** SYSTEM is the IAM process itself (evidence intake, scheduled status evaluation); it is not a user role. */
  role: WorkflowRole | "SYSTEM";
  displayName?: string;
}

export const MANAGEMENT_ROLES: readonly WorkflowRole[] = ["OWNER", "ADMINISTRATOR", "MANAGER"];
export const SENIOR_ROLES: readonly WorkflowRole[] = ["OWNER", "ADMINISTRATOR"];

export const SYSTEM_ACTOR: WorkflowActor = { actorId: "iam-system", role: "SYSTEM" };

export function assertActor(actor: WorkflowActor | undefined | null): asserts actor is WorkflowActor {
  if (!actor || !actor.actorId || !actor.actorId.trim()) {
    throw new DposError("ACTOR_REQUIRED", "An identified actor is required for every workflow operation.", 401);
  }
  if (actor.role !== "SYSTEM" && !(WORKFLOW_ROLES as readonly string[]).includes(actor.role)) {
    throw new DposError("ACTOR_ROLE_UNKNOWN", `Unknown workflow role: ${String(actor.role)}`, 403);
  }
  if (actor.actorId.startsWith("iam-svc-")) {
    throw new DposError("SERVICE_IDENTITY_NOT_A_USER", "A service identity cannot perform user workflow operations.", 403);
  }
  if (actor.role !== "SYSTEM" && actor.actorId === SYSTEM_ACTOR.actorId) {
    throw new DposError("SYSTEM_ACTOR_RESERVED", "The IAM system actor identity is reserved and cannot be used by a user.", 403);
  }
  if (actor.role === "SYSTEM" && actor.actorId !== SYSTEM_ACTOR.actorId) {
    throw new DposError("SYSTEM_ACTOR_INVALID", "Only the IAM system actor may use the SYSTEM role.", 403);
  }
}

export const isSystem = (actor: WorkflowActor) => actor.role === "SYSTEM";
export const isManagement = (actor: WorkflowActor) => (MANAGEMENT_ROLES as readonly string[]).includes(actor.role);
export const isSenior = (actor: WorkflowActor) => (SENIOR_ROLES as readonly string[]).includes(actor.role);

export function requireManagement(actor: WorkflowActor, operation: string): void {
  assertActor(actor);
  if (!isManagement(actor)) {
    throw new DposError("MANAGEMENT_AUTHORIZATION_REQUIRED", `${operation} requires management-level authorization.`, 403, { requiredRoles: [...MANAGEMENT_ROLES], role: actor.role });
  }
}

export function requireSenior(actor: WorkflowActor, operation: string, why: string): void {
  assertActor(actor);
  if (!isSenior(actor)) {
    throw new DposError("SENIOR_REVIEW_REQUIRED", `${operation} requires senior management review (${why}).`, 403, { requiredRoles: [...SENIOR_ROLES], role: actor.role, why });
  }
}

/** The IAM system process or a manager (candidate creation, evidence intake, presenting a candidate). */
export function requireSystemOrManagement(actor: WorkflowActor, operation: string): void {
  assertActor(actor);
  if (!isSystem(actor) && !isManagement(actor)) {
    throw new DposError("SYSTEM_OR_MANAGEMENT_REQUIRED", `${operation} requires the IAM system or a manager.`, 403, { role: actor.role });
  }
}

export interface OwnershipFacts {
  taskOwnerId: string | null;
  contributorIds: readonly string[];
  /** Contributors (or any user) currently authorized by management to write OFFICIAL progress values. */
  authorizedOfficialWriterIds: readonly string[];
}

export type ActorRelation = "PRIMARY_OWNER" | "AUTHORIZED_CONTRIBUTOR" | "CONTRIBUTOR" | "MANAGER" | "NONE";

export function relationOf(actor: WorkflowActor, facts: OwnershipFacts): ActorRelation {
  if (actor.role === "VIEW_ONLY" || actor.role === "SYSTEM") return "NONE";
  if (facts.taskOwnerId && actor.actorId === facts.taskOwnerId) return "PRIMARY_OWNER";
  if (facts.authorizedOfficialWriterIds.includes(actor.actorId)) return "AUTHORIZED_CONTRIBUTOR";
  if (facts.contributorIds.includes(actor.actorId)) return "CONTRIBUTOR";
  if (isManagement(actor)) return "MANAGER";
  return "NONE";
}

/** Owner action: the assigned primary owner, or an authorized manager acting on the owner's behalf. */
export function requireOwnerOrManager(actor: WorkflowActor, facts: OwnershipFacts, operation: string): { onBehalf: boolean } {
  assertActor(actor);
  const rel = relationOf(actor, facts);
  if (rel === "PRIMARY_OWNER") return { onBehalf: false };
  if (isManagement(actor)) return { onBehalf: true };
  throw new DposError("OWNER_OR_MANAGER_REQUIRED", `${operation} requires the assigned task owner or an authorized manager.`, 403, { role: actor.role, relation: rel });
}

/** Official progress values: primary owner, a management-authorized contributor, or an authorized manager. */
export function requireOfficialWriter(actor: WorkflowActor, facts: OwnershipFacts, operation: string): { onBehalf: boolean; viaAuthorization: boolean } {
  assertActor(actor);
  const rel = relationOf(actor, facts);
  if (rel === "PRIMARY_OWNER") return { onBehalf: false, viaAuthorization: false };
  if (rel === "AUTHORIZED_CONTRIBUTOR") return { onBehalf: false, viaAuthorization: true };
  if (isManagement(actor)) return { onBehalf: true, viaAuthorization: false };
  if (rel === "CONTRIBUTOR") {
    throw new DposError("CONTRIBUTOR_NOT_AUTHORIZED", `${operation}: contributors may add notes, supporting work and evidence but cannot overwrite official completion or condition-reduction values unless management explicitly authorizes them.`, 403);
  }
  throw new DposError("OWNER_OR_MANAGER_REQUIRED", `${operation} requires the primary task owner or an authorized manager.`, 403, { role: actor.role, relation: rel });
}

/** Notes / supporting work / evidence: owner, any listed contributor, or a manager. */
export function requireContributorOrAbove(actor: WorkflowActor, facts: OwnershipFacts, operation: string): ActorRelation {
  assertActor(actor);
  const rel = relationOf(actor, facts);
  if (rel === "NONE") {
    throw new DposError("CONTRIBUTOR_OR_ABOVE_REQUIRED", `${operation} requires the task owner, a listed contributor or a manager.`, 403, { role: actor.role });
  }
  return rel;
}
