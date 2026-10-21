import { withDposAccess } from "@/lib/dpos/with-access";
import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";

async function GET_v15(_req: Request, ctx: { params: Promise<{ actionId: string }> }) {
  const { actionId } = await ctx.params;
  const action = await prisma.action.findUnique({
    where: { id: actionId },
    include: {
      candidate: true,
      groupedItems: true,
      notes: { orderBy: { createdDate: "desc" } },
      run: { include: { company: true } },
    },
  });

  if (!action) return NextResponse.json({ error: "Action not found" }, { status: 404 });
  return NextResponse.json({ action });
}

export const GET = withDposAccess(GET_v15);
