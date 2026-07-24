/**
 * Shared financial / operational impact scoring for discovery + interim profile.
 * Financial impact leads; operational risk may override when justified.
 */

/** Maps dollar exposure to 0–100 with enough range that $400k clearly outranks $5k. */
export function cashImpactScore(cashImpact: number): number {
  const dollars = Math.max(0, cashImpact);
  // Linear path: $4,000 → 10 pts, $40,000 → 100 pts (capped). Soft log preserves small-value nuance.
  const linear = (dollars / 4000) * 10;
  const softLog = Math.log10(dollars + 1) * 8;
  return Math.min(100, linear + softLog);
}

export type ImpactRankable = {
  estimatedCashImpact: number;
  priorityScore: number;
  serviceOperationalRisk?: boolean;
  serviceRiskScore?: number;
  detail?: Record<string, unknown>;
};

/**
 * Sort by business impact: critical operational override first among peers,
 * then total financial exposure, then composite priority score.
 */
export function compareByBusinessImpact(a: ImpactRankable, b: ImpactRankable): number {
  const aCrit = isCriticalOperationalOverride(a) ? 1 : 0;
  const bCrit = isCriticalOperationalOverride(b) ? 1 : 0;
  if (bCrit !== aCrit) return bCrit - aCrit;
  const cashDelta = (b.estimatedCashImpact ?? 0) - (a.estimatedCashImpact ?? 0);
  if (Math.abs(cashDelta) > 0.01) return cashDelta;
  return (b.priorityScore ?? 0) - (a.priorityScore ?? 0);
}

export function isCriticalOperationalOverride(row: ImpactRankable): boolean {
  if (row.detail?.criticalOverride === true) return true;
  const service = row.serviceRiskScore ?? 0;
  const cash = cashImpactScore(row.estimatedCashImpact ?? 0);
  return Boolean(row.serviceOperationalRisk) && service / Math.max(cash, 1) >= 1.5;
}
