/**
 * Classification ingestion + segment impact ranking (V1.5).
 */
import { prisma } from "../src/lib/db";
import { runIamCalculatePipeline } from "../src/lib/iam/engine/calculate-pipeline";
import { cashImpactScore, compareByBusinessImpact } from "../src/lib/iam/engine/impact-score";
import {
  applySegmentDoubleCountGuard,
  identifySegmentCandidates,
} from "../src/lib/iam/engine/segments";
import { buildSkuEvidence, identifyCandidatesForSku } from "../src/lib/iam/engine/ranking";
import {
  approveEvidenceForAnalysis,
  submitEvidenceThroughUnifiedIngestion,
} from "../src/lib/iam/ingestion";
import { resolveKeystrokeFileType } from "../src/lib/iam/adapters/keystroke/file-types";
import type { ScoredCandidate } from "../src/lib/iam/types";

type Result = { id: string; name: string; pass: boolean; detail: string };

async function main() {
  const results: Result[] = [];

  const ftClass = resolveKeystrokeFileType("TrueDemandClassification-Standard.xlsx", [
    "STOCK #",
    "Classification",
    "Vendor",
  ]);
  results.push({
    id: "CL-DETECT-TDC",
    name: "True Demand Classification recognized",
    pass: ftClass.fileType === "demand_classification" && ftClass.variant === "standard",
    detail: JSON.stringify(ftClass),
  });

  const ftInvClass = resolveKeystrokeFileType("InventoryClassification.xlsx", [
    "STOCK #",
    "Inventory Class",
    "Category",
  ]);
  results.push({
    id: "CL-DETECT-INV",
    name: "Inventory Classification recognized",
    pass: ftInvClass.fileType === "inventory_classification",
    detail: JSON.stringify(ftInvClass),
  });

  results.push({
    id: "CL-CASH-SCALE",
    name: "Cash impact score separates $5k vs $400k",
    pass: cashImpactScore(400_000) > cashImpactScore(5_000) + 20,
    detail: `5k=${cashImpactScore(5_000).toFixed(1)} 400k=${cashImpactScore(400_000).toFixed(1)}`,
  });

  // Segment vs SKU ranking + double-count
  const members = Array.from({ length: 5 }, (_, i) =>
    buildSkuEvidence(
      `D-${i + 1}`,
      {
        description: `D class ${i}`,
        quantityOnHand: 1000,
        cost: 80,
        inventoryValue: 80_000,
        dataConfidence: "Medium Confidence",
        classification: "D",
        vendorName: "VendorX",
      },
      { unitsSold: 10, grossSalesDollars: 800, dataConfidence: "Medium Confidence" }
    )
  );
  const smallSku = buildSkuEvidence(
    "SKU-SMALL",
    {
      description: "Small exposure",
      quantityOnHand: 50,
      cost: 100,
      inventoryValue: 5_000,
      dataConfidence: "Medium Confidence",
      classification: "A",
    },
    { unitsSold: 1, grossSalesDollars: 100, dataConfidence: "Medium Confidence" }
  );

  const skuCands: ScoredCandidate[] = [];
  for (const m of [...members, smallSku]) {
    skuCands.push(...identifyCandidatesForSku(m));
  }
  const segments = identifySegmentCandidates([...members, smallSku]);
  const guarded = applySegmentDoubleCountGuard(skuCands, segments);
  const combined = [...segments, ...guarded].sort(compareByBusinessImpact);

  const top = combined[0];
  const memberStillRanked = guarded.some(
    (c) => c.actionType === "Trapped Cash Review" && c.skuOrItemId.startsWith("D-")
  );

  results.push({
    id: "CL-SEG-DISCOVER",
    name: "Classification segment candidate discovered",
    pass: segments.some((s) => s.detail.segmentKey === "D" && (s.estimatedCashImpact ?? 0) >= 400_000),
    detail: JSON.stringify(
      segments.map((s) => ({
        title: s.candidateTitle,
        cash: s.estimatedCashImpact,
        n: s.detail.affectedSkuCount,
      }))
    ),
  });

  results.push({
    id: "CL-SEG-RANKS",
    name: "D-class $400k segment outranks $5k SKU",
    pass:
      top?.detail?.analysisGrain === "segment" &&
      (top.estimatedCashImpact ?? 0) > 100_000 &&
      combined.some((c) => c.skuOrItemId === "SKU-SMALL"),
    detail: `top=${top?.candidateTitle} cash=${top?.estimatedCashImpact}`,
  });

  results.push({
    id: "CL-NO-DOUBLE",
    name: "Member SKUs not separately ranked for same action",
    pass: !memberStillRanked,
    detail: `guardedTrapped=${guarded.filter((c) => c.actionType === "Trapped Cash Review").map((c) => c.skuOrItemId).join(",")}`,
  });

  // End-to-end: RSE classification overlay + calculate
  const company = await prisma.company.create({
    data: {
      name: `Class Seg Co ${Date.now()}`,
      enableStandaloneUpload: true,
      enableRseEvidence: true,
      enableDataHub: false,
    },
  });
  const run = await prisma.iamRun.create({
    data: {
      companyId: company.id,
      runName: "Class segment test",
      reviewDate: new Date(),
      reviewWeekStart: new Date(),
      reviewWeekEnd: new Date(),
    },
  });

  try {
    const invItems = Array.from({ length: 5 }, (_, i) => ({
      skuOrItemId: `RSE-D-${i + 1}`,
      quantityOnHand: 500,
      unitCost: 160,
      periodCode: "W13",
      unitsSold: 5,
      salesDollars: 800,
      dataConfidence: "Medium Confidence",
    }));
    await submitEvidenceThroughUnifiedIngestion({
      reviewCycleId: run.id,
      evidenceBatchKey: `cust:inv:${run.id}`,
      sourceSystem: "CustomerUpload",
      sourceReportType: "inventory_position",
      items: invItems,
      performedBy: "test",
    });
    await submitEvidenceThroughUnifiedIngestion({
      reviewCycleId: run.id,
      evidenceBatchKey: `rse:class:${run.id}`,
      sourceSystem: "RSE",
      sourceReportType: "inventory_classification",
      items: invItems.map((r) => ({
        skuOrItemId: r.skuOrItemId,
        classification: "D",
        vendorName: "RSE-Vendor",
        dataConfidence: "High Confidence",
      })),
      performedBy: "rse-adapter",
    });

    const withClass = await prisma.inventorySnapshot.count({
      where: { iamRunId: run.id, classification: "D", selectedForAnalysis: true },
    });
    results.push({
      id: "CL-RSE-OVERLAY",
      name: "RSE classification overlays inventory when RSE active",
      pass: withClass >= 5,
      detail: `classified=${withClass}`,
    });

    await approveEvidenceForAnalysis(run.id, "test");
    const calc = await runIamCalculatePipeline(run.id);
    const segs = await prisma.recommendation.findMany({
      where: { iamRunId: run.id, analysisGrain: "segment" },
    });
    results.push({
      id: "CL-CALC-SEG",
      name: "Calculate emits segment Recommendation",
      pass: segs.length >= 1 && (segs[0].estimatedCashImpact ?? 0) >= 100_000,
      detail: JSON.stringify({
        scored: calc.scoredCount,
        seg: segs.map((s) => ({
          title: s.title,
          cash: s.estimatedCashImpact,
          n: s.affectedSkuCount,
        })),
      }),
    });
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
