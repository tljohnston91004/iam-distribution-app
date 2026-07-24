/**
 * Phase 4 scoring service — reads Recommendations + canonical evidence only.
 * No adapter / Keystroke imports (ADR-IAM-001).
 * Attempts revised Decision Priority scoring when company denominators + net cash exist.
 */

import { prisma } from "@/lib/db";
import { INTERIM_SCORING_PROFILE_ID } from "./profile";
import { REVISED_SCORING_PROFILE_ID } from "./revised";
import {
  rankScoredRecommendations,
  scoreRecommendation,
  type EvidenceHints,
  type RevisedScoringContext,
} from "./score";
import type { ScoredRecommendationRow } from "./types";

function buildEvidenceHints(opts: {
  inv?: {
    quantityOnHand: number;
    availableQoh?: number | null;
    quantityBasisUsed?: string | null;
    cost?: number | null;
    inventoryValue?: number | null;
    dataConfidence: string;
  };
  demand?: { unitsSold: number; grossSalesDollars: number } | null;
  supply?: { backorderQuantity?: number | null } | null;
}): EvidenceHints {
  const inv = opts.inv;
  const usableQty =
    inv?.quantityBasisUsed === "available_qoh" && inv.availableQoh != null
      ? inv.availableQoh
      : (inv?.quantityOnHand ?? null);
  const unitsSold = opts.demand?.unitsSold ?? null;
  const weeklyUnits = unitsSold != null ? unitsSold / 13 : null;
  const weeksOfSupply =
    usableQty != null && weeklyUnits != null && weeklyUnits > 0 ? usableQty / weeklyUnits : null;

  const hasRequired =
    usableQty != null &&
    unitsSold != null &&
    opts.demand?.grossSalesDollars != null &&
    (inv?.inventoryValue != null || inv?.cost != null);

  let serviceRiskScoreHint: number | null = null;
  if (opts.supply?.backorderQuantity != null && opts.supply.backorderQuantity > 0) {
    serviceRiskScoreHint = 70 + Math.min(30, opts.supply.backorderQuantity);
  } else if (weeksOfSupply != null && weeksOfSupply <= 2 && usableQty != null && usableQty > 0) {
    serviceRiskScoreHint = 55;
  }

  return {
    weeksOfSupply,
    hasRequiredEvidence: Boolean(hasRequired),
    serviceRiskScoreHint,
    backorder: (opts.supply?.backorderQuantity ?? 0) > 0,
  };
}

/**
 * Score all Recommendations on a Review Cycle. Persists score breakdown into explainabilityJson
 * and priorityScore / scoringProfileId columns. Does not assign presentation categories.
 */
export async function scoreReviewCycle(iamRunId: string): Promise<{
  scoredCount: number;
  scoringProfileId: string;
  revisedAuthoritativeCount: number;
  revisedExceptionCount: number;
  ranked: ScoredRecommendationRow[];
}> {
  const run = await prisma.iamRun.findUnique({
    where: { id: iamRunId },
    include: {
      company: true,
      recommendations: {
        include: {
          financialImpacts: { orderBy: { revision: "desc" }, take: 1 },
        },
      },
      inventorySnapshots: true,
      demandHistory: true,
      incomingSupply: true,
    },
  });
  if (!run) throw new Error("Review cycle not found");

  const demandBySku = new Map<string, { unitsSold: number; grossSalesDollars: number }>();
  for (const d of run.demandHistory) {
    const existing = demandBySku.get(d.skuOrItemId);
    if (existing) {
      existing.unitsSold += d.unitsSold;
      existing.grossSalesDollars += d.grossSalesDollars;
    } else {
      demandBySku.set(d.skuOrItemId, {
        unitsSold: d.unitsSold,
        grossSalesDollars: d.grossSalesDollars,
      });
    }
  }
  const invBySku = new Map(run.inventorySnapshots.map((i) => [i.skuOrItemId, i]));
  const supplyBySku = new Map(run.incomingSupply.map((s) => [s.skuOrItemId, s]));

  const denominators = {
    trailing52WeekRevenue: run.company.trailing52WeekRevenue ?? null,
    trailing12MonthGrossProfit: run.company.trailing12MonthGrossProfit ?? null,
    totalInventoryBookValue: run.company.totalInventoryBookValue ?? null,
  };

  const scored: ScoredRecommendationRow[] = [];
  let revisedAuthoritativeCount = 0;
  let revisedExceptionCount = 0;

  for (const rec of run.recommendations) {
    const sku = rec.skuOrItemId;
    const inv = sku ? invBySku.get(sku) : undefined;
    const demand = sku ? demandBySku.get(sku) : undefined;
    const supply = sku ? supplyBySku.get(sku) : undefined;
    const hints = sku
      ? buildEvidenceHints({ inv, demand: demand ?? null, supply: supply ?? null })
      : { weeksOfSupply: null, hasRequiredEvidence: false, serviceRiskScoreHint: null };

    let priorService: number | null = null;
    if (rec.explainabilityJson) {
      try {
        const p = JSON.parse(rec.explainabilityJson) as { serviceRiskScore?: number };
        if (typeof p.serviceRiskScore === "number") priorService = p.serviceRiskScore;
      } catch {
        /* ignore */
      }
    }
    if (priorService != null) {
      hints.serviceRiskScoreHint = priorService;
    }

    const fi = rec.financialImpacts[0];
    const revisedCtx: RevisedScoringContext = {
      denominators,
      netScoreable13WeekCash: fi?.netScoreable13WeekCash ?? fi?.expectedCash ?? null,
      netScoreableProfitability: fi?.netScoreableProfitability ?? null,
      estimationMethod: fi?.estimationMethod ?? null,
    };

    const row = scoreRecommendation(rec, hints, revisedCtx);
    if (row.scoringProfileId === REVISED_SCORING_PROFILE_ID) revisedAuthoritativeCount += 1;
    else revisedExceptionCount += 1;
    scored.push(row);
  }

  const ranked = rankScoredRecommendations(scored);

  for (const row of ranked) {
    const existing = run.recommendations.find((r) => r.id === row.recommendationId);
    let prior: Record<string, unknown> = {};
    if (existing?.explainabilityJson) {
      try {
        prior = JSON.parse(existing.explainabilityJson) as Record<string, unknown>;
      } catch {
        prior = {};
      }
    }
    const merged = {
      ...prior,
      ...row.explainability,
      priorityScore: row.priorityScore,
      interim: existing?.generationPath === "interim_evidence",
      generationPath: existing?.generationPath,
      prescribedActionPlan:
        prior.prescribedActionPlan ??
        (row.explainability as { prescribedActionPlan?: unknown }).prescribedActionPlan ??
        null,
      recommendedManagementAction:
        prior.recommendedManagementAction ??
        (row.explainability as { recommendedManagementAction?: unknown }).recommendedManagementAction ??
        null,
      dataQualityWarning:
        prior.dataQualityWarning ??
        (row.explainability as { dataQualityWarning?: unknown }).dataQualityWarning ??
        null,
      memberSkus: prior.memberSkus ?? (row.explainability as { memberSkus?: unknown }).memberSkus ?? null,
      revisedScore: row.explainability.revisedScore,
      authoritativeProfile: row.explainability.authoritativeProfile,
      detail: {
        ...((prior.detail as Record<string, unknown> | undefined) ?? {}),
        ...(((row.explainability as { detail?: Record<string, unknown> }).detail) ?? {}),
        prescribedActionPlan:
          (prior.detail as { prescribedActionPlan?: unknown } | undefined)?.prescribedActionPlan ??
          prior.prescribedActionPlan ??
          null,
      },
    };
    await prisma.recommendation.update({
      where: { id: row.recommendationId },
      data: {
        priorityScore: row.priorityScore,
        scoringProfileId: row.scoringProfileId,
        explainabilityJson: JSON.stringify(merged),
      },
    });
  }

  const cycleProfile =
    revisedAuthoritativeCount > 0 ? REVISED_SCORING_PROFILE_ID : INTERIM_SCORING_PROFILE_ID;

  return {
    scoredCount: ranked.length,
    scoringProfileId: cycleProfile,
    revisedAuthoritativeCount,
    revisedExceptionCount,
    ranked,
  };
}
