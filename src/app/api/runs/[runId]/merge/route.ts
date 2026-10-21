import { withDposAccess } from "@/lib/dpos/with-access";
import { NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { mergeKeystrokeViaInboundPort } from "@/lib/iam/adapters/keystroke";

async function POST_v15(_req: Request, ctx: { params: Promise<{ runId: string }> }) {
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

export const POST = withDposAccess(POST_v15);
