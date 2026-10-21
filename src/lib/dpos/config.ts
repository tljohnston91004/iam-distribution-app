/**
 * DPOS integration configuration (Stage 4A).
 *
 * Everything environment-specific is read from the process environment so the same build runs on the local Windows
 * workstation and, later, in a cloud deployment. Nothing here hard-codes a local path, company or secret, and secrets
 * are never part of the config object that is logged or returned by status endpoints (only the NAME of the variable
 * that holds a credential is carried).
 *
 * Deployment mode:
 *   STANDALONE_LEGACY (default when unset) — V1.5 behaviour exactly as the baseline. No DPOS eligibility is enforced.
 *   DPOS_INTEGRATED                        — governed company context, module eligibility enforcement, service identity,
 *                                            Data Hub client, scheduler and Results Return producer are active.
 */
import { isValidIanaTimeZone } from "./contract/iam-results-return";

export const DEPLOYMENT_MODES = ["STANDALONE_LEGACY", "DPOS_INTEGRATED"] as const;
export type DeploymentMode = (typeof DEPLOYMENT_MODES)[number];
export const ENVIRONMENT_CLASSES = ["PRODUCTION", "WORKSHOP", "TEST"] as const;
export type EnvironmentClass = (typeof ENVIRONMENT_CLASSES)[number];

export type EnvMap = Record<string, string | undefined>;

export interface ConfigIssue {
  code: string;
  field: string;
  message: string;
}

export interface DposIntegrationConfig {
  mode: "DPOS_INTEGRATED";
  environmentClass: EnvironmentClass;
  configurationId: string;
  dposCompanyId: string;
  dataHubCompanyId: string;
  installationId: string;
  /** Raw configured value; validated at use (a missing/invalid zone is an explicit scheduler failure, never UTC). */
  companyTimeZone: string | null;
  dataHub: {
    /** Origin only (no /api/v1). */
    baseUrl: string;
    httpTimeoutMs: number;
  };
  resultsReturn: {
    /** Origin of the Results Return endpoint. Defaults to the Data Hub origin. */
    baseUrl: string;
  };
  serviceIdentity: {
    /** Identity id sent to Data Hub. Null until an identity is issued; then outbound calls are refused. */
    identityId: string | null;
    /** NAME of the env var that holds the bearer credential (optional; Data Hub V1 trusts the identity headers). */
    credentialEnvName: string;
  };
  refresh: {
    hourLocal: number;
    schedulerEnabled: boolean;
    pollSeconds: number;
    /** Wait this long after a failed scheduled attempt before retrying the same occurrence. */
    retryMinutes: number;
    /** Give up on a scheduled occurrence after this many failed attempts (the failure stays visible). */
    maxAttempts: number;
  };
  outbox: {
    retryBaseSeconds: number;
    retryMaxSeconds: number;
    maxBatch: number;
    leaseSeconds: number;
  };
  eligibility: {
    /** DPOS application root (ships module-access.mjs and release/). */
    applicationRoot: string | null;
    /** DPOS installation root (config/ and state/). */
    installationRoot: string | null;
    /** Registry override for WORKSHOP/TEST only (refused in PRODUCTION). */
    registryFile: string | null;
    cacheTtlMs: number;
  };
  frontDoor: {
    /** NAME of the env var holding the shared secret the DPOS front door presents (never the secret). */
    credentialEnvName: string;
  };
}

export interface StandaloneConfig {
  mode: "STANDALONE_LEGACY";
}

export type LoadedConfig = StandaloneConfig | DposIntegrationConfig;

export type ConfigResult = { ok: true; config: LoadedConfig } | { ok: false; issues: ConfigIssue[] };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function text(env: EnvMap, key: string): string | null {
  const v = env[key];
  if (v === undefined) return null;
  const t = v.trim();
  return t === "" ? null : t;
}

function int(
  env: EnvMap,
  key: string,
  def: number,
  min: number,
  max: number,
  issues: ConfigIssue[],
): number {
  const raw = text(env, key);
  if (raw === null) return def;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < min || n > max) {
    issues.push({ code: "CONFIG_INVALID_NUMBER", field: key, message: `${key} must be an integer from ${min} to ${max}` });
    return def;
  }
  return n;
}

function bool(env: EnvMap, key: string, def: boolean, issues: ConfigIssue[]): boolean {
  const raw = text(env, key);
  if (raw === null) return def;
  if (/^(1|true|yes|on)$/i.test(raw)) return true;
  if (/^(0|false|no|off)$/i.test(raw)) return false;
  issues.push({ code: "CONFIG_INVALID_BOOLEAN", field: key, message: `${key} must be true or false` });
  return def;
}

/** Validates an origin-only http(s) URL; rejects embedded credentials and paths. */
export function parseOrigin(value: string, field: string, issues: ConfigIssue[]): string | null {
  let u: URL;
  try {
    u = new URL(value);
  } catch {
    issues.push({ code: "CONFIG_INVALID_URL", field, message: `${field} is not a valid URL` });
    return null;
  }
  if (u.protocol !== "http:" && u.protocol !== "https:") {
    issues.push({ code: "CONFIG_INVALID_URL", field, message: `${field} must be http or https` });
    return null;
  }
  if (u.username || u.password) {
    issues.push({ code: "CONFIG_URL_HAS_CREDENTIALS", field, message: `${field} must not embed credentials` });
    return null;
  }
  if ((u.pathname !== "/" && u.pathname !== "") || u.search || u.hash) {
    issues.push({ code: "CONFIG_URL_NOT_ORIGIN", field, message: `${field} must be an origin only (no path); the API path is fixed by contract` });
    return null;
  }
  return u.origin;
}

export function parseDeploymentMode(env: EnvMap): { ok: true; mode: DeploymentMode } | { ok: false; issue: ConfigIssue } {
  const raw = text(env, "IAM_DEPLOYMENT_MODE");
  if (raw === null) return { ok: true, mode: "STANDALONE_LEGACY" };
  if ((DEPLOYMENT_MODES as readonly string[]).includes(raw)) return { ok: true, mode: raw as DeploymentMode };
  return {
    ok: false,
    issue: { code: "CONFIG_INVALID_MODE", field: "IAM_DEPLOYMENT_MODE", message: `IAM_DEPLOYMENT_MODE must be one of ${DEPLOYMENT_MODES.join(", ")}` },
  };
}

export function loadDposIntegrationConfig(env: EnvMap = process.env): ConfigResult {
  const mode = parseDeploymentMode(env);
  if (!mode.ok) return { ok: false, issues: [mode.issue] };
  if (mode.mode === "STANDALONE_LEGACY") return { ok: true, config: { mode: "STANDALONE_LEGACY" } };

  const issues: ConfigIssue[] = [];
  const req = (key: string): string | null => {
    const v = text(env, key);
    if (v === null) issues.push({ code: "CONFIG_MISSING", field: key, message: `${key} is required in DPOS_INTEGRATED mode` });
    return v;
  };

  const envClass = req("IAM_ENVIRONMENT_CLASS");
  if (envClass !== null && !(ENVIRONMENT_CLASSES as readonly string[]).includes(envClass)) {
    issues.push({ code: "CONFIG_INVALID_ENV_CLASS", field: "IAM_ENVIRONMENT_CLASS", message: `IAM_ENVIRONMENT_CLASS must be one of ${ENVIRONMENT_CLASSES.join(", ")}` });
  }
  const configurationId = req("IAM_CONFIGURATION_ID");
  const dposCompanyId = req("IAM_DPOS_COMPANY_ID");
  const dataHubCompanyId = req("IAM_DATA_HUB_COMPANY_ID");
  const installationId = req("IAM_INSTALLATION_ID");
  for (const [key, v] of [
    ["IAM_DPOS_COMPANY_ID", dposCompanyId],
    ["IAM_DATA_HUB_COMPANY_ID", dataHubCompanyId],
  ] as const) {
    if (v !== null && !UUID.test(v)) issues.push({ code: "CONFIG_INVALID_COMPANY_ID", field: key, message: `${key} must be a UUID` });
  }
  if (dposCompanyId && dataHubCompanyId && UUID.test(dposCompanyId) && UUID.test(dataHubCompanyId)) {
    if (dposCompanyId.toLowerCase() !== dataHubCompanyId.toLowerCase()) {
      issues.push({
        code: "COMPANY_ID_MISMATCH",
        field: "IAM_DATA_HUB_COMPANY_ID",
        message: "The DPOS company id and the Data Hub company id must be the same governed company identity",
      });
    }
  }
  const dataHubBase = req("DATA_HUB_BASE_URL");
  const dataHubOrigin = dataHubBase === null ? null : parseOrigin(dataHubBase, "DATA_HUB_BASE_URL", issues);
  const rrBase = text(env, "IAM_RESULTS_RETURN_BASE_URL");
  const rrOrigin = rrBase === null ? dataHubOrigin : parseOrigin(rrBase, "IAM_RESULTS_RETURN_BASE_URL", issues);

  const tzRaw = text(env, "IAM_COMPANY_TIME_ZONE");
  const hourLocal = int(env, "IAM_REFRESH_HOUR_LOCAL", 2, 0, 23, issues);
  const httpTimeoutMs = int(env, "DATA_HUB_HTTP_TIMEOUT_MS", 15000, 100, 300000, issues);
  const schedulerEnabled = bool(env, "IAM_SCHEDULER_ENABLED", false, issues);
  const pollSeconds = int(env, "IAM_SCHEDULER_POLL_SECONDS", 60, 1, 3600, issues);
  const retryMinutes = int(env, "IAM_REFRESH_RETRY_MINUTES", 15, 1, 1440, issues);
  const maxAttempts = int(env, "IAM_REFRESH_MAX_ATTEMPTS", 5, 1, 50, issues);
  const retryBaseSeconds = int(env, "IAM_OUTBOX_RETRY_BASE_SECONDS", 30, 1, 86400, issues);
  const retryMaxSeconds = int(env, "IAM_OUTBOX_RETRY_MAX_SECONDS", 3600, 1, 604800, issues);
  const maxBatch = int(env, "IAM_OUTBOX_MAX_BATCH", 20, 1, 500, issues);
  const leaseSeconds = int(env, "IAM_OUTBOX_LEASE_SECONDS", 120, 5, 3600, issues);
  const cacheTtlMs = int(env, "IAM_ELIGIBILITY_CACHE_TTL_MS", 30000, 0, 3600000, issues);
  if (envClass === "PRODUCTION" && text(env, "IAM_DPOS_REGISTRY_FILE") !== null) {
    issues.push({ code: "CONFIG_FORBIDDEN_IN_PRODUCTION", field: "IAM_DPOS_REGISTRY_FILE", message: "A registry override is not permitted in a PRODUCTION environment" });
  }
  if (retryMaxSeconds < retryBaseSeconds) {
    issues.push({ code: "CONFIG_INVALID_NUMBER", field: "IAM_OUTBOX_RETRY_MAX_SECONDS", message: "IAM_OUTBOX_RETRY_MAX_SECONDS must be >= IAM_OUTBOX_RETRY_BASE_SECONDS" });
  }

  if (issues.length > 0 || !envClass || !configurationId || !dposCompanyId || !dataHubCompanyId || !installationId || !dataHubOrigin || !rrOrigin) {
    return { ok: false, issues };
  }
  return {
    ok: true,
    config: {
      mode: "DPOS_INTEGRATED",
      environmentClass: envClass as EnvironmentClass,
      configurationId,
      dposCompanyId: dposCompanyId.toLowerCase(),
      dataHubCompanyId: dataHubCompanyId.toLowerCase(),
      installationId,
      companyTimeZone: tzRaw,
      dataHub: { baseUrl: dataHubOrigin, httpTimeoutMs },
      resultsReturn: { baseUrl: rrOrigin },
      serviceIdentity: {
        identityId: text(env, "IAM_SERVICE_IDENTITY_ID"),
        credentialEnvName: text(env, "IAM_SERVICE_CREDENTIAL_ENV") ?? "IAM_DATA_HUB_CREDENTIAL",
      },
      refresh: { hourLocal, schedulerEnabled, pollSeconds, retryMinutes, maxAttempts },
      outbox: { retryBaseSeconds, retryMaxSeconds, maxBatch, leaseSeconds },
      eligibility: {
        applicationRoot: text(env, "IAM_DPOS_APPLICATION_ROOT"),
        installationRoot: text(env, "IAM_DPOS_INSTALLATION_ROOT") ?? text(env, "DPOS_INSTALLATION_ROOT"),
        registryFile: text(env, "IAM_DPOS_REGISTRY_FILE"),
        cacheTtlMs,
      },
      frontDoor: { credentialEnvName: text(env, "IAM_FRONT_DOOR_CREDENTIAL_ENV") ?? "IAM_FRONT_DOOR_CREDENTIAL" },
    },
  };
}

export type TimeZoneStatus = "OK" | "MISSING" | "INVALID";

export function timeZoneStatusOf(value: string | null | undefined): TimeZoneStatus {
  if (value === null || value === undefined || value === "") return "MISSING";
  return isValidIanaTimeZone(value) ? "OK" : "INVALID";
}

/** Loads config and throws a single structured error when invalid (for server start-up). */
export class DposConfigError extends Error {
  constructor(public readonly issues: ConfigIssue[]) {
    super(`Invalid DPOS integration configuration: ${issues.map((i) => `${i.field} (${i.code})`).join(", ")}`);
    this.name = "DposConfigError";
  }
}

export function requireIntegratedConfig(env: EnvMap = process.env): DposIntegrationConfig {
  const r = loadDposIntegrationConfig(env);
  if (!r.ok) throw new DposConfigError(r.issues);
  if (r.config.mode !== "DPOS_INTEGRATED") throw new DposConfigError([{ code: "NOT_INTEGRATED", field: "IAM_DEPLOYMENT_MODE", message: "IAM is not running in DPOS_INTEGRATED mode" }]);
  return r.config;
}

/** Safe-to-publish projection (no secret values; credential variable NAMES only). */
export function describeConfig(config: LoadedConfig): Record<string, unknown> {
  if (config.mode === "STANDALONE_LEGACY") return { mode: config.mode };
  return {
    mode: config.mode,
    environmentClass: config.environmentClass,
    configurationId: config.configurationId,
    dposCompanyId: config.dposCompanyId,
    dataHubCompanyId: config.dataHubCompanyId,
    installationId: config.installationId,
    companyTimeZone: config.companyTimeZone,
    companyTimeZoneStatus: timeZoneStatusOf(config.companyTimeZone),
    dataHubBaseUrl: config.dataHub.baseUrl,
    resultsReturnBaseUrl: config.resultsReturn.baseUrl,
    serviceIdentityId: config.serviceIdentity.identityId,
    serviceCredentialEnvName: config.serviceIdentity.credentialEnvName,
    refresh: config.refresh,
    outbox: config.outbox,
  };
}
