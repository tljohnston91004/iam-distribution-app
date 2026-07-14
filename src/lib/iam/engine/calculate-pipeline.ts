import { prisma } from "@/lib/db";
import { FEATURED_PRIORITY_COUNT } from "@/lib/iam/constants";
import {
  buildSkuEvidence,
  groupCandidatesIntoWorkPackages,
  identifyCandidatesForSku,
  rankWorkPackages,
} from "./ranking";
import type { IfmSignalFlags, RseSignalFlags, WorkPackage } from "../types";

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

function strengthFromPackage(pkg: WorkPackage): string {
  const raw = pkg.detail.actionStrength;
  return typeof raw === "string" ? raw : "Monitor";
}

export async function runIamCalculatePipeline(iamRunId: string) {
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

  const demandBySku = new Map<string, { unitsSold: number; grossSalesDollars: number; dataConfidence: string }>();
  for (const d of run.demandHistory) {
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

  const allScored = [];

  for (const inv of run.inventorySnapshots) {
    const demand = demandBySku.get(inv.skuOrItemId);
    const supply = supplyBySku.get(inv.skuOrItemId);
    const evidence = buildSkuEvidence(
      inv.skuOrItemId,
      inv,
      demand,
      supply
        ? {
            backorderQuantity: supply.backorderQuantity,
            openOrderQuantity: supply.openOrderQuantity,
          }
        : undefined
    );
    const rse = rseFlagsFromSignals(rseBySku.get(inv.skuOrItemId) ?? []);
    const ifm = ifmFlagsFromSignals(ifmBySku.get(inv.skuOrItemId) ?? []);
    allScored.push(...identifyCandidatesForSku(evidence, rse, ifm));
  }

  const packages = rankWorkPackages(groupCandidatesIntoWorkPackages(allScored));
  const topFeatured = packages.slice(0, FEATURED_PRIORITY_COUNT);
  const skuCandidateCount = allScored.filter((c) => !c.suppressedFlag).length;

  await prisma.$transaction(async (tx) => {
    await tx.actionCandidate.deleteMany({ where: { iamRunId } });
    await tx.action.deleteMany({
      where: {
        iamRunId,
        workflowState: { in: ["Candidate", "Featured"] },
        priorityCategory: "new_priority",
      },
    });

    for (let i = 0; i < packages.length; i++) {
      const pkg = packages[i]!;
      const isFeatured = i < FEATURED_PRIORITY_COUNT && !pkg.suppressedFlag;
      const slot = isFeatured ? i + 1 : null;
      const isGrouped = pkg.childSkuIds.length > 1;

      const candidate = await tx.actionCandidate.create({
        data: {
          iamRunId,
          skuOrItemId: pkg.leadSkuOrItemId,
          sourceType: pkg.sourceType,
          actionType: pkg.actionType,
          candidateTitle: pkg.packageTitle,
          evidenceStrength: pkg.evidenceStrength,
          estimatedCashImpact: pkg.estimatedCashImpact,
          serviceOperationalRisk: pkg.serviceOperationalRisk,
          serviceRiskScore: pkg.serviceRiskScore,
          cashImpactScore: pkg.cashImpactScore,
          priorityScore: pkg.priorityScore,
          priorityCategory: pkg.priorityCategory,
          readinessLabel: pkg.readinessLabel,
          confidenceLevel: pkg.confidenceLevel,
          suppressedFlag: pkg.suppressedFlag,
          rankedPosition: i + 1,
          detailJson: JSON.stringify(pkg.detail),
        },
      });

      if (pkg.suppressedFlag) continue;

      const action = await tx.action.create({
        data: {
          iamRunId,
          actionCandidateId: candidate.id,
          skuOrItemId: pkg.leadSkuOrItemId,
          actionTitle: pkg.packageTitle,
          actionType: pkg.actionType,
          actionStrength: strengthFromPackage(pkg),
          priorityScore: pkg.priorityScore,
          priorityCategory: "new_priority",
          workflowState: isFeatured ? "Featured" : "Candidate",
          featuredSlot: slot,
          firstSurfacedDate: isFeatured ? new Date() : null,
          confidenceLevel: pkg.confidenceLevel,
          originalEstimatedImpact: pkg.estimatedCashImpact,
          visibilityClass: "Management Visible",
          groupedActionFlag: isGrouped,
          detailJson: JSON.stringify(pkg.detail),
        },
      });

      if (isGrouped) {
        await tx.groupedActionItem.createMany({
          data: pkg.childSkuIds.map((sku) => ({
            actionId: action.id,
            childReferenceId: sku,
            childStatus: "open",
          })),
        });
      }
    }

    const hasInventory = run.inventorySnapshots.length > 0;
    const hasDemand = run.demandHistory.length > 0;
    let readiness = "Not Ready";
    if (hasInventory && hasDemand) readiness = packages.length ? "Ready" : "Partial";
    else if (hasInventory || hasDemand) readiness = "Partial";

    await tx.iamRun.update({
      where: { id: iamRunId },
      data: { readinessStatus: readiness, runStatus: "In Review" },
    });

    await tx.changeLog.create({
      data: {
        iamRunId,
        entityType: "IamRun",
        entityId: iamRunId,
        action: "calculated",
        detail: `${packages.length} work packages from ${skuCandidateCount} SKU candidates; ${topFeatured.length} featured`,
      },
    });
  });

  return {
    candidateCount: packages.length,
    skuCandidateCount,
    featuredCount: topFeatured.length,
    holdoverCount: run.actions.length,
    childSkuCount: packages.reduce((sum, p) => sum + p.childSkuIds.length, 0),
  };
}
