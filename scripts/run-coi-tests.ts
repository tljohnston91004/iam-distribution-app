/**
 * Cost of Inaction (COI) automated tests — PO-approved interim formula.
 * Run: npm run test:coi
 */
import { prisma } from "../src/lib/db";
import {
  calculateCostOfInaction,
  parseTargetPeriodToDays,
  formatCoiBoardDisplay,
  applyCoiToReviewCycle,
  adjustRecommendationCoiTargetPeriod,
  DEFAULT_COI_HORIZON_DAYS,
} from "../src/lib/iam/coi";
import { lockReviewCycle } from "../src/lib/iam/lifecycle";

type Result = { id: string; name: string; pass: boolean; detail: string };

function assert(id: string, name: string, pass: boolean, detail: string): Result {
  return { id, name, pass, detail };
}

async function main() {
  const results: Result[] = [];

  // --- Unit: horizon parsing ---
  const days = parseTargetPeriodToDays("90-day trapped-cash reduction program");
  results.push(
    assert("COI-HORIZON-DAYS", "Target period supplied in days", days?.days === 90 && days.unit === "days", JSON.stringify(days))
  );
  const weeks = parseTargetPeriodToDays("4-week corrective action");
  results.push(
    assert("COI-HORIZON-WEEKS", "Target period supplied in weeks", weeks?.days === 28 && weeks.unit === "weeks", JSON.stringify(weeks))
  );
  const months = parseTargetPeriodToDays("3-month inventory reduction plan");
  results.push(
    assert("COI-HORIZON-MONTHS", "Target period supplied in months", months?.days === 90 && months.unit === "months", JSON.stringify(months))
  );

  const def = calculateCostOfInaction({
    recommendedTargetPeriodText: null,
    affectedInventoryValue: 100_000,
    annualCarryingCostRate: 0.24,
    preventableLossDuringHorizon: 0,
  });
  results.push(
    assert(
      "COI-DEFAULT-30",
      "Missing target period defaults to 30 days",
      def.coiHorizonDays === DEFAULT_COI_HORIZON_DAYS &&
        def.coiHorizonSource === "Default 30-Day Period",
      `days=${def.coiHorizonDays} source=${def.coiHorizonSource}`
    )
  );

  // --- Example validation: $324,808 × 24% × 90/365 ≈ $19,224 ---
  const example = calculateCostOfInaction({
    recommendedTargetPeriodText: "90-day trapped-cash reduction program",
    affectedInventoryValue: 324_808,
    annualCarryingCostRate: 0.24,
    preventableLossDuringHorizon: 0,
    recommendationConfidence: "High Confidence",
  });
  const expectedCarrying = Math.round(324_808 * 0.24 * (90 / 365));
  results.push(
    assert(
      "COI-CARRYING-ONLY",
      "Carrying-cost-only COI (example ≈ $19,224)",
      example.carryingCostComponent === expectedCarrying &&
        example.estimatedCostOfInaction === expectedCarrying &&
        example.coiCalculationStatus === "calculated" &&
        example.coiConfidenceLevel === "High",
      `got=${example.estimatedCostOfInaction} expected=${expectedCarrying} status=${example.coiCalculationStatus}`
    )
  );
  results.push(
    assert(
      "COI-BOARD-WORDING",
      "Correct Board display wording",
      example.boardDisplayLine ===
        `Estimated COI over 90-day target period: $${expectedCarrying.toLocaleString("en-US")}` &&
        example.coiCalculationExplanation.includes("carrying cost only"),
      example.boardDisplayLine
    )
  );

  const withLoss = calculateCostOfInaction({
    recommendedTargetPeriodText: "90 days",
    affectedInventoryValue: 324_808,
    annualCarryingCostRate: 0.24,
    preventableLossDuringHorizon: 5_000,
  });
  results.push(
    assert(
      "COI-PLUS-PREVENTABLE",
      "Carrying cost plus preventable loss",
      withLoss.estimatedCostOfInaction === expectedCarrying + 5_000 &&
        withLoss.preventableLossComponent === 5_000,
      `total=${withLoss.estimatedCostOfInaction}`
    )
  );

  const missingRate = calculateCostOfInaction({
    recommendedTargetPeriodText: "90 days",
    affectedInventoryValue: 324_808,
    annualCarryingCostRate: null,
    preventableLossDuringHorizon: null,
  });
  results.push(
    assert(
      "COI-MISSING-RATE",
      "Missing carrying-cost rate",
      missingRate.coiCalculationStatus === "unavailable" &&
        missingRate.estimatedCostOfInaction == null &&
        missingRate.boardDisplayLine.includes("annual inventory carrying-cost rate has not been configured"),
      missingRate.boardDisplayLine
    )
  );

  const lossOnly = calculateCostOfInaction({
    recommendedTargetPeriodText: "30 days",
    affectedInventoryValue: 324_808,
    annualCarryingCostRate: null,
    preventableLossDuringHorizon: 12_000,
  });
  results.push(
    assert(
      "COI-LOSS-WITHOUT-RATE",
      "Preventable loss available without carrying-cost rate",
      lossOnly.coiCalculationStatus === "partial" &&
        lossOnly.estimatedCostOfInaction === 12_000 &&
        lossOnly.carryingCostComponent == null,
      `status=${lossOnly.coiCalculationStatus} total=${lossOnly.estimatedCostOfInaction}`
    )
  );

  const dbl = calculateCostOfInaction({
    recommendedTargetPeriodText: "90 days",
    affectedInventoryValue: 324_808,
    annualCarryingCostRate: 0.24,
    preventableLossDuringHorizon: expectedCarrying, // same as carrying → exclude
  });
  results.push(
    assert(
      "COI-NO-DOUBLE-COUNT",
      "Double-counting prevention",
      dbl.preventableLossComponent == null &&
        dbl.estimatedCostOfInaction === expectedCarrying &&
        dbl.excludedComponents.some((e) => e.includes("double-counting")),
      `preventable=${dbl.preventableLossComponent} excluded=${dbl.excludedComponents.join("|")}`
    )
  );

  // Confidence matrix
  for (const [conf, expected] of [
    ["High Confidence", "High"],
    ["Medium Confidence", "Medium"],
    ["Low Confidence", "Low"],
    ["Insufficient Data", "Insufficient"],
  ] as const) {
    const c = calculateCostOfInaction({
      recommendedTargetPeriodText: "30 days",
      affectedInventoryValue: 10_000,
      annualCarryingCostRate: 0.2,
      preventableLossDuringHorizon: 0,
      recommendationConfidence: conf,
    });
    results.push(
      assert(`COI-CONF-${expected}`, `${expected} confidence`, c.coiConfidenceLevel === expected, c.coiConfidenceLevel)
    );
  }
  const insuff = calculateCostOfInaction({
    recommendedTargetPeriodText: "30 days",
    affectedInventoryValue: null,
    annualCarryingCostRate: null,
  });
  results.push(
    assert(
      "COI-CONF-INSUFFICIENT-INPUTS",
      "Insufficient when COI unavailable",
      insuff.coiConfidenceLevel === "Insufficient",
      insuff.coiConfidenceLevel
    )
  );

  results.push(
    assert(
      "COI-FORMAT-FALLBACK",
      "formatCoiBoardDisplay never blank",
      formatCoiBoardDisplay({ costOfInaction: null }).includes("cannot be calculated"),
      formatCoiBoardDisplay({ costOfInaction: null })
    )
  );

  // --- Integration: persist, adjust, recalc, published audit ---
  const company = await prisma.company.create({
    data: {
      name: `COI Test Co ${Date.now()}`,
      annualCarryingCostRate: 0.24,
    },
  });
  const run = await prisma.iamRun.create({
    data: {
      companyId: company.id,
      runName: "COI Test Run",
      reviewDate: new Date(),
      reviewWeekStart: new Date(),
      reviewWeekEnd: new Date(),
      cycleStatus: "Open",
    },
  });

  try {
    const rec = await prisma.recommendation.create({
      data: {
        iamRunId: run.id,
        sourceModule: "IAM",
        opportunityKey: "SEG|TrappedCash",
        recommendationType: "Trapped Cash Reduction",
        title: "Reduce trapped cash — test segment",
        confidence: "High Confidence",
        estimatedCashImpact: 324_808,
        estimatedFinancialImpact: 324_808,
        explainabilityJson: JSON.stringify({
          prescribedActionPlan: {
            targetCompletionPeriod: "90-day trapped-cash reduction program",
          },
          preventableLossForCoi: 0,
        }),
      },
    });

    const applied = await applyCoiToReviewCycle(run.id);
    const after = await prisma.recommendation.findUniqueOrThrow({ where: { id: rec.id } });
    results.push(
      assert(
        "COI-APPLY",
        "applyCoiToReviewCycle sets estimated COI",
        applied.calculated + applied.partial >= 1 &&
          after.costOfInaction === expectedCarrying &&
          after.coiHorizonDays === 90 &&
          after.originalEstimatedCoi === expectedCarrying,
        `status=${after.coiCalculationStatus} coi=${after.costOfInaction} board=${after.coiBoardDisplayLine}`
      )
    );

    const adjusted = await adjustRecommendationCoiTargetPeriod({
      recommendationId: rec.id,
      newTargetPeriodText: "30-day accelerated plan",
      reason: "Executive requested faster resolution",
      performedBy: "test-manager",
    });
    const afterAdj = await prisma.recommendation.findUniqueOrThrow({ where: { id: rec.id } });
    const expected30 = Math.round(324_808 * 0.24 * (30 / 365));
    results.push(
      assert(
        "COI-MGMT-ADJUST",
        "Management-adjusted target period",
        afterAdj.coiHorizonSource === "Management-Adjusted Target Period" &&
          afterAdj.coiHorizonDays === 30 &&
          afterAdj.revisedEstimatedCoi === expected30 &&
          afterAdj.originalEstimatedCoi === expectedCarrying &&
          adjusted.originalEstimatedCoi === expectedCarrying,
        `orig=${afterAdj.originalEstimatedCoi} revised=${afterAdj.revisedEstimatedCoi} source=${afterAdj.coiHorizonSource}`
      )
    );
    results.push(
      assert(
        "COI-PRESERVE-ORIG-REVISED",
        "Preservation of original and revised COI",
        afterAdj.originalEstimatedCoi === expectedCarrying &&
          afterAdj.revisedEstimatedCoi === expected30 &&
          afterAdj.originalEstimatedCoi !== afterAdj.revisedEstimatedCoi,
        `orig=${afterAdj.originalEstimatedCoi} rev=${afterAdj.revisedEstimatedCoi}`
      )
    );

    // Recalc when target period changes again via apply (management period retained)
    await applyCoiToReviewCycle(run.id);
    const afterRecalcPeriod = await prisma.recommendation.findUniqueOrThrow({ where: { id: rec.id } });
    results.push(
      assert(
        "COI-RECALC-PERIOD",
        "COI recalculation when the target period changes",
        afterRecalcPeriod.costOfInaction === expected30 &&
          afterRecalcPeriod.originalEstimatedCoi === expectedCarrying,
        `coi=${afterRecalcPeriod.costOfInaction} orig=${afterRecalcPeriod.originalEstimatedCoi}`
      )
    );

    // Recalc when affected inventory value changes
    await prisma.recommendation.update({
      where: { id: rec.id },
      data: { estimatedCashImpact: 200_000, estimatedFinancialImpact: 200_000 },
    });
    await applyCoiToReviewCycle(run.id);
    const afterValue = await prisma.recommendation.findUniqueOrThrow({ where: { id: rec.id } });
    const expectedValueChange = Math.round(200_000 * 0.24 * (30 / 365));
    results.push(
      assert(
        "COI-RECALC-VALUE",
        "COI recalculation when affected inventory value changes",
        afterValue.costOfInaction === expectedValueChange &&
          afterValue.affectedInventoryValueForCoi === 200_000 &&
          afterValue.originalEstimatedCoi === expectedCarrying,
        `coi=${afterValue.costOfInaction} expected=${expectedValueChange} orig=${afterValue.originalEstimatedCoi}`
      )
    );

    const govBefore = await prisma.governanceDecision.count({
      where: { recommendationId: rec.id, decisionType: "CoiTargetPeriodAdjustment" },
    });
    const auditBefore = await prisma.auditEvent.count({
      where: { entityId: rec.id, action: "coi:target_period_adjusted" },
    });
    await lockReviewCycle(run.id, { performedBy: "test-lock" });
    const afterLock = await prisma.recommendation.findUniqueOrThrow({ where: { id: rec.id } });
    const govAfter = await prisma.governanceDecision.count({
      where: { recommendationId: rec.id, decisionType: "CoiTargetPeriodAdjustment" },
    });
    const auditAfter = await prisma.auditEvent.count({
      where: { entityId: rec.id, action: "coi:target_period_adjusted" },
    });
    let lockedReject = false;
    try {
      await adjustRecommendationCoiTargetPeriod({
        recommendationId: rec.id,
        newTargetPeriodText: "7 days",
        reason: "should fail",
        performedBy: "test",
      });
    } catch {
      lockedReject = true;
    }
    results.push(
      assert(
        "COI-PUBLISHED-AUDIT",
        "Published-cycle audit preservation",
        govBefore >= 1 &&
          auditBefore >= 1 &&
          govAfter === govBefore &&
          auditAfter === auditBefore &&
          afterLock.originalEstimatedCoi === expectedCarrying &&
          afterLock.revisedEstimatedCoi === expectedValueChange &&
          lockedReject,
        `gov=${govAfter} audit=${auditAfter} lockedReject=${lockedReject} orig=${afterLock.originalEstimatedCoi}`
      )
    );
  } finally {
    await prisma.iamRun.delete({ where: { id: run.id } }).catch(() => undefined);
    await prisma.company.delete({ where: { id: company.id } }).catch(() => undefined);
  }

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
