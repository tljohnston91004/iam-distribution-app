/**
 * Phase 2 Architecture Closure tests.
 * Run: npx tsx scripts/run-phase2-architecture-closure-tests.ts
 */
import * as XLSX from "xlsx";
import { prisma, ensureDefaultCompany } from "../src/lib/db";
import { intakeSpreadsheet } from "../src/lib/iam/intake";
import { runIamCalculatePipeline } from "../src/lib/iam/engine/calculate-pipeline";
import { upsertEvidenceBatch, upsertRecommendations } from "../src/lib/iam/inbound";

type Result = { id: string; name: string; pass: boolean; detail: string };

function sheetBuffer(headers: string[], rows: (string | number)[][]): Buffer {
  const ws = XLSX.utils.aoa_to_sheet([headers, ...rows]);
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
      runName: "Phase2 Architecture Closure Test",
      reviewDate: new Date(),
      reviewWeekStart: new Date(),
      reviewWeekEnd: new Date(),
      runStatus: "Open",
      cycleStatus: "Open",
    },
  });

  try {
    const invBuf = sheetBuffer(
      ["SKU", "Description", "On-Hand Qty", "Cost", "Qty On Order"],
      [
        ["SKU-A", "Trapped", 240, 85, 0],
        ["SKU-B", "Stock risk", 12, 42, 0],
        ["SKU-C", "Moderate", 90, 25, 0],
      ]
    );
    const demBuf = sheetBuffer(
      ["SKU", "Description", "Units Sold", "Gross Sales"],
      [
        ["SKU-A", "Trapped", 8, 640],
        ["SKU-B", "Stock risk", 180, 7560],
        ["SKU-C", "Moderate", 20, 500],
      ]
    );

    const up1 = await intakeSpreadsheet(run.id, invBuf, "generic_inv.xlsx", "ManualSpreadsheet");
    const invRows = await prisma.inventorySnapshot.findMany({ where: { iamRunId: run.id } });
    const batches = await prisma.evidenceBatch.findMany({ where: { iamRunId: run.id } });

    results.push({
      id: "P2C-PORT-01",
      name: "Generic upload creates EvidenceBatch via Port",
      pass:
        Boolean(up1.evidenceBatchId) &&
        batches.length >= 1 &&
        batches.every((b) => b.sourceSystem === "ManualSpreadsheet") &&
        invRows.every((r) => r.evidenceBatchId != null),
      detail: `batch=${up1.evidenceBatchId} inv=${invRows.length}`,
    });

    results.push({
      id: "P2C-PORT-02",
      name: "Generic upload does not leave unlinked evidence (Port-only persistence)",
      pass: invRows.length > 0 && invRows.every((r) => r.evidenceBatchId === up1.evidenceBatchId),
      detail: invRows.map((r) => r.evidenceBatchId).join(","),
    });

    await intakeSpreadsheet(run.id, demBuf, "generic_dem.xlsx", "ManualSpreadsheet");

    const up2 = await intakeSpreadsheet(run.id, invBuf, "generic_inv.xlsx", "ManualSpreadsheet");
    const invAfter = await prisma.inventorySnapshot.findMany({ where: { iamRunId: run.id } });
    const invBatches = await prisma.evidenceBatch.findMany({
      where: { iamRunId: run.id, sourceReportType: "inventory_position" },
    });

    results.push({
      id: "P2C-IDEM",
      name: "Repeated generic upload remains idempotent",
      pass:
        up2.supersededPriorBatch === true &&
        invBatches.length === 1 &&
        invAfter.length === 3 &&
        up2.externalBatchKey === `generic:ManualSpreadsheet:inventory:${run.id}`,
      detail: JSON.stringify({
        superseded: up2.supersededPriorBatch,
        batches: invBatches.length,
        rows: invAfter.length,
      }),
    });

    results.push({
      id: "P2C-PROV",
      name: "Provenance complete on generic upload",
      pass:
        invBatches[0]?.sourceFileName === "generic_inv.xlsx" &&
        invBatches[0]?.sourceSystem === "ManualSpreadsheet" &&
        invAfter.every((r) => r.sourceRowRef != null && r.quantityBasisUsed === "on_hand"),
      detail: `${invBatches[0]?.sourceSystem}/${invBatches[0]?.sourceFileName}`,
    });

    // Supply/backorder for stock-risk scoring via Port (no direct evidence write)
    await upsertEvidenceBatch({
      reviewCycleId: run.id,
      evidenceBatchKey: `generic:ManualSpreadsheet:supply:${run.id}`,
      sourceSystem: "ManualSpreadsheet",
      sourceReportType: "incoming_supply",
      sourceFileName: "generic_supply.xlsx",
      items: [{ skuOrItemId: "SKU-B", backorderQuantity: 24, openOrderQty: 0 }],
      performedBy: "phase2-closure-test",
    });

    // Module Recommendation for same opportunity as calculate will generate for SKU-A trapped cash
    await upsertRecommendations({
      reviewCycleId: run.id,
      recommendations: [
        {
          sourceModule: "RSE",
          sourceRecommendationId: "RSE-TRAP-A",
          generationPath: "module",
          opportunityKey: "SKU-A|Trapped Cash Review",
          skuOrItemId: "SKU-A",
          recommendationType: "Trapped Cash Review",
          title: "Module authoritative trapped cash",
          estimatedCashImpact: 9999,
        },
      ],
    });

    const actionsBefore = await prisma.action.count({ where: { iamRunId: run.id } });
    const { reconcileEvidenceForRun, approveEvidenceForAnalysis } = await import(
      "../src/lib/iam/ingestion"
    );
    await reconcileEvidenceForRun(run.id);
    await approveEvidenceForAnalysis(run.id, "phase2-closure-test");
    const calc = await runIamCalculatePipeline(run.id);
    const actionsAfter = await prisma.action.count({ where: { iamRunId: run.id } });
    const candidates = await prisma.actionCandidate.count({ where: { iamRunId: run.id } });
    const interim = await prisma.recommendation.findMany({
      where: { iamRunId: run.id, generationPath: "interim_evidence" },
    });
    const moduleRecs = await prisma.recommendation.findMany({
      where: { iamRunId: run.id, generationPath: "module" },
    });
    const allRecs = await prisma.recommendation.findMany({ where: { iamRunId: run.id } });
    const oppKeys = allRecs.map((r) => r.opportunityKey);
    const dupOpp = oppKeys.filter((k, i) => oppKeys.indexOf(k) !== i);

    results.push({
      id: "P2C-INT-REC",
      name: "Evidence-generated calculation creates interim Recommendation",
      pass: interim.length > 0 && calc.interimRecommendationCount > 0,
      detail: `interim=${interim.length} calc=${JSON.stringify(calc)}`,
    });

    results.push({
      id: "P2C-NO-ACTION",
      name: "New calculation does not create a new legacy Action",
      pass: actionsAfter === actionsBefore && candidates === 0,
      detail: `actions before=${actionsBefore} after=${actionsAfter} candidates=${candidates}`,
    });

    const moduleA = moduleRecs.find((r) => r.opportunityKey === "SKU-A|Trapped Cash Review");
    const interimA = interim.find((r) => r.opportunityKey === "SKU-A|Trapped Cash Review");

    results.push({
      id: "P2C-SD17",
      name: "SD-17 consolidation prevents duplicate opportunities",
      pass: dupOpp.length === 0 && !interimA && Boolean(moduleA),
      detail: `dup=${dupOpp.join("|") || "none"} moduleA=${moduleA?.id} interimA=${interimA?.id ?? "none"} enriched=${calc.sd17EnrichedModuleCount}`,
    });

    results.push({
      id: "P2C-AUTH",
      name: "Module Recommendations remain authoritative",
      pass:
        moduleA?.title === "Module authoritative trapped cash" &&
        moduleA.estimatedCashImpact === 9999 &&
        (moduleA.evidenceRefsJson?.length ?? 0) > 0,
      detail: JSON.stringify({
        title: moduleA?.title,
        cash: moduleA?.estimatedCashImpact,
        refs: moduleA?.evidenceRefsJson,
      }),
    });

    const top2 = interim.filter(
      (r) => r.presentationCategory === "top_2" || r.presentationCategory === "active_priority"
    );
    results.push({
      id: "P2C-TOP2",
      name: "Interim Recommendations carry presentation (active_priority) after rank",
      pass: top2.length >= 1 && top2.every((r) => r.generationPath === "interim_evidence"),
      detail: `top2=${top2.length}`,
    });
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
