import { withDposAccess } from "@/lib/dpos/with-access";
import { NextResponse } from "next/server";
import { runIamCalculatePipeline } from "@/lib/iam/engine/calculate-pipeline";
import { IngestionError } from "@/lib/iam/ingestion";

async function POST_v15(_req: Request, ctx: { params: Promise<{ runId: string }> }) {
  try {
    const { runId } = await ctx.params;
    const result = await runIamCalculatePipeline(runId);
    return NextResponse.json(result);
  } catch (err) {
    console.error(err);
    if (err instanceof IngestionError) {
      const status = err.code === "NOT_FOUND" ? 404 : 400;
      return NextResponse.json({ error: err.message, code: err.code }, { status });
    }
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Calculate failed" },
      { status: 500 }
    );
  }
}

export const POST = withDposAccess(POST_v15);
