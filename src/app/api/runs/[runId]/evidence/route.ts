import { NextRequest, NextResponse } from "next/server";
import {
  approveEvidenceForAnalysis,
  getIngestionStatus,
  IngestionError,
  reconcileEvidenceForRun,
} from "@/lib/iam/ingestion";

export const runtime = "nodejs";

/** GET — unified ingestion status (channels, batches, conflicts, approval). */
export async function GET(_req: NextRequest, ctx: { params: Promise<{ runId: string }> }) {
  try {
    const { runId } = await ctx.params;
    const status = await getIngestionStatus(runId);
    return NextResponse.json(status);
  } catch (err) {
    if (err instanceof IngestionError) {
      const status = err.code === "NOT_FOUND" ? 404 : 400;
      return NextResponse.json({ error: err.message }, { status });
    }
    console.error(err);
    return NextResponse.json({ error: "Status failed" }, { status: 500 });
  }
}

/**
 * POST — approve evidence for analysis, or reconcile.
 * body.action: "approve" | "reconcile" (default approve)
 */
export async function POST(req: NextRequest, ctx: { params: Promise<{ runId: string }> }) {
  try {
    const { runId } = await ctx.params;
    const body = (await req.json().catch(() => ({}))) as {
      action?: string;
      performedBy?: string;
    };
    const action = body.action ?? "approve";
    if (action === "reconcile") {
      const reconcile = await reconcileEvidenceForRun(runId);
      return NextResponse.json({ status: "pending_approval", reconcile });
    }
    const result = await approveEvidenceForAnalysis(runId, body.performedBy ?? "operator");
    return NextResponse.json(result);
  } catch (err) {
    if (err instanceof IngestionError) {
      const status = err.code === "NOT_FOUND" ? 404 : err.code === "DISABLED" ? 403 : 400;
      return NextResponse.json({ error: err.message, code: err.code }, { status });
    }
    console.error(err);
    return NextResponse.json({ error: "Evidence action failed" }, { status: 500 });
  }
}
