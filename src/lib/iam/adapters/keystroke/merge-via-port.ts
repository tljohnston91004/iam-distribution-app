/**
 * Keystroke → Canonical Inbound Port merge.
 *
 * Builds Evidence Packages from staged UploadBatches and submits them exclusively
 * via upsertEvidenceBatch. Does NOT write InventorySnapshot / DemandHistory directly
 * except through the Inbound Port.
 *
 * SD-15: Available QOH preferred; On-Hand fallback; both retained; quantity_basis_used recorded.
 * SD-16: Case-break remains outside IAM (RSE responsibility).
 * ADR-IAM-001: EvidenceBatch idempotency by (reviewCycleId, evidenceBatchKey).
 */

import { prisma } from "@/lib/db";
import { assessRunReadiness } from "@/lib/iam/intake";
import {
  type EvidenceItemInput,
  type QuantityBasisUsed,
} from "@/lib/iam/inbound";
import { submitEvidenceThroughUnifiedIngestion } from "@/lib/iam/ingestion";
import { buildExcludedParentSkus } from "./matrix-parents";
import { loadEffectiveUploadBatches } from "./stage-upload";

export type MergeViaPortResult = {
  inventorySkus: number;
  demandSkus: number;
  supplySkus: number;
  excludedParentSkuCount: number;
  sharedParentSkuCount: number;
  evidenceBatchIds: string[];
  quantityBasisSummary: { available_qoh: number; on_hand: number };
  warnings: string[];
  readiness: Awaited<ReturnType<typeof assessRunReadiness>>;
  /** After merge, evidence is pending_approval until Approve Evidence. */
  evidenceApprovalStatus: string;
  conflictCount: number;
};

function chooseQuantityBasis(
  availableQoh: number | null | undefined,
  onHand: number | null | undefined
): {
  quantityOnHand: number | null;
  availableQoh: number | null;
  quantityBasisUsed: QuantityBasisUsed;
} {
  const avail = availableQoh != null && Number.isFinite(availableQoh) ? availableQoh : null;
  const oh = onHand != null && Number.isFinite(onHand) ? onHand : null;
  if (avail != null) {
    return { quantityOnHand: oh, availableQoh: avail, quantityBasisUsed: "available_qoh" };
  }
  if (oh != null) {
    return { quantityOnHand: oh, availableQoh: null, quantityBasisUsed: "on_hand" };
  }
  return { quantityOnHand: 0, availableQoh: null, quantityBasisUsed: "on_hand" };
}

/**
 * Merge all staged Keystroke upload batches for a run through the Canonical Inbound Port.
 * Re-merge of previously merged batches is allowed (idempotent evidence keys per run).
 */
export async function mergeKeystrokeViaInboundPort(iamRunId: string): Promise<MergeViaPortResult> {
  const run = await prisma.iamRun.findUnique({ where: { id: iamRunId } });
  if (!run) throw new Error("IAM run not found");

  const batches = await loadEffectiveUploadBatches(iamRunId);

  if (!batches.length) {
    throw new Error("No staged Keystroke uploads to merge. Upload files first.");
  }

  const inventoryBatches = batches.filter((b) => b.fileType === "inventory_position");
  const demandBatches = batches.filter((b) => b.fileType === "demand_replenishment");
  const classBatches = batches.filter(
    (b) => b.fileType === "demand_classification" || b.fileType === "inventory_classification"
  );

  if (!inventoryBatches.length) {
    throw new Error("Merge requires a staged inventory file (SCBSRSE3 or INVENTORYPOSITION).");
  }
  if (!demandBatches.length) {
    throw new Error("Merge requires at least one staged 13-week True Demand Replenishment file.");
  }

  const warnings: string[] = [];
  if (classBatches.length) {
    warnings.push(
      `Applied ${classBatches.length} classification report(s) as dimensional overlays (optional when standalone; authoritative when from RSE).`
    );
  }

  type Dims = {
    classification: string | null;
    vendorName: string | null;
    category: string | null;
    department: string | null;
    locationCode: string | null;
    productGroup: string | null;
    itemStatus: string | null;
  };

  const classBySku = new Map<string, Dims>();
  for (const batch of classBatches) {
    for (const row of batch.rows) {
      classBySku.set(row.skuOrItemId, {
        classification: row.classification ?? null,
        vendorName: row.vendorName ?? null,
        category: row.category ?? null,
        department: row.department ?? null,
        locationCode: row.locationCode ?? null,
        productGroup: row.productGroup ?? null,
        itemStatus: row.itemStatus ?? null,
      });
    }
  }

  const quantityBasisSummary = { available_qoh: 0, on_hand: 0 };
  const inventoryBySku = new Map<
    string,
    {
      skuOrItemId: string;
      description: string | null;
      quantityOnHand: number | null;
      availableQoh: number | null;
      quantityBasisUsed: QuantityBasisUsed;
      cost: number | null;
      openOrderQty: number | null;
      sourceRowRef: string | null;
      sourceFileName: string;
    } & Dims
  >();

  for (const batch of inventoryBatches) {
    for (const row of batch.rows) {
      if (row.quantityOnHand == null && row.availableQoh == null) continue;
      const chosen = chooseQuantityBasis(row.availableQoh, row.quantityOnHand);
      if (chosen.quantityBasisUsed === "available_qoh") quantityBasisSummary.available_qoh += 1;
      else quantityBasisSummary.on_hand += 1;
      const fromClass = classBySku.get(row.skuOrItemId);
      inventoryBySku.set(row.skuOrItemId, {
        skuOrItemId: row.skuOrItemId,
        description: row.description,
        quantityOnHand: chosen.quantityOnHand,
        availableQoh: chosen.availableQoh,
        quantityBasisUsed: chosen.quantityBasisUsed,
        cost: row.cost,
        openOrderQty: row.openOrderQty,
        sourceRowRef: row.sourceRowRef,
        sourceFileName: batch.originalFilename,
        classification: fromClass?.classification ?? row.classification ?? null,
        vendorName: fromClass?.vendorName ?? row.vendorName ?? null,
        category: fromClass?.category ?? row.category ?? null,
        department: fromClass?.department ?? row.department ?? null,
        locationCode: fromClass?.locationCode ?? row.locationCode ?? null,
        productGroup: fromClass?.productGroup ?? row.productGroup ?? null,
        itemStatus: fromClass?.itemStatus ?? row.itemStatus ?? null,
      });
    }
  }

  const matrixSkus = new Set<string>();
  const standardSkus = new Set<string>();
  const allDemandSkus: string[] = [];
  for (const batch of demandBatches) {
    for (const row of batch.rows) {
      allDemandSkus.push(row.skuOrItemId);
      if (batch.demandVariant === "matrix") matrixSkus.add(row.skuOrItemId);
      if (batch.demandVariant === "standard") standardSkus.add(row.skuOrItemId);
    }
  }

  const { excludedParents, sharedParents, inferredParents } = buildExcludedParentSkus({
    matrixSkus,
    standardSkus,
    allDemandSkus,
    inventorySkus: inventoryBySku.keys(),
  });

  if (excludedParents.size > 0) {
    warnings.push(
      `Excluded ${excludedParents.size} matrix parent/scheme SKU(s) (${sharedParents.size} shared Matrix+Standard, ${inferredParents.size} inferred). Case-break remains RSE (SD-16).`
    );
  }

  type Dem = {
    skuOrItemId: string;
    description: string | null;
    unitsSold: number;
    salesDollars: number;
    sourceRowRef: string | null;
    sourceFileName: string;
  };
  const demandBySku = new Map<string, Dem>();
  const orderedDemand = [
    ...demandBatches.filter((b) => b.demandVariant === "matrix"),
    ...demandBatches.filter((b) => b.demandVariant === "standard"),
    ...demandBatches.filter((b) => b.demandVariant !== "matrix" && b.demandVariant !== "standard"),
  ];

  for (const batch of orderedDemand) {
    for (const row of batch.rows) {
      if (excludedParents.has(row.skuOrItemId)) continue;
      demandBySku.set(row.skuOrItemId, {
        skuOrItemId: row.skuOrItemId,
        description: row.description,
        unitsSold: row.unitsSold ?? 0,
        salesDollars: row.salesDollars ?? 0,
        sourceRowRef: row.sourceRowRef,
        sourceFileName: batch.originalFilename,
      });
    }
  }

  const importAt = new Date().toISOString();
  const invFileNames = inventoryBatches.map((b) => b.originalFilename).join("|");
  const demFileNames = demandBatches.map((b) => b.originalFilename).join("|");

  // Do NOT wipe other sources (RSE / Data Hub). Keystroke batches use stable evidence keys;
  // the Inbound Port supersedes only rows for those Keystroke EvidenceBatches.
  await prisma.dataGap.deleteMany({
    where: {
      iamRunId,
      affectedArea: {
        in: ["Inventory Position", "Sales / Demand Evidence", "Demand Merge", "Matrix Parents"],
      },
    },
  });

  const invItems: EvidenceItemInput[] = [...inventoryBySku.values()]
    .filter((r) => !excludedParents.has(r.skuOrItemId))
    .map((r) => ({
      skuOrItemId: r.skuOrItemId,
      description: r.description,
      quantityOnHand: r.quantityOnHand,
      availableQoh: r.availableQoh,
      quantityBasisUsed: r.quantityBasisUsed,
      unitCost: r.cost,
      openOrderQty: r.openOrderQty,
      sourceRowRef: r.sourceRowRef,
      entityEligibility: "rankable" as const,
      classification: r.classification,
      vendorName: r.vendorName,
      category: r.category,
      department: r.department,
      locationCode: r.locationCode,
      productGroup: r.productGroup,
      itemStatus: r.itemStatus,
      dataConfidence: r.classification ? "Medium Confidence" : "Medium Confidence",
    }));

  const demItems: EvidenceItemInput[] = [...demandBySku.values()].map((r) => ({
    skuOrItemId: r.skuOrItemId,
    description: r.description,
    periodCode: "W13",
    unitsSold: r.unitsSold,
    salesDollars: r.salesDollars,
    sourceRowRef: r.sourceRowRef,
    entityEligibility: "rankable" as const,
  }));

  const evidenceBatchIds: string[] = [];

  const invSubmit = await submitEvidenceThroughUnifiedIngestion({
    reviewCycleId: iamRunId,
    evidenceBatchKey: `keystroke:inventory:${iamRunId}`,
    sourceSystem: "Keystroke",
    sourceReportType: "inventory_position",
    sourceFileName: invFileNames,
    asOfTimestamp: importAt,
    contentIdentity: `inv:${inventoryBatches.map((b) => b.id).join(",")}:${invItems.length}`,
    items: invItems,
    performedBy: "keystroke-adapter",
  });
  evidenceBatchIds.push(invSubmit.evidenceBatchId);

  const demSubmit = await submitEvidenceThroughUnifiedIngestion({
    reviewCycleId: iamRunId,
    evidenceBatchKey: `keystroke:demand:${iamRunId}`,
    sourceSystem: "Keystroke",
    sourceReportType: "demand_replenishment",
    sourceFileName: demFileNames,
    asOfTimestamp: importAt,
    contentIdentity: `dem:${demandBatches.map((b) => b.id).join(",")}:${demItems.length}`,
    items: demItems,
    performedBy: "keystroke-adapter",
  });
  evidenceBatchIds.push(demSubmit.evidenceBatchId);

  if (classBySku.size > 0) {
    const classItems: EvidenceItemInput[] = [...classBySku.entries()].map(([sku, d]) => ({
      skuOrItemId: sku,
      classification: d.classification,
      vendorName: d.vendorName,
      category: d.category,
      department: d.department,
      locationCode: d.locationCode,
      productGroup: d.productGroup,
      itemStatus: d.itemStatus,
      dataConfidence: "Medium Confidence",
    }));
    const classSubmit = await submitEvidenceThroughUnifiedIngestion({
      reviewCycleId: iamRunId,
      evidenceBatchKey: `keystroke:classification:${iamRunId}`,
      sourceSystem: "Keystroke",
      sourceReportType: "inventory_classification",
      sourceFileName: classBatches.map((b) => b.originalFilename).join("|"),
      asOfTimestamp: importAt,
      contentIdentity: `class:${classBatches.map((b) => b.id).join(",")}:${classItems.length}`,
      items: classItems,
      performedBy: "keystroke-adapter",
    });
    evidenceBatchIds.push(classSubmit.evidenceBatchId);
  }

  const invResult = {
    inventoryRows: invSubmit.inventoryRows,
    demandRows: invSubmit.demandRows,
  };
  const demResult = {
    inventoryRows: demSubmit.inventoryRows,
    demandRows: demSubmit.demandRows,
  };

  if (excludedParents.size > 0) {
    await prisma.dataGap.create({
      data: {
        iamRunId,
        affectedArea: "Matrix Parents",
        gapDescription: `Excluded ${excludedParents.size} matrix parent/scheme SKU(s) from ranking (${sharedParents.size} shared on Matrix+Standard, ${inferredParents.size} inferred from parent.variant Stock # pattern). Same rule as RSE/RLC — parents are non-entities. Case-break multipliers remain RSE (SD-16).`,
        severity: "confidence limiter",
        blockingStatus: "partial",
        confidenceImpact: "Parent schemes ignored; variant/standard items retained",
        status: "open",
      },
    });
  }

  await prisma.uploadBatch.updateMany({
    where: { iamRunId, status: { in: ["staged", "merged"] } },
    data: { status: "merged" },
  });

  await prisma.changeLog.create({
    data: {
      iamRunId,
      entityType: "IamRun",
      entityId: iamRunId,
      action: "keystroke_merge_via_inbound_port",
      detail: `inventory=${invResult.inventoryRows} demand=${demResult.demandRows} excludedParents=${excludedParents.size} batches=${evidenceBatchIds.join(",")}`,
    },
  });

  const readiness = await assessRunReadiness(iamRunId);
  const supplySkus = invItems.filter((r) => (r.openOrderQty ?? 0) > 0).length;

  return {
    inventorySkus: invResult.inventoryRows,
    demandSkus: demResult.demandRows,
    supplySkus,
    excludedParentSkuCount: excludedParents.size,
    sharedParentSkuCount: sharedParents.size,
    evidenceBatchIds,
    quantityBasisSummary,
    warnings,
    readiness,
    evidenceApprovalStatus: "pending_approval",
    conflictCount: demSubmit.reconcile.conflictsRecorded,
  };
}
