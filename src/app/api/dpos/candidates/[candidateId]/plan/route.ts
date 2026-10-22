import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { dposRoute } from "@/lib/dpos/dpos-route";
import { actorFromFrontDoor, readActionPlan } from "@/lib/dpos/board";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** GET /api/dpos/candidates/:id/plan - the Recommended Action Plan read model. */
export const GET = dposRoute(async (_req, auth, ctx: { params: Promise<{ candidateId: string }> }) => {
  const { candidateId } = await ctx.params;
  const actor = actorFromFrontDoor({ userId: auth.user.userId ?? null, identityId: auth.user.identityId ?? null, roles: auth.user.roles ?? [] });
  return NextResponse.json(await readActionPlan(prisma, auth.context, candidateId, actor));
});
