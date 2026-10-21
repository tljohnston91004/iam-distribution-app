/**
 * IAM-internal module eligibility enforcement (Stage 4A).
 *
 * The same governed chain the DPOS operator front door uses, evaluated again INSIDE IAM so that IAM cannot be reached
 * around the front door:
 *
 *     Installed -> Entitled -> Implementation Ready -> Enabled -> User Authorized
 *
 * It delegates to the shared Stage 1B access module (`module-access.mjs`) and the release module registry, loaded from
 * the DPOS application tree configured by IAM_DPOS_APPLICATION_ROOT (no hard-coded path). Everything fails closed.
 *
 * The Results Return SERVICE path does not use this chain: it uses the separate Stage 3 service eligibility
 * (`evaluateServiceEligibility(context, "IAM", "RESULTS_RETURN")`) enforced by Data Hub, and a service identity is
 * never accepted as an end user here.
 */
import { existsSync, readFileSync } from "fs";
import path from "path";
import { pathToFileURL } from "url";

export const IAM_MODULE_ID = "IAM";
export const ELIGIBILITY_STAGES = ["INSTALLED", "ENTITLED", "IMPLEMENTATION_READY", "ENABLED", "USER_AUTHORIZED"] as const;
export type EligibilityStage = (typeof ELIGIBILITY_STAGES)[number];

export interface EligibilityUser {
  identityId: string | null;
  userId: string | null;
  /** Module access list the DPOS front door granted this user (the user's `allowedModules`). */
  allowedModules: string[];
  roles: string[];
}

export interface ModuleEligibilityVerdict {
  allowed: boolean;
  /** Stage 1B access state (OPERATIONAL, NOT_ENTITLED, NOT_READY, DISABLED, USER_NOT_AUTHORIZED, ...) or ELIGIBILITY_UNAVAILABLE. */
  state: string;
  code: string;
  detail: string;
  httpStatus: number;
  chain: Record<EligibilityStage, boolean | null>;
  /** First stage in the chain that failed, null when allowed. */
  blockedAt: EligibilityStage | null;
  evaluatedAt: string;
}

export interface ModuleEligibilityPort {
  evaluate(
    company: { dposCompanyId: string; installationId: string },
    user: EligibilityUser | null,
  ): Promise<ModuleEligibilityVerdict>;
}

interface Verdict {
  state: string;
  code: string;
  detail: string;
  httpStatus: number;
  company: { installed: boolean; entitled: boolean; implementationReady: boolean; enabled: boolean; operationalService: boolean };
  userAuthorized?: boolean;
}
interface Context {
  metadata: { ok: boolean; code?: string; identity?: { installationId?: string; companyId?: string | null } };
}
interface ModuleAccessApi {
  loadModuleRegistry(file: string): unknown;
  parseTrustStore(raw: unknown): unknown;
  loadAccessContext(input: { root: string | null; registry: unknown; companyId: string | null; releaseTrustStore?: unknown }): Context;
  evaluateModuleAccess(context: Context, moduleId: string, user: { allowedModules?: string[] } | null): Verdict;
  accessContextStamp(root: string | null, companyId: string | null): string;
}

export interface InstallationEligibilityOptions {
  /** DPOS application root: contains packages/deployment/operator-front-door/module-access.mjs and release/. */
  applicationRoot: string;
  /** DPOS installation root: contains config/ and state/. */
  installationRoot: string;
  /** Registry override (tests only). Defaults to <applicationRoot>/release/module-registry.json. */
  registryFile?: string;
  cacheTtlMs?: number;
  now?: () => number;
}

const MODULE_ACCESS_RELATIVE = path.join("packages", "deployment", "operator-front-door", "module-access.mjs");

const STAGE_FOR_STATE: Record<string, EligibilityStage> = {
  NOT_INSTALLED: "INSTALLED",
  INSTALLATION_UNVERIFIED: "INSTALLED",
  ENTITLEMENT_INVALID: "ENTITLED",
  NOT_ENTITLED: "ENTITLED",
  NOT_READY: "IMPLEMENTATION_READY",
  DISABLED: "ENABLED",
  USER_NOT_AUTHORIZED: "USER_AUTHORIZED",
};

function closed(code: string, detail: string, httpStatus: number, state = "ELIGIBILITY_UNAVAILABLE"): ModuleEligibilityVerdict {
  return {
    allowed: false,
    state,
    code,
    detail,
    httpStatus,
    chain: { INSTALLED: null, ENTITLED: null, IMPLEMENTATION_READY: null, ENABLED: null, USER_AUTHORIZED: null },
    blockedAt: null,
    evaluatedAt: new Date().toISOString(),
  };
}

export function createInstallationModuleEligibilityPort(options: InstallationEligibilityOptions): ModuleEligibilityPort {
  const ttl = options.cacheTtlMs ?? 30_000;
  const clock = options.now ?? Date.now;
  const moduleAccessFile = path.join(options.applicationRoot, MODULE_ACCESS_RELATIVE);
  const releaseDir = path.join(options.applicationRoot, "release");
  let loaded: { api: ModuleAccessApi; registry: unknown; releaseTrustStore: unknown } | null = null;
  const cache = new Map<string, { stamp: string; at: number; context: Context }>();

  async function load() {
    if (loaded) return loaded;
    if (!existsSync(moduleAccessFile)) throw new Error("module-access.mjs was not found under the configured DPOS application root");
    const api = (await import(/* webpackIgnore: true */ pathToFileURL(moduleAccessFile).href)) as ModuleAccessApi;
    const registry = api.loadModuleRegistry(options.registryFile ?? path.join(releaseDir, "module-registry.json"));
    let releaseTrustStore: unknown;
    try {
      releaseTrustStore = api.parseTrustStore(JSON.parse(readFileSync(path.join(releaseDir, "trust", "dpos-trust-store.json"), "utf8")));
    } catch {
      releaseTrustStore = { schemaVersion: 1, trustStoreVersion: "unavailable", keys: [] };
    }
    loaded = { api, registry, releaseTrustStore };
    return loaded;
  }

  return {
    async evaluate(company, user) {
      try {
        const { api, registry, releaseTrustStore } = await load();
        const stamp = api.accessContextStamp(options.installationRoot, company.dposCompanyId);
        let entry = cache.get(company.dposCompanyId);
        if (!entry || entry.stamp !== stamp || clock() - entry.at >= ttl) {
          const context = api.loadAccessContext({
            root: options.installationRoot,
            registry,
            companyId: company.dposCompanyId,
            releaseTrustStore,
          });
          entry = { stamp, at: clock(), context };
          cache.set(company.dposCompanyId, entry);
        }
        const context = entry.context;
        // The installation this IAM serves must be the installation the governed state describes.
        const identity = context.metadata.ok ? context.metadata.identity : undefined;
        if (identity?.installationId && identity.installationId !== company.installationId) {
          return closed("INSTALLATION_MISMATCH", "The configured IAM installation id is not the governed installation.", 403, "INSTALLATION_UNVERIFIED");
        }
        if (identity?.companyId && identity.companyId.toLowerCase() !== company.dposCompanyId.toLowerCase()) {
          return closed("INSTALLATION_COMPANY_MISMATCH", "The governed installation belongs to a different company.", 403, "INSTALLATION_UNVERIFIED");
        }
        const v = api.evaluateModuleAccess(context, IAM_MODULE_ID, { allowedModules: user?.allowedModules ?? [] });
        const allowed = v.state === "OPERATIONAL" && user !== null;
        const chain: Record<EligibilityStage, boolean | null> = {
          INSTALLED: v.company.installed,
          ENTITLED: v.company.entitled,
          IMPLEMENTATION_READY: v.company.implementationReady,
          ENABLED: v.company.enabled,
          USER_AUTHORIZED: v.userAuthorized ?? false,
        };
        return {
          allowed,
          state: v.state,
          code: v.code,
          detail: v.detail,
          httpStatus: allowed ? 200 : v.httpStatus || 403,
          chain,
          blockedAt: allowed ? null : (STAGE_FOR_STATE[v.state] ?? (ELIGIBILITY_STAGES.find((s) => chain[s] === false) ?? null)),
          evaluatedAt: new Date().toISOString(),
        };
      } catch (e) {
        loaded = null;
        return closed(
          "IAM_ELIGIBILITY_UNAVAILABLE",
          `Module eligibility could not be determined: ${e instanceof Error ? e.message : String(e)}`,
          503,
        );
      }
    },
  };
}

/** Port used when no DPOS installation is configured: everything is blocked (fail closed). */
export class NotConfiguredModuleEligibilityPort implements ModuleEligibilityPort {
  async evaluate(): Promise<ModuleEligibilityVerdict> {
    return closed(
      "IAM_ELIGIBILITY_NOT_CONFIGURED",
      "IAM_DPOS_APPLICATION_ROOT and IAM_DPOS_INSTALLATION_ROOT must be configured in DPOS_INTEGRATED mode.",
      503,
    );
  }
}
