/**
 * Revised Decision Priority scoring — calculation acceptance tests (§37 subset).
 */
import {
  calculateRevisedScore,
  evaluateEmergencyTests,
  resolveTie,
  type RevisedScoreInput,
} from "../src/lib/iam/scoring/revised";
import { pointsFromAscendingMinBands } from "../src/lib/iam/scoring/revised/bands";
import { CASH_IMPACT_BANDS, MODIFIER_CAPS, PRIORITY_BANDS } from "../src/lib/iam/scoring/revised/config";
import { priorityBandFromScore } from "../src/lib/iam/scoring/revised/bands";

type Result = { id: string; name: string; pass: boolean; detail: string };

function assert(id: string, name: string, pass: boolean, detail: string): Result {
  return { id, name, pass, detail };
}

function baseInput(over: Partial<RevisedScoreInput> = {}): RevisedScoreInput {
  return {
    recommendationId: "r1",
    grossCashImpact: 200_000,
    netScoreable13WeekCashImpact: 74_000,
    cashEstimationMethod: "test_net_scoreable",
    netScoreableProfitabilityImpact: 12_000,
    profitabilityEstimationMethod: "test",
    affectedInventoryBookValue: 118_000,
    denominators: {
      trailing52WeekRevenue: 52 * 500_000, // AWR = 500k
      trailing12MonthGrossProfit: 2_000_000,
      totalInventoryBookValue: 5_000_000,
    },
    operationalRiskLevel: "moderate",
    customerRevenueLevel: "low",
    actionWindowDays: 20,
    actionabilityLevel: "strong",
    confidence: "high",
    persistence: "first",
    deterioration: "stable",
    crossFunctional: "isolated",
    strategicImportance: "normal",
    executionBurden: "normal",
    benefitUncertainty: "supported",
    ...over,
  };
}

async function main() {
  const results: Result[] = [];

  // Cash band boundaries — exact threshold enters higher band
  const cashCases: [number, number][] = [
    [0.009999, 0],
    [0.01, 6],
    [0.029999, 6],
    [0.03, 12],
    [0.07, 18],
    [0.15, 24],
    [0.3, 30],
  ];
  for (const [ratio, pts] of cashCases) {
    const got = pointsFromAscendingMinBands(ratio, CASH_IMPACT_BANDS);
    results.push(
      assert(
        `CASH-${ratio}`,
        `Cash ratio ${ratio} → ${pts} pts`,
        got === pts,
        `got=${got}`
      )
    );
  }

  // Missing denominators → exception
  const miss = calculateRevisedScore(
    baseInput({
      denominators: {
        trailing52WeekRevenue: null,
        trailing12MonthGrossProfit: null,
        totalInventoryBookValue: null,
      },
    })
  );
  results.push(
    assert(
      "EXC-DENOM",
      "Missing denominators → calculation exception (no fabricated score)",
      miss.ok === false && miss.exceptionCode === "MISSING_DENOMINATORS",
      miss.ok === false ? miss.exceptionCode : "ok"
    )
  );

  // Book value alone is not net cash
  const noNet = calculateRevisedScore(
    baseInput({ netScoreable13WeekCashImpact: null, grossCashImpact: 200_000 })
  );
  results.push(
    assert(
      "EXC-NET",
      "Missing net scoreable cash → exception (book value not auto cash)",
      noNet.ok === false && noNet.exceptionCode === "MISSING_NET_SCOREABLE_CASH",
      noNet.ok === false ? noNet.exceptionCode : "ok"
    )
  );

  // Happy path base + confidence
  const ok = calculateRevisedScore(baseInput());
  results.push(
    assert(
      "OK-BASE",
      "Successful revised score produces governed final + band",
      ok.ok === true && ok.normallyRankable && ok.priorityBand.length > 0,
      ok.ok ? `final=${ok.governedFinalScore} band=${ok.priorityBand} base=${ok.basePriorityScore}` : "fail"
    )
  );

  // Max base factors
  const max = calculateRevisedScore(
    baseInput({
      netScoreable13WeekCashImpact: 0.35 * 500_000, // 35% of AWR
      netScoreableProfitabilityImpact: 0.02 * 2_000_000,
      affectedInventoryBookValue: 0.06 * 5_000_000,
      operationalRiskLevel: "critical",
      customerRevenueLevel: "critical",
      actionWindowDays: 3,
      actionabilityLevel: "immediate",
    })
  );
  results.push(
    assert(
      "MAX-BASE",
      "Maximum factor scores sum to 100 before confidence",
      max.ok === true && max.basePriorityScore === 100,
      max.ok ? `base=${max.basePriorityScore}` : "fail"
    )
  );

  // Medium / Low confidence multipliers
  const med = calculateRevisedScore(baseInput({ confidence: "medium" }));
  const low = calculateRevisedScore(baseInput({ confidence: "low" }));
  results.push(
    assert(
      "CONF-MED",
      "Medium confidence multiplier 0.95",
      med.ok === true && med.confidenceMultiplier === 0.95,
      med.ok ? String(med.confidenceMultiplier) : "fail"
    )
  );
  results.push(
    assert(
      "CONF-LOW",
      "Low confidence multiplier 0.85",
      low.ok === true && low.confidenceMultiplier === 0.85,
      low.ok ? String(low.confidenceMultiplier) : "fail"
    )
  );

  const insuff = calculateRevisedScore(baseInput({ confidence: "insufficient" }));
  results.push(
    assert(
      "CONF-INSUFF",
      "Insufficient confidence → not normally rankable exception",
      insuff.ok === false && insuff.exceptionCode === "INSUFFICIENT_CONFIDENCE",
      insuff.ok === false ? insuff.exceptionCode : "ok"
    )
  );

  // Modifier caps
  const capped = calculateRevisedScore(
    baseInput({
      persistence: "fifth_or_later",
      deterioration: "accelerating_toward_critical",
      crossFunctional: "broad",
      strategicImportance: "enterprise_critical",
      executionBurden: "major_barriers",
      benefitUncertainty: "highly_uncertain",
    })
  );
  results.push(
    assert(
      "MOD-CAP",
      "Positive modifiers capped at +15 and negatives at -15",
      capped.ok === true &&
        capped.modifiers.positiveCapped <= MODIFIER_CAPS.positive &&
        capped.modifiers.negativeCapped >= -MODIFIER_CAPS.negative,
      capped.ok
        ? `+${capped.modifiers.positiveCapped}/${capped.modifiers.positiveUncapped} ${capped.modifiers.negativeCapped}/${capped.modifiers.negativeUncapped}`
        : "fail"
    )
  );

  // Priority bands
  for (const [score, band] of [
    [85, "Critical"],
    [70, "High"],
    [55, "Moderate"],
    [40, "Watch"],
    [39.99, "Informational"],
  ] as const) {
    results.push(
      assert(
        `BAND-${score}`,
        `Score ${score} → ${band}`,
        priorityBandFromScore(score, PRIORITY_BANDS) === band,
        priorityBandFromScore(score, PRIORITY_BANDS)
      )
    );
  }

  // Emergency A–E
  const emA = evaluateEmergencyTests({
    operationalRiskScore: 15,
    customerRevenueImpactScore: 0,
    timeSensitivityScore: 8,
    actionWindowDays: 10,
  });
  results.push(assert("EM-A", "Emergency Test A", emA.tests.find((t) => t.testId === "A")?.triggered === true, JSON.stringify(emA.tests.filter((t) => t.triggered).map((t) => t.testId))));

  const emB = evaluateEmergencyTests({
    operationalRiskScore: 0,
    customerRevenueImpactScore: 10,
    timeSensitivityScore: 8,
    actionWindowDays: 10,
  });
  results.push(assert("EM-B", "Emergency Test B", emB.tests.find((t) => t.testId === "B")?.triggered === true, "B"));

  const emC = evaluateEmergencyTests({
    operationalRiskScore: 12,
    customerRevenueImpactScore: 8,
    timeSensitivityScore: 6,
    actionWindowDays: 20,
  });
  results.push(assert("EM-C", "Emergency Test C", emC.tests.find((t) => t.testId === "C")?.triggered === true, "C"));

  const emD = evaluateEmergencyTests({
    operationalRiskScore: 0,
    customerRevenueImpactScore: 0,
    timeSensitivityScore: 0,
    actionWindowDays: 14,
    irreversibleMaterialLossLikely: true,
  });
  results.push(assert("EM-D", "Emergency Test D", emD.tests.find((t) => t.testId === "D")?.triggered === true, "D"));

  const emE = evaluateEmergencyTests({
    operationalRiskScore: 0,
    customerRevenueImpactScore: 0,
    timeSensitivityScore: 0,
    actionWindowDays: 90,
    verifiedCriticalThreat: true,
  });
  results.push(assert("EM-E", "Emergency Test E", emE.tests.find((t) => t.testId === "E")?.triggered === true, "E"));

  results.push(
    assert(
      "EM-NO-AUTO",
      "Emergency trigger creates review candidate flag only (not auto-confirm field)",
      emA.emergencyReviewCandidate === true && emA.anyTriggered === true,
      "reviewCandidate"
    )
  );

  // Tie-break by cash impact score then 13-week cash
  const tie = resolveTie(
    {
      id: "a",
      cashImpactScore: 18,
      expected13WeekCashImpact: 50_000,
      timeSensitivityScore: 4,
      operationalRiskScore: 6,
      customerRevenueImpactScore: 2,
      expectedPreventableLoss: 0,
      dataConfidenceRank: 4,
      benefitRealizationDays: 30,
      executionBurdenPenalty: 0,
      qualifiedPersistenceCycles: 1,
      actionDeadline: null,
      candidateIdentifiedAt: "2026-01-01",
    },
    {
      id: "b",
      cashImpactScore: 18,
      expected13WeekCashImpact: 80_000,
      timeSensitivityScore: 4,
      operationalRiskScore: 6,
      customerRevenueImpactScore: 2,
      expectedPreventableLoss: 0,
      dataConfidenceRank: 4,
      benefitRealizationDays: 30,
      executionBurdenPenalty: 0,
      qualifiedPersistenceCycles: 1,
      actionDeadline: null,
      candidateIdentifiedAt: "2026-01-01",
    }
  );
  results.push(
    assert(
      "TIE-CASH",
      "Tie broken by higher 13-week cash when cash scores equal",
      tie.winnerId === "b" && tie.steps.some((s) => s.criterion.includes("13-Week")),
      tie.explanation
    )
  );

  // 74k / 500k AWR = 14.8% → 18 pts cash (7%–15%)
  const example = calculateRevisedScore(baseInput({ netScoreable13WeekCashImpact: 74_000 }));
  results.push(
    assert(
      "EX-CASH-PTS",
      "Example $74k / $500k AWR → cash factor 18",
      example.ok === true && example.factors.cashImpactScore === 18,
      example.ok ? String(example.factors.cashImpactScore) : "fail"
    )
  );

  const failed = results.filter((r) => !r.pass);
  for (const r of results) {
    console.log(`${r.pass ? "PASS" : "FAIL"} ${r.id} — ${r.name}: ${r.detail}`);
  }
  console.log(`\n${results.length - failed.length}/${results.length} passed`);
  if (failed.length) process.exit(1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
