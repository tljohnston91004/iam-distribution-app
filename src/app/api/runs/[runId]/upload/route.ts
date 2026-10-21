import { withDposAccess } from "@/lib/dpos/with-access";
import { NextResponse } from "next/server";
import { intakeSpreadsheet, assessRunReadiness } from "@/lib/iam/intake";

async function POST_v15(req: Request, ctx: { params: Promise<{ runId: string }> }) {
  try {
    const { runId } = await ctx.params;
    const form = await req.formData();
    const file = form.get("file");
    const sourceSystem = String(form.get("sourceSystem") ?? "spreadsheet");

    if (!(file instanceof File)) {
      return NextResponse.json({ error: "file required" }, { status: 400 });
    }

    const buffer = Buffer.from(await file.arrayBuffer());
    const result = await intakeSpreadsheet(runId, buffer, file.name, sourceSystem);
    const readiness = await assessRunReadiness(runId);

    return NextResponse.json({ ...result, readiness });
  } catch (err) {
    console.error(err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Upload failed" },
      { status: 500 }
    );
  }
}

export const POST = withDposAccess(POST_v15);
