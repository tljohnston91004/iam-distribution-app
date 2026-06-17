import { prisma } from "@/lib/db";
import { FEATURED_PRIORITY_COUNT } from "@/lib/iam/constants";
import { rankNewPriorityCandidates, identifyCandidatesForSku, buildSkuEvidence } from "./ranking";
import type { IfmSignalFlags, RseSignalFlags } from "../types";

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

  const ranked = rankNewPriorityCandidates(allScored);
  const topFeatured = ranked.slice(0, FEATURED_PRIORITY_COUNT);

  await prisma.$transaction(async (tx) => {
    await tx.actionCandidate.deleteMany({ where: { iamRunId } });
    await tx.action.deleteMany({
      where: {
        iamRunId,
        workflowState: { in: ["Candidate", "Featured"] },
        priorityCategory: "new_priority",
      },
    });

    const candidateRecords = await Promise.all(
      ranked.map((c, i) =>
        tx.actionCandidate.create({
          data: {
            iamRunId,
            skuOrItemId: c.skuOrItemId,
            sourceType: c.sourceType,
            actionType: c.actionType,
            candidateTitle: c.candidateTitle,
            evidenceStrength: c.evidenceStrength,
            estimatedCashImpact: c.estimatedCashImpact,
            serviceOperationalRisk: c.serviceOperationalRisk,
            serviceRiskScore: c.serviceRiskScore,
            cashImpactScore: c.cashImpactScore,
            priorityScore: c.priorityScore,
            priorityCategory: c.priorityCategory,
            readinessLabel: c.readinessLabel,
            confidenceLevel: c.confidenceLevel,
            suppressedFlag: c.suppressedFlag,
            rankedPosition: i + 1,
            detailJson: JSON.stringify(c.detail),
          },
        })
      )
    );

    const featuredIds = new Set(
      topFeatured.map((t) => `${t.skuOrItemId}:${t.actionType}`)
    );

    for (const rec of candidateRecords) {
      const key = `${rec.skuOrItemId}:${rec.actionType}`;
      const isFeatured = featuredIds.has(key) && !rec.suppressedFlag;
      const slot = isFeatured
        ? topFeatured.findIndex((t) => `${t.skuOrItemId}:${t.actionType}` === key) + 1
        : null;

      if (!isFeatured && rec.suppressedFlag) continue;

      await tx.action.create({
        data: {
          iamRunId,
          actionCandidateId: rec.id,
          skuOrItemId: rec.skuOrItemId,
          actionTitle: rec.candidateTitle,
          actionType: rec.actionType,
          actionStrength: JSON.parse(rec.detailJson ?? "{}").actionStrength ?? "Monitor",
          priorityScore: rec.priorityScore,
          priorityCategory: "new_priority",
          workflowState: isFeatured ? "Featured" : "Candidate",
          featuredSlot: slot,
          firstSurfacedDate: isFeatured ? new Date() : null,
          confidenceLevel: rec.confidenceLevel,
          originalEstimatedImpact: rec.estimatedCashImpact ?? undefined,
          visibilityClass: "Management Visible",
          detailJson: rec.detailJson,
        },
      });
    }

    const hasInventory = run.inventorySnapshots.length > 0;
    const hasDemand = run.demandHistory.length > 0;
    let readiness = "Not Ready";
    if (hasInventory && hasDemand) readiness = ranked.length ? "Ready" : "Partial";
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
        detail: `${ranked.length} candidates, ${topFeatured.length} featured`,
      },
    });
  });

  return {
    candidateCount: ranked.length,
    featuredCount: topFeatured.length,
    holdoverCount: run.actions.length,
  };
}
