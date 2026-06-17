import { prisma } from "@/lib/db";
import {
  BACKORDER_ALIASES,
  COST_ALIASES,
  DESC_ALIASES,
  OPEN_ORDER_ALIASES,
  PERIOD_ALIASES,
  QOH_ALIASES,
  SALES_DOLLARS_ALIASES,
  SKU_ALIASES,
  UNITS_SOLD_ALIASES,
  VALUE_ALIASES,
  VENDOR_ALIASES,
  detectIntakeDomain,
} from "./mapping";
import {
  parseSpreadsheetBuffer,
  pickField,
  parseNumber,
  rowToRecord,
} from "@/lib/parsers/spreadsheet";

export async function intakeSpreadsheet(
  iamRunId: string,
  buffer: Buffer,
  filename: string,
  sourceSystemName: string
) {
  const parsed = parseSpreadsheetBuffer(buffer, filename);
  const domain = detectIntakeDomain(parsed.headers);
  const doc = await prisma.sourceDocument.create({
    data: {
      iamRunId,
      sourceSystemName,
      sourceDocumentName: filename,
      sourceArea: domain,
      freshnessStatus: "Current",
      confidenceLevel: "Medium Confidence",
      uploadedBy: "pilot-user",
    },
  });

  let rowCount = 0;

  if (domain === "inventory") {
    for (const row of parsed.rows) {
      const rec = rowToRecord(parsed.headers, row);
      const sku = pickField(rec, SKU_ALIASES);
      if (!sku) continue;
      const qoh = parseNumber(pickField(rec, QOH_ALIASES));
      if (qoh == null) continue;
      const cost = parseNumber(pickField(rec, COST_ALIASES));
      const value = parseNumber(pickField(rec, VALUE_ALIASES)) ?? (cost != null ? qoh * cost : null);

      await prisma.inventorySnapshot.create({
        data: {
          iamRunId,
          skuOrItemId: sku,
          description: pickField(rec, DESC_ALIASES) || null,
          quantityOnHand: qoh,
          cost,
          inventoryValue: value,
          vendorName: pickField(rec, VENDOR_ALIASES) || null,
          dataConfidence: "Medium Confidence",
        },
      });
      rowCount++;
    }
  } else if (domain === "demand") {
    for (const row of parsed.rows) {
      const rec = rowToRecord(parsed.headers, row);
      const sku = pickField(rec, SKU_ALIASES);
      if (!sku) continue;
      const units = parseNumber(pickField(rec, UNITS_SOLD_ALIASES));
      const dollars = parseNumber(pickField(rec, SALES_DOLLARS_ALIASES));
      if (units == null || dollars == null) continue;

      await prisma.demandHistory.create({
        data: {
          iamRunId,
          skuOrItemId: sku,
          periodLabel: pickField(rec, PERIOD_ALIASES) || "review_window",
          unitsSold: units,
          grossSalesDollars: dollars,
          dataConfidence: "Medium Confidence",
        },
      });
      rowCount++;
    }
  } else {
    for (const row of parsed.rows) {
      const rec = rowToRecord(parsed.headers, row);
      const sku = pickField(rec, SKU_ALIASES);
      if (!sku) continue;
      await prisma.incomingSupply.create({
        data: {
          iamRunId,
          skuOrItemId: sku,
          openOrderQuantity: parseNumber(pickField(rec, OPEN_ORDER_ALIASES)),
          backorderQuantity: parseNumber(pickField(rec, BACKORDER_ALIASES)),
          dataConfidence: "Medium Confidence",
        },
      });
      rowCount++;
    }
  }

  for (const h of parsed.headers.filter(Boolean)) {
    await prisma.fieldMapping.create({
      data: {
        sourceDocumentId: doc.id,
        sourceFieldName: h,
        iamDomain: domain,
        iamTable: domain === "inventory" ? "inventory_snapshots" : domain === "demand" ? "demand_history" : "incoming_supply",
        iamFieldName: h,
        mappingConfidence: "Medium Confidence",
        validationStatus: "needs review",
      },
    });
  }

  return { domain, rowCount, documentId: doc.id };
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
