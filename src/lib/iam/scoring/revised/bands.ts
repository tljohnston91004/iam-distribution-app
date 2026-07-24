/**
 * Ratio / discrete band helpers — exact threshold enters the higher band.
 */

export function pointsFromAscendingMinBands(
  ratio: number,
  bands: { minRatioInclusive: number; points: number }[]
): number {
  const r = Number.isFinite(ratio) ? Math.max(0, ratio) : 0;
  for (const b of bands) {
    if (r >= b.minRatioInclusive) return b.points;
  }
  return 0;
}

export function timeSensitivityPoints(
  actionWindowDays: number | null,
  bands: { maxDaysInclusive: number; points: number }[]
): number {
  if (actionWindowDays == null || !Number.isFinite(actionWindowDays)) return 0;
  const d = Math.max(0, actionWindowDays);
  for (const b of bands) {
    if (d <= b.maxDaysInclusive) return b.points;
  }
  return 0;
}

export function priorityBandFromScore(
  finalScore: number,
  bands: { minInclusive: number; band: string }[]
): string {
  for (const b of bands) {
    if (finalScore >= b.minInclusive) return b.band;
  }
  return "Informational";
}

export function clamp(n: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, n));
}
