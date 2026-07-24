/**
 * Tie-breaker sequence (§16). Records structured comparison — no invented prose.
 */

export type TieBreakComparable = {
  id: string;
  cashImpactScore: number;
  expected13WeekCashImpact: number;
  timeSensitivityScore: number;
  operationalRiskScore: number;
  customerRevenueImpactScore: number;
  expectedPreventableLoss: number;
  dataConfidenceRank: number; // higher = better (High=4 … Insufficient=0)
  benefitRealizationDays: number; // lower = faster
  executionBurdenPenalty: number; // more negative = higher burden; compare using absolute burden
  qualifiedPersistenceCycles: number;
  actionDeadline: string | null; // ISO; earlier wins
  candidateIdentifiedAt: string; // ISO; earlier wins
};

export type TieBreakStep = {
  criterion: string;
  aValue: number | string | null;
  bValue: number | string | null;
  winnerId: string | null; // null if still tied
};

export function resolveTie(
  a: TieBreakComparable,
  b: TieBreakComparable
): { winnerId: string; steps: TieBreakStep[]; explanation: string } {
  const steps: TieBreakStep[] = [];

  function higher(criterion: string, av: number, bv: number): string | null {
    if (av === bv) {
      steps.push({ criterion, aValue: av, bValue: bv, winnerId: null });
      return null;
    }
    const winnerId = av > bv ? a.id : b.id;
    steps.push({ criterion, aValue: av, bValue: bv, winnerId });
    return winnerId;
  }

  function lower(criterion: string, av: number, bv: number): string | null {
    if (av === bv) {
      steps.push({ criterion, aValue: av, bValue: bv, winnerId: null });
      return null;
    }
    const winnerId = av < bv ? a.id : b.id;
    steps.push({ criterion, aValue: av, bValue: bv, winnerId });
    return winnerId;
  }

  function earlierIso(criterion: string, av: string | null, bv: string | null): string | null {
    if (!av && !bv) {
      steps.push({ criterion, aValue: av, bValue: bv, winnerId: null });
      return null;
    }
    if (!av) {
      steps.push({ criterion, aValue: av, bValue: bv, winnerId: b.id });
      return b.id;
    }
    if (!bv) {
      steps.push({ criterion, aValue: av, bValue: bv, winnerId: a.id });
      return a.id;
    }
    if (av === bv) {
      steps.push({ criterion, aValue: av, bValue: bv, winnerId: null });
      return null;
    }
    const winnerId = av < bv ? a.id : b.id;
    steps.push({ criterion, aValue: av, bValue: bv, winnerId });
    return winnerId;
  }

  const order: (() => string | null)[] = [
    () => higher("Higher Cash Impact Score", a.cashImpactScore, b.cashImpactScore),
    () =>
      higher(
        "Higher Expected 13-Week Cash Impact",
        a.expected13WeekCashImpact,
        b.expected13WeekCashImpact
      ),
    () => higher("Higher Time Sensitivity Score", a.timeSensitivityScore, b.timeSensitivityScore),
    () => higher("Higher Operational Risk Score", a.operationalRiskScore, b.operationalRiskScore),
    () =>
      higher(
        "Higher Customer and Revenue Impact Score",
        a.customerRevenueImpactScore,
        b.customerRevenueImpactScore
      ),
    () =>
      higher("Higher Expected Preventable Loss", a.expectedPreventableLoss, b.expectedPreventableLoss),
    () => higher("Higher Data Confidence", a.dataConfidenceRank, b.dataConfidenceRank),
    () => lower("Faster Benefit Realization", a.benefitRealizationDays, b.benefitRealizationDays),
    () =>
      // Lower execution burden: less negative / closer to 0 wins → higher (less penalty) wins
      higher(
        "Lower Execution Burden",
        a.executionBurdenPenalty,
        b.executionBurdenPenalty
      ),
    () =>
      higher(
        "Longer Qualified Persistence",
        a.qualifiedPersistenceCycles,
        b.qualifiedPersistenceCycles
      ),
    () => earlierIso("Earlier Action Deadline", a.actionDeadline, b.actionDeadline),
    () =>
      earlierIso(
        "Earlier Candidate Identification Date",
        a.candidateIdentifiedAt,
        b.candidateIdentifiedAt
      ),
  ];

  for (const step of order) {
    const w = step();
    if (w) {
      const last = steps[steps.length - 1]!;
      return {
        winnerId: w,
        steps,
        explanation: `Tie broken by: ${last.criterion} (${w} wins).`,
      };
    }
  }

  return {
    winnerId: a.id < b.id ? a.id : b.id,
    steps: [
      ...steps,
      {
        criterion: "Manual Management Tie-Break required (stable id fallback)",
        aValue: a.id,
        bValue: b.id,
        winnerId: a.id < b.id ? a.id : b.id,
      },
    ],
    explanation: "All automatic tie-breakers exhausted — manual management tie-break required.",
  };
}
