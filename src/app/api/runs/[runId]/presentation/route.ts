import { withDposAccess } from "@/lib/dpos/with-access";
import { NextResponse } from "next/server";
import { getPresentationLanes, scoreAndPresentReviewCycle } from "@/lib/iam/presentation";

/**
 * GET /api/runs/[runId]/presentation — Board lanes for a Review Cycle.
 * POST — re-score and re-assign presentation (does not change lifecycle states).
 */
async function GET_v15(_req: Request, ctx: { params: Promise<{ runId: string }> }) {
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

async function POST_v15(_req: Request, ctx: { params: Promise<{ runId: string }> }) {
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

export const GET = withDposAccess(GET_v15);
export const POST = withDposAccess(POST_v15);
