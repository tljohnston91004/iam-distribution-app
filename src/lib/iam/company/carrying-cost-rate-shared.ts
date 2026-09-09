/**
 * Carrying-cost rate constants/types — safe for client components (no Prisma).
 */

export const CARRYING_COST_RATE_FIELD = "annual_inventory_carrying_cost_rate";
export const CARRYING_COST_RATE_PERMISSION = "company_financial_config";
/** Approved absolute maximum (100%). Values below 0% or above this are rejected. */
export const MAX_ANNUAL_CARRYING_COST_RATE = 1;

export const CARRYING_COST_RATE_SOURCES = [
  "Company-provided rate",
  "Calculated company rate",
  "Management-approved assumption",
  "Default onboarding assumption",
] as const;

export type CarryingCostRateSource = (typeof CARRYING_COST_RATE_SOURCES)[number];

export const MISSING_CARRYING_RATE_COI_MESSAGE =
  "COI cannot be calculated because the company's annual inventory carrying-cost rate has not been configured.";

export function percentToDecimal(percent: number): number {
  return percent / 100;
}

export function decimalToPercent(rate: number): number {
  return Math.round(rate * 10000) / 100;
}

export function validateCarryingCostRateDecimal(
  rate: number,
  maxAllowed: number = MAX_ANNUAL_CARRYING_COST_RATE
): { ok: true } | { ok: false; error: string } {
  if (!Number.isFinite(rate)) {
    return { ok: false, error: "Annual Inventory Carrying-Cost Rate must be a number" };
  }
  if (rate < 0) {
    return { ok: false, error: "Annual Inventory Carrying-Cost Rate cannot be below 0%" };
  }
  if (rate > maxAllowed) {
    return {
      ok: false,
      error: `Annual Inventory Carrying-Cost Rate cannot exceed ${(maxAllowed * 100).toFixed(0)}%`,
    };
  }
  return { ok: true };
}

const AUTHORIZED_ROLES = new Set(["executive", "operations", "management", "company_admin"]);

export function isAuthorizedToEditCarryingCostRate(performedBy: string): boolean {
  const s = performedBy.trim().toLowerCase();
  if (AUTHORIZED_ROLES.has(s)) return true;
  for (const role of AUTHORIZED_ROLES) {
    if (s.includes(role)) return true;
  }
  return false;
}
