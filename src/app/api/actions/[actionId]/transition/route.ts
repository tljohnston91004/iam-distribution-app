import { NextResponse } from "next/server";
import { transitionAction } from "@/lib/iam/workflow";
import type { ActionWorkflowState } from "@/lib/iam/enums";

export async function POST(req: Request, ctx: { params: Promise<{ actionId: string }> }) {
  try {
    const { actionId } = await ctx.params;
    const body = await req.json();
    const toState = body.toState as ActionWorkflowState;
    if (!toState) {
      return NextResponse.json({ error: "toState required" }, { status: 400 });
    }

    const action = await transitionAction(actionId, toState, {
      ownerRole: body.ownerRole,
      ownerName: body.ownerName,
      dueDate: body.dueDate ? new Date(body.dueDate) : undefined,
      reviewDate: body.reviewDate ? new Date(body.reviewDate) : undefined,
      changedBy: body.changedBy,
    });

    return NextResponse.json({ action });
  } catch (err) {
    console.error(err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Transition failed" },
      { status: 400 }
    );
  }
}
