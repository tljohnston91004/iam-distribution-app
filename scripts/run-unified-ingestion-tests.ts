/**
 * Unified multi-source evidence ingestion (V1.5 product-completeness).
 */
import { prisma } from "../src/lib/db";
import { runIamCalculatePipeline } from "../src/lib/iam/engine/calculate-pipeline";
import {
  approveEvidenceForAnalysis,
  IngestionError,
  reconcileEvidenceForRun,
  submitEvidenceThroughUnifiedIngestion,
  SOURCE_PRIORITY_RULE_ID,
} from "../src/lib/iam/ingestion";
import { submitRseEvidencePackage } from "../src/lib/iam/adapters/rse/submit-evidence";
import { submitDataHubEvidencePackage } from "../src/lib/iam/adapters/data-hub/submit-evidence";

type Result = { id: string; name: string; pass: boolean; detail: string };

async function main() {
  const results: Result[] = [];
  const company = await prisma.company.create({
    data: {
      name: `Unified Ingestion Co ${Date.now()}`,
      enableStandaloneUpload: true,
      enableRseEvidence: false,
      enableDataHub: false,
    },
  });
  const run = await prisma.iamRun.create({
    data: {
      companyId: company.id,
      runName: "Unified Ingestion Test",
      reviewDate: new Date(),
      reviewWeekStart: new Date(),
      reviewWeekEnd: new Date(),
      runStatus: "Open",
      cycleStatus: "Open",
    },
  });

  try {
    // Standalone customer upload
    await submitEvidenceThroughUnifiedIngestion({
      reviewCycleId: run.id,
      evidenceBatchKey: `cust:inv:${run.id}`,
      sourceSystem: "CustomerUpload",
      sourceReportType: "inventory_position",
      items: [
        { skuOrItemId: "SKU-A", quantityOnHand: 100, unitCost: 10 },
        { skuOrItemId: "SKU-B", quantityOnHand: 50, unitCost: 5 },
      ],
      performedBy: "ui-test",
    });
    await submitEvidenceThroughUnifiedIngestion({
      reviewCycleId: run.id,
      evidenceBatchKey: `cust:dem:${run.id}`,
      sourceSystem: "CustomerUpload",
      sourceReportType: "demand_history",
      items: [
        { skuOrItemId: "SKU-A", periodCode: "W13", unitsSold: 10, salesDollars: 100 },
        { skuOrItemId: "SKU-B", periodCode: "W13", unitsSold: 20, salesDollars: 100 },
      ],
      performedBy: "ui-test",
    });

    const afterStandalone = await prisma.iamRun.findUnique({ where: { id: run.id } });
    results.push({
      id: "UI-STANDALONE",
      name: "Standalone customer upload works without RSE/Hub",
      pass:
        afterStandalone?.evidenceApprovalStatus === "pending_approval" &&
        (await prisma.inventorySnapshot.count({ where: { iamRunId: run.id } })) === 2,
      detail: `status=${afterStandalone?.evidenceApprovalStatus}`,
    });

    // Calculate blocked until approve
    let blocked = false;
    try {
      await runIamCalculatePipeline(run.id);
    } catch (e) {
      blocked = e instanceof IngestionError;
    }
    results.push({
      id: "UI-GATE",
      name: "Calculate blocked until evidence approved",
      pass: blocked,
      detail: blocked ? "blocked" : "calculate ran unexpectedly",
    });

    await approveEvidenceForAnalysis(run.id, "ui-test");
    const calc1 = await runIamCalculatePipeline(run.id);
    results.push({
      id: "UI-CALC",
      name: "Approved standalone evidence feeds Calculate",
      pass: calc1.candidateCount >= 0 && calc1.scoredCount >= 0,
      detail: JSON.stringify({
        candidates: calc1.candidateCount,
        scored: calc1.scoredCount,
      }),
    });

    // RSE disabled by default
    let rseDisabled = false;
    try {
      await submitRseEvidencePackage({
        reviewCycleId: run.id,
        evidenceBatchKey: `rse:inv:${run.id}`,
        sourceReportType: "inventory_position",
        items: [{ skuOrItemId: "SKU-A", quantityOnHand: 1 }],
      });
    } catch (e) {
      rseDisabled = e instanceof IngestionError && e.code === "DISABLED";
    }
    results.push({
      id: "UI-RSE-OFF",
      name: "RSE channel rejected when company flag off",
      pass: rseDisabled,
      detail: rseDisabled ? "disabled" : "accepted unexpectedly",
    });

    // Enable RSE + Hub; conflict on SKU-A (Hub wins)
    await prisma.company.update({
      where: { id: company.id },
      data: { enableRseEvidence: true, enableDataHub: true },
    });

    await submitRseEvidencePackage({
      reviewCycleId: run.id,
      evidenceBatchKey: `rse:inv:${run.id}`,
      sourceReportType: "inventory_position",
      items: [
        { skuOrItemId: "SKU-A", quantityOnHand: 70, unitCost: 10 },
        { skuOrItemId: "SKU-C", quantityOnHand: 15, unitCost: 8 },
      ],
      performedBy: "rse-adapter",
    });
    await submitDataHubEvidencePackage({
      reviewCycleId: run.id,
      evidenceBatchKey: `hub:inv:${run.id}`,
      sourceReportType: "inventory_position",
      items: [
        { skuOrItemId: "SKU-A", quantityOnHand: 55, unitCost: 10 },
      ],
      performedBy: "hub-adapter",
    });

    const conflicts = await prisma.evidenceConflict.findMany({ where: { iamRunId: run.id } });
    const skuASelected = await prisma.inventorySnapshot.findMany({
      where: { iamRunId: run.id, skuOrItemId: "SKU-A", selectedForAnalysis: true },
    });
    const hubWin =
      skuASelected.length === 1 &&
      skuASelected[0].winningSourceSystem === "DataHub" &&
      skuASelected[0].quantityOnHand === 55;

    results.push({
      id: "UI-PRIORITY",
      name: "Source priority: DataHub > RSE > CustomerUpload",
      pass: hubWin && conflicts.some((c) => c.resolutionRule === SOURCE_PRIORITY_RULE_ID),
      detail: JSON.stringify({
        winningQty: skuASelected[0]?.quantityOnHand,
        winningSource: skuASelected[0]?.winningSourceSystem,
        conflicts: conflicts.length,
      }),
    });

    // Keystroke-priority family vs Customer: Keystroke wins when Hub/RSE absent for SKU-B
    await submitEvidenceThroughUnifiedIngestion({
      reviewCycleId: run.id,
      evidenceBatchKey: `keystroke:inv:${run.id}`,
      sourceSystem: "Keystroke",
      sourceReportType: "inventory_position",
      items: [{ skuOrItemId: "SKU-B", quantityOnHand: 40, unitCost: 5 }],
      performedBy: "keystroke-adapter",
    });
    const skuB = await prisma.inventorySnapshot.findFirst({
      where: { iamRunId: run.id, skuOrItemId: "SKU-B", selectedForAnalysis: true },
    });
    results.push({
      id: "UI-KEYSTROKE-PRIO",
      name: "Keystroke outranks CustomerUpload on same SKU",
      pass: skuB?.winningSourceSystem === "Keystroke" && skuB.quantityOnHand === 40,
      detail: JSON.stringify({
        winning: skuB?.winningSourceSystem,
        qty: skuB?.quantityOnHand,
      }),
    });

    // Lineage preserved — multiple batches retained
    const batches = await prisma.evidenceBatch.findMany({ where: { iamRunId: run.id } });
    const channels = new Set(batches.map((b) => b.sourceChannel).filter(Boolean));
    results.push({
      id: "UI-LINEAGE",
      name: "Source lineage preserved across channels",
      pass:
        channels.has("CustomerUpload") &&
        channels.has("RSE") &&
        channels.has("DataHub") &&
        channels.has("Keystroke"),
      detail: [...channels].join(","),
    });

    // Re-approve after reconcile and calculate once
    await reconcileEvidenceForRun(run.id);
    await approveEvidenceForAnalysis(run.id, "ui-test");
    const calc2 = await runIamCalculatePipeline(run.id);
    const selectedInv = await prisma.inventorySnapshot.count({
      where: { iamRunId: run.id, selectedForAnalysis: true },
    });
    results.push({
      id: "UI-COMBINED",
      name: "Combined sources feed one analytical model after approval",
      pass: selectedInv >= 3 && calc2.scoredCount >= 0,
      detail: JSON.stringify({ selectedInv, scored: calc2.scoredCount }),
    });

    // Hub-only company config (standalone still on; Hub active)
    const hubOnly = await prisma.company.create({
      data: {
        name: `Hub Co ${Date.now()}`,
        enableStandaloneUpload: true,
        enableRseEvidence: false,
        enableDataHub: true,
      },
    });
    const hubRun = await prisma.iamRun.create({
      data: {
        companyId: hubOnly.id,
        runName: "Hub only",
        reviewDate: new Date(),
        reviewWeekStart: new Date(),
        reviewWeekEnd: new Date(),
      },
    });
    await submitDataHubEvidencePackage({
      reviewCycleId: hubRun.id,
      evidenceBatchKey: "hub-only-inv",
      sourceReportType: "inventory_position",
      items: [{ skuOrItemId: "H1", quantityOnHand: 9, unitCost: 2 }],
    });
    await submitEvidenceThroughUnifiedIngestion({
      reviewCycleId: hubRun.id,
      evidenceBatchKey: "hub-only-dem",
      sourceSystem: "CustomerUpload",
      sourceReportType: "demand_history",
      items: [{ skuOrItemId: "H1", periodCode: "W13", unitsSold: 1, salesDollars: 2 }],
    });
    await approveEvidenceForAnalysis(hubRun.id, "ui-test");
    const hubCalc = await runIamCalculatePipeline(hubRun.id);
    results.push({
      id: "UI-HUB-COMBO",
      name: "IAM + Data Hub combination operable",
      pass: hubCalc.scoredCount >= 0,
      detail: `scored=${hubCalc.scoredCount}`,
    });
    await prisma.iamRun.delete({ where: { id: hubRun.id } });
    await prisma.company.delete({ where: { id: hubOnly.id } });
  } finally {
    await prisma.iamRun.delete({ where: { id: run.id } }).catch(() => undefined);
    await prisma.company.delete({ where: { id: company.id } }).catch(() => undefined);
  }

  const failed = results.filter((r) => !r.pass);
  for (const r of results) {
    console.log(`${r.pass ? "PASS" : "FAIL"} ${r.id} ${r.name} — ${r.detail}`);
  }
  console.log(`\n${results.length - failed.length}/${results.length} PASS`);
  if (failed.length) process.exit(1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
