/**
 * Cost of Inaction (COI) — decision-support output (not an 8th scoring factor).
 * Formula (interim, PO-approved):
 *   carrying = affectedInventoryValue × annualCarryingCostRate × horizonDays / 365
 *   COI = carrying + preventableLoss (+ other supported components)
 * Do not copy cash impact into COI. Do not invent carrying-cost rate.
 */

export const DEFAULT_COI_HORIZON_DAYS = 30;

export type CoiHorizonSource =
  | "Recommended Action Target Period"
  | "Management-Adjusted Target Period"
  | "Default 30-Day Period"
  | "Contractual or External Deadline";

export type CoiHorizonUnit = "days" | "weeks" | "months";

export type CoiCalculationStatus = "calculated" | "partial" | "unavailable";

export type CoiConfidenceLevel = "High" | "Medium" | "Low" | "Insufficient";

export type CoiResult = {
  coiHorizonValue: number;
  coiHorizonUnit: CoiHorizonUnit;
  coiHorizonDays: number;
  coiHorizonSource: CoiHorizonSource;
  recommendedTargetPeriod: string | null;
  recommendedTargetEndDate: string | null;
  managementAdjustedTargetPeriod: string | null;
  managementAdjustmentReason: string | null;
  affectedInventoryValueForCoi: number | null;
  annualCarryingCostRate: number | null;
  carryingCostComponent: number | null;
  preventableLossComponent: number | null;
  otherCoiComponent: number | null;
  estimatedCostOfInaction: number | null;
  coiConfidenceLevel: CoiConfidenceLevel;
  coiCalculationStatus: CoiCalculationStatus;
  coiCalculationExplanation: string;
  boardDisplayLine: string;
  detailLines: string[];
  missingInputs: string[];
  excludedComponents: string[];
};

export type CoiInput = {
  /** From Prescribed Action Plan targetCompletionPeriod, or management override text. */
  recommendedTargetPeriodText?: string | null;
  managementAdjustedTargetPeriodText?: string | null;
  managementAdjustmentReason?: string | null;
  contractualDeadlineDays?: number | null;
  affectedInventoryValue: number | null;
  /** Annual rate as decimal (0.24 = 24%). From company config — never invent. */
  annualCarryingCostRate: number | null;
  /** Supported preventable-loss $ during horizon; omit/null if unsupported. */
  preventableLossDuringHorizon?: number | null;
  /** Other measurable delay costs; omit/null if unsupported. */
  otherCoiDuringHorizon?: number | null;
  /** Recommendation confidence (mapped to COI confidence with input quality). */
  recommendationConfidence?: string | null;
  asOfDate?: Date;
};

/** Round USD per app display rule (whole dollars). */
export function roundCoiUsd(n: number): number {
  return Math.round(n);
}

/**
 * Parse a target-resolution period string into days.
 * Supports days / weeks / months. Returns null if unparseable.
 */
export function parseTargetPeriodToDays(text: string | null | undefined): {
  value: number;
  unit: CoiHorizonUnit;
  days: number;
} | null {
  if (!text?.trim()) return null;
  const t = text.trim().toLowerCase();

  const month = t.match(/(\d+(?:\.\d+)?)\s*-\s*month|\b(\d+(?:\.\d+)?)\s*months?\b/);
  if (month) {
    const v = Number(month[1] ?? month[2]);
    if (Number.isFinite(v) && v > 0) {
      return { value: v, unit: "months", days: Math.round(v * 30) };
    }
  }

  const week = t.match(/(\d+(?:\.\d+)?)\s*-\s*week|\b(\d+(?:\.\d+)?)\s*weeks?\b/);
  if (week) {
    const v = Number(week[1] ?? week[2]);
    if (Number.isFinite(v) && v > 0) {
      return { value: v, unit: "weeks", days: Math.round(v * 7) };
    }
  }

  // "90-day …" or "90 days" or "14-day"
  const day = t.match(/(\d+(?:\.\d+)?)\s*-\s*day|\b(\d+(?:\.\d+)?)\s*days?\b/);
  if (day) {
    const v = Number(day[1] ?? day[2]);
    if (Number.isFinite(v) && v > 0) {
      return { value: v, unit: "days", days: Math.round(v) };
    }
  }

  return null;
}

function mapConfidence(
  recConf: string | null | undefined,
  missingCritical: boolean,
  partial: boolean
): CoiConfidenceLevel {
  if (missingCritical) return "Insufficient";
  const s = (recConf ?? "").toLowerCase();
  if (s.includes("insufficient")) return "Insufficient";
  if (partial) {
    if (s.includes("high")) return "Medium";
    if (s.includes("low")) return "Low";
    return "Low";
  }
  if (s.includes("high")) return "High";
  if (s.includes("low")) return "Low";
  return "Medium";
}

export function resolveCoiHorizon(input: CoiInput): {
  value: number;
  unit: CoiHorizonUnit;
  days: number;
  source: CoiHorizonSource;
  recommendedTargetPeriod: string | null;
  managementAdjustedTargetPeriod: string | null;
} {
  const mgmt = parseTargetPeriodToDays(input.managementAdjustedTargetPeriodText);
  if (mgmt) {
    return {
      ...mgmt,
      source: "Management-Adjusted Target Period",
      recommendedTargetPeriod: input.recommendedTargetPeriodText ?? null,
      managementAdjustedTargetPeriod: input.managementAdjustedTargetPeriodText ?? null,
    };
  }

  if (input.contractualDeadlineDays != null && input.contractualDeadlineDays > 0) {
    return {
      value: input.contractualDeadlineDays,
      unit: "days",
      days: Math.round(input.contractualDeadlineDays),
      source: "Contractual or External Deadline",
      recommendedTargetPeriod: input.recommendedTargetPeriodText ?? null,
      managementAdjustedTargetPeriod: null,
    };
  }

  const rec = parseTargetPeriodToDays(input.recommendedTargetPeriodText);
  if (rec) {
    return {
      ...rec,
      source: "Recommended Action Target Period",
      recommendedTargetPeriod: input.recommendedTargetPeriodText ?? null,
      managementAdjustedTargetPeriod: null,
    };
  }

  return {
    value: DEFAULT_COI_HORIZON_DAYS,
    unit: "days",
    days: DEFAULT_COI_HORIZON_DAYS,
    source: "Default 30-Day Period",
    recommendedTargetPeriod: input.recommendedTargetPeriodText ?? null,
    managementAdjustedTargetPeriod: null,
  };
}

/**
 * Compute Cost of Inaction. Never copies cash impact wholesale into COI.
 * Never invents annual carrying-cost rate.
 */
export function calculateCostOfInaction(input: CoiInput): CoiResult {
  const horizon = resolveCoiHorizon(input);
  const asOf = input.asOfDate ?? new Date();
  const end = new Date(asOf);
  end.setUTCDate(end.getUTCDate() + horizon.days);

  const missing: string[] = [];
  const excluded: string[] = [];

  const affected =
    input.affectedInventoryValue != null && Number.isFinite(input.affectedInventoryValue)
      ? Math.max(0, input.affectedInventoryValue)
      : null;
  if (affected == null) missing.push("affected inventory value for COI");

  const rate =
    input.annualCarryingCostRate != null &&
    Number.isFinite(input.annualCarryingCostRate) &&
    input.annualCarryingCostRate >= 0
      ? input.annualCarryingCostRate
      : null;
  if (rate == null) {
    missing.push("company annual inventory carrying-cost rate");
    excluded.push("carrying-cost component");
  }

  let carrying: number | null = null;
  if (affected != null && rate != null) {
    carrying = roundCoiUsd(affected * rate * (horizon.days / 365));
  }

  // Preventable loss — only when explicitly provided (supported). Do not invent.
  // Never treat cash impact / trapped cash as preventable loss (caller must not pass those).
  let preventable: number | null = null;
  const preventableProvided =
    input.preventableLossDuringHorizon != null &&
    Number.isFinite(input.preventableLossDuringHorizon) &&
    input.preventableLossDuringHorizon >= 0;
  if (preventableProvided) {
    preventable = roundCoiUsd(input.preventableLossDuringHorizon!);
  } else {
    excluded.push("preventable-loss / markdown deterioration (not yet available)");
  }

  let other: number | null = null;
  if (
    input.otherCoiDuringHorizon != null &&
    Number.isFinite(input.otherCoiDuringHorizon) &&
    input.otherCoiDuringHorizon >= 0
  ) {
    other = roundCoiUsd(input.otherCoiDuringHorizon);
  } else {
    excluded.push("other COI component (no supported amount)");
  }

  // Double-count prevention: same dollar effect must not appear in carrying + another component.
  if (carrying != null && preventable != null && preventable === carrying) {
    excluded.push("preventable-loss component (excluded to prevent double-counting with carrying cost)");
    preventable = null;
  }
  if (carrying != null && other != null && other === carrying) {
    excluded.push("other COI component (excluded to prevent double-counting with carrying cost)");
    other = null;
  }
  if (preventable != null && other != null && other === preventable) {
    excluded.push("other COI component (excluded to prevent double-counting with preventable loss)");
    other = null;
  }

  const parts: number[] = [];
  if (carrying != null) parts.push(carrying);
  if (preventable != null) parts.push(preventable);
  if (other != null) parts.push(other);

  let status: CoiCalculationStatus;
  let estimated: number | null = null;
  let explanation: string;
  let boardDisplayLine: string;

  // Full calculated when carrying is available and preventable was explicitly supplied (incl. $0).
  const fullySupported = carrying != null && preventableProvided;

  if (parts.length === 0) {
    status = "unavailable";
    const rateMissing = rate == null;
    const affectedMissing = affected == null;
    if (rateMissing && !affectedMissing) {
      explanation =
        "COI cannot be calculated because the company's annual inventory carrying-cost rate has not been configured.";
    } else if (affectedMissing && !rateMissing) {
      explanation = "COI cannot be calculated because affected inventory value for COI is unavailable.";
    } else if (rateMissing && affectedMissing) {
      explanation =
        "COI cannot be calculated because the company's annual inventory carrying-cost rate has not been configured and affected inventory value for COI is unavailable.";
    } else if (missing.length === 1) {
      explanation = `COI cannot be calculated because ${missing[0]} is unavailable.`;
    } else if (missing.length > 1) {
      explanation = `COI cannot be calculated because the following required inputs are unavailable: ${missing.join("; ")}.`;
    } else {
      explanation = "COI cannot be calculated because required inputs are unavailable.";
    }
    boardDisplayLine = explanation;
  } else if (!fullySupported) {
    status = "partial";
    estimated = roundCoiUsd(parts.reduce((s, n) => s + n, 0));
    const basis: string[] = [];
    if (carrying != null) basis.push("carrying cost");
    if (preventable != null) basis.push("preventable loss");
    if (other != null) basis.push("other supported delay costs");
    const excludedNote =
      carrying != null && !preventableProvided
        ? "markdown deterioration is not yet available"
        : rate == null
          ? "carrying-cost component is unavailable (no approved annual carrying-cost rate)"
          : "some COI components are not yet available";
    explanation =
      `Estimated COI over ${horizon.days} days: $${estimated.toLocaleString("en-US")}. ` +
      `Based on ${basis.join(" + ")}${basis.length === 1 ? " only" : ""}; ${excludedNote}.`;
    boardDisplayLine = `Estimated COI over ${horizon.days}-day target period: $${estimated.toLocaleString("en-US")}`;
  } else {
    status = "calculated";
    estimated = roundCoiUsd(parts.reduce((s, n) => s + n, 0));
    explanation =
      `Estimated COI over the ${horizon.days}-day target period: approximately $${estimated.toLocaleString("en-US")}. ` +
      `COI basis: carrying cost` +
      (preventable != null && preventable > 0 ? ` + preventable loss` : ` only`) +
      `. Horizon source: ${horizon.source}.`;
    boardDisplayLine = `Estimated COI over ${horizon.days}-day target period: $${estimated.toLocaleString("en-US")}`;
  }

  const partial = status === "partial";
  const unavailable = status === "unavailable";
  const confidence = mapConfidence(input.recommendationConfidence, unavailable, partial);

  const detailLines = [
    `Target period: ${horizon.days} days (${horizon.source})`,
    rate != null ? `Annual carrying-cost rate: ${(rate * 100).toFixed(1)}%` : "Annual carrying-cost rate: unavailable",
    carrying != null
      ? `Carrying-cost component: $${carrying.toLocaleString("en-US")}`
      : "Carrying-cost component: unavailable",
    preventable != null
      ? `Preventable-loss component: $${preventable.toLocaleString("en-US")}`
      : "Preventable-loss component: not available",
    `COI confidence: ${confidence}`,
    explanation,
  ];

  return {
    coiHorizonValue: horizon.value,
    coiHorizonUnit: horizon.unit,
    coiHorizonDays: horizon.days,
    coiHorizonSource: horizon.source,
    recommendedTargetPeriod: horizon.recommendedTargetPeriod,
    recommendedTargetEndDate: end.toISOString().slice(0, 10),
    managementAdjustedTargetPeriod: horizon.managementAdjustedTargetPeriod,
    managementAdjustmentReason: input.managementAdjustmentReason ?? null,
    affectedInventoryValueForCoi: affected,
    annualCarryingCostRate: rate,
    carryingCostComponent: carrying,
    preventableLossComponent: preventable,
    otherCoiComponent: other,
    estimatedCostOfInaction: estimated,
    coiConfidenceLevel: confidence,
    coiCalculationStatus: status,
    coiCalculationExplanation: explanation,
    boardDisplayLine,
    detailLines,
    missingInputs: missing,
    excludedComponents: excluded,
  };
}

/** Extract target period text from explainability / prescribed action plan. */
export function extractTargetPeriodFromExplainability(explainabilityJson: string | null): string | null {
  if (!explainabilityJson) return null;
  try {
    const ex = JSON.parse(explainabilityJson) as {
      prescribedActionPlan?: { targetCompletionPeriod?: string };
      detail?: { prescribedActionPlan?: { targetCompletionPeriod?: string } };
    };
    return (
      ex.prescribedActionPlan?.targetCompletionPeriod ??
      ex.detail?.prescribedActionPlan?.targetCompletionPeriod ??
      null
    );
  } catch {
    return null;
  }
}
