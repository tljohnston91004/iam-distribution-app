import { createHash } from "crypto";
import { prisma } from "@/lib/db";
import {
  type EvidenceItemInput,
} from "@/lib/iam/inbound";
import {
  BACKORDER_ALIASES,
  COST_ALIASES,
  DESC_ALIASES,
  LAST_PURCHASE_ALIASES,
  LAST_SOLD_ALIASES,
  OPEN_ORDER_ALIASES,
  PERIOD_ALIASES,
  QOH_ALIASES,
  SALES_DOLLARS_ALIASES,
  SKU_ALIASES,
  UNITS_SOLD_ALIASES,
  defaultDemandPeriodLabel,
  detectIntakeDomain,
} from "./mapping";
import {
  parseSpreadsheetBuffer,
  pickField,
  parseNumber,
  parseDate,
  rowToRecord,
} from "@/lib/parsers/spreadsheet";

/**
 * Generic spreadsheet intake → Canonical Evidence Package → Inbound Port only.
 * Does not write InventorySnapshot / DemandHistory / IncomingSupply directly.
 */
export async function intakeSpreadsheet(
  iamRunId: string,
  buffer: Buffer,
  filename: string,
  sourceSystemName: string
) {
  // Keystroke must use the Keystroke adapter (not generic upload).
  if (/keystroke/i.test(sourceSystemName) || /scbsrse3|inventoryposition|truedemand/i.test(filename)) {
    throw new Error(
      "Keystroke files must use the Keystroke adapter (/api/runs/:id/keystroke) and merge via the Canonical Inbound Port. Generic spreadsheet intake is disabled for Keystroke."
    );
  }

  if (!buffer?.length) {
    throw new Error("Empty or missing file buffer");
  }

  const parsed = parseSpreadsheetBuffer(buffer, filename);
  if (!parsed.headers?.length) {
    throw new Error("Spreadsheet has no header row");
  }

  const domain = detectIntakeDomain(parsed.headers);
  const sourceSystem = (sourceSystemName || "spreadsheet").trim() || "spreadsheet";
  const contentIdentity = createHash("sha256").update(buffer).digest("hex").slice(0, 24);
  const importAt = new Date().toISOString();

  const doc = await prisma.sourceDocument.create({
    data: {
      iamRunId,
      sourceSystemName: sourceSystem,
      sourceDocumentName: filename,
      sourceArea: domain,
      freshnessStatus: "Current",
      confidenceLevel: "Medium Confidence",
      uploadedBy: "generic-upload",
    },
  });

  const items: EvidenceItemInput[] = [];
  let rowIndex = 0;

  if (domain === "inventory") {
    for (const row of parsed.rows) {
      rowIndex += 1;
      const rec = rowToRecord(parsed.headers, row);
      const sku = pickField(rec, SKU_ALIASES);
      if (!sku) continue;
      const qoh = parseNumber(pickField(rec, QOH_ALIASES));
      if (qoh == null) continue;
      const cost = parseNumber(pickField(rec, COST_ALIASES));
      const openOrder = parseNumber(pickField(rec, OPEN_ORDER_ALIASES));
      const lastSold = parseDate(pickField(rec, LAST_SOLD_ALIASES));
      const lastPurchase = parseDate(pickField(rec, LAST_PURCHASE_ALIASES));

      items.push({
        skuOrItemId: sku,
        description: pickField(rec, DESC_ALIASES) || null,
        quantityOnHand: qoh,
        availableQoh: null,
        quantityBasisUsed: "on_hand",
        unitCost: cost,
        openOrderQty: openOrder,
        lastSoldDate: lastSold ? lastSold.toISOString() : null,
        lastReceivedDate: lastPurchase ? lastPurchase.toISOString() : null,
        sourceRowRef: String(rowIndex),
        entityEligibility: "rankable",
      });
    }
  } else if (domain === "demand") {
    const periodFallback = defaultDemandPeriodLabel(filename);
    const periodCode =
      periodFallback === "13_weeks" ? "W13" : periodFallback === "52_weeks" ? "W52" : null;
    for (const row of parsed.rows) {
      rowIndex += 1;
      const rec = rowToRecord(parsed.headers, row);
      const sku = pickField(rec, SKU_ALIASES);
      if (!sku) continue;
      const units = parseNumber(pickField(rec, UNITS_SOLD_ALIASES));
      const dollars = parseNumber(pickField(rec, SALES_DOLLARS_ALIASES));
      if (units == null) continue;

      items.push({
        skuOrItemId: sku,
        description: pickField(rec, DESC_ALIASES) || null,
        periodCode,
        unitsSold: units,
        salesDollars: dollars ?? 0,
        sourceRowRef: String(rowIndex),
        entityEligibility: "rankable",
      });
    }
  } else {
    for (const row of parsed.rows) {
      rowIndex += 1;
      const rec = rowToRecord(parsed.headers, row);
      const sku = pickField(rec, SKU_ALIASES);
      if (!sku) continue;
      const openOrder = parseNumber(pickField(rec, OPEN_ORDER_ALIASES));
      const backorder = parseNumber(pickField(rec, BACKORDER_ALIASES));
      // Canonical package carries open-order qty; backorder retained in description when present.
      if (openOrder == null && backorder == null) continue;
      items.push({
        skuOrItemId: sku,
        description: pickField(rec, DESC_ALIASES) || null,
        openOrderQty: openOrder,
        backorderQuantity: backorder,
        sourceRowRef: String(rowIndex),
        entityEligibility: "rankable",
      });
    }
  }

  if (items.length === 0) {
    throw new Error(`No usable ${domain} rows found in ${filename}`);
  }

  for (const h of parsed.headers.filter(Boolean)) {
    await prisma.fieldMapping.create({
      data: {
        sourceDocumentId: doc.id,
        sourceFieldName: h,
        iamDomain: domain,
        iamTable: "evidence_batches",
        iamFieldName: h,
        mappingConfidence: "Medium Confidence",
        validationStatus: "needs review",
      },
    });
  }

  const sourceReportType =
    domain === "inventory"
      ? "inventory_position"
      : domain === "demand"
        ? "demand_history"
        : "incoming_supply";

  // Stable idempotency key per run + domain + source system (repeat upload supersedes).
  const evidenceBatchKey = `generic:${sourceSystem}:${domain}:${iamRunId}`;

  const { submitEvidenceThroughUnifiedIngestion } = await import("@/lib/iam/ingestion");
  const portResult = await submitEvidenceThroughUnifiedIngestion({
    reviewCycleId: iamRunId,
    evidenceBatchKey,
    sourceSystem,
    sourceReportType,
    sourceFileName: filename,
    asOfTimestamp: importAt,
    contentIdentity,
    items,
    performedBy: "generic-upload",
  });

  return {
    domain,
    rowCount: items.length,
    documentId: doc.id,
    evidenceBatchId: portResult.evidenceBatchId,
    externalBatchKey: evidenceBatchKey,
    supersededPriorBatch: portResult.supersededPriorBatch,
    inventoryRows: portResult.inventoryRows,
    demandRows: portResult.demandRows,
    supplyRows: portResult.supplyRows,
    evidenceApprovalStatus: "pending_approval",
    conflictCount: portResult.reconcile.conflictsRecorded,
  };
}

export async function importModuleSignals(
  iamRunId: string,
  signals: {
    sourceModule: string;
    signalType: string;
    signalCategory?: string;
    skuOrItemId?: string;
    summary?: string;
    payload?: Record<string, unknown>;
  }[]
) {
  const created = [];
  for (const s of signals) {
    const rec = await prisma.moduleSignal.create({
      data: {
        iamRunId,
        sourceModule: s.sourceModule,
        signalType: s.signalType,
        signalCategory: s.signalCategory ?? "Advisory",
        integrationStatus: "Received",
        skuOrItemId: s.skuOrItemId,
        summary: s.summary,
        payloadJson: s.payload ? JSON.stringify(s.payload) : null,
      },
    });
    created.push(rec.id);
  }
  return created;
}

export async function assessRunReadiness(iamRunId: string) {
  const [inv, demand, gaps] = await Promise.all([
    prisma.inventorySnapshot.count({ where: { iamRunId } }),
    prisma.demandHistory.count({ where: { iamRunId } }),
    prisma.dataGap.count({ where: { iamRunId, status: "open" } }),
  ]);

  const gapsToCreate: { affectedArea: string; gapDescription: string; confidenceImpact: string }[] = [];
  if (inv === 0) {
    gapsToCreate.push({
      affectedArea: "Inventory Position",
      gapDescription: "No inventory snapshot rows uploaded",
      confidenceImpact: "Blocks normal confident surfacing",
    });
  }
  if (demand === 0) {
    gapsToCreate.push({
      affectedArea: "Sales / Demand Evidence",
      gapDescription: "No demand history rows uploaded",
      confidenceImpact: "Reduces confidence and ranking quality",
    });
  }

  if (gapsToCreate.length && gaps === 0) {
    await prisma.dataGap.createMany({
      data: gapsToCreate.map((g) => ({
        iamRunId,
        ...g,
        severity: inv === 0 || demand === 0 ? "decision limiter" : "confidence limiter",
        blockingStatus: inv === 0 ? "blocking" : "partial",
      })),
    });
  }

  const label =
    inv > 0 && demand > 0 ? "Ready with Limitations" : inv > 0 || demand > 0 ? "Partial" : "Not Ready";

  await prisma.iamRun.update({
    where: { id: iamRunId },
    data: { readinessStatus: label },
  });

  return { inv, demand, readinessStatus: label };
}
