import { NextResponse } from "next/server";
import { runIamCalculatePipeline } from "@/lib/iam/engine/calculate-pipeline";

export async function POST(_req: Request, ctx: { params: Promise<{ runId: string }> }) {
  try {
    const { runId } = await ctx.params;
    const result = await runIamCalculatePipeline(runId);
    return NextResponse.json(result);
  } catch (err) {
    console.error(err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Calculate failed" },
      { status: 500 }
    );
  }
}
