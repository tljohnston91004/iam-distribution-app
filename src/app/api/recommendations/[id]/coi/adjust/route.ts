import { withDposAccess } from "@/lib/dpos/with-access";
import { NextResponse } from "next/server";
import { adjustRecommendationCoiTargetPeriod } from "@/lib/iam/coi";

/**
 * POST /api/recommendations/[id]/coi/adjust
 * Management-adjusted COI target-resolution period (preserves original COI).
 */
async function POST_v15(req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await ctx.params;
    const body = (await req.json()) as {
      newTargetPeriodText?: string;
      reason?: string;
      performedBy?: string;
    };
    if (!body.newTargetPeriodText?.trim()) {
      return NextResponse.json({ error: "newTargetPeriodText is required" }, { status: 400 });
    }
    if (!body.reason?.trim()) {
      return NextResponse.json({ error: "reason is required" }, { status: 400 });
    }
    const result = await adjustRecommendationCoiTargetPeriod({
      recommendationId: id,
      newTargetPeriodText: body.newTargetPeriodText,
      reason: body.reason,
      performedBy: body.performedBy?.trim() || "management",
    });
    return NextResponse.json({ status: "ok", payload: result });
  } catch (err) {
    console.error(err);
    const message = err instanceof Error ? err.message : "COI adjust failed";
    const status =
      message.includes("not found") ? 404 : message.includes("locked") || message.includes("closed") ? 400 : 500;
    return NextResponse.json({ error: message }, { status });
  }
}

export const POST = withDposAccess(POST_v15);
