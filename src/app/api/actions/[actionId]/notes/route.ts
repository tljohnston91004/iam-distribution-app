import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";

export async function POST(req: Request, ctx: { params: Promise<{ actionId: string }> }) {
  try {
    const { actionId } = await ctx.params;
    const body = await req.json();
    const noteText = String(body.noteText ?? "").trim();
    const noteType = String(body.noteType ?? "management_note");
    const visibilityClass = String(body.visibilityClass ?? "Management-Only Protected");

    if (!noteText) {
      return NextResponse.json({ error: "noteText required" }, { status: 400 });
    }

    const action = await prisma.action.findUnique({ where: { id: actionId } });
    if (!action) return NextResponse.json({ error: "Action not found" }, { status: 404 });

    const note = await prisma.actionNote.create({
      data: {
        actionId,
        noteType,
        visibilityClass,
        noteText,
        createdBy: body.createdBy ?? "management",
      },
    });

    return NextResponse.json({ note });
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: "Failed to add note" }, { status: 500 });
  }
}
