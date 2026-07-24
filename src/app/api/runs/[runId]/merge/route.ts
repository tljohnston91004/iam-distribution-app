import { NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { mergeKeystrokeViaInboundPort } from "@/lib/iam/adapters/keystroke";

export async function POST(_req: Request, ctx: { params: Promise<{ runId: string }> }) {
  try {
    const { runId } = await ctx.params;
    const result = await mergeKeystrokeViaInboundPort(runId);
    revalidatePath(`/runs/${runId}`);
    revalidatePath("/");
    return NextResponse.json(result);
  } catch (err) {
    console.error(err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Merge failed" },
      { status: 500 }
    );
  }
}
