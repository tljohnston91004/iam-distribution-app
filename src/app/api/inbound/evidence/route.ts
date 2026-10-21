import { withDposAccess } from "@/lib/dpos/with-access";
import { NextRequest, NextResponse } from "next/server";
import { InboundPortError, type EvidencePackageInput } from "@/lib/iam/inbound";
import {
  IngestionError,
  submitEvidenceThroughUnifiedIngestion,
} from "@/lib/iam/ingestion";

export const runtime = "nodejs";

/**
 * POST /api/inbound/evidence — unified evidence submission (Port + reconcile + pending approval).
 * Does not score, place on Board, or mutate lifecycle (ADR-IAM-001).
 */
async function POST_v15(req: NextRequest) {
  try {
    const body = (await req.json()) as EvidencePackageInput;
    const result = await submitEvidenceThroughUnifiedIngestion(body);
    return NextResponse.json({
      requestId: body.requestId ?? null,
      status: "ok",
      timestamp: new Date().toISOString(),
      payload: {
        ...result,
        evidenceApprovalStatus: "pending_approval",
      },
    }, { status: 201 });
  } catch (e) {
    if (e instanceof IngestionError) {
      const status = e.code === "NOT_FOUND" ? 404 : e.code === "DISABLED" ? 403 : 400;
      return NextResponse.json({
        status: "error",
        timestamp: new Date().toISOString(),
        error: { code: e.code, message: e.message },
      }, { status });
    }
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

export const POST = withDposAccess(POST_v15, { peekRunReference: true });
