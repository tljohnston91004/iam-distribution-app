import { NextRequest, NextResponse } from "next/server";
import { InboundPortError, upsertRecommendations } from "@/lib/iam/inbound";
import type { RecommendationBatchInput } from "@/lib/iam/inbound";

export const runtime = "nodejs";

/**
 * POST /api/inbound/recommendations — UpsertRecommendations (ADR-IAM-001 + SD-17).
 */
export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as RecommendationBatchInput;
    const result = await upsertRecommendations(body);
    return NextResponse.json({
      requestId: body.requestId ?? null,
      status: "ok",
      timestamp: new Date().toISOString(),
      payload: result,
    }, { status: 201 });
  } catch (e) {
    if (e instanceof InboundPortError) {
      const status = e.code === "NOT_FOUND" ? 404 : e.code === "CONFLICT" ? 409 : 400;
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
