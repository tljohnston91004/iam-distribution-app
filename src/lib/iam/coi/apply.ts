/**
 * Persist COI onto Recommendations for a Review Cycle.
 * Preserves originalEstimatedCoi on recalculation when already set.
 */

import { prisma } from "@/lib/db";
import {
  calculateCostOfInaction,
  extractTargetPeriodFromExplainability,
  type CoiResult,
} from "./calculate";

function mergeCoiIntoExplainability(json: string | null, coi: CoiResult): string {
  let prior: Record<string, unknown> = {};
  if (json) {
    try {
      prior = JSON.parse(json) as Record<string, unknown>;
    } catch {
      prior = {};
    }
  }
  return JSON.stringify({
    ...prior,
    costOfInactionDetail: coi,
    coiBoardDisplayLine: coi.boardDisplayLine,
  });
}

function readExplicitPreventable(rec: {
  preventableLossComponent: number | null;
  explainabilityJson: string | null;
}): number | null {
  if (rec.preventableLossComponent != null && Number.isFinite(rec.preventableLossComponent)) {
    return rec.preventableLossComponent;
  }
  if (!rec.explainabilityJson) return null;
  try {
    const ex = JSON.parse(rec.explainabilityJson) as {
      preventableLossForCoi?: number;
      costOfInactionDetail?: { preventableLossComponent?: number | null };
    };
    if (typeof ex.preventableLossForCoi === "number") return ex.preventableLossForCoi;
    if (typeof ex.costOfInactionDetail?.preventableLossComponent === "number") {
      return ex.costOfInactionDetail.preventableLossComponent;
    }
  } catch {
    /* ignore */
  }
  return null;
}

/** Affected inventory for COI — recommendation exposure, not company total. Never invent. */
function affectedInventoryForCoi(rec: {
  estimatedCashImpact: number | null;
  estimatedFinancialImpact: number | null;
}): number | null {
  return rec.estimatedCashImpact ?? rec.estimatedFinancialImpact ?? null;
}

export async function applyCoiToReviewCycle(iamRunId: string): Promise<{
  updated: number;
  calculated: number;
  partial: number;
  unavailable: number;
}> {
  const run = await prisma.iamRun.findUnique({
    where: { id: iamRunId },
    include: { company: true, recommendations: true },
  });
  if (!run) throw new Error("Review cycle not found");

  const rate = run.company.annualCarryingCostRate ?? null;
  let updated = 0;
  let calculated = 0;
  let partial = 0;
  let unavailable = 0;

  for (const rec of run.recommendations) {
    const papPeriod = extractTargetPeriodFromExplainability(rec.explainabilityJson);
    const recommendedPeriod = rec.recommendedTargetPeriod ?? papPeriod;
    const affected = affectedInventoryForCoi(rec);
    const preventable = readExplicitPreventable(rec);

    const coi = calculateCostOfInaction({
      recommendedTargetPeriodText: recommendedPeriod,
      managementAdjustedTargetPeriodText: rec.managementAdjustedTargetPeriod,
      managementAdjustmentReason: rec.managementAdjustmentReason,
      affectedInventoryValue: affected,
      annualCarryingCostRate: rate,
      preventableLossDuringHorizon: preventable,
      recommendationConfidence: rec.confidence,
    });

    if (coi.coiCalculationStatus === "calculated") calculated += 1;
    else if (coi.coiCalculationStatus === "partial") partial += 1;
    else unavailable += 1;

    // Preserve first successful original; do not overwrite on recalculation.
    const original =
      rec.originalEstimatedCoi != null
        ? rec.originalEstimatedCoi
        : coi.estimatedCostOfInaction;

    const revised =
      rec.managementAdjustedTargetPeriod != null
        ? coi.estimatedCostOfInaction
        : rec.revisedEstimatedCoi;

    await prisma.recommendation.update({
      where: { id: rec.id },
      data: {
        costOfInaction: coi.estimatedCostOfInaction,
        coiHorizonValue: coi.coiHorizonValue,
        coiHorizonUnit: coi.coiHorizonUnit,
        coiHorizonDays: coi.coiHorizonDays,
        coiHorizonSource: coi.coiHorizonSource,
        recommendedTargetPeriod: recommendedPeriod,
        recommendedTargetEndDate: coi.recommendedTargetEndDate
          ? new Date(coi.recommendedTargetEndDate)
          : null,
        affectedInventoryValueForCoi: coi.affectedInventoryValueForCoi,
        annualCarryingCostRateUsed: coi.annualCarryingCostRate,
        carryingCostComponent: coi.carryingCostComponent,
        preventableLossComponent: coi.preventableLossComponent,
        otherCoiComponent: coi.otherCoiComponent,
        coiConfidenceLevel: coi.coiConfidenceLevel,
        coiCalculationStatus: coi.coiCalculationStatus,
        coiCalculationExplanation: coi.coiCalculationExplanation,
        coiBoardDisplayLine: coi.boardDisplayLine,
        originalEstimatedCoi: original,
        revisedEstimatedCoi: revised,
        coiDetailJson: JSON.stringify(coi),
        explainabilityJson: mergeCoiIntoExplainability(rec.explainabilityJson, coi),
      },
    });
    updated += 1;
  }

  await prisma.changeLog.create({
    data: {
      iamRunId,
      entityType: "IamRun",
      entityId: iamRunId,
      action: "coi_applied",
      detail: `updated=${updated} calculated=${calculated} partial=${partial} unavailable=${unavailable} rate=${rate ?? "null"}`,
    },
  });

  return { updated, calculated, partial, unavailable };
}

/**
 * Management adjusts target-resolution period: preserve original COI, recompute revised.
 */
export async function adjustRecommendationCoiTargetPeriod(opts: {
  recommendationId: string;
  newTargetPeriodText: string;
  reason: string;
  performedBy: string;
}): Promise<{
  recommendationId: string;
  originalEstimatedCoi: number | null;
  revisedEstimatedCoi: number | null;
}> {
  if (!opts.newTargetPeriodText.trim()) {
    throw new Error("New target-resolution period is required");
  }
  if (!opts.reason.trim()) {
    throw new Error("Management adjustment reason is required");
  }

  const rec = await prisma.recommendation.findUnique({
    where: { id: opts.recommendationId },
    include: { run: { include: { company: true } } },
  });
  if (!rec) throw new Error("Recommendation not found");

  if (
    rec.run.cycleLockedAt ||
    rec.run.cycleStatus === "Locked" ||
    rec.run.cycleStatus === "Closed"
  ) {
    throw new Error(
      `Review cycle is ${rec.run.cycleStatus === "Closed" ? "closed" : "locked"}; COI target-period adjustments are not allowed`
    );
  }

  const rate = rec.run.company.annualCarryingCostRate ?? null;
  const recommendedPeriod =
    rec.recommendedTargetPeriod ?? extractTargetPeriodFromExplainability(rec.explainabilityJson);

  const originalCoi = rec.originalEstimatedCoi ?? rec.costOfInaction ?? null;
  const affected = affectedInventoryForCoi(rec);
  const preventable = readExplicitPreventable(rec);

  const coi = calculateCostOfInaction({
    recommendedTargetPeriodText: recommendedPeriod,
    managementAdjustedTargetPeriodText: opts.newTargetPeriodText,
    managementAdjustmentReason: opts.reason,
    affectedInventoryValue: affected,
    annualCarryingCostRate: rate,
    preventableLossDuringHorizon: preventable,
    recommendationConfidence: rec.confidence,
  });

  const adjustedAt = new Date();

  await prisma.$transaction(async (tx) => {
    await tx.recommendation.update({
      where: { id: rec.id },
      data: {
        managementAdjustedTargetPeriod: opts.newTargetPeriodText.trim(),
        managementAdjustmentReason: opts.reason.trim(),
        managementAdjustedBy: opts.performedBy,
        managementAdjustedAt: adjustedAt,
        recommendedTargetPeriod: recommendedPeriod,
        originalEstimatedCoi: originalCoi,
        revisedEstimatedCoi: coi.estimatedCostOfInaction,
        costOfInaction: coi.estimatedCostOfInaction,
        coiHorizonValue: coi.coiHorizonValue,
        coiHorizonUnit: coi.coiHorizonUnit,
        coiHorizonDays: coi.coiHorizonDays,
        coiHorizonSource: coi.coiHorizonSource,
        recommendedTargetEndDate: coi.recommendedTargetEndDate
          ? new Date(coi.recommendedTargetEndDate)
          : null,
        affectedInventoryValueForCoi: coi.affectedInventoryValueForCoi,
        annualCarryingCostRateUsed: coi.annualCarryingCostRate,
        carryingCostComponent: coi.carryingCostComponent,
        preventableLossComponent: coi.preventableLossComponent,
        otherCoiComponent: coi.otherCoiComponent,
        coiConfidenceLevel: coi.coiConfidenceLevel,
        coiCalculationStatus: coi.coiCalculationStatus,
        coiCalculationExplanation: coi.coiCalculationExplanation,
        coiBoardDisplayLine: coi.boardDisplayLine,
        coiDetailJson: JSON.stringify(coi),
        explainabilityJson: mergeCoiIntoExplainability(rec.explainabilityJson, coi),
      },
    });
    await tx.governanceDecision.create({
      data: {
        iamRunId: rec.iamRunId,
        recommendationId: rec.id,
        decisionType: "CoiTargetPeriodAdjustment",
        reason: opts.reason.trim(),
        performedBy: opts.performedBy,
        detailJson: JSON.stringify({
          originalRecommendedTargetPeriod: recommendedPeriod,
          originalEstimatedCoi: originalCoi,
          revisedTargetPeriod: opts.newTargetPeriodText.trim(),
          revisedEstimatedCoi: coi.estimatedCostOfInaction,
          authorizingUser: opts.performedBy,
          adjustedAt: adjustedAt.toISOString(),
        }),
      },
    });
    await tx.auditEvent.create({
      data: {
        iamRunId: rec.iamRunId,
        entityType: "Recommendation",
        entityId: rec.id,
        action: "coi:target_period_adjusted",
        performedBy: opts.performedBy,
        detailJson: JSON.stringify({
          originalEstimatedCoi: originalCoi,
          revisedEstimatedCoi: coi.estimatedCostOfInaction,
          originalRecommendedTargetPeriod: recommendedPeriod,
          newTargetPeriod: opts.newTargetPeriodText.trim(),
          reason: opts.reason.trim(),
          adjustedAt: adjustedAt.toISOString(),
        }),
      },
    });
  });

  return {
    recommendationId: rec.id,
    originalEstimatedCoi: originalCoi,
    revisedEstimatedCoi: coi.estimatedCostOfInaction,
  };
}
