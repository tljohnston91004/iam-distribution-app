import { prisma } from "@/lib/db";
import {
  buildOpportunityKey,
  deriveQuantityBasis,
  type EvidencePackageInput,
  type RecommendationBatchInput,
  type RecommendationPackageItem,
} from "./types";
import { normalizeSourceChannel, channelPriority } from "@/lib/iam/ingestion/source-priority";

export class InboundPortError extends Error {
  constructor(
    message: string,
    public readonly code: "VALIDATION" | "NOT_FOUND" | "CONFLICT" = "VALIDATION"
  ) {
    super(message);
    this.name = "InboundPortError";
  }
}

async function writeAudit(opts: {
  iamRunId: string;
  entityType: string;
  entityId: string;
  action: string;
  performedBy: string;
  requestId?: string;
  detail?: Record<string, unknown>;
}) {
  await prisma.auditEvent.create({
    data: {
      iamRunId: opts.iamRunId,
      entityType: opts.entityType,
      entityId: opts.entityId,
      action: opts.action,
      performedBy: opts.performedBy,
      requestId: opts.requestId ?? null,
      detailJson: opts.detail ? JSON.stringify(opts.detail) : null,
    },
  });
}

/**
 * Upsert canonical Evidence Package. Adapters only — never sets Board/scores/workflow.
 */
export async function upsertEvidenceBatch(pkg: EvidencePackageInput) {
  if (!pkg.reviewCycleId?.trim()) throw new InboundPortError("reviewCycleId is required");
  if (!pkg.evidenceBatchKey?.trim()) throw new InboundPortError("evidenceBatchKey is required");
  if (!pkg.sourceSystem?.trim()) throw new InboundPortError("sourceSystem is required");
  if (!pkg.sourceReportType?.trim()) throw new InboundPortError("sourceReportType is required");
  if (!Array.isArray(pkg.items)) throw new InboundPortError("items must be an array");

  const run = await prisma.iamRun.findUnique({ where: { id: pkg.reviewCycleId } });
  if (!run) throw new InboundPortError(`Review cycle not found: ${pkg.reviewCycleId}`, "NOT_FOUND");

  const performedBy = pkg.performedBy ?? "inbound-port";
  const asOf = pkg.asOfTimestamp ? new Date(pkg.asOfTimestamp) : null;
  const sourceChannel = normalizeSourceChannel(pkg.sourceSystem);

  const existing = await prisma.evidenceBatch.findUnique({
    where: {
      iamRunId_externalBatchKey: {
        iamRunId: pkg.reviewCycleId,
        externalBatchKey: pkg.evidenceBatchKey,
      },
    },
  });

  let batch = existing;
  if (existing) {
    await prisma.inventorySnapshot.deleteMany({ where: { evidenceBatchId: existing.id } });
    await prisma.demandHistory.deleteMany({ where: { evidenceBatchId: existing.id } });
    await prisma.incomingSupply.deleteMany({ where: { evidenceBatchId: existing.id } });
    batch = await prisma.evidenceBatch.update({
      where: { id: existing.id },
      data: {
        sourceSystem: pkg.sourceSystem,
        sourceChannel,
        sourceReportType: pkg.sourceReportType,
        sourceFileName: pkg.sourceFileName ?? null,
        asOfTimestamp: asOf && !Number.isNaN(asOf.getTime()) ? asOf : null,
        contentIdentity: pkg.contentIdentity ?? null,
        status: "accepted",
        itemCount: pkg.items.length,
        errorDetail: null,
      },
    });
  } else {
    batch = await prisma.evidenceBatch.create({
      data: {
        iamRunId: pkg.reviewCycleId,
        externalBatchKey: pkg.evidenceBatchKey,
        sourceSystem: pkg.sourceSystem,
        sourceChannel,
        sourceReportType: pkg.sourceReportType,
        sourceFileName: pkg.sourceFileName ?? null,
        asOfTimestamp: asOf && !Number.isNaN(asOf.getTime()) ? asOf : null,
        contentIdentity: pkg.contentIdentity ?? null,
        status: "accepted",
        itemCount: pkg.items.length,
      },
    });
  }

  const invRows: {
    iamRunId: string;
    skuOrItemId: string;
    description: string | null;
    quantityOnHand: number;
    availableQoh: number | null;
    quantityBasisUsed: string | null;
    cost: number | null;
    inventoryValue: number | null;
    classification: string | null;
    vendorName: string | null;
    category: string | null;
    department: string | null;
    locationCode: string | null;
    productGroup: string | null;
    itemStatus: string | null;
    classificationSource: string | null;
    dataConfidence: string;
    entityEligibility: string;
    evidenceBatchId: string;
    openOrderQuantity: number | null;
    lastSoldDate: Date | null;
    lastReceivedDate: Date | null;
    sourceRowRef: string | null;
  }[] = [];
  const demRows: {
    iamRunId: string;
    skuOrItemId: string;
    periodLabel: string;
    periodCode: string | null;
    unitsSold: number;
    grossSalesDollars: number;
    dataConfidence: string;
    entityEligibility: string;
    evidenceBatchId: string;
    sourceRowRef: string | null;
  }[] = [];
  const supplyRows: {
    iamRunId: string;
    skuOrItemId: string;
    openOrderQuantity: number | null;
    backorderQuantity: number | null;
    dataConfidence: string;
    evidenceBatchId: string;
  }[] = [];
  const classificationOverlays: {
    skuOrItemId: string;
    classification?: string | null;
    vendorName?: string | null;
    category?: string | null;
    department?: string | null;
    locationCode?: string | null;
    productGroup?: string | null;
    itemStatus?: string | null;
    dataConfidence?: string | null;
  }[] = [];

  for (const item of pkg.items) {
    const sku = String(item.skuOrItemId ?? "").trim();
    if (!sku) continue;
    const eligibility = item.entityEligibility ?? "rankable";
    const { basis, usableQty } = deriveQuantityBasis(
      item.availableQoh,
      item.quantityOnHand,
      item.quantityBasisUsed
    );

    const hasDims =
      item.classification != null ||
      item.vendorName != null ||
      item.category != null ||
      item.department != null ||
      item.locationCode != null ||
      item.productGroup != null ||
      item.itemStatus != null;

    if (usableQty != null || item.quantityOnHand != null || item.availableQoh != null) {
      const qoh = item.quantityOnHand ?? usableQty ?? 0;
      const cost = item.unitCost ?? null;
      invRows.push({
        iamRunId: pkg.reviewCycleId,
        skuOrItemId: sku,
        description: item.description ?? null,
        quantityOnHand: qoh,
        availableQoh: item.availableQoh ?? null,
        quantityBasisUsed: basis,
        cost,
        inventoryValue: cost != null ? qoh * cost : null,
        classification: item.classification ?? null,
        vendorName: item.vendorName ?? null,
        category: item.category ?? null,
        department: item.department ?? null,
        locationCode: item.locationCode ?? null,
        productGroup: item.productGroup ?? null,
        itemStatus: item.itemStatus ?? null,
        classificationSource: hasDims ? normalizeSourceChannel(pkg.sourceSystem) : null,
        dataConfidence: item.dataConfidence ?? "Medium Confidence",
        entityEligibility: eligibility,
        evidenceBatchId: batch.id,
        openOrderQuantity: item.openOrderQty ?? null,
        lastSoldDate: item.lastSoldDate ? new Date(item.lastSoldDate) : null,
        lastReceivedDate: item.lastReceivedDate ? new Date(item.lastReceivedDate) : null,
        sourceRowRef: item.sourceRowRef ?? null,
      });
    } else if (hasDims) {
      // Classification / dimensional overlay without QOH (RSE or optional Keystroke class reports).
      classificationOverlays.push({
        skuOrItemId: sku,
        classification: item.classification,
        vendorName: item.vendorName,
        category: item.category,
        department: item.department,
        locationCode: item.locationCode,
        productGroup: item.productGroup,
        itemStatus: item.itemStatus,
        dataConfidence: item.dataConfidence,
      });
    }

    if (item.unitsSold != null || item.salesDollars != null) {
      demRows.push({
        iamRunId: pkg.reviewCycleId,
        skuOrItemId: sku,
        periodLabel: item.periodCode === "W13" ? "13_weeks" : item.periodCode ?? "unspecified",
        periodCode: item.periodCode ?? null,
        unitsSold: item.unitsSold ?? 0,
        grossSalesDollars: item.salesDollars ?? 0,
        dataConfidence: item.dataConfidence ?? "Medium Confidence",
        entityEligibility: eligibility,
        evidenceBatchId: batch.id,
        sourceRowRef: item.sourceRowRef ?? null,
      });
    }

    if (
      (item.openOrderQty != null && item.openOrderQty > 0) ||
      (item.backorderQuantity != null && item.backorderQuantity > 0)
    ) {
      supplyRows.push({
        iamRunId: pkg.reviewCycleId,
        skuOrItemId: sku,
        openOrderQuantity: item.openOrderQty ?? null,
        backorderQuantity: item.backorderQuantity ?? null,
        dataConfidence: item.dataConfidence ?? "Medium Confidence",
        evidenceBatchId: batch.id,
      });
    }
  }

  for (let i = 0; i < invRows.length; i += 500) {
    await prisma.inventorySnapshot.createMany({ data: invRows.slice(i, i + 500) });
  }
  for (let i = 0; i < demRows.length; i += 500) {
    await prisma.demandHistory.createMany({ data: demRows.slice(i, i + 500) });
  }
  for (let i = 0; i < supplyRows.length; i += 500) {
    await prisma.incomingSupply.createMany({ data: supplyRows.slice(i, i + 500) });
  }

  // Apply dimensional overlays onto existing inventory rows (consume RSE outputs; do not recalculate).
  const overlayChannel = normalizeSourceChannel(pkg.sourceSystem);
  const overlayPriority = channelPriority(overlayChannel);
  for (const ov of classificationOverlays) {
    const rows = await prisma.inventorySnapshot.findMany({
      where: { iamRunId: pkg.reviewCycleId, skuOrItemId: ov.skuOrItemId },
    });
    for (const row of rows) {
      const existingCh = row.classificationSource
        ? normalizeSourceChannel(row.classificationSource)
        : null;
      const existingPri = existingCh ? channelPriority(existingCh) : -1;
      if (existingPri > overlayPriority) continue;
      await prisma.inventorySnapshot.update({
        where: { id: row.id },
        data: {
          ...(ov.classification != null ? { classification: ov.classification } : {}),
          ...(ov.vendorName != null ? { vendorName: ov.vendorName } : {}),
          ...(ov.category != null ? { category: ov.category } : {}),
          ...(ov.department != null ? { department: ov.department } : {}),
          ...(ov.locationCode != null ? { locationCode: ov.locationCode } : {}),
          ...(ov.productGroup != null ? { productGroup: ov.productGroup } : {}),
          ...(ov.itemStatus != null ? { itemStatus: ov.itemStatus } : {}),
          classificationSource: overlayChannel,
          ...(ov.dataConfidence
            ? {
                dataConfidence:
                  overlayChannel === "RSE" || overlayChannel === "DataHub"
                    ? ov.dataConfidence
                    : row.dataConfidence,
              }
            : {}),
        },
      });
    }
  }

  await prisma.evidenceBatch.update({
    where: { id: batch.id },
    data: { itemCount: invRows.length + demRows.length + classificationOverlays.length },
  });

  await writeAudit({
    iamRunId: pkg.reviewCycleId,
    entityType: "EvidenceBatch",
    entityId: batch.id,
    action: "upsertEvidenceBatch",
    performedBy,
    requestId: pkg.requestId,
    detail: {
      sourceSystem: pkg.sourceSystem,
      sourceReportType: pkg.sourceReportType,
      inventoryRows: invRows.length,
      demandRows: demRows.length,
      supersededBatchId: existing?.id ?? null,
    },
  });

  return {
    evidenceBatchId: batch.id,
    externalBatchKey: batch.externalBatchKey,
    status: "accepted" as const,
    inventoryRows: invRows.length,
    demandRows: demRows.length,
    supplyRows: supplyRows.length,
    supersededPriorBatch: Boolean(existing),
  };
}

function moduleSourceId(item: RecommendationPackageItem, opportunityKey: string): string {
  const path = item.generationPath ?? "module";
  if (path === "module") {
    const id = item.sourceRecommendationId?.trim();
    if (!id) {
      throw new InboundPortError(
        `sourceRecommendationId is required for module recommendations (${item.sourceModule})`
      );
    }
    return id;
  }
  // interim_evidence: stable synthetic id so unique constraint works; SD-17 blocks duplicates vs module
  return item.sourceRecommendationId?.trim() || `interim:${opportunityKey}`;
}

/**
 * Upsert Recommendation Package with SD-17 consolidation:
 * module Recommendations are authoritative; interim evidence must not duplicate.
 */
export async function upsertRecommendations(batch: RecommendationBatchInput) {
  if (!batch.reviewCycleId?.trim()) throw new InboundPortError("reviewCycleId is required");
  if (!Array.isArray(batch.recommendations)) {
    throw new InboundPortError("recommendations must be an array");
  }

  const run = await prisma.iamRun.findUnique({ where: { id: batch.reviewCycleId } });
  if (!run) throw new InboundPortError(`Review cycle not found: ${batch.reviewCycleId}`, "NOT_FOUND");

  const performedBy = batch.performedBy ?? "inbound-port";
  const created: string[] = [];
  const updated: string[] = [];
  const enriched: string[] = [];
  const skippedDuplicates: string[] = [];

  for (const item of batch.recommendations) {
    if (!item.sourceModule?.trim()) throw new InboundPortError("sourceModule is required");
    if (!item.recommendationType?.trim()) throw new InboundPortError("recommendationType is required");
    if (!item.title?.trim()) throw new InboundPortError("title is required");

    const generationPath = item.generationPath ?? "module";
    const opportunityKey = buildOpportunityKey(item);
    const sourceRecommendationId = moduleSourceId(item, opportunityKey);

    if (generationPath === "interim_evidence") {
      const authoritative = await prisma.recommendation.findFirst({
        where: {
          iamRunId: batch.reviewCycleId,
          opportunityKey,
          generationPath: "module",
        },
      });
      if (authoritative) {
        const refs = mergeEvidenceRefs(authoritative.evidenceRefsJson, item.evidenceRefs);
        await prisma.recommendation.update({
          where: { id: authoritative.id },
          data: {
            evidenceRefsJson: refs,
            // Enrich only when module left the field empty — module values remain authoritative (SD-17).
            ...(item.estimatedCashImpact != null && authoritative.estimatedCashImpact == null
              ? { estimatedCashImpact: item.estimatedCashImpact }
              : {}),
            ...(item.estimatedFinancialImpact != null && authoritative.estimatedFinancialImpact == null
              ? { estimatedFinancialImpact: item.estimatedFinancialImpact }
              : {}),
            ...(item.costOfInaction != null && authoritative.costOfInaction == null
              ? { costOfInaction: item.costOfInaction }
              : {}),
            ...(item.confidence && (!authoritative.confidence || authoritative.confidence === "Medium")
              ? { confidence: item.confidence }
              : {}),
          },
        });
        enriched.push(authoritative.id);
        skippedDuplicates.push(opportunityKey);
        await writeAudit({
          iamRunId: batch.reviewCycleId,
          entityType: "Recommendation",
          entityId: authoritative.id,
          action: "sd17_enrich_module_from_interim_evidence",
          performedBy,
          requestId: batch.requestId,
          detail: { opportunityKey, skippedInterim: true },
        });
        continue;
      }
    }

    const existing = await prisma.recommendation.findUnique({
      where: {
        iamRunId_sourceModule_sourceRecommendationId: {
          iamRunId: batch.reviewCycleId,
          sourceModule: item.sourceModule,
          sourceRecommendationId,
        },
      },
    });

    const data = {
      opportunityKey,
      skuOrItemId:
        item.analysisGrain === "segment" ? null : item.skuOrItemId ?? null,
      analysisGrain: item.analysisGrain ?? "sku",
      segmentType: item.segmentType ?? null,
      segmentKey: item.segmentKey ?? null,
      affectedSkuCount: item.affectedSkuCount ?? null,
      recommendationType: item.recommendationType,
      title: item.title,
      generationPath,
      confidence: item.confidence ?? "Medium",
      estimatedFinancialImpact: item.estimatedFinancialImpact ?? null,
      estimatedCashImpact: item.estimatedCashImpact ?? null,
      costOfInaction: item.costOfInaction ?? null,
      explainabilityJson: item.explainability ? JSON.stringify(item.explainability) : null,
      evidenceRefsJson: item.evidenceRefs != null ? JSON.stringify(item.evidenceRefs) : null,
      sourcePayloadHash: item.sourcePayloadHash ?? null,
      presentationCategory: item.presentationCategory ?? "managed_backlog",
      presentationRank: item.presentationRank ?? null,
    };

    if (existing) {
      await prisma.recommendation.update({ where: { id: existing.id }, data });
      updated.push(existing.id);
      await writeAudit({
        iamRunId: batch.reviewCycleId,
        entityType: "Recommendation",
        entityId: existing.id,
        action: "upsertRecommendation_update",
        performedBy,
        requestId: batch.requestId,
        detail: { sourceModule: item.sourceModule, sourceRecommendationId, generationPath },
      });
    } else {
      const createdRow = await prisma.recommendation.create({
        data: {
          iamRunId: batch.reviewCycleId,
          sourceModule: item.sourceModule,
          sourceRecommendationId,
          lifecycleState: "Identified",
          ...data,
        },
      });
      created.push(createdRow.id);

      if (item.estimatedFinancialImpact != null || item.estimatedCashImpact != null) {
        await prisma.financialImpact.create({
          data: {
            recommendationId: createdRow.id,
            revision: 1,
            expectedValue: item.estimatedFinancialImpact ?? item.estimatedCashImpact ?? 0,
            expectedCash: item.estimatedCashImpact ?? null,
            currency: "USD",
          },
        });
      }

      await writeAudit({
        iamRunId: batch.reviewCycleId,
        entityType: "Recommendation",
        entityId: createdRow.id,
        action: "upsertRecommendation_create",
        performedBy,
        requestId: batch.requestId,
        detail: { sourceModule: item.sourceModule, sourceRecommendationId, generationPath },
      });
    }
  }

  return {
    createdCount: created.length,
    updatedCount: updated.length,
    enrichedModuleCount: enriched.length,
    skippedDuplicateInterimCount: skippedDuplicates.length,
    createdIds: created,
    updatedIds: updated,
    enrichedIds: enriched,
  };
}

function mergeEvidenceRefs(existingJson: string | null, incoming: unknown): string {
  let existing: unknown[] = [];
  if (existingJson) {
    try {
      const parsed = JSON.parse(existingJson);
      existing = Array.isArray(parsed) ? parsed : [parsed];
    } catch {
      existing = [{ raw: existingJson }];
    }
  }
  if (incoming == null) return JSON.stringify(existing);
  const add = Array.isArray(incoming) ? incoming : [incoming];
  return JSON.stringify([...existing, ...add]);
}

export async function getIngestionStatus(batchIdOrKey: string, reviewCycleId?: string) {
  const byId = await prisma.evidenceBatch.findUnique({ where: { id: batchIdOrKey } });
  if (byId) {
    return {
      kind: "evidence_batch" as const,
      id: byId.id,
      reviewCycleId: byId.iamRunId,
      externalBatchKey: byId.externalBatchKey,
      sourceSystem: byId.sourceSystem,
      sourceReportType: byId.sourceReportType,
      sourceFileName: byId.sourceFileName,
      status: byId.status,
      itemCount: byId.itemCount,
      createdAt: byId.createdAt.toISOString(),
      errorDetail: byId.errorDetail,
    };
  }

  if (reviewCycleId) {
    const byKey = await prisma.evidenceBatch.findUnique({
      where: {
        iamRunId_externalBatchKey: {
          iamRunId: reviewCycleId,
          externalBatchKey: batchIdOrKey,
        },
      },
    });
    if (byKey) {
      return {
        kind: "evidence_batch" as const,
        id: byKey.id,
        reviewCycleId: byKey.iamRunId,
        externalBatchKey: byKey.externalBatchKey,
        sourceSystem: byKey.sourceSystem,
        sourceReportType: byKey.sourceReportType,
        sourceFileName: byKey.sourceFileName,
        status: byKey.status,
        itemCount: byKey.itemCount,
        createdAt: byKey.createdAt.toISOString(),
        errorDetail: byKey.errorDetail,
      };
    }
  }

  throw new InboundPortError(`Ingestion batch not found: ${batchIdOrKey}`, "NOT_FOUND");
}
