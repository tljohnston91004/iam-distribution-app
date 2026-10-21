/**
 * IAM service identity (Stage 4A).
 *
 * IAM calls Data Hub (Results Return, input reads) as a SERVICE principal — never as a person and never with an
 * end-user role. The capabilities below are the Data Hub keys introduced by Stage 3 (Results Return write/read) plus the Stage 4A closeout governed-input read (4A-D2); they are deliberately NOT
 * grantable to the user roles OWNER / ADMINISTRATOR / MANAGER / OPERATOR / VIEW_ONLY, are scoped to one DPOS company +
 * installation + environment class, are audited, can be revoked, and contain no human name or local path, so the same
 * registry works unchanged in a cloud deployment.
 *
 * Credential handling: this registry never stores a secret. `credentialRef` is the NAME of the environment variable
 * (or, in the cloud, secret reference) that holds the bearer credential.
 *
 * Production issuance gap (see the Stage 4A report): the DPOS identity platform does not yet issue service principals
 * and Data Hub grants (`DATA_HUB_IAM_RESULTS_RETURN_SERVICE_IDENTITY_IDS` + the Authorization service grant of the
 * capability keys, notably the dedicated datahub.iam_governed_input.read, never generic source/canonical/lineage read) are an operator action outside IAM. `ServiceIdentityProvider` is the governed interface; the WORKSHOP provider
 * issues a clearly labelled workshop identity that is refused in a PRODUCTION environment.
 */
import { randomUUID } from "crypto";
import { writeAudit, tryAudit } from "./audit";
import type { DposIntegrationConfig } from "./config";
import { DposError, type Db } from "./errors";

export const IAM_SERVICE_CAPABILITIES = {
  RESULTS_RETURN_WRITE: "datahub.iam_results_return.write",
  RESULTS_RETURN_READ: "datahub.iam_results_return.read",
  /**
   * 4A-D2: dedicated, least-privilege governed-input read capability (Open PO / Customer Backorder views, freshness,
   * source-run and lineage references). It replaces any generic source/canonical/lineage grant for IAM.
   */
  GOVERNED_INPUT_READ: "datahub.iam_governed_input.read",
} as const;
export type IamServiceCapability = (typeof IAM_SERVICE_CAPABILITIES)[keyof typeof IAM_SERVICE_CAPABILITIES];
export const ALL_IAM_SERVICE_CAPABILITIES: readonly IamServiceCapability[] = Object.values(IAM_SERVICE_CAPABILITIES);

/** Normal user roles. None of them can ever hold an IAM service capability. */
export const USER_ROLES = ["OWNER", "ADMINISTRATOR", "MANAGER", "OPERATOR", "VIEW_ONLY"] as const;
export type UserRole = (typeof USER_ROLES)[number];

/** Always false: service capabilities are not role grants. (Kept as a function so tests can prove it.) */
export function userRoleHasServiceCapability(_role: string, _capability: string): boolean {
  return false;
}

export const SERVICE_IDENTITY_PREFIX = "iam-svc-";

export interface IssueServiceIdentityInput {
  actor: string;
  issuanceKind: "WORKSHOP" | "PRODUCTION";
  capabilities?: readonly string[];
  credentialRef?: string | null;
  expiresAt?: Date | null;
  now?: Date;
}

export interface ServiceIdentityRecord {
  id: string;
  identityId: string;
  principalKind: "SERVICE";
  moduleId: "IAM";
  dposCompanyId: string;
  installationId: string;
  environmentClass: string;
  capabilities: IamServiceCapability[];
  status: "ACTIVE" | "REVOKED";
  issuanceKind: "WORKSHOP" | "PRODUCTION";
  credentialRef: string | null;
  issuedAt: Date;
  issuedBy: string;
  expiresAt: Date | null;
  revokedAt: Date | null;
}

type Row = NonNullable<Awaited<ReturnType<Db["dposServiceIdentity"]["findFirst"]>>>;

function toRecord(r: Row): ServiceIdentityRecord {
  return {
    id: r.id,
    identityId: r.identityId,
    principalKind: "SERVICE",
    moduleId: "IAM",
    dposCompanyId: r.dposCompanyId,
    installationId: r.installationId,
    environmentClass: r.environmentClass,
    capabilities: JSON.parse(r.capabilitiesJson) as IamServiceCapability[],
    status: r.status as "ACTIVE" | "REVOKED",
    issuanceKind: r.issuanceKind as "WORKSHOP" | "PRODUCTION",
    credentialRef: r.credentialRef,
    issuedAt: r.issuedAt,
    issuedBy: r.issuedBy,
    expiresAt: r.expiresAt,
    revokedAt: r.revokedAt,
  };
}

/** The governed provider interface. A production provider backed by the DPOS identity platform plugs in here. */
export interface ServiceIdentityProvider {
  readonly kind: "WORKSHOP" | "PRODUCTION";
  issueIdentityId(input: { dposCompanyId: string; installationId: string; environmentClass: string }): Promise<string>;
}

export class WorkshopServiceIdentityProvider implements ServiceIdentityProvider {
  readonly kind = "WORKSHOP" as const;
  async issueIdentityId(): Promise<string> {
    return `${SERVICE_IDENTITY_PREFIX}${randomUUID()}`;
  }
}

/** Placeholder for the DPOS identity platform. It cannot issue yet; the gap is explicit, never silently bypassed. */
export class DposIdentityPlatformProvider implements ServiceIdentityProvider {
  readonly kind = "PRODUCTION" as const;
  async issueIdentityId(): Promise<string> {
    throw new DposError(
      "IDENTITY_PLATFORM_NOT_AVAILABLE",
      "The DPOS identity platform cannot issue production service identities yet. Use a WORKSHOP identity outside production and record the gap.",
      501,
    );
  }
}

/** Capabilities must be a non-empty subset of the IAM service capabilities above. Anything else (e.g. a generic Data Hub key) is refused. */
export function normalizeCapabilities(requested?: readonly string[]): IamServiceCapability[] {
  const list = requested && requested.length ? requested : ALL_IAM_SERVICE_CAPABILITIES;
  const bad = list.filter((c) => !(ALL_IAM_SERVICE_CAPABILITIES as readonly string[]).includes(c));
  if (bad.length) {
    throw new DposError("SERVICE_CAPABILITY_NOT_ALLOWED", `Capabilities not permitted for the IAM service identity: ${bad.join(", ")}`, 400);
  }
  return [...new Set(list)] as IamServiceCapability[];
}

export async function issueServiceIdentity(
  db: Db,
  config: DposIntegrationConfig,
  provider: ServiceIdentityProvider,
  input: IssueServiceIdentityInput,
): Promise<ServiceIdentityRecord> {
  if (provider.kind !== input.issuanceKind) {
    throw new DposError("SERVICE_IDENTITY_PROVIDER_MISMATCH", "Provider kind does not match the requested issuance kind.", 400);
  }
  if (input.issuanceKind === "WORKSHOP" && config.environmentClass === "PRODUCTION") {
    throw new DposError(
      "WORKSHOP_IDENTITY_NOT_ALLOWED_IN_PRODUCTION",
      "A workshop service identity cannot be issued in a PRODUCTION environment.",
      403,
    );
  }
  if (!input.actor.trim()) throw new DposError("ACTOR_REQUIRED", "The issuing operator must be recorded.", 400);
  const capabilities = normalizeCapabilities(input.capabilities);
  const identityId = await provider.issueIdentityId({
    dposCompanyId: config.dposCompanyId,
    installationId: config.installationId,
    environmentClass: config.environmentClass,
  });
  if (!identityId.startsWith(SERVICE_IDENTITY_PREFIX)) {
    throw new DposError("SERVICE_IDENTITY_ID_INVALID", `Service identity ids must start with ${SERVICE_IDENTITY_PREFIX}`, 500);
  }
  const row = await db.dposServiceIdentity.create({
    data: {
      identityId,
      principalKind: "SERVICE",
      moduleId: "IAM",
      dposCompanyId: config.dposCompanyId,
      installationId: config.installationId,
      environmentClass: config.environmentClass,
      capabilitiesJson: JSON.stringify(capabilities),
      status: "ACTIVE",
      issuanceKind: input.issuanceKind,
      // A NAME (environment variable / cloud secret reference), never a secret value.
      credentialRef: input.credentialRef ?? config.serviceIdentity.credentialEnvName,
      issuedAt: input.now ?? new Date(),
      issuedBy: input.actor,
      expiresAt: input.expiresAt ?? null,
    },
  });
  await writeAudit(db, {
    category: "SERVICE_IDENTITY",
    action: "ISSUED",
    outcome: "SUCCESS",
    actor: input.actor,
    dposCompanyId: config.dposCompanyId,
    subjectType: "DposServiceIdentity",
    subjectId: row.identityId,
    detail: { issuanceKind: input.issuanceKind, capabilities, environmentClass: config.environmentClass },
  });
  return toRecord(row);
}

export async function revokeServiceIdentity(
  db: Db,
  identityId: string,
  input: { actor: string; reason: string; now?: Date },
): Promise<ServiceIdentityRecord> {
  const row = await db.dposServiceIdentity.findUnique({ where: { identityId } });
  if (!row) throw new DposError("SERVICE_IDENTITY_NOT_FOUND", "Unknown service identity.", 404);
  if (row.status === "REVOKED") return toRecord(row);
  if (!input.reason.trim()) throw new DposError("REASON_REQUIRED", "A revocation reason is required.", 400);
  const updated = await db.dposServiceIdentity.update({
    where: { identityId },
    data: { status: "REVOKED", revokedAt: input.now ?? new Date(), revokedBy: input.actor, revokedReason: input.reason },
  });
  await writeAudit(db, {
    category: "SERVICE_IDENTITY",
    action: "REVOKED",
    outcome: "SUCCESS",
    actor: input.actor,
    dposCompanyId: row.dposCompanyId,
    subjectType: "DposServiceIdentity",
    subjectId: identityId,
    detail: { reason: input.reason },
  });
  return toRecord(updated);
}

/**
 * Validate that `identityId` is an ACTIVE, unexpired IAM service identity for THIS company, installation and
 * environment that holds `capability`. Users, other companies, revoked and expired identities are all refused.
 */
export async function requireServiceIdentity(
  db: Db,
  config: DposIntegrationConfig,
  identityId: string | null | undefined,
  capability: IamServiceCapability,
  now: Date = new Date(),
): Promise<ServiceIdentityRecord> {
  const deny = async (code: string, message: string, status = 403): Promise<never> => {
    await tryAudit(db, {
      category: "SERVICE_IDENTITY",
      action: "AUTHORIZE",
      outcome: "DENIED",
      dposCompanyId: config.dposCompanyId,
      subjectType: "DposServiceIdentity",
      subjectId: identityId ?? null,
      detail: { code, capability },
    });
    throw new DposError(code, message, status);
  };
  if (!identityId) return deny("SERVICE_IDENTITY_NOT_CONFIGURED", "No IAM service identity is configured.", 503);
  if (!identityId.startsWith(SERVICE_IDENTITY_PREFIX)) {
    return deny("SERVICE_PRINCIPAL_REQUIRED", "This capability is service-to-service only; a user principal is not accepted.");
  }
  const row = await db.dposServiceIdentity.findUnique({ where: { identityId } });
  if (!row) return deny("SERVICE_IDENTITY_NOT_FOUND", "Unknown service identity.");
  if (row.principalKind !== "SERVICE") return deny("SERVICE_PRINCIPAL_REQUIRED", "Identity is not a service principal.");
  if (row.status !== "ACTIVE") return deny("SERVICE_IDENTITY_REVOKED", "The service identity has been revoked.");
  if (row.expiresAt && row.expiresAt.getTime() <= now.getTime()) return deny("SERVICE_IDENTITY_EXPIRED", "The service identity has expired.");
  if (row.dposCompanyId !== config.dposCompanyId) return deny("SERVICE_IDENTITY_WRONG_COMPANY", "The service identity belongs to a different company.");
  if (row.installationId !== config.installationId) return deny("SERVICE_IDENTITY_WRONG_INSTALLATION", "The service identity belongs to a different installation.");
  if (row.environmentClass !== config.environmentClass) return deny("SERVICE_IDENTITY_WRONG_ENVIRONMENT", "The service identity belongs to a different environment class.");
  const rec = toRecord(row);
  if (!rec.capabilities.includes(capability)) return deny("SERVICE_CAPABILITY_MISSING", `The service identity does not hold ${capability}.`);
  return rec;
}

/**
 * Identity headers IAM sends to Data Hub. They match RSE's Data Hub client (x-identity-id / x-user-id / x-company-id /
 * x-correlation-id). For a service principal x-user-id is the same service identity (there is no human).
 */
export function outboundIdentityHeaders(
  identity: Pick<ServiceIdentityRecord, "identityId" | "credentialRef">,
  companyId: string,
  correlationId: string,
  env: Record<string, string | undefined> = process.env,
): Record<string, string> {
  const headers: Record<string, string> = {
    "x-identity-id": identity.identityId,
    "x-user-id": identity.identityId,
    "x-company-id": companyId,
    "x-correlation-id": correlationId,
  };
  const secret = identity.credentialRef ? env[identity.credentialRef] : undefined;
  if (secret) headers.authorization = `Bearer ${secret}`;
  return headers;
}

/** True when an inbound principal looks like an IAM/other service identity (and so must not reach operational routes). */
export function looksLikeServicePrincipal(id: string | null | undefined): boolean {
  return !!id && id.startsWith(SERVICE_IDENTITY_PREFIX);
}

export async function listServiceIdentities(db: Db, dposCompanyId: string): Promise<ServiceIdentityRecord[]> {
  const rows = await db.dposServiceIdentity.findMany({ where: { dposCompanyId }, orderBy: { issuedAt: "asc" } });
  return rows.map(toRecord);
}
