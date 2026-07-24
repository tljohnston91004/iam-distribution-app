/**
 * Phase 2 Keystroke adapter tests — ADR-IAM-001, SD-15/16/17, R-P2-01 cutover.
 * Run: npx tsx scripts/run-phase2-keystroke-adapter-tests.ts
 */
import * as XLSX from "xlsx";
import { prisma, ensureDefaultCompany } from "../src/lib/db";
import {
  stageKeystrokeUpload,
  mergeKeystrokeViaInboundPort,
  KeystrokeAdapterError,
  isExcludedSummarySku,
  resolveKeystrokeFileType,
} from "../src/lib/iam/adapters/keystroke";
import { upsertEvidenceBatch } from "../src/lib/iam/inbound";

type Result = { id: string; name: string; pass: boolean; detail: string };

function sheetBuffer(filename: string, headers: string[], rows: (string | number)[][]): Buffer {
  const aoa = [headers, ...rows];
  const ws = XLSX.utils.aoa_to_sheet(aoa);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Sheet1");
  return Buffer.from(XLSX.write(wb, { type: "buffer", bookType: "xlsx" }));
}

async function main() {
  const results: Result[] = [];
  const company = await ensureDefaultCompany();
  const run = await prisma.iamRun.create({
    data: {
      companyId: company.id,
      runName: "Phase2 Keystroke Adapter Test Run",
      reviewDate: new Date(),
      reviewWeekStart: new Date(),
      reviewWeekEnd: new Date(),
      runStatus: "Open",
      cycleStatus: "Open",
    },
  });

  try {
    results.push({
      id: "P2-STK0",
      name: "STK#0 exclusion helper",
      pass: isExcludedSummarySku("0") && isExcludedSummarySku(" 0 ") && !isExcludedSummarySku("100"),
      detail: "isExcludedSummarySku",
    });

    const invHeaders = ["STOCK #", "Description", "On-Hand Qty", "Available QOH", "Last Cost", "Qty Ordered"];
    const invBuf = sheetBuffer("SCBSRSE3_test.xlsx", invHeaders, [
      ["0", "SUMMARY", 999, 999, 1, 0],
      ["SKU-A", "Item A", 12, 10, 5, 2],
      ["SKU-B", "Item B", 7, "", 3, 0], // On-Hand only → fallback
      ["SKU-C", "Item C", "", 4, 2, 0], // Available only
    ]);

    const demHeaders = ["STOCK #", "Description", "Units Sold/Shipped", "Total Sale"];
    const demBuf = sheetBuffer("TrueDemandReplenishment_Standard.xlsx", demHeaders, [
      ["0", "SUMMARY", 100, 1000],
      ["SKU-A", "Item A", 20, 200],
      ["SKU-B", "Item B", 5, 50],
      ["SKU-C", "Item C", 8, 80],
    ]);

    // Unsupported type
    try {
      await stageKeystrokeUpload(
        run.id,
        sheetBuffer("random_report.xlsx", ["Col1"], [["x"]]),
        "random_report.xlsx"
      );
      results.push({
        id: "P2-UNSUP",
        name: "Unsupported report type rejected",
        pass: false,
        detail: "expected throw",
      });
    } catch (e) {
      results.push({
        id: "P2-UNSUP",
        name: "Unsupported report type rejected",
        pass: e instanceof KeystrokeAdapterError && e.code === "UNSUPPORTED_TYPE",
        detail: e instanceof Error ? e.message : String(e),
      });
    }

    // Malformed / empty
    try {
      await stageKeystrokeUpload(run.id, Buffer.alloc(0), "SCBSRSE3_empty.xlsx");
      results.push({ id: "P2-MAL", name: "Malformed empty buffer rejected", pass: false, detail: "expected throw" });
    } catch (e) {
      results.push({
        id: "P2-MAL",
        name: "Malformed empty buffer rejected",
        pass: e instanceof KeystrokeAdapterError && e.code === "MALFORMED",
        detail: e instanceof Error ? e.message : String(e),
      });
    }

    // Missing filename
    try {
      await stageKeystrokeUpload(run.id, invBuf, "   ");
      results.push({ id: "P2-MISS", name: "Missing filename rejected", pass: false, detail: "expected throw" });
    } catch (e) {
      results.push({
        id: "P2-MISS",
        name: "Missing filename rejected",
        pass: e instanceof KeystrokeAdapterError && e.code === "MISSING_FIELDS",
        detail: e instanceof Error ? e.message : String(e),
      });
    }

    // Header aliases + stage inventory
    const stagedInv = await stageKeystrokeUpload(run.id, invBuf, "SCBSRSE3_test.xlsx");
    const stagedRows = await prisma.uploadStagingRow.findMany({
      where: { batchId: stagedInv.batchId },
    });
    const hasSummary = stagedRows.some((r) => r.skuOrItemId === "0");
    const skuA = stagedRows.find((r) => r.skuOrItemId === "SKU-A");
    results.push({
      id: "P2-ALIAS",
      name: "Header aliases + STK#0 excluded from staging",
      pass:
        stagedInv.rowCount === 3 &&
        !hasSummary &&
        skuA?.availableQoh === 10 &&
        skuA?.quantityOnHand === 12 &&
        skuA?.sourceRowRef != null,
      detail: `rows=${stagedInv.rowCount} skuA=${JSON.stringify(skuA)}`,
    });

    await stageKeystrokeUpload(run.id, demBuf, "TrueDemandReplenishment_Standard.xlsx");

    const merge1 = await mergeKeystrokeViaInboundPort(run.id);
    const invAfter = await prisma.inventorySnapshot.findMany({ where: { iamRunId: run.id } });
    const demAfter = await prisma.demandHistory.findMany({ where: { iamRunId: run.id } });
    const batchA = invAfter.find((i) => i.skuOrItemId === "SKU-A");
    const batchB = invAfter.find((i) => i.skuOrItemId === "SKU-B");
    const batchC = invAfter.find((i) => i.skuOrItemId === "SKU-C");
    const noZero = !invAfter.some((i) => i.skuOrItemId === "0") && !demAfter.some((d) => d.skuOrItemId === "0");

    results.push({
      id: "P2-QOH-AVAIL",
      name: "Available QOH preferred (SKU-A)",
      pass: batchA?.quantityBasisUsed === "available_qoh" && batchA.availableQoh === 10,
      detail: JSON.stringify(batchA),
    });
    results.push({
      id: "P2-QOH-FALL",
      name: "On-Hand fallback (SKU-B)",
      pass: batchB?.quantityBasisUsed === "on_hand" && batchB.quantityOnHand === 7,
      detail: JSON.stringify(batchB),
    });
    results.push({
      id: "P2-QOH-AVAIL-ONLY",
      name: "Available-only row accepted (SKU-C)",
      pass: batchC?.quantityBasisUsed === "available_qoh" && batchC.availableQoh === 4,
      detail: JSON.stringify(batchC),
    });
    results.push({
      id: "P2-STK0-MERGE",
      name: "STK#0 excluded from evidence",
      pass: noZero && merge1.inventorySkus === 3 && merge1.demandSkus === 3,
      detail: `inv=${merge1.inventorySkus} dem=${merge1.demandSkus}`,
    });

    // Provenance
    const evBatches = await prisma.evidenceBatch.findMany({ where: { iamRunId: run.id } });
    results.push({
      id: "P2-PROV",
      name: "Provenance preserved (source system/file/batch/row)",
      pass:
        evBatches.length >= 2 &&
        evBatches.every((b) => b.sourceSystem === "Keystroke" && b.sourceFileName) &&
        batchA?.evidenceBatchId != null &&
        batchA.sourceRowRef != null &&
        demAfter[0]?.sourceRowRef != null,
      detail: evBatches.map((b) => `${b.sourceReportType}:${b.sourceFileName}`).join("; "),
    });

    // Exclusive port path: all snapshots linked to EvidenceBatch
    results.push({
      id: "P2-PORT",
      name: "Keystroke evidence enters exclusively via Inbound Port",
      pass: invAfter.every((i) => i.evidenceBatchId != null) && demAfter.every((d) => d.evidenceBatchId != null),
      detail: `inv linked=${invAfter.filter((i) => i.evidenceBatchId).length}`,
    });

    // Duplicate / repeat import idempotency
    const merge2 = await mergeKeystrokeViaInboundPort(run.id);
    const invAfter2 = await prisma.inventorySnapshot.findMany({ where: { iamRunId: run.id } });
    const batchesAfter2 = await prisma.evidenceBatch.findMany({ where: { iamRunId: run.id } });
    results.push({
      id: "P2-IDEM",
      name: "Repeat merge idempotency (stable evidence keys)",
      pass:
        merge2.inventorySkus === merge1.inventorySkus &&
        invAfter2.length === invAfter.length &&
        batchesAfter2.length === evBatches.length &&
        batchesAfter2.every((b) =>
          ["keystroke:inventory:" + run.id, "keystroke:demand:" + run.id].includes(b.externalBatchKey)
        ),
      detail: `batches=${batchesAfter2.length} keys=${batchesAfter2.map((b) => b.externalBatchKey).join(",")}`,
    });

    // Duplicate batch submission via port directly
    const dup = await upsertEvidenceBatch({
      reviewCycleId: run.id,
      evidenceBatchKey: `keystroke:inventory:${run.id}`,
      sourceSystem: "Keystroke",
      sourceReportType: "inventory_position",
      sourceFileName: "SCBSRSE3_test.xlsx",
      items: [
        {
          skuOrItemId: "SKU-A",
          quantityOnHand: 12,
          availableQoh: 10,
          quantityBasisUsed: "available_qoh",
        },
      ],
    });
    results.push({
      id: "P2-DUP",
      name: "Duplicate batch submission supersedes (idempotent key)",
      pass: dup.supersededPriorBatch === true && dup.inventoryRows === 1,
      detail: JSON.stringify(dup),
    });

    // File type resolution aliases
    const ft = resolveKeystrokeFileType("INVENTORYPOSITION_export.xlsx", [
      "STOCK #",
      "On-Hand Qty",
      "Last Cost",
    ]);
    results.push({
      id: "P2-FTYPE",
      name: "Filename/report identification",
      pass: ft.fileType === "inventory_position",
      detail: JSON.stringify(ft),
    });

    // Hub replaceability smoke: second adapter uses same port contract without Keystroke imports
    const hubRun = await prisma.iamRun.create({
      data: {
        companyId: company.id,
        runName: "Phase2 Hub Replaceability Smoke",
        reviewDate: new Date(),
        reviewWeekStart: new Date(),
        reviewWeekEnd: new Date(),
        runStatus: "Open",
        cycleStatus: "Open",
      },
    });
    const hub = await upsertEvidenceBatch({
      reviewCycleId: hubRun.id,
      evidenceBatchKey: "hub:inventory:smoke",
      sourceSystem: "DataHub",
      sourceReportType: "inventory_position",
      sourceFileName: "hub-feed.json",
      items: [{ skuOrItemId: "HUB-1", availableQoh: 3, quantityOnHand: 5 }],
    });
    const hubInv = await prisma.inventorySnapshot.findFirst({
      where: { iamRunId: hubRun.id, skuOrItemId: "HUB-1" },
    });
    results.push({
      id: "P2-HUB",
      name: "Future Hub adapter can use same Inbound Port (no Core change)",
      pass:
        hub.status === "accepted" &&
        hubInv?.quantityBasisUsed === "available_qoh" &&
        hubInv.evidenceBatchId === hub.evidenceBatchId,
      detail: JSON.stringify({ hub, basis: hubInv?.quantityBasisUsed }),
    });
    await prisma.iamRun.delete({ where: { id: hubRun.id } });

    // Missing required inventory fields → empty after STK0 only
    try {
      await stageKeystrokeUpload(
        run.id,
        sheetBuffer("SCBSRSE3_nofields.xlsx", ["STOCK #", "Description"], [["SKU-Z", "No qty"]]),
        "SCBSRSE3_nofields.xlsx"
      );
      results.push({
        id: "P2-REQ",
        name: "Missing required QOH fields rejected",
        pass: false,
        detail: "expected throw",
      });
    } catch (e) {
      results.push({
        id: "P2-REQ",
        name: "Missing required QOH fields rejected",
        pass: e instanceof KeystrokeAdapterError && e.code === "MISSING_FIELDS",
        detail: e instanceof Error ? e.message : String(e),
      });
    }
  } finally {
    await prisma.iamRun.delete({ where: { id: run.id } }).catch(() => undefined);
  }

  const failed = results.filter((r) => !r.pass);
  for (const r of results) {
    console.log(`${r.pass ? "PASS" : "FAIL"} ${r.id} — ${r.name} :: ${r.detail}`);
  }
  console.log(`\n${results.length - failed.length}/${results.length} passed`);
  if (failed.length) process.exit(1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
