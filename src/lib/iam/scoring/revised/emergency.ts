/**
 * Automatic Emergency Review Tests A–E.
 * Trigger creates Emergency Review Candidate — does NOT auto-confirm Emergency Priority.
 */

import type { CustomerLevel, RiskLevel } from "./config";
import { CUSTOMER_REVENUE_POINTS, OPERATIONAL_RISK_POINTS } from "./config";

export type EmergencyTestId = "A" | "B" | "C" | "D" | "E";

export type EmergencyEvaluationInput = {
  operationalRiskScore: number;
  customerRevenueImpactScore: number;
  timeSensitivityScore: number;
  actionWindowDays: number | null;
  /** Test D — irreversible material loss likely (management/evidence flag). */
  irreversibleMaterialLossLikely?: boolean;
  /** Test E — verified legal/regulatory/safety/continuity threat. */
  verifiedCriticalThreat?: boolean;
};

export type EmergencyTestResult = {
  testId: EmergencyTestId;
  triggered: boolean;
  description: string;
};

export function evaluateEmergencyTests(input: EmergencyEvaluationInput): {
  anyTriggered: boolean;
  tests: EmergencyTestResult[];
  emergencyReviewCandidate: boolean;
} {
  const op = input.operationalRiskScore;
  const cust = input.customerRevenueImpactScore;
  const time = input.timeSensitivityScore;
  const window = input.actionWindowDays;

  const tests: EmergencyTestResult[] = [
    {
      testId: "A",
      triggered: op === 15 && time >= 8,
      description: "Operational Risk = 15 AND Time Sensitivity ≥ 8",
    },
    {
      testId: "B",
      triggered: cust === 10 && time >= 8,
      description: "Customer and Revenue Impact = 10 AND Time Sensitivity ≥ 8",
    },
    {
      testId: "C",
      triggered: op >= 12 && cust >= 8 && time >= 6,
      description: "Operational Risk ≥ 12 AND Customer Impact ≥ 8 AND Time Sensitivity ≥ 6",
    },
    {
      testId: "D",
      triggered:
        Boolean(input.irreversibleMaterialLossLikely) &&
        window != null &&
        window <= 14,
      description:
        "Irreversible material loss likely AND action window ≤ 14 days AND loss not reasonably recoverable after deadline",
    },
    {
      testId: "E",
      triggered: Boolean(input.verifiedCriticalThreat),
      description: "Verified legal, regulatory, safety, or business-continuity threat",
    },
  ];

  const anyTriggered = tests.some((t) => t.triggered);
  return {
    anyTriggered,
    tests,
    emergencyReviewCandidate: anyTriggered,
  };
}

export function operationalRiskPointsFromLevel(level: RiskLevel): number {
  return OPERATIONAL_RISK_POINTS[level];
}

export function customerPointsFromLevel(level: CustomerLevel): number {
  return CUSTOMER_REVENUE_POINTS[level];
}
