/**
 * IAM V1.0 fixed configuration — validation-stage build.
 * Priority weights are NOT user-adjustable in V1 (doc 00 §4, Build Brief §6).
 *
 * Surfacing unit is the work package (grouped business case), not a lone SKU.
 * Management still reviews a small featured set; owners get a broader execution queue.
 */

/** Featured unit for management review */
export const FEATURED_UNIT = "work_package" as const;

/** Core weekly management-focus work packages */
export const FEATURED_PRIORITY_COUNT = 2;

/** Management may elevate a 3rd package for material out-of-cycle events */
export const MAX_MANAGEMENT_PRIORITY_SLOTS = 3;

/**
 * Ranked Candidate packages beyond featured remain available for execution release
 * (Candidate → Approved) without auto-backfilling featured slots.
 */
export const EXECUTION_QUEUE_VISIBLE_COUNT = 12;

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

/** Keystroke export rule */
export const KEYSTROKE_IMPORT_EXTENSION = ".txt";
