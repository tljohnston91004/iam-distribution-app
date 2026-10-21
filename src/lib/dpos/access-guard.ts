/**
 * Request guard for IAM operational endpoints and pages in DPOS_INTEGRATED mode (Stage 4A).
 *
 * Order of checks (each can only restrict):
 *   1. governed company context resolves (bound, config matches binding);
 *   2. the caller is the trusted DPOS front door (service identity + shared secret, timing-safe) — end-user identity
 *      headers are honoured ONLY from it;
 *   3. the end-user context is present, is not a service principal, and names the bound company;
 *   4. module eligibility: Installed -> Entitled -> Implementation Ready -> Enabled -> User Authorized;
 *   5. optional role restriction for administrative endpoints.
 *
 * A service credential presented on an operational route is rejected: the IAM Results Return service path is separate
 * and must never grant end-user access.
 */
import { timingSafeEqual } from "crypto";
import { tryAudit } from "./audit";
import type { DposIntegrationConfig } from "./config";
import { assertSameCompany, resolveCompanyContext, type DposCompanyContext } from "./company-context";
import { DposError, isDposError, type Db } from "./errors";
import type { EligibilityUser, ModuleEligibilityPort, ModuleEligibilityVerdict } from "./eligibility";
import { looksLikeServicePrincipal } from "./service-identity";

export const FRONT_DOOR_SERVICE_ID = "dpos-front-door";
/** Roles that may use administrative IAM integration endpoints (refresh, outbox administration). */
export const ADMIN_CAPABLE_ROLES = ["OWNER", "ADMINISTRATOR", "MANAGER", "OPERATOR"] as const;

export interface GuardDeps {
  db: Db;
  config: DposIntegrationConfig;
  eligibility: ModuleEligibilityPort;
  env?: Record<string, string | undefined>;
}

export interface GuardOptions {
  /** User must hold at least one of these roles (from the front door's `x-roles`). */
  requireAnyRole?: readonly string[];
  /** Route-specific company id (path/body) that must match the bound company. */
  suppliedCompanyId?: string | null;
}

export type GuardResult =
  | { ok: true; context: DposCompanyContext; user: EligibilityUser; verdict: ModuleEligibilityVerdict }
  | { ok: false; status: number; code: string; message: string; details?: Record<string, unknown> };

function csv(v: string | null): string[] {
  return (v ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  return ab.length === bb.length && timingSafeEqual(ab, bb);
}

export async function authorizeOperationalRequest(
  headers: { get(name: string): string | null },
  deps: GuardDeps,
  options: GuardOptions = {},
): Promise<GuardResult> {
  const env = deps.env ?? process.env;
  const deny = async (status: number, code: string, message: string, details?: Record<string, unknown>, companyId?: string): Promise<GuardResult> => {
    await tryAudit(deps.db, {
      category: "ELIGIBILITY",
      action: "OPERATIONAL_ACCESS",
      outcome: "DENIED",
      dposCompanyId: companyId ?? deps.config.dposCompanyId,
      detail: { code, ...(details ?? {}) },
    });
    return { ok: false, status, code, message, ...(details ? { details } : {}) };
  };

  // 1. company context
  let context: DposCompanyContext;
  try {
    context = await resolveCompanyContext(deps.db, deps.config);
  } catch (e) {
    if (isDposError(e)) return deny(e.httpStatus, e.code, e.message, e.details);
    throw e;
  }

  // 2. trusted front door
  const svcId = headers.get("x-service-identity");
  const svcCred = headers.get("x-service-credential");
  const expected = env[deps.config.frontDoor.credentialEnvName];
  if (!svcId || !svcCred) {
    return deny(401, "END_USER_CONTEXT_REQUIRED", "IAM is reachable only through the DPOS front door; no trusted caller was presented.");
  }
  if (svcId !== FRONT_DOOR_SERVICE_ID) {
    return deny(403, "SERVICE_IDENTITY_NOT_END_USER", "A service identity cannot be used on operational IAM routes.", { presented: looksLikeServicePrincipal(svcId) ? "IAM_SERVICE_IDENTITY" : "OTHER_SERVICE" });
  }
  if (!expected) {
    return deny(503, "FRONT_DOOR_NOT_CONFIGURED", "The front-door credential is not configured; operational routes stay closed.");
  }
  if (!safeEqual(svcCred, expected)) {
    return deny(401, "FRONT_DOOR_NOT_TRUSTED", "The front-door credential was not accepted.");
  }

  // 3. end-user context
  const identityId = headers.get("x-identity-id");
  const userId = headers.get("x-user-id");
  if (looksLikeServicePrincipal(identityId) || looksLikeServicePrincipal(userId)) {
    return deny(403, "SERVICE_IDENTITY_NOT_END_USER", "A service principal cannot act as an end user.");
  }
  if (!identityId && !userId) {
    return deny(401, "END_USER_CONTEXT_REQUIRED", "No end-user identity was supplied by the front door.");
  }
  try {
    assertSameCompany(context, headers.get("x-company-id"), "x-company-id");
    if (options.suppliedCompanyId !== undefined && options.suppliedCompanyId !== null) {
      assertSameCompany(context, options.suppliedCompanyId, "the request");
    }
  } catch (e) {
    if (e instanceof DposError) return deny(e.httpStatus, e.code, e.message, e.details);
    throw e;
  }
  const user: EligibilityUser = {
    identityId,
    userId,
    allowedModules: csv(headers.get("x-dpos-allowed-modules")),
    roles: csv(headers.get("x-roles")).map((r) => r.toUpperCase()),
  };

  // 4. module eligibility chain
  const verdict = await deps.eligibility.evaluate(
    { dposCompanyId: context.dposCompanyId, installationId: context.installationId },
    user,
  );
  if (!verdict.allowed) {
    return deny(verdict.httpStatus || 403, verdict.code, verdict.detail, { state: verdict.state, blockedAt: verdict.blockedAt, chain: verdict.chain }, context.dposCompanyId);
  }

  // 5. optional role restriction
  if (options.requireAnyRole && !user.roles.some((r) => options.requireAnyRole!.includes(r))) {
    return deny(403, "ROLE_NOT_PERMITTED", "The user's role cannot perform this IAM integration operation.", { required: [...options.requireAnyRole] }, context.dposCompanyId);
  }
  return { ok: true, context, user, verdict };
}
