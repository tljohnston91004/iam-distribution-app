/**
 * Governed company context (Stage 4A).
 *
 * In DPOS_INTEGRATED mode this IAM installation serves exactly ONE DPOS company. The binding between the DPOS company,
 * the Data Hub company, the IAM installation and the V1.5 `companies` row is created only by an explicit, audited
 * operator action (`bindCompany`). There is no silent default company: a missing binding, a configuration that points
 * at a different company than the database is bound to, or a request that names another company is rejected.
 */
import type { Company } from "@prisma/client";
import { writeAudit } from "./audit";
import { timeZoneStatusOf, type DposIntegrationConfig, type TimeZoneStatus } from "./config";
import { DposError, type Db } from "./errors";

export interface DposCompanyContext {
  bindingId: string;
  /** DPOS company UUID (also the Data Hub company UUID — they are the same governed identity in V1). */
  dposCompanyId: string;
  dataHubCompanyId: string;
  /** V1.5 `companies.company_id` that legacy-model data (runs, recommendations) is stored under. */
  iamCompanyId: string;
  installationId: string;
  companyTimeZone: string | null;
  timeZoneStatus: TimeZoneStatus;
  environmentClass: string;
  configurationId: string;
}

type Binding = NonNullable<Awaited<ReturnType<Db["dposCompanyBinding"]["findFirst"]>>>;

function fieldDiffs(binding: Binding, config: DposIntegrationConfig): string[] {
  const d: string[] = [];
  if (binding.dposCompanyId !== config.dposCompanyId) d.push("dposCompanyId");
  if (binding.dataHubCompanyId !== config.dataHubCompanyId) d.push("dataHubCompanyId");
  if (binding.installationId !== config.installationId) d.push("installationId");
  if (binding.environmentClass !== config.environmentClass) d.push("environmentClass");
  if (binding.configurationId !== config.configurationId) d.push("configurationId");
  if ((binding.companyTimeZone ?? null) !== (config.companyTimeZone ?? null)) d.push("companyTimeZone");
  return d;
}

function toContext(binding: Binding): DposCompanyContext {
  return {
    bindingId: binding.id,
    dposCompanyId: binding.dposCompanyId,
    dataHubCompanyId: binding.dataHubCompanyId,
    iamCompanyId: binding.iamCompanyId,
    installationId: binding.installationId,
    companyTimeZone: binding.companyTimeZone,
    timeZoneStatus: timeZoneStatusOf(binding.companyTimeZone),
    environmentClass: binding.environmentClass,
    configurationId: binding.configurationId,
  };
}

/** Resolve the governed company context or throw a structured DposError. Never defaults a company. */
export async function resolveCompanyContext(db: Db, config: DposIntegrationConfig): Promise<DposCompanyContext> {
  const binding = await db.dposCompanyBinding.findUnique({ where: { dposCompanyId: config.dposCompanyId } });
  if (!binding) {
    const other = await db.dposCompanyBinding.count();
    if (other > 0) {
      throw new DposError(
        "COMPANY_BINDING_MISMATCH",
        "This IAM database is bound to a different company than the configured IAM_DPOS_COMPANY_ID.",
        409,
        { fields: ["dposCompanyId"] },
      );
    }
    throw new DposError(
      "COMPANY_NOT_BOUND",
      "No company is bound to this IAM installation. An operator must run the explicit company-binding command; IAM never picks a default company.",
      503,
    );
  }
  if (binding.status !== "ACTIVE") {
    throw new DposError("COMPANY_BINDING_SUSPENDED", "The company binding for this IAM installation is not active.", 503);
  }
  const diffs = fieldDiffs(binding, config);
  if (diffs.length) {
    throw new DposError(
      "COMPANY_BINDING_MISMATCH",
      `Configured company context differs from the governed binding (${diffs.join(", ")}). Correct the configuration or update the binding explicitly.`,
      409,
      { fields: diffs },
    );
  }
  const company = await db.company.findUnique({ where: { id: binding.iamCompanyId } });
  if (!company) {
    throw new DposError("COMPANY_BINDING_BROKEN", "The bound IAM company record does not exist.", 503);
  }
  return toContext(binding);
}

/**
 * Compare a company id supplied by a caller (header, path or body) with the governed context.
 * Missing or different => rejected. Accepts the DPOS/Data Hub company id or the V1.5 company id of the bound company.
 */
export function assertSameCompany(context: DposCompanyContext, supplied: string | null | undefined, source: string): void {
  if (supplied === null || supplied === undefined || supplied.trim() === "") {
    throw new DposError("COMPANY_MISSING", `A company id is required (${source}).`, 400);
  }
  const s = supplied.trim().toLowerCase();
  if (s !== context.dposCompanyId && s !== context.dataHubCompanyId && s !== context.iamCompanyId.toLowerCase()) {
    throw new DposError("COMPANY_MISMATCH", `The company in ${source} is not the company this IAM installation serves.`, 403);
  }
}

export interface BindCompanyInput {
  actor: string;
  /** Adopt an existing V1.5 company row ... */
  existingIamCompanyId?: string;
  /** ... or create a new one with this name. Exactly one of the two is required. */
  createCompanyName?: string;
}

/** Explicit, audited, idempotent creation of the one governed company binding. */
export async function bindCompany(db: Db, config: DposIntegrationConfig, input: BindCompanyInput): Promise<DposCompanyContext> {
  const existing = await db.dposCompanyBinding.findUnique({ where: { dposCompanyId: config.dposCompanyId } });
  if (existing) {
    const diffs = fieldDiffs(existing, config);
    if (diffs.length) {
      throw new DposError("COMPANY_BINDING_MISMATCH", `A binding already exists with different values (${diffs.join(", ")}); use updateBinding.`, 409, { fields: diffs });
    }
    return toContext(existing);
  }
  if ((await db.dposCompanyBinding.count()) > 0) {
    throw new DposError("COMPANY_BINDING_MISMATCH", "This IAM database is already bound to a different company.", 409);
  }
  if (!!input.existingIamCompanyId === !!input.createCompanyName) {
    throw new DposError("BIND_INPUT_INVALID", "Provide exactly one of existingIamCompanyId or createCompanyName.", 400);
  }
  let company: Company | null;
  if (input.existingIamCompanyId) {
    company = await db.company.findUnique({ where: { id: input.existingIamCompanyId } });
    if (!company) throw new DposError("BIND_COMPANY_NOT_FOUND", "The named IAM company does not exist.", 404);
  } else {
    company = await db.company.create({ data: { name: input.createCompanyName!.trim() } });
  }
  const binding = await db.dposCompanyBinding.create({
    data: {
      iamCompanyId: company.id,
      dposCompanyId: config.dposCompanyId,
      dataHubCompanyId: config.dataHubCompanyId,
      installationId: config.installationId,
      companyTimeZone: config.companyTimeZone,
      environmentClass: config.environmentClass,
      configurationId: config.configurationId,
    },
  });
  await writeAudit(db, {
    category: "COMPANY_CONTEXT",
    action: "BINDING_CREATED",
    outcome: "SUCCESS",
    actor: input.actor,
    dposCompanyId: config.dposCompanyId,
    subjectType: "DposCompanyBinding",
    subjectId: binding.id,
    detail: { iamCompanyId: company.id, adoptedExisting: !!input.existingIamCompanyId },
  });
  return toContext(binding);
}

/** Update the mutable parts of the binding (never the company identities). Audited. */
export async function updateBinding(db: Db, config: DposIntegrationConfig, actor: string): Promise<DposCompanyContext> {
  const existing = await db.dposCompanyBinding.findUnique({ where: { dposCompanyId: config.dposCompanyId } });
  if (!existing) throw new DposError("COMPANY_NOT_BOUND", "No binding exists for the configured company.", 404);
  if (existing.dataHubCompanyId !== config.dataHubCompanyId) {
    throw new DposError("COMPANY_BINDING_MISMATCH", "Company identities can never be changed on an existing binding.", 409, { fields: ["dataHubCompanyId"] });
  }
  const updated = await db.dposCompanyBinding.update({
    where: { id: existing.id },
    data: {
      installationId: config.installationId,
      environmentClass: config.environmentClass,
      configurationId: config.configurationId,
      companyTimeZone: config.companyTimeZone,
    },
  });
  await writeAudit(db, {
    category: "COMPANY_CONTEXT",
    action: "BINDING_UPDATED",
    outcome: "SUCCESS",
    actor,
    dposCompanyId: config.dposCompanyId,
    subjectType: "DposCompanyBinding",
    subjectId: existing.id,
    detail: { changedFields: fieldDiffs(existing, config) },
  });
  return toContext(updated);
}

/** The bound V1.5 company row — used by `ensureDefaultCompany` in integrated mode instead of "first or create". */
export async function resolveBoundLegacyCompany(db: Db, config: DposIntegrationConfig): Promise<Company> {
  const ctx = await resolveCompanyContext(db, config);
  const company = await db.company.findUnique({ where: { id: ctx.iamCompanyId } });
  if (!company) throw new DposError("COMPANY_BINDING_BROKEN", "The bound IAM company record does not exist.", 503);
  return company;
}
