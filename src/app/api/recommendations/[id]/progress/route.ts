import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";

/**
 * EEP — update WIP progress narrative (does not change lifecycle).
 */
export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  try {
    const body = await req.json();
    const rec = await prisma.recommendation.findUnique({ where: { id } });
    if (!rec) return NextResponse.json({ error: "Not found" }, { status: 404 });

    const expectedCompletionAt =
      body.expectedCompletionAt != null && body.expectedCompletionAt !== ""
        ? new Date(body.expectedCompletionAt)
        : body.expectedCompletionAt === null
          ? null
          : undefined;

    const updated = await prisma.recommendation.update({
      where: { id },
      data: {
        progressNarrative:
          body.progressNarrative !== undefined ? body.progressNarrative : undefined,
        blockerNote: body.blockerNote !== undefined ? body.blockerNote : undefined,
        ...(expectedCompletionAt !== undefined ? { expectedCompletionAt } : {}),
        lastProgressAt: new Date(),
      },
    });

    await prisma.auditEvent.create({
      data: {
        iamRunId: rec.iamRunId,
        entityType: "Recommendation",
        entityId: id,
        action: "progress_updated",
        performedBy: body.performedBy ?? "pilot-user",
        detailJson: JSON.stringify({
          progressNarrative: updated.progressNarrative,
          blockerNote: updated.blockerNote,
          expectedCompletionAt: updated.expectedCompletionAt,
        }),
      },
    });

    return NextResponse.json({
      id: updated.id,
      progressNarrative: updated.progressNarrative,
      blockerNote: updated.blockerNote,
      lastProgressAt: updated.lastProgressAt,
      expectedCompletionAt: updated.expectedCompletionAt,
    });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Progress update failed" },
      { status: 500 }
    );
  }
}
