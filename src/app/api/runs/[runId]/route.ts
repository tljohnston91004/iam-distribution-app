import { withDposAccess } from "@/lib/dpos/with-access";
import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";

async function GET_v15(_req: Request, ctx: { params: Promise<{ runId: string }> }) {
  const { runId } = await ctx.params;
  const run = await prisma.iamRun.findUnique({
    where: { id: runId },
    include: {
      company: true,
      actionCandidates: { orderBy: { rankedPosition: "asc" }, take: 20 },
      actions: { orderBy: { priorityScore: "desc" } },
      dataGaps: true,
      moduleSignals: { orderBy: { createdAt: "desc" }, take: 20 },
      _count: {
        select: {
          inventorySnapshots: true,
          demandHistory: true,
          incomingSupply: true,
        },
      },
    },
  });

  if (!run) return NextResponse.json({ error: "Run not found" }, { status: 404 });
  return NextResponse.json({ run });
}

export const GET = withDposAccess(GET_v15);
