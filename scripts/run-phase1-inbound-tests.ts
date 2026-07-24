/**
 * Phase 1 inbound port tests — ADR-IAM-001 + SD-15 + SD-17.
 * Run: npx tsx scripts/run-phase1-inbound-tests.ts
 */
import { prisma, ensureDefaultCompany } from "../src/lib/db";
import {
  deriveQuantityBasis,
  upsertEvidenceBatch,
  upsertRecommendations,
  getIngestionStatus,
} from "../src/lib/iam/inbound";

type Result = { id: string; name: string; pass: boolean; detail: string };

async function main() {
  const results: Result[] = [];
  const company = await ensureDefaultCompany();
  const run = await prisma.iamRun.create({
    data: {
      companyId: company.id,
      runName: "Phase1 Inbound Test Run",
      reviewDate: new Date(),
      reviewWeekStart: new Date(),
      reviewWeekEnd: new Date(),
      runStatus: "Open",
      cycleStatus: "Open",
    },
  });

  try {
    const basisPref = deriveQuantityBasis(10, 12, null);
    results.push({
      id: "P1-SD15",
      name: "Available QOH preferred",
      pass: basisPref.basis === "available_qoh" && basisPref.usableQty === 10,
      detail: JSON.stringify(basisPref),
    });

    const basisFallback = deriveQuantityBasis(null, 7, null);
    results.push({
      id: "P1-SD15b",
      name: "On-Hand fallback",
      pass: basisFallback.basis === "on_hand" && basisFallback.usableQty === 7,
      detail: JSON.stringify(basisFallback),
    });

    const ev = await upsertEvidenceBatch({
      reviewCycleId: run.id,
      evidenceBatchKey: "test-inv-001",
      sourceSystem: "TestAdapter",
      sourceReportType: "inventory_position",
      contentIdentity: "hash-1",
      items: [
        {
          skuOrItemId: "SKU-A",
          quantityOnHand: 5,
          availableQoh: 4,
          unitCost: 10,
          openOrderQty: 2,
          entityEligibility: "rankable",
        },
        {
          skuOrItemId: "SKU-PARENT",
          quantityOnHand: 100,
          entityEligibility: "excluded_non_entity",
        },
        {
          skuOrItemId: "SKU-A",
          periodCode: "W13",
          unitsSold: 20,
          salesDollars: 200,
        },
      ],
    });

    const inv = await prisma.inventorySnapshot.findMany({ where: { evidenceBatchId: ev.evidenceBatchId } });
    const dem = await prisma.demandHistory.findMany({ where: { evidenceBatchId: ev.evidenceBatchId } });
    const skuA = inv.find((i) => i.skuOrItemId === "SKU-A");
    results.push({
      id: "P1-EV-01",
      name: "Evidence batch persists inventory with QOH basis",
      pass:
        ev.inventoryRows >= 2 &&
        skuA?.quantityBasisUsed === "available_qoh" &&
        skuA.availableQoh === 4 &&
        dem.length >= 1,
      detail: `inv=${inv.length} dem=${dem.length} basis=${skuA?.quantityBasisUsed}`,
    });

    const status = await getIngestionStatus(ev.evidenceBatchId);
    results.push({
      id: "P1-EV-02",
      name: "GetIngestionStatus by id",
      pass: status.status === "accepted" && status.externalBatchKey === "test-inv-001",
      detail: status.status,
    });

    const mod = await upsertRecommendations({
      reviewCycleId: run.id,
      recommendations: [
        {
          sourceModule: "RSE",
          sourceRecommendationId: "RSE-REC-1",
          generationPath: "module",
          skuOrItemId: "SKU-A",
          recommendationType: "Trapped Cash Review",
          title: "Module trapped cash",
          estimatedCashImpact: 1000,
          evidenceRefs: [{ batch: ev.evidenceBatchId }],
        },
      ],
    });
    results.push({
      id: "P1-REC-01",
      name: "Module recommendation create",
      pass: mod.createdCount === 1,
      detail: JSON.stringify(mod),
    });

    const interimDup = await upsertRecommendations({
      reviewCycleId: run.id,
      recommendations: [
        {
          sourceModule: "IAM",
          generationPath: "interim_evidence",
          skuOrItemId: "SKU-A",
          recommendationType: "Trapped Cash Review",
          title: "Interim should not duplicate",
          estimatedCashImpact: 50,
          evidenceRefs: [{ note: "enrichment" }],
        },
      ],
    });
    const allForOpp = await prisma.recommendation.findMany({
      where: { iamRunId: run.id, opportunityKey: "SKU-A|Trapped Cash Review" },
    });
    results.push({
      id: "P1-SD17",
      name: "SD-17 interim does not duplicate module Recommendation",
      pass:
        interimDup.skippedDuplicateInterimCount === 1 &&
        interimDup.createdCount === 0 &&
        allForOpp.length === 1 &&
        allForOpp[0].generationPath === "module",
      detail: `recs=${allForOpp.length} skipped=${interimDup.skippedDuplicateInterimCount}`,
    });

    const interimOnly = await upsertRecommendations({
      reviewCycleId: run.id,
      recommendations: [
        {
          sourceModule: "IAM",
          generationPath: "interim_evidence",
          skuOrItemId: "SKU-B",
          recommendationType: "Stock Risk Review",
          title: "Interim only SKU-B",
        },
      ],
    });
    results.push({
      id: "P1-REC-02",
      name: "Interim allowed when no module Recommendation",
      pass: interimOnly.createdCount === 1,
      detail: JSON.stringify(interimOnly),
    });

    const ev2 = await upsertEvidenceBatch({
      reviewCycleId: run.id,
      evidenceBatchKey: "test-inv-001",
      sourceSystem: "TestAdapter",
      sourceReportType: "inventory_position",
      items: [{ skuOrItemId: "SKU-A", quantityOnHand: 9, availableQoh: 8 }],
    });
    results.push({
      id: "P1-EV-03",
      name: "Evidence batch key idempotent replace",
      pass: ev2.supersededPriorBatch === true,
      detail: JSON.stringify(ev2),
    });
  } finally {
    await prisma.iamRun.delete({ where: { id: run.id } }).catch(() => undefined);
  }

  const failed = results.filter((r) => !r.pass);
  for (const r of results) {
    console.log(`${r.pass ? "PASS" : "FAIL"} ${r.id} ${r.name} — ${r.detail}`);
  }
  console.log(`\n${results.length - failed.length}/${results.length} passed`);
  if (failed.length) process.exitCode = 1;
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
