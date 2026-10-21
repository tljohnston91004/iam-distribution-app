/**
 * Process-level wiring for the DPOS integration (Stage 4A). This is the only DPOS module that touches the global
 * Prisma client; everything else takes its dependencies as parameters so it can be tested in isolation.
 */
import { prisma } from "@/lib/db";
import { DposConfigError, loadDposIntegrationConfig, type DposIntegrationConfig, type LoadedConfig } from "./config";
import { resolveCompanyContext, type DposCompanyContext } from "./company-context";
import { DataHubClient } from "./data-hub-client";
import {
  NotConfiguredModuleEligibilityPort,
  createInstallationModuleEligibilityPort,
  type ModuleEligibilityPort,
} from "./eligibility";
import type { GuardDeps } from "./access-guard";
import { IAM_SERVICE_CAPABILITIES, requireServiceIdentity, type ServiceIdentityRecord } from "./service-identity";

export function loadedConfig(): LoadedConfig {
  const r = loadDposIntegrationConfig(process.env);
  if (!r.ok) throw new DposConfigError(r.issues);
  return r.config;
}

/** The integrated config, or null in STANDALONE_LEGACY mode. Throws DposConfigError when integrated and invalid. */
export function integratedConfig(): DposIntegrationConfig | null {
  const c = loadedConfig();
  return c.mode === "DPOS_INTEGRATED" ? c : null;
}

export function isIntegratedMode(): boolean {
  return integratedConfig() !== null;
}

let eligibilityCache: { key: string; port: ModuleEligibilityPort } | null = null;

export function eligibilityPortFor(config: DposIntegrationConfig): ModuleEligibilityPort {
  const { applicationRoot, installationRoot, registryFile, cacheTtlMs } = config.eligibility;
  const key = JSON.stringify([applicationRoot, installationRoot, registryFile, cacheTtlMs]);
  if (eligibilityCache?.key === key) return eligibilityCache.port;
  const port =
    applicationRoot && installationRoot
      ? createInstallationModuleEligibilityPort({
          applicationRoot,
          installationRoot,
          registryFile: registryFile ?? undefined,
          cacheTtlMs,
        })
      : new NotConfiguredModuleEligibilityPort();
  eligibilityCache = { key, port };
  return port;
}

export function guardDeps(config: DposIntegrationConfig): GuardDeps {
  return { db: prisma, config, eligibility: eligibilityPortFor(config) };
}

export async function currentCompanyContext(config: DposIntegrationConfig): Promise<DposCompanyContext> {
  return resolveCompanyContext(prisma, config);
}

/** Bound V1.5 company id in integrated mode (used to scope legacy list endpoints), null in standalone mode. */
export async function boundIamCompanyId(): Promise<string | null> {
  const config = integratedConfig();
  if (!config) return null;
  return (await resolveCompanyContext(prisma, config)).iamCompanyId;
}

export interface OperationalServices {
  config: DposIntegrationConfig;
  context: DposCompanyContext;
  identity: ServiceIdentityRecord;
  client: DataHubClient;
}

/** Governed context + validated service identity + Data Hub client for refresh / outbox operations. */
export async function operationalServices(
  capability: (typeof IAM_SERVICE_CAPABILITIES)[keyof typeof IAM_SERVICE_CAPABILITIES] = IAM_SERVICE_CAPABILITIES.GOVERNED_INPUT_READ,
): Promise<OperationalServices> {
  const config = integratedConfig();
  if (!config) throw new DposConfigError([{ code: "NOT_INTEGRATED", field: "IAM_DEPLOYMENT_MODE", message: "IAM is not running in DPOS_INTEGRATED mode" }]);
  const context = await resolveCompanyContext(prisma, config);
  const identity = await requireServiceIdentity(prisma, config, config.serviceIdentity.identityId, capability);
  return { config, context, identity, client: new DataHubClient({ config, identity }) };
}
