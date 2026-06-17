import { NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { assessRunReadiness } from "@/lib/iam/intake";
import { runIamCalculatePipeline } from "@/lib/iam/engine/calculate-pipeline";
import { applyPostCalculateFixtures, seedValidationData } from "@/lib/iam/validation/integration-tests";

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const runId = body.runId as string;
    if (!runId) return NextResponse.json({ error: "runId required" }, { status: 400 });

    await seedValidationData(runId);
    const calc = await runIamCalculatePipeline(runId);
    await applyPostCalculateFixtures(runId);

    const readiness = await assessRunReadiness(runId);

    revalidatePath("/");
    revalidatePath(`/runs/${runId}`);
    revalidatePath("/validation");

    return NextResponse.json({
      loaded: true,
      ...calc,
      readiness,
      message: "Validation scenario dataset loaded (doc 07 SC-001–SC-012 fixtures)",
    });
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: "Validation seed failed" }, { status: 500 });
  }
}
