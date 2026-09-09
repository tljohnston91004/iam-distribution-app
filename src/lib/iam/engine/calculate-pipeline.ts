/**
 * IAM calculate pipeline — Phase 4 scoring/presentation separation.
 *
 * 1) Identify interim candidates from evidence (Port upsert + SD-17)
 * 2) Score all Recommendations via scoring service (interim profile)
 * 3) Assign Board presentation lanes (independent of lifecycle mutation)
 *
 * Does not create new legacy Action / ActionCandidate records.
 * No Keystroke adapter imports (ADR-IAM-001).
 */

import { prisma } from "@/lib/db";
import {
  upsertRecommendations,
  type RecommendationPackageItem,
} from "@/lib/iam/inbound";
import { assertEvidenceApprovedForAnalysis } from "@/lib/iam/ingestion";
import { scoreAndPresentReviewCycle } from "@/lib/iam/presentation";
import { attachPrescribedActionPlans, type SkuActionInput } from "@/lib/iam/actions";
import { applyCoiToReviewCycle } from "@/lib/iam/coi";
import { identifyCandidatesForSku, buildSkuEvidence, rankAllPriorityCandidates } from "./ranking";
import {
  applySegmentDoubleCountGuard,
  identifySegmentCandidates,
  type SkuEvidenceWithDims,
} from "./segments";
import type { IfmSignalFlags, RseSignalFlags, ScoredCandidate } from "../types";

function parseSignalPayload(json: string | null | undefined): Record<string, unknown> {
  if (!json) return {};
  try {
    return JSON.parse(json) as Record<string, unknown>;
  } catch {
    return {};
  }
}

function rseFlagsFromSignals(signals: { signalType: string; payloadJson: string | null }[]): RseSignalFlags {
  const flags: RseSignalFlags = {};
  for (const s of signals) {
    const p = parseSignalPayload(s.payloadJson);
    if (s.signalType.includes("root_cause") || p.rootCauseFlag) flags.rootCauseFlag = true;
    if (s.signalType.includes("classification")) flags.classificationIssueFlag = true;
    if (s.signalType.includes("min_max") || s.signalType.includes("minmax")) flags.minMaxIssueFlag = true;
    if (s.signalType.includes("overbuy")) flags.replenishmentOverbuyRisk = true;
    if (s.signalType.includes("review_recommended")) flags.rseReviewRecommended = true;
  }
  return flags;
}

function ifmFlagsFromSignals(signals: { signalType: string; payloadJson: string | null }[]): IfmSignalFlags {
  const flags: IfmSignalFlags = {};
  for (const s of signals) {
    const p = parseSignalPayload(s.payloadJson);
    if (s.signalType.includes("cash_pressure")) flags.cashPressureFlag = true;
    if (s.signalType.includes("funding_constrained")) flags.fundingConstrainedFlag = true;
    if (s.signalType.includes("patience") && p.low === true) flags.patienceToleranceLow = true;
    if (typeof p.severity === "number") flags.inventoryCapitalSeverity = p.severity;
  }
  return flags;
}

export async function runIamCalculatePipeline(iamRunId: string) {
  await assertEvidenceApprovedForAnalysis(iamRunId);

  const run = await prisma.iamRun.findUnique({
    where: { id: iamRunId },
    include: {
      inventorySnapshots: true,
      demandHistory: true,
      incomingSupply: true,
      moduleSignals: true,
      actions: { where: { workflowState: "Holdover" } },
    },
  });

  if (!run) throw new Error("Run not found");

  // Unified ingestion: only reconciled winners feed the analytical model.
  const selectedInventory = run.inventorySnapshots.filter((i) => i.selectedForAnalysis);
  const selectedDemand = run.demandHistory.filter((d) => d.selectedForAnalysis);

  const demandBySku = new Map<string, { unitsSold: number; grossSalesDollars: number; dataConfidence: string }>();
  for (const d of selectedDemand) {
    const existing = demandBySku.get(d.skuOrItemId);
    if (existing) {
      existing.unitsSold += d.unitsSold;
      existing.grossSalesDollars += d.grossSalesDollars;
    } else {
      demandBySku.set(d.skuOrItemId, {
        unitsSold: d.unitsSold,
        grossSalesDollars: d.grossSalesDollars,
        dataConfidence: d.dataConfidence,
      });
    }
  }

  const supplyBySku = new Map(run.incomingSupply.map((s) => [s.skuOrItemId, s]));
  const rseBySku = new Map<string, typeof run.moduleSignals>();
  const ifmBySku = new Map<string, typeof run.moduleSignals>();
  for (const sig of run.moduleSignals) {
    if (!sig.skuOrItemId) continue;
    if (sig.sourceModule === "RSE") {
      const list = rseBySku.get(sig.skuOrItemId) ?? [];
      list.push(sig);
      rseBySku.set(sig.skuOrItemId, list);
    }
    if (sig.sourceModule === "IFM") {
      const list = ifmBySku.get(sig.skuOrItemId) ?? [];
      list.push(sig);
      ifmBySku.set(sig.skuOrItemId, list);
    }
  }

  const skuEvidenceList: SkuEvidenceWithDims[] = [];
  const skuCandidates: ScoredCandidate[] = [];
  const evidenceBySku = new Map<string, SkuActionInput>();

  for (const inv of selectedInventory) {
    const usableQty =
      inv.quantityBasisUsed === "available_qoh" && inv.availableQoh != null
        ? inv.availableQoh
        : inv.quantityOnHand;

    // Standalone without classification: keep operable; soften confidence when class missing.
    let dataConfidence = inv.dataConfidence;
    if (!inv.classification && dataConfidence === "High Confidence") {
      dataConfidence = "Medium Confidence";
    } else if (!inv.classification && dataConfidence === "Medium Confidence") {
      // leave Medium — optional class does not block analysis
    }

    const demand = demandBySku.get(inv.skuOrItemId);
    const supply = supplyBySku.get(inv.skuOrItemId);
    const evidence = buildSkuEvidence(
      inv.skuOrItemId,
      {
        description: inv.description,
        quantityOnHand: usableQty,
        cost: inv.cost,
        inventoryValue: inv.inventoryValue,
        dataConfidence,
        classification: inv.classification,
        vendorName: inv.vendorName,
        category: inv.category,
        department: inv.department,
        locationCode: inv.locationCode,
        productGroup: inv.productGroup,
        lastSoldDate: inv.lastSoldDate,
      },
      demand,
      supply
        ? {
            backorderQuantity: supply.backorderQuantity,
            openOrderQuantity: supply.openOrderQuantity,
          }
        : undefined
    );
    skuEvidenceList.push(evidence);
    const rse = rseFlagsFromSignals(rseBySku.get(inv.skuOrItemId) ?? []);
    const ifm = ifmFlagsFromSignals(ifmBySku.get(inv.skuOrItemId) ?? []);
    evidenceBySku.set(inv.skuOrItemId, {
      ...evidence,
      lastSoldDate: inv.lastSoldDate,
      openPurchaseOrders: supply?.openOrderQuantity ?? null,
      rseMinMaxIssue: Boolean(rse.minMaxIssueFlag),
      rseOverbuyRisk: Boolean(rse.replenishmentOverbuyRisk),
    });
    skuCandidates.push(...identifyCandidatesForSku(evidence, rse, ifm));
  }

  const segmentCandidates = identifySegmentCandidates(skuEvidenceList);
  const guardedSku = applySegmentDoubleCountGuard(skuCandidates, segmentCandidates);
  const withPlans = attachPrescribedActionPlans(
    [...segmentCandidates, ...guardedSku],
    evidenceBySku
  );
  const allScored = withPlans;

  // Phase 4: do not drop confidence-suppressed candidates before Port upsert.
  // Rank by total financial + operational business impact (segment or SKU).
  // Cap Board volume: keep all segments, then fill remaining slots with top SKU issues.
  const rankedAll = rankAllPriorityCandidates(allScored);
  const segmentsOnly = rankedAll.filter((c) => c.detail?.analysisGrain === "segment");
  const skusOnly = rankedAll.filter((c) => c.detail?.analysisGrain !== "segment");
  const MAX_INTERIM_BOARD = 80;
  const skuSlots = Math.max(0, MAX_INTERIM_BOARD - segmentsOnly.length);
  const ranked = [...segmentsOnly, ...skusOnly.slice(0, skuSlots)];


  const evidenceBatchIds = [
    ...new Set(
      [
        ...selectedInventory.map((i) => i.evidenceBatchId),
        ...selectedDemand.map((d) => d.evidenceBatchId),
      ].filter((id): id is string => Boolean(id))
    ),
  ];

  await prisma.recommendation.deleteMany({
    where: { iamRunId, generationPath: "interim_evidence" },
  });

  await prisma.actionCandidate.deleteMany({ where: { iamRunId } });
  await prisma.action.deleteMany({
    where: {
      iamRunId,
      workflowState: { in: ["Candidate", "Featured"] },
      priorityCategory: "new_priority",
    },
  });

  // Presentation deferred to presentation service — upsert as managed_backlog only.
  const packageItems: RecommendationPackageItem[] = ranked.map((c, i) => {
    const isSegment = c.detail?.analysisGrain === "segment";
    return {
      sourceModule: "IAM",
      generationPath: "interim_evidence" as const,
      opportunityKey: `${c.skuOrItemId}|${c.actionType}`,
      skuOrItemId: isSegment ? null : c.skuOrItemId,
      analysisGrain: isSegment ? ("segment" as const) : ("sku" as const),
      segmentType: isSegment ? String(c.detail.segmentType ?? "") : null,
      segmentKey: isSegment ? String(c.detail.segmentKey ?? "") : null,
      affectedSkuCount: isSegment ? Number(c.detail.affectedSkuCount ?? 0) : null,
      recommendationType: c.actionType,
      title: c.candidateTitle,
      confidence: c.confidenceLevel,
      estimatedCashImpact: c.estimatedCashImpact ?? null,
      estimatedFinancialImpact: c.estimatedCashImpact ?? null,
      explainability: {
        sourceType: c.sourceType,
        evidenceStrength: c.evidenceStrength,
        detail: c.detail,
        serviceRiskScore: c.serviceRiskScore,
        interim: true,
        generationPath: "interim_evidence",
        candidateDiscoveryScore: c.priorityScore,
        suppressedFlagAtDiscovery: c.suppressedFlag,
        analysisGrain: isSegment ? "segment" : "sku",
        memberSkus: c.detail.memberSkus ?? null,
        doubleCountGuard: c.detail.doubleCountGuard ?? null,
        prescribedActionPlan: c.detail.prescribedActionPlan ?? null,
        recommendedManagementAction: c.detail.recommendedManagementAction ?? null,
        dataQualityWarning: c.detail.dataQualityWarning ?? null,
      },
      evidenceRefs: evidenceBatchIds.map((id) => ({ evidenceBatchId: id })),
      presentationCategory: "managed_backlog" as const,
      presentationRank: i + 1,
    };
  });

  const upsertResult = await upsertRecommendations({
    reviewCycleId: iamRunId,
    recommendations: packageItems,
    performedBy: "calculate-pipeline",
  });

  // Apply COI before score/present so Trust stories and Board metrics include it.
  // Scoring merges explainability over prior JSON (preserves costOfInactionDetail).
  const coi = await applyCoiToReviewCycle(iamRunId);
  const presented = await scoreAndPresentReviewCycle(iamRunId);

  const hasInventory = selectedInventory.length > 0;
  const hasDemand = selectedDemand.length > 0;
  let readiness = "Not Ready";
  if (hasInventory && hasDemand) readiness = ranked.length ? "Ready" : "Partial";
  else if (hasInventory || hasDemand) readiness = "Partial";

  await prisma.iamRun.update({
    where: { id: iamRunId },
    data: { readinessStatus: readiness, runStatus: "In Review" },
  });

  await prisma.changeLog.create({
    data: {
      iamRunId,
      entityType: "IamRun",
      entityId: iamRunId,
      action: "calculated_scored_presented",
      detail: `interimSubmitted=${packageItems.length} created=${upsertResult.createdCount} updated=${upsertResult.updatedCount} sd17Enriched=${upsertResult.enrichedModuleCount} skippedDup=${upsertResult.skippedDuplicateInterimCount} scored=${presented.scoredCount} profile=${presented.scoringProfileId} active=${presented.lanes.active_priority.length} holdover=${presented.lanes.holdover.length} coiCalc=${coi.calculated} coiPartial=${coi.partial} coiUnavailable=${coi.unavailable}`,
    },
  });

  return {
    candidateCount: ranked.length,
    featuredCount: presented.lanes.active_priority.length,
    holdoverCount: presented.lanes.holdover.length + run.actions.length,
    interimRecommendationCount: upsertResult.createdCount + upsertResult.updatedCount,
    sd17EnrichedModuleCount: upsertResult.enrichedModuleCount,
    sd17SkippedDuplicateCount: upsertResult.skippedDuplicateInterimCount,
    scoredCount: presented.scoredCount,
    scoringProfileId: presented.scoringProfileId,
    presentationLanes: presented.lanes,
    coi,
  };
}
