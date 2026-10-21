import { withDposAccess } from "@/lib/dpos/with-access";
import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";

/**
 * GET/POST /api/recommendations/[id]/notes
 * Phase 5 contributor / management notes.
 */
async function GET_v15(req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await ctx.params;
    const viewAs = new URL(req.url).searchParams.get("viewAs") ?? "executive";
    const notes = await prisma.recommendationNote.findMany({
      where: {
        recommendationId: id,
        ...(viewAs === "owner" ? { visibility: "shared" } : {}),
      },
      orderBy: { createdAt: "asc" },
    });
    return NextResponse.json({ status: "ok", notes });
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: "Failed to load notes" }, { status: 500 });
  }
}

async function POST_v15(req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await ctx.params;
    const body = (await req.json()) as Record<string, unknown>;
    const text = String(body.body ?? "").trim();
    if (!text) return NextResponse.json({ error: "Note body required" }, { status: 400 });

    const rec = await prisma.recommendation.findUnique({ where: { id } });
    if (!rec) return NextResponse.json({ error: "Not found" }, { status: 404 });

    const visibility = body.visibility === "management" ? "management" : "shared";
    const authoredBy = typeof body.authoredBy === "string" ? body.authoredBy : "pilot-user";

    const note = await prisma.recommendationNote.create({
      data: {
        recommendationId: id,
        body: text,
        visibility,
        authoredBy,
      },
    });

    await prisma.auditEvent.create({
      data: {
        iamRunId: rec.iamRunId,
        entityType: "Recommendation",
        entityId: id,
        action: "note:add",
        performedBy: authoredBy,
        detailJson: JSON.stringify({ visibility, noteId: note.id }),
      },
    });

    return NextResponse.json({ status: "ok", note });
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: "Failed to add note" }, { status: 500 });
  }
}

export const GET = withDposAccess(GET_v15);
export const POST = withDposAccess(POST_v15);
