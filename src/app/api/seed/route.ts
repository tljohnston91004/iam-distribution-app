import { NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import {
  approveEvidenceForAnalysis,
  submitEvidenceThroughUnifiedIngestion,
} from "@/lib/iam/ingestion";
import { assessRunReadiness } from "@/lib/iam/intake";

/** Sample SKUs aligned with doc 07 validation scenarios (trapped cash + stock risk). */
const SAMPLE_INVENTORY = [
  { sku: "SKU-100", desc: "Slow mover — trapped cash", qoh: 240, cost: 85, units: 8, sales: 640 },
  { sku: "SKU-200", desc: "Fast mover — stock risk", qoh: 12, cost: 42, units: 180, sales: 7560 },
  { sku: "SKU-300", desc: "Moderate excess", qoh: 90, cost: 25, units: 20, sales: 500 },
  { sku: "SKU-400", desc: "Healthy turnover", qoh: 45, cost: 18, units: 60, sales: 1080 },
];

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const runId = body.runId as string;
    if (!runId) return NextResponse.json({ error: "runId required" }, { status: 400 });

    await submitEvidenceThroughUnifiedIngestion({
      reviewCycleId: runId,
      evidenceBatchKey: `sample:inventory:${runId}`,
      sourceSystem: "CustomerUpload",
      sourceReportType: "inventory_position",
      sourceFileName: "sample-inventory.json",
      items: SAMPLE_INVENTORY.map((row) => ({
        skuOrItemId: row.sku,
        description: row.desc,
        quantityOnHand: row.qoh,
        unitCost: row.cost,
        dataConfidence: "Medium Confidence",
      })),
      performedBy: "sample-seed",
    });

    await submitEvidenceThroughUnifiedIngestion({
      reviewCycleId: runId,
      evidenceBatchKey: `sample:demand:${runId}`,
      sourceSystem: "CustomerUpload",
      sourceReportType: "demand_history",
      sourceFileName: "sample-demand.json",
      items: SAMPLE_INVENTORY.map((row) => ({
        skuOrItemId: row.sku,
        description: row.desc,
        periodCode: "W13",
        unitsSold: row.units,
        salesDollars: row.sales,
        dataConfidence: "Medium Confidence",
      })),
      performedBy: "sample-seed",
    });

    await submitEvidenceThroughUnifiedIngestion({
      reviewCycleId: runId,
      evidenceBatchKey: `sample:supply:${runId}`,
      sourceSystem: "CustomerUpload",
      sourceReportType: "incoming_supply",
      sourceFileName: "sample-supply.json",
      items: [{ skuOrItemId: "SKU-200", backorderQuantity: 24, openOrderQty: 0 }],
      performedBy: "sample-seed",
    });

    await approveEvidenceForAnalysis(runId, "sample-seed");

    const readiness = await assessRunReadiness(runId);

    revalidatePath("/");
    revalidatePath(`/runs/${runId}`);

    return NextResponse.json({
      loaded: SAMPLE_INVENTORY.length,
      inventoryCount: SAMPLE_INVENTORY.length,
      demandCount: SAMPLE_INVENTORY.length,
      supplyCount: 1,
      readiness,
      evidenceApprovalStatus: "approved",
    });
  } catch (err) {
    console.error(err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Seed failed" },
      { status: 500 }
    );
  }
}
