import { withDposAccess } from "@/lib/dpos/with-access";
import { NextResponse } from "next/server";
import { runFullValidation } from "@/lib/iam/validation/run-all";

export const dynamic = "force-dynamic";

async function POST_v15(req: Request) {
  try {
    const body = await req.json().catch(() => ({}));
    const runId = typeof body.runId === "string" ? body.runId : undefined;
    const integration = body.integration !== false;

    const { report, checklist, validationRunId } = await runFullValidation({ integration, runId });

    return NextResponse.json({ report, checklist, validationRunId });
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: "Validation run failed" }, { status: 500 });
  }
}

async function GET_v15(_req: Request) {
  const { runFullValidation } = await import("@/lib/iam/validation/run-all");
  const { report, checklist } = await runFullValidation({ integration: false });
  return NextResponse.json({ report, checklist });
}

export const GET = withDposAccess(GET_v15, { blockInIntegrated: true });
export const POST = withDposAccess(POST_v15, { blockInIntegrated: true });
