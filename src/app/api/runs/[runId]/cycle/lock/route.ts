import { withDposAccess } from "@/lib/dpos/with-access";
import { NextResponse } from "next/server";
import { LifecycleTransitionError, lockReviewCycle } from "@/lib/iam/lifecycle";

/**
 * POST /api/runs/[runId]/cycle/lock
 * Body: { close?: boolean, performedBy?: string }
 * Locks/closes the Review Cycle without applying Holdover as a lifecycle state.
 */
async function POST_v15(req: Request, ctx: { params: Promise<{ runId: string }> }) {
  try {
    const { runId } = await ctx.params;
    const body = (await req.json().catch(() => ({}))) as {
      close?: boolean;
      performedBy?: string;
    };
    const result = await lockReviewCycle(runId, {
      close: Boolean(body.close),
      performedBy: body.performedBy,
    });
    return NextResponse.json({ status: "ok", payload: result });
  } catch (err) {
    console.error(err);
    if (err instanceof LifecycleTransitionError) {
      return NextResponse.json(
        { error: err.message, code: err.code },
        { status: err.code === "NOT_FOUND" ? 404 : 400 }
      );
    }
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Lock failed" },
      { status: 500 }
    );
  }
}

export const POST = withDposAccess(POST_v15);
