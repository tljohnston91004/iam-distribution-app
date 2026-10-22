/**
 * Stage 4D natural sell-through protection (pure).
 *
 * Exposure that will sell through naturally within the protection horizon (90 days) is not a management problem, so it must not
 * degrade the Slow / Nonmoving component or inflate a plan's cost of inaction. Only the RESIDUAL exposure counts.
 *
 * Never inferred: protection is applied only when governed demand evidence supplies a protected value, its horizon is within the
 * window and it carries an evidence reference. Missing, over-horizon or unreferenced evidence applies NO protection (the full
 * exposure stays), with the reason recorded.
 */
export interface NaturalSellThroughEvidence {
  protectedValue: number;
  horizonDays: number;
  evidenceRef: string;
}

export interface ResidualExposure {
  exposure: number;
  protectedApplied: number;
  residual: number;
  applied: boolean;
  reason: string;
}

export const NATURAL_SELL_THROUGH_DAYS = 90;

export function residualAfterNaturalSellThrough(exposure: number, nst: NaturalSellThroughEvidence | null | undefined, horizonCapDays: number = NATURAL_SELL_THROUGH_DAYS): ResidualExposure {
  const e = Number.isFinite(exposure) && exposure > 0 ? exposure : 0;
  const none = (reason: string): ResidualExposure => ({ exposure: e, protectedApplied: 0, residual: e, applied: false, reason });
  if (!nst) return none("No natural sell-through evidence was supplied; none is inferred, so the full exposure counts.");
  if (!nst.evidenceRef || !nst.evidenceRef.trim()) return none("The natural sell-through value has no evidence reference; no protection is applied.");
  if (!Number.isFinite(nst.protectedValue) || nst.protectedValue < 0) return none("The natural sell-through value is not valid; no protection is applied.");
  if (!Number.isFinite(nst.horizonDays) || nst.horizonDays > horizonCapDays) {
    return none(`The sell-through evidence horizon (${nst.horizonDays} days) is longer than the ${horizonCapDays}-day protection window; no protection is applied.`);
  }
  const protectedApplied = Math.min(nst.protectedValue, e);
  return { exposure: e, protectedApplied, residual: e - protectedApplied, applied: protectedApplied > 0, reason: protectedApplied > 0 ? `Natural sell-through within ${nst.horizonDays} days protects ${protectedApplied}.` : "Evidence shows no natural sell-through within the window." };
}
