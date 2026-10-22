/**
 * Stage 4D: Inventory Management Health Score configuration (IAM_HEALTH_SCORE_V1).
 *
 * LOCKED by the Product Owner / specification: the five components, their nominal weights (40 / 20 / 15 / 15 / 10) and the four
 * labels with their boundaries.
 *
 * PROVISIONAL (not specified anywhere, so NOT silently invented as final): every "curve" below - how an exposure share, a turns
 * ratio, an aging band or a recurrence count turns into a 0-100 component value. They are DATA (versioned and hashed with the
 * configuration), every stored Health Score carries `curveStatus: "PROVISIONAL"` and the board says so, and the Product Owner is
 * asked to approve or replace them. Approving them changes `HEALTH_CURVE_STATUS` and nothing else.
 */
import { createHash } from "node:crypto";
import { canonicalJson } from "../scoring/config";

export const HEALTH_VERSION = "IAM_HEALTH_SCORE_V1";

/** PROVISIONAL until the Product Owner approves the component curves (PO decision 4D-P1). */
export const HEALTH_CURVE_STATUS: "PROVISIONAL" | "APPROVED" = "PROVISIONAL";

export const COMPONENT_KEYS = ["POSITION_BALANCE", "EFFICIENCY", "SLOW_NONMOVING", "SHORTAGE_BACKORDER", "ACTION_RESOLUTION"] as const;
export type ComponentKey = (typeof COMPONENT_KEYS)[number];

export const COMPONENT_LABELS: Record<ComponentKey, string> = {
  POSITION_BALANCE: "Position & Balance",
  EFFICIENCY: "Efficiency",
  SLOW_NONMOVING: "Slow / Nonmoving",
  SHORTAGE_BACKORDER: "Customer Shortage / Backorder",
  ACTION_RESOLUTION: "Action Resolution",
};

export const HEALTH_LABELS = ["STRONG", "HEALTHY", "WATCH", "NEEDS_ATTENTION"] as const;
export type HealthLabel = (typeof HEALTH_LABELS)[number];

export const HEALTH_LABEL_TEXT: Record<HealthLabel, string> = {
  STRONG: "Strong",
  HEALTHY: "Healthy",
  WATCH: "Watch",
  NEEDS_ATTENTION: "Needs Attention",
};

export interface HealthConfig {
  version: string;
  /** Nominal weights (percent) - locked. They always sum to 100. */
  weights: Record<ComponentKey, number>;
  /** Locked label floors on the two-decimal score: 90-100 Strong, 75-89.99 Healthy, 60-74.99 Watch, below 60 Needs Attention. */
  labelFloors: Array<{ label: HealthLabel; minHundredths: number }>;
  curves: {
    positionBalance: {
      /** Out-of-balance (below Min + above Max) exposure as a % of total inventory book value at which the component reaches 0. */
      outOfBalanceSharePctForZero: number;
    };
    efficiency: {
      /** Actual / company target ratio at or above which the efficiency measure scores 100. */
      fullCreditRatio: number;
      /** Actual / company target ratio at or below which the measure scores 0 (linear in between). */
      zeroCreditRatio: number;
    };
    slowNonmoving: {
      /** Residual (after natural sell-through protection and overlap) slow + nonmoving exposure as a % of total inventory book value at which the component reaches 0. */
      residualSharePctForZero: number;
      /** Natural sell-through protection horizon in days (locked at 90). Evidence for a longer horizon is not applied. */
      sellThroughHorizonDays: number;
    };
    shortage: {
      /** Severity-weighted backorder value as a % of one week of revenue at which the component reaches 0. */
      weightedShareOfWeeklyRevenuePctForZero: number;
      /** Age multipliers by days since the original order date: the first band whose maxDays is not exceeded applies. */
      ageBands: Array<{ maxDays: number | null; multiplier: number }>;
      /** Recurrence multipliers by the number of distinct open orders backordered for the same parentSku + childPartOrVariant. */
      recurrenceBands: Array<{ minOrders: number; multiplier: number }>;
      /** Largest share of backorder lines without a priced value for which the priced lines still score; above it the component is unavailable. */
      maxUnpricedLineShare: number;
    };
    actionResolution: {
      lookbackDays: number;
      /** Multiplier applied to a completion that finished after its target resolution date. */
      lateCompletionFactor: number;
      /** Multiplier applied when the same grouped condition has more than one completion in the window (the condition recurred). */
      recurrenceFactor: number;
    };
  };
  /** Weeks of history compared for "change since prior". */
  materiality: {
    /** A change in the composite or a component below this many points is not reported as a change. */
    scorePoints: number;
  };
}

export const HEALTH_CONFIG: HealthConfig = {
  version: HEALTH_VERSION,
  weights: { POSITION_BALANCE: 40, EFFICIENCY: 20, SLOW_NONMOVING: 15, SHORTAGE_BACKORDER: 15, ACTION_RESOLUTION: 10 },
  labelFloors: [
    { label: "STRONG", minHundredths: 9000 },
    { label: "HEALTHY", minHundredths: 7500 },
    { label: "WATCH", minHundredths: 6000 },
    { label: "NEEDS_ATTENTION", minHundredths: 0 },
  ],
  curves: {
    positionBalance: { outOfBalanceSharePctForZero: 40 },
    efficiency: { fullCreditRatio: 1, zeroCreditRatio: 0.5 },
    slowNonmoving: { residualSharePctForZero: 30, sellThroughHorizonDays: 90 },
    shortage: {
      weightedShareOfWeeklyRevenuePctForZero: 25,
      ageBands: [
        { maxDays: 7, multiplier: 0.5 },
        { maxDays: 30, multiplier: 1 },
        { maxDays: 60, multiplier: 1.5 },
        { maxDays: null, multiplier: 2 },
      ],
      recurrenceBands: [
        { minOrders: 1, multiplier: 1 },
        { minOrders: 2, multiplier: 1.25 },
        { minOrders: 4, multiplier: 1.5 },
      ],
      maxUnpricedLineShare: 0.05,
    },
    actionResolution: { lookbackDays: 90, lateCompletionFactor: 0.8, recurrenceFactor: 0.75 },
  },
  materiality: { scorePoints: 0.5 },
};

export const healthConfigHash = (cfg: HealthConfig = HEALTH_CONFIG): string => createHash("sha256").update(canonicalJson({ cfg, curveStatus: HEALTH_CURVE_STATUS })).digest("hex");

/** Fail fast on a malformed configuration (weights must be the locked ones and sum to 100). */
export function assertHealthConfig(cfg: HealthConfig = HEALTH_CONFIG): void {
  const sum = COMPONENT_KEYS.reduce((a, k) => a + cfg.weights[k], 0);
  if (sum !== 100) throw new Error(`Health weights must sum to 100 (got ${sum}).`);
}
assertHealthConfig();
