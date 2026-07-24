import { NextResponse } from "next/server";
import {
  stageKeystrokeUpload,
  getKeystrokeUploadStatus,
  KeystrokeAdapterError,
  type IamKeystrokeFileType,
} from "@/lib/iam/adapters/keystroke";

export async function GET(_req: Request, ctx: { params: Promise<{ runId: string }> }) {
  try {
    const { runId } = await ctx.params;
    const status = await getKeystrokeUploadStatus(runId);
    return NextResponse.json(status);
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: "Failed to load upload status" }, { status: 500 });
  }
}

export async function POST(req: Request, ctx: { params: Promise<{ runId: string }> }) {
  try {
    const { runId } = await ctx.params;
    const form = await req.formData();
    const file = form.get("file");
    const forced = String(form.get("fileType") ?? "auto");

    if (!(file instanceof File)) {
      return NextResponse.json({ error: "file required" }, { status: 400 });
    }

    const buffer = Buffer.from(await file.arrayBuffer());
    const forcedType =
      forced !== "auto" && forced !== "unknown" ? (forced as IamKeystrokeFileType) : undefined;

    const result = await stageKeystrokeUpload(runId, buffer, file.name, forcedType);
    const status = await getKeystrokeUploadStatus(runId);

    return NextResponse.json({ ...result, checklist: status });
  } catch (err) {
    console.error(err);
    const status =
      err instanceof KeystrokeAdapterError
        ? err.code === "UNSUPPORTED_TYPE"
          ? 400
          : err.code === "MALFORMED" || err.code === "MISSING_FIELDS"
            ? 400
            : 500
        : 500;
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Keystroke upload failed" },
      { status }
    );
  }
}
