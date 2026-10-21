import { withDposAccess } from "@/lib/dpos/with-access";
import { NextRequest, NextResponse } from "next/server";
import { InboundPortError, type EvidencePackageInput } from "@/lib/iam/inbound";
import { IngestionError } from "@/lib/iam/ingestion";
import { submitDataHubEvidencePackage } from "@/lib/iam/adapters/data-hub/submit-evidence";

export const runtime = "nodejs";

/** POST — Data Hub Evidence Package into unified IAM ingestion (requires enableDataHub). */
async function POST_v15(req: NextRequest, ctx: { params: Promise<{ runId: string }> }) {
  try {
    const { runId } = await ctx.params;
    const body = (await req.json()) as Omit<EvidencePackageInput, "reviewCycleId">;
    const result = await submitDataHubEvidencePackage({
      ...body,
      reviewCycleId: runId,
      sourceSystem: body.sourceSystem ?? "DataHub",
    });
    return NextResponse.json({ status: "ok", payload: result }, { status: 201 });
  } catch (err) {
    if (err instanceof IngestionError || err instanceof InboundPortError) {
      const code = "code" in err ? err.code : "VALIDATION";
      const status = code === "NOT_FOUND" ? 404 : code === "DISABLED" ? 403 : 400;
      return NextResponse.json({ error: err.message, code }, { status });
    }
    console.error(err);
    return NextResponse.json({ error: "Data Hub evidence submit failed" }, { status: 500 });
  }
}

export const POST = withDposAccess(POST_v15);
