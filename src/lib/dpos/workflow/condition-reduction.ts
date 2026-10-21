/**
 * Stage 4B condition reduction (pure).
 *
 *   condition reduction % = (baseline exposure - current exposure) / baseline exposure x 100
 *
 * It is defined ONLY when a valid quantitative baseline exists (a finite number greater than zero) and a valid current
 * exposure (finite, not negative). Otherwise the result is NOT_YET_MEASURED and no percentage is produced - never a
 * guess, a default or a zero. Action completion is a different measure and is never combined with this one.
 */
export type ConditionReduction =
  | {
      status: "MEASURED";
      /** Exact formula result rounded to 2 decimals. Negative when the condition is WORSE than the baseline. */
      pct: number;
      /** The same value limited to 0..100 for the shared contract (its percent type cannot express a negative value). */
      contractPct: number;
      worseThanBaseline: boolean;
    }
  | { status: "NOT_YET_MEASURED"; pct: null; contractPct: null; worseThanBaseline: false; reason: string };

export function computeConditionReduction(baselineExposure: number | null | undefined, currentExposure: number | null | undefined): ConditionReduction {
  const notMeasured = (reason: string): ConditionReduction => ({ status: "NOT_YET_MEASURED", pct: null, contractPct: null, worseThanBaseline: false, reason });
  if (baselineExposure === null || baselineExposure === undefined) return notMeasured("No quantitative baseline exposure has been recorded.");
  if (typeof baselineExposure !== "number" || !Number.isFinite(baselineExposure)) return notMeasured("The baseline exposure is not a finite number.");
  if (baselineExposure <= 0) return notMeasured("A baseline exposure of zero or less cannot support a percentage.");
  if (currentExposure === null || currentExposure === undefined) return notMeasured("No current exposure has been recorded.");
  if (typeof currentExposure !== "number" || !Number.isFinite(currentExposure) || currentExposure < 0) return notMeasured("The current exposure is not a valid non-negative number.");
  const raw = ((baselineExposure - currentExposure) / baselineExposure) * 100;
  const pct = Math.round(raw * 100) / 100;
  return { status: "MEASURED", pct, contractPct: Math.min(100, Math.max(0, pct)), worseThanBaseline: pct < 0 };
}
