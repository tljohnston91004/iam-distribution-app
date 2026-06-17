import type { ConfidenceLevel } from "../types";

const CONFIDENCE_ORDER = [
  "High Confidence",
  "Medium Confidence",
  "Low Confidence",
  "Insufficient Data",
  "Unknown",
] as const;

export function lowestConfidence(...levels: string[]): ConfidenceLevel {
  let worst = 0;
  for (const level of levels) {
    const idx = CONFIDENCE_ORDER.indexOf(level as (typeof CONFIDENCE_ORDER)[number]);
    const rank = idx === -1 ? CONFIDENCE_ORDER.length - 1 : idx;
    if (rank > worst) worst = rank;
  }
  return CONFIDENCE_ORDER[worst] ?? "Unknown";
}

export function confidenceMultiplier(level: string): number {
  switch (level) {
    case "High Confidence":
      return 1;
    case "Medium Confidence":
      return 0.88;
    case "Low Confidence":
      return 0.68;
    case "Insufficient Data":
      return 0.45;
    default:
      return 0.75;
  }
}

export function readinessFromConfidence(
  level: string,
  hasRequiredFields: boolean
): string {
  if (!hasRequiredFields) return "Insufficient Support for Normal Surfacing";
  if (level === "Insufficient Data" || level === "Unknown") return "Cautious / Review Posture";
  if (level === "Low Confidence") return "Ready with Limitations";
  if (level === "Medium Confidence") return "Ready with Limitations";
  return "Ready for Normal Surfacing";
}

export function evidenceStrengthFromConfidence(level: string): string {
  if (level === "High Confidence") return "strong";
  if (level === "Medium Confidence") return "moderate";
  if (level === "Low Confidence") return "weak";
  return "unsupported";
}

export function actionStrengthFromScore(score: number, confidence: string): string {
  const adj = score * confidenceMultiplier(confidence);
  if (adj >= 80) return "Critical";
  if (adj >= 60) return "High";
  if (adj >= 40) return "Moderate";
  if (adj >= 20) return "Monitor";
  return "Watch";
}
