import type { CoiResult } from "./calculate";
import { MISSING_CARRYING_RATE_COI_MESSAGE } from "@/lib/iam/company/carrying-cost-rate-shared";

export { MISSING_CARRYING_RATE_COI_MESSAGE };

/** Board / Priority section display — never blank without explanation. */
export function formatCoiBoardDisplay(opts: {
  costOfInaction: number | null;
  coiBoardDisplayLine?: string | null;
  coiCalculationStatus?: string | null;
  coiCalculationExplanation?: string | null;
  /** When known, prefer the specific missing-rate message over a generic fallback. */
  companyCarryingCostRateConfigured?: boolean | null;
}): string {
  if (opts.coiBoardDisplayLine?.trim()) return opts.coiBoardDisplayLine.trim();
  if (opts.coiCalculationExplanation?.trim()) return opts.coiCalculationExplanation.trim();
  if (opts.costOfInaction != null) {
    return `Estimated Cost of Inaction: $${Math.round(opts.costOfInaction).toLocaleString("en-US")}`;
  }
  if (opts.companyCarryingCostRateConfigured === false) {
    return MISSING_CARRYING_RATE_COI_MESSAGE;
  }
  return "COI cannot be calculated because required inputs are unavailable.";
}

export function formatCoiDetailSummary(coi: CoiResult): string {
  return coi.coiCalculationExplanation;
}
