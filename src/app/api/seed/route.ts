import { NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db";
import { assessRunReadiness } from "@/lib/iam/intake";

/** Sample SKUs — shared vendors produce multi-SKU work packages after Calculate. */
const SAMPLE_INVENTORY = [
  { sku: "SKU-100", desc: "Slow mover — trapped cash", qoh: 240, cost: 85, units: 8, sales: 640, vendor: "Acme Parts" },
  { sku: "SKU-110", desc: "Sister SKU — trapped cash", qoh: 180, cost: 70, units: 6, sales: 420, vendor: "Acme Parts" },
  { sku: "SKU-200", desc: "Fast mover — stock risk", qoh: 12, cost: 42, units: 180, sales: 7560, vendor: "Critical Supply" },
  { sku: "SKU-210", desc: "Backorder twin — stock risk", qoh: 9, cost: 48, units: 150, sales: 7200, vendor: "Critical Supply" },
  { sku: "SKU-300", desc: "Moderate excess", qoh: 90, cost: 25, units: 20, sales: 500, vendor: "Budget Line" },
  { sku: "SKU-400", desc: "Healthy turnover", qoh: 45, cost: 18, units: 60, sales: 1080, vendor: "Steady Co" },
];

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const runId = body.runId as string;
    if (!runId) return NextResponse.json({ error: "runId required" }, { status: 400 });

    await prisma.inventorySnapshot.deleteMany({ where: { iamRunId: runId } });
    await prisma.demandHistory.deleteMany({ where: { iamRunId: runId } });
    await prisma.incomingSupply.deleteMany({ where: { iamRunId: runId } });

    for (const row of SAMPLE_INVENTORY) {
      await prisma.inventorySnapshot.create({
        data: {
          iamRunId: runId,
          skuOrItemId: row.sku,
          description: row.desc,
          vendorName: row.vendor,
          quantityOnHand: row.qoh,
          cost: row.cost,
          inventoryValue: row.qoh * row.cost,
          dataConfidence: "Medium Confidence",
        },
      });
      await prisma.demandHistory.create({
        data: {
          iamRunId: runId,
          skuOrItemId: row.sku,
          periodLabel: "13_weeks",
          unitsSold: row.units,
          grossSalesDollars: row.sales,
          dataConfidence: "Medium Confidence",
        },
      });
    }

    await prisma.incomingSupply.createMany({
      data: [
        {
          iamRunId: runId,
          skuOrItemId: "SKU-200",
          backorderQuantity: 24,
          openOrderQuantity: 0,
          dataConfidence: "Medium Confidence",
        },
        {
          iamRunId: runId,
          skuOrItemId: "SKU-210",
          backorderQuantity: 40,
          openOrderQuantity: 0,
          dataConfidence: "Medium Confidence",
        },
      ],
    });

    await prisma.dataGap.deleteMany({ where: { iamRunId: runId } });

    const readiness = await assessRunReadiness(runId);

    revalidatePath("/");
    revalidatePath(`/runs/${runId}`);

    return NextResponse.json({
      loaded: SAMPLE_INVENTORY.length,
      inventoryCount: SAMPLE_INVENTORY.length,
      demandCount: SAMPLE_INVENTORY.length,
      supplyCount: 2,
      readiness,
    });
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: "Seed failed" }, { status: 500 });
  }
}
