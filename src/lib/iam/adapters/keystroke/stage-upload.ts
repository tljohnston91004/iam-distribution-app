import { createHash } from "crypto";
import { prisma } from "@/lib/db";
import {
  parseNumber,
  parseSpreadsheetBuffer,
  pickField,
  rowToRecord,
} from "@/lib/parsers/spreadsheet";
import {
  KS_AVAILABLE_QOH_ALIASES,
  KS_CATEGORY_ALIASES,
  KS_CLASSIFICATION_ALIASES,
  KS_COST_ALIASES,
  KS_DEPARTMENT_ALIASES,
  KS_DESC_ALIASES,
  KS_ITEM_STATUS_ALIASES,
  KS_LOCATION_ALIASES,
  KS_ON_HAND_ALIASES,
  KS_OPEN_ORDER_ALIASES,
  KS_PRODUCT_GROUP_ALIASES,
  KS_SALES_DOLLARS_ALIASES,
  KS_SKU_ALIASES,
  KS_UNITS_SOLD_ALIASES,
  KS_VALUE_ALIASES,
  KS_VENDOR_ALIASES,
  isExcludedSummarySku,
} from "./aliases";
import { buildChecklist, resolveKeystrokeFileType, type IamKeystrokeFileType } from "./file-types";

const BATCH_SIZE = 500;

export class KeystrokeAdapterError extends Error {
  constructor(
    message: string,
    public readonly code:
      | "UNSUPPORTED_TYPE"
      | "MISSING_FIELDS"
      | "MALFORMED"
      | "VALIDATION" = "VALIDATION"
  ) {
    super(message);
    this.name = "KeystrokeAdapterError";
  }
}

/**
 * Stage a Keystroke XLS into UploadBatch (adapter staging only).
 * Does not write IAM Core evidence tables — mergeViaInboundPort does that.
 */
export async function stageKeystrokeUpload(
  iamRunId: string,
  buffer: Buffer,
  filename: string,
  forcedType?: IamKeystrokeFileType
) {
  if (!filename?.trim()) {
    throw new KeystrokeAdapterError("Filename is required", "MISSING_FIELDS");
  }
  if (!buffer?.length) {
    throw new KeystrokeAdapterError("Empty or missing file buffer", "MALFORMED");
  }

  let parsed;
  try {
    parsed = parseSpreadsheetBuffer(buffer, filename);
  } catch (e) {
    throw new KeystrokeAdapterError(
      e instanceof Error ? e.message : "Failed to parse spreadsheet",
      "MALFORMED"
    );
  }

  if (!parsed.headers?.length) {
    throw new KeystrokeAdapterError("Spreadsheet has no header row", "MALFORMED");
  }

  const resolved = resolveKeystrokeFileType(filename, parsed.headers);
  const fileType = forcedType && forcedType !== "unknown" ? forcedType : resolved.fileType;
  const demandVariant =
    fileType === "demand_replenishment" || fileType === "demand_classification"
      ? resolved.variant ?? "unspecified"
      : null;

  if (fileType === "unknown") {
    throw new KeystrokeAdapterError(
      `Unsupported Keystroke/RSE report or file type: ${filename}. Use SCBSRSE3/INVENTORYPOSITION, TrueDemandReplenishment (Standard/Matrix), TrueDemandClassification (Standard/Matrix), or Inventory Classification.`,
      "UNSUPPORTED_TYPE"
    );
  }

  await prisma.uploadBatch.deleteMany({
    where: {
      iamRunId,
      fileType,
      ...(demandVariant ? { demandVariant } : { demandVariant: null }),
    },
  });

  const contentHash = createHash("sha256").update(buffer).digest("hex").slice(0, 16);

  const doc = await prisma.sourceDocument.create({
    data: {
      iamRunId,
      sourceSystemName: "Keystroke",
      sourceDocumentName: filename,
      sourceArea: `${fileType}${demandVariant ? `:${demandVariant}` : ""}`,
      freshnessStatus: "Current",
      confidenceLevel: "Medium Confidence",
      uploadedBy: "keystroke-adapter",
    },
  });

  const batch = await prisma.uploadBatch.create({
    data: {
      iamRunId,
      originalFilename: filename,
      fileType,
      demandVariant,
      status: "staged",
      rowCount: 0,
    },
  });

  const stagingRows: {
    batchId: string;
    skuOrItemId: string;
    description: string | null;
    quantityOnHand: number | null;
    availableQoh: number | null;
    cost: number | null;
    inventoryValue: number | null;
    unitsSold: number | null;
    salesDollars: number | null;
    openOrderQty: number | null;
    sourceRowRef: string | null;
    classification: string | null;
    vendorName: string | null;
    category: string | null;
    department: string | null;
    locationCode: string | null;
    productGroup: string | null;
    itemStatus: string | null;
  }[] = [];

  let rowIndex = 0;
  for (const row of parsed.rows) {
    rowIndex += 1;
    const rec = rowToRecord(parsed.headers, row);
    const sku = pickField(rec, KS_SKU_ALIASES);
    if (!sku) continue;
    if (isExcludedSummarySku(sku)) continue;

    const sourceRowRef = String(rowIndex);
    const dims = {
      classification: pickField(rec, KS_CLASSIFICATION_ALIASES) || null,
      vendorName: pickField(rec, KS_VENDOR_ALIASES) || null,
      category: pickField(rec, KS_CATEGORY_ALIASES) || null,
      department: pickField(rec, KS_DEPARTMENT_ALIASES) || null,
      locationCode: pickField(rec, KS_LOCATION_ALIASES) || null,
      productGroup: pickField(rec, KS_PRODUCT_GROUP_ALIASES) || null,
      itemStatus: pickField(rec, KS_ITEM_STATUS_ALIASES) || null,
    };

    if (fileType === "inventory_position") {
      const onHand = parseNumber(pickField(rec, KS_ON_HAND_ALIASES));
      const available = parseNumber(pickField(rec, KS_AVAILABLE_QOH_ALIASES));
      if (onHand == null && available == null) continue;
      const cost = parseNumber(pickField(rec, KS_COST_ALIASES));
      const qohBasis = onHand ?? available ?? 0;
      const value =
        parseNumber(pickField(rec, KS_VALUE_ALIASES)) ?? (cost != null ? qohBasis * cost : null);
      stagingRows.push({
        batchId: batch.id,
        skuOrItemId: sku,
        description: pickField(rec, KS_DESC_ALIASES) || null,
        quantityOnHand: onHand,
        availableQoh: available,
        cost,
        inventoryValue: value,
        unitsSold: null,
        salesDollars: null,
        openOrderQty: parseNumber(pickField(rec, KS_OPEN_ORDER_ALIASES)),
        sourceRowRef,
        ...dims,
      });
    } else if (fileType === "inventory_classification") {
      if (!dims.classification && !dims.vendorName && !dims.category) continue;
      stagingRows.push({
        batchId: batch.id,
        skuOrItemId: sku,
        description: pickField(rec, KS_DESC_ALIASES) || null,
        quantityOnHand: null,
        availableQoh: null,
        cost: null,
        inventoryValue: null,
        unitsSold: null,
        salesDollars: null,
        openOrderQty: null,
        sourceRowRef,
        ...dims,
      });
    } else if (fileType === "demand_classification") {
      // RSE True Demand Classification — consume class dimensions; optional units for lineage only.
      const units = parseNumber(pickField(rec, KS_UNITS_SOLD_ALIASES));
      const dollars = parseNumber(pickField(rec, KS_SALES_DOLLARS_ALIASES));
      if (!dims.classification && units == null && dollars == null) continue;
      stagingRows.push({
        batchId: batch.id,
        skuOrItemId: sku,
        description: pickField(rec, KS_DESC_ALIASES) || null,
        quantityOnHand: null,
        availableQoh: null,
        cost: null,
        inventoryValue: null,
        unitsSold: units,
        salesDollars: dollars,
        openOrderQty: null,
        sourceRowRef,
        ...dims,
      });
    } else {
      const units = parseNumber(pickField(rec, KS_UNITS_SOLD_ALIASES));
      if (units == null && fileType === "demand_replenishment") continue;
      const dollars = parseNumber(pickField(rec, KS_SALES_DOLLARS_ALIASES));
      stagingRows.push({
        batchId: batch.id,
        skuOrItemId: sku,
        description: pickField(rec, KS_DESC_ALIASES) || null,
        quantityOnHand: null,
        availableQoh: null,
        cost: null,
        inventoryValue: null,
        unitsSold: units,
        salesDollars: dollars ?? 0,
        openOrderQty: null,
        sourceRowRef,
        ...dims,
      });
    }
  }

  if (fileType === "inventory_position" && stagingRows.length === 0) {
    throw new KeystrokeAdapterError(
      "No inventory rows with On-Hand or Available QOH found",
      "MISSING_FIELDS"
    );
  }
  if (fileType === "demand_replenishment" && stagingRows.length === 0) {
    throw new KeystrokeAdapterError(
      "No demand rows with Units Sold/Shipped found",
      "MISSING_FIELDS"
    );
  }
  if (
    (fileType === "inventory_classification" || fileType === "demand_classification") &&
    stagingRows.length === 0
  ) {
    throw new KeystrokeAdapterError(
      "No classification rows with SKU and classification/vendor dimensions found",
      "MISSING_FIELDS"
    );
  }

  for (let i = 0; i < stagingRows.length; i += BATCH_SIZE) {
    await prisma.uploadStagingRow.createMany({ data: stagingRows.slice(i, i + BATCH_SIZE) });
  }

  await prisma.uploadBatch.update({
    where: { id: batch.id },
    data: { rowCount: stagingRows.length },
  });

  for (const h of parsed.headers.filter(Boolean)) {
    await prisma.fieldMapping.create({
      data: {
        sourceDocumentId: doc.id,
        sourceFieldName: h,
        iamDomain: fileType,
        iamTable: "upload_staging_rows",
        iamFieldName: h,
        mappingConfidence: "Medium Confidence",
        validationStatus: "auto",
      },
    });
  }

  return {
    batchId: batch.id,
    documentId: doc.id,
    fileType,
    demandVariant,
    rowCount: stagingRows.length,
    filename,
    contentHash,
  };
}

/**
 * Effective uploads for checklist/merge: prefer staged over merged for the same
 * fileType + demandVariant. Prevents merge lock when the user re-uploads only
 * some reports after a prior successful merge.
 */
export async function loadEffectiveUploadBatches(iamRunId: string) {
  const batches = await prisma.uploadBatch.findMany({
    where: { iamRunId, status: { in: ["staged", "merged"] } },
    include: { rows: true },
    orderBy: { createdAt: "asc" },
  });
  const byKey = new Map<string, (typeof batches)[number]>();
  // Merged first, then staged so staged wins for the same slot.
  for (const b of batches.filter((x) => x.status === "merged")) {
    byKey.set(`${b.fileType}::${b.demandVariant ?? ""}`, b);
  }
  for (const b of batches.filter((x) => x.status === "staged")) {
    byKey.set(`${b.fileType}::${b.demandVariant ?? ""}`, b);
  }
  return [...byKey.values()];
}

export async function getKeystrokeUploadStatus(iamRunId: string) {
  const batches = await loadEffectiveUploadBatches(iamRunId);
  const hasStaged = batches.some((b) => b.status === "staged");
  const alreadyMerged = batches.length > 0 && batches.every((b) => b.status === "merged");
  return {
    batches: batches.map(({ rows: _rows, ...b }) => b),
    alreadyMerged,
    hasStagedOverrides: hasStaged && batches.some((b) => b.status === "merged"),
    ...buildChecklist(batches),
  };
}
