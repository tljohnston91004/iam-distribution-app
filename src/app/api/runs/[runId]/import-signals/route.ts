import { withDposAccess } from "@/lib/dpos/with-access";
import { NextResponse } from "next/server";
import { importModuleSignals } from "@/lib/iam/intake";

async function POST_v15(req: Request, ctx: { params: Promise<{ runId: string }> }) {
  try {
    const { runId } = await ctx.params;
    const body = await req.json();
    const signals = Array.isArray(body.signals) ? body.signals : [];
    const ids = await importModuleSignals(runId, signals);
    return NextResponse.json({ imported: ids.length, signalIds: ids });
  } catch (err) {
    console.error(err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Import failed" },
      { status: 500 }
    );
  }
}

export const POST = withDposAccess(POST_v15);
