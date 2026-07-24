import { prisma } from "@/lib/db";
import { evaluateAgingAdvisory, getOecForRun } from "@/lib/iam/presentation";
import type { BoardRecommendation } from "./types";

export async function loadBoardRecommendations(iamRunId: string): Promise<BoardRecommendation[]> {
  const oec = await getOecForRun(iamRunId);
  const rows = await prisma.recommendation.findMany({
    where: { iamRunId },
    include: {
      assignments: { where: { active: true }, take: 1 },
    },
    orderBy: [{ presentationRank: "asc" }, { priorityScore: "desc" }],
  });

  return rows.map((r) => {
    const a = r.assignments[0];
    const aging = evaluateAgingAdvisory({
      recommendationId: r.id,
      // Use createdAt so presentation re-assign (story refresh) does not reset aging.
      updatedAt: r.createdAt,
      thresholdDays: oec.recommendationAgingDays,
    });
    return {
      id: r.id,
      title: r.title,
      recommendationType: r.recommendationType,
      skuOrItemId: r.skuOrItemId,
      analysisGrain: r.analysisGrain,
      segmentType: r.segmentType,
      segmentKey: r.segmentKey,
      affectedSkuCount: r.affectedSkuCount,
      lifecycleState: r.lifecycleState,
      presentationCategory: r.presentationCategory,
      presentationRank: r.presentationRank,
      generationPath: r.generationPath,
      sourceModule: r.sourceModule,
      confidence: r.confidence,
      priorityScore: r.priorityScore,
      scoringProfileId: r.scoringProfileId,
      estimatedFinancialImpact: r.estimatedFinancialImpact,
      estimatedCashImpact: r.estimatedCashImpact,
      costOfInaction: r.costOfInaction,
      explainabilityJson: r.explainabilityJson,
      ownerUserId: a?.primaryOwnerUserId ?? null,
      ownerName: a?.primaryOwnerName ?? null,
      ownerAccepted: a?.accepted ?? false,
      storyWhat: r.storyWhat,
      storyWhy: r.storyWhy,
      storyWhyNow: r.storyWhyNow,
      storyExpectedResult: r.storyExpectedResult,
      confidenceNarrative: r.confidenceNarrative,
      progressNarrative: r.progressNarrative,
      blockerNote: r.blockerNote,
      lastProgressAt: r.lastProgressAt?.toISOString() ?? null,
      expectedCompletionAt: r.expectedCompletionAt?.toISOString() ?? null,
      updatedAt: r.updatedAt.toISOString(),
      agingAdvisory: aging?.message ?? null,
    };
  });
}

export async function loadBusinessHealth(iamRunId: string) {
  const run = await prisma.iamRun.findUnique({
    where: { id: iamRunId },
    include: {
      company: true,
      _count: {
        select: {
          recommendations: true,
          dataGaps: true,
          inventorySnapshots: true,
          demandHistory: true,
        },
      },
    },
  });
  if (!run) return null;

  const byLane = await prisma.recommendation.groupBy({
    by: ["presentationCategory"],
    where: { iamRunId },
    _count: true,
  });
  const laneCounts = Object.fromEntries(byLane.map((g) => [g.presentationCategory, g._count]));
  const active =
    (laneCounts.active_priority ?? 0) + (laneCounts.top_2 ?? 0);
  const waiting =
    (laneCounts.waiting_activation ?? 0) + (laneCounts.managed_backlog ?? 0);

  return {
    readinessStatus: run.readinessStatus,
    runStatus: run.runStatus,
    cycleStatus: run.cycleStatus,
    recommendationCount: run._count.recommendations,
    dataGapCount: run._count.dataGaps,
    inventoryCount: run._count.inventorySnapshots,
    demandCount: run._count.demandHistory,
    laneCounts: {
      ...laneCounts,
      active_priority: active,
      waiting_activation: waiting,
      top_2: active,
      managed_backlog: waiting,
    },
    scoringProfileNote: "interim_v1_cash_led (approved for V1.5; SD-1 open for final formulas)",
    oec: run.company.organizationalExecutionCapability,
    agingDays: run.company.recommendationAgingDays,
    companyId: run.companyId,
    companyName: run.company.name,
  };
}
