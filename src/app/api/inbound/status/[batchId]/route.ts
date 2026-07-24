import { NextRequest, NextResponse } from "next/server";
import { getIngestionStatus, InboundPortError } from "@/lib/iam/inbound";

export const runtime = "nodejs";

/**
 * GET /api/inbound/status/[batchId]?reviewCycleId= — GetIngestionStatus
 */
export async function GET(
  req: NextRequest,
  ctx: { params: Promise<{ batchId: string }> }
) {
  try {
    const { batchId } = await ctx.params;
    const reviewCycleId = req.nextUrl.searchParams.get("reviewCycleId") ?? undefined;
    const result = await getIngestionStatus(batchId, reviewCycleId);
    return NextResponse.json({
      status: "ok",
      timestamp: new Date().toISOString(),
      payload: result,
    });
  } catch (e) {
    if (e instanceof InboundPortError) {
      const status = e.code === "NOT_FOUND" ? 404 : 400;
      return NextResponse.json({
        status: "error",
        timestamp: new Date().toISOString(),
        error: { code: e.code, message: e.message },
      }, { status });
    }
    console.error(e);
    return NextResponse.json({
      status: "error",
      timestamp: new Date().toISOString(),
      error: { code: "INTERNAL", message: e instanceof Error ? e.message : "Unknown error" },
    }, { status: 500 });
  }
}
