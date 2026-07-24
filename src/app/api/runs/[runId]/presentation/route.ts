import { NextResponse } from "next/server";
import { getPresentationLanes, scoreAndPresentReviewCycle } from "@/lib/iam/presentation";

/**
 * GET /api/runs/[runId]/presentation — Board lanes for a Review Cycle.
 * POST — re-score and re-assign presentation (does not change lifecycle states).
 */
export async function GET(_req: Request, ctx: { params: Promise<{ runId: string }> }) {
  try {
    const { runId } = await ctx.params;
    const lanes = await getPresentationLanes(runId);
    return NextResponse.json({ status: "ok", lanes });
  } catch (err) {
    console.error(err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Presentation read failed" },
      { status: 500 }
    );
  }
}

export async function POST(_req: Request, ctx: { params: Promise<{ runId: string }> }) {
  try {
    const { runId } = await ctx.params;
    const result = await scoreAndPresentReviewCycle(runId);
    return NextResponse.json({ status: "ok", ...result });
  } catch (err) {
    console.error(err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Score/present failed" },
      { status: 500 }
    );
  }
}
