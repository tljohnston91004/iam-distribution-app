/**
 * Stage 4D Cost of Inaction (COI) - pure.
 *
 *   excess COI = excess value x carrying rate x days / 365  +  supported expected preventable loss
 *
 *  - Horizon = the target-resolution horizon of the plan (days from the start of the horizon to the target resolution date),
 *    defaulting to 30 days when no target is known.
 *  - Carrying rate: 24% a year (pilot value; a company-governed rate would replace it).
 *  - The exposure is the RESIDUAL excess after natural sell-through (never the gross excess when sell-through is evidenced).
 *  - Only SUPPORTED expected preventable loss (with an evidence reference) is added. If only carrying cost can be computed the COI is
 *    marked PARTIAL, so it is never presented as the whole cost of inaction. With no exposure value there is no COI at all.
 */
import { NATURAL_SELL_THROUGH_DAYS, residualAfterNaturalSellThrough, type NaturalSellThroughEvidence } from "../health/sell-through";

export const COI_POLICY = { defaultHorizonDays: 30, annualCarryingRate: 0.24, provisional: true } as const;

export type CoiStatus = "COMPLETE" | "PARTIAL" | "NOT_COMPUTABLE";

export interface CoiInput {
  /** The gross excess / affected inventory value. Null or non-positive: nothing to carry. */
  excessValue: number | null | undefined;
  naturalSellThrough?: NaturalSellThroughEvidence | null;
  /** Start of the horizon (default: now). */
  from: Date;
  /** The plan's target resolution date; null -> the 30-day default horizon. */
  targetResolution?: Date | null;
  expectedPreventableLoss?: { amount: number; evidenceRef?: string | null; basis?: string | null } | null;
  carryingRate?: number;
}

export interface CoiResult {
  status: CoiStatus;
  horizonDays: number;
  horizonBasis: "TARGET_RESOLUTION" | "DEFAULT_30_DAYS";
  carryingRate: number;
  grossExcessValue: number | null;
  protectedByNaturalSellThrough: number;
  residualExcessValue: number | null;
  naturalSellThroughNote: string | null;
  carryingCost: number | null;
  expectedPreventableLoss: number | null;
  expectedPreventableLossSupported: boolean;
  /** Carrying cost + supported expected preventable loss. Null when not computable. */
  total: number | null;
  /** What the figure covers / omits, in words. */
  statement: string;
}

const round2 = (n: number) => Math.round(n * 100) / 100;

export function computeCoi(input: CoiInput): CoiResult {
  const rate = input.carryingRate ?? COI_POLICY.annualCarryingRate;
  const target = input.targetResolution ?? null;
  let horizonDays: number = COI_POLICY.defaultHorizonDays;
  let horizonBasis: CoiResult["horizonBasis"] = "DEFAULT_30_DAYS";
  if (target && !Number.isNaN(target.getTime())) {
    const d = Math.ceil((target.getTime() - input.from.getTime()) / (24 * 3600 * 1000));
    if (d >= 1) {
      horizonDays = d;
      horizonBasis = "TARGET_RESOLUTION";
    }
  }
  const gross = typeof input.excessValue === "number" && Number.isFinite(input.excessValue) && input.excessValue > 0 ? input.excessValue : null;
  const base = { horizonDays, horizonBasis, carryingRate: rate };
  if (gross === null) {
    return { ...base, status: "NOT_COMPUTABLE", grossExcessValue: null, protectedByNaturalSellThrough: 0, residualExcessValue: null, naturalSellThroughNote: null, carryingCost: null, expectedPreventableLoss: null, expectedPreventableLossSupported: false, total: null, statement: "No quantified excess value is available, so the cost of inaction cannot be computed." };
  }
  const st = residualAfterNaturalSellThrough(gross, input.naturalSellThrough ?? null, NATURAL_SELL_THROUGH_DAYS);
  const carrying = round2((st.residual * rate * horizonDays) / 365);
  const loss = input.expectedPreventableLoss;
  const lossSupported = !!loss && Number.isFinite(loss.amount) && loss.amount > 0 && !!loss.evidenceRef && loss.evidenceRef.trim() !== "";
  const lossAmount = lossSupported ? round2(loss!.amount) : null;
  const total = round2(carrying + (lossAmount ?? 0));
  return {
    ...base,
    status: lossSupported ? "COMPLETE" : "PARTIAL",
    grossExcessValue: round2(gross),
    protectedByNaturalSellThrough: round2(st.protectedApplied),
    residualExcessValue: round2(st.residual),
    naturalSellThroughNote: st.reason,
    carryingCost: carrying,
    expectedPreventableLoss: lossAmount,
    expectedPreventableLossSupported: lossSupported,
    total,
    statement: lossSupported
      ? `Carrying cost over ${horizonDays} days plus supported expected preventable loss.`
      : `PARTIAL: carrying cost over ${horizonDays} days only. No supported expected preventable loss is available, so this is not the whole cost of inaction.`,
  };
}
