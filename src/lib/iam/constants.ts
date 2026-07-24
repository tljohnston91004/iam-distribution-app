/**
 * IAM V1.0 fixed configuration — validation-stage build.
 * Priority weights are NOT user-adjustable in V1 (doc 00 §4, Build Brief §6).
 * Stage 2 will implement full scoring from doc 04 using these defaults.
 */

/** Core weekly surfaced priorities */
export const FEATURED_PRIORITY_COUNT = 2;

/** Management may elevate a 3rd priority for material out-of-cycle events */
export const MAX_MANAGEMENT_PRIORITY_SLOTS = 3;

/** Default weekly rhythm label */
export const DEFAULT_RUN_NAME = "Weekly Inventory Action Review";

/** Fixed ranking weights (V1 — cash impact leads). Stage 2 scoring engine uses these. */
export const V1_RANKING_WEIGHTS = {
  cashImpact: 0.45,
  serviceOperationalRisk: 0.35,
  inventoryCondition: 0.12,
  actionability: 0.08,
} as const;

/** Service/operational risk override threshold — must be clearly more dangerous */
export const SERVICE_RISK_OVERRIDE_MIN_RATIO = 1.5;

/** Product module URLs (local dev defaults) */
export const SIBLING_MODULE_URLS = {
  rse: process.env.RSE_API_URL ?? "http://127.0.0.1:3000",
  ifm: process.env.IFM_API_URL ?? "http://127.0.0.1:3001",
} as const;

/** Write-back export extension (operational note; Keystroke adapter owns intake). */
export const LEGACY_IMPORT_READY_EXTENSION = ".txt";
