import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { dposRoute } from "@/lib/dpos/dpos-route";
import { actorFromFrontDoor } from "@/lib/dpos/board";
import { readCloseout } from "@/lib/dpos/closeout";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** GET /api/dpos/candidates/:id/closeout - the formal closeout read model (versions, approval, attribution, learning, recurrence, gate). */
export const GET = dposRoute(async (_req, auth, ctx: { params: Promise<{ candidateId: string }> }) => {
  const { candidateId } = await ctx.params;
  const actor = actorFromFrontDoor({ userId: auth.user.userId ?? null, identityId: auth.user.identityId ?? null, roles: auth.user.roles ?? [] });
  return NextResponse.json(await readCloseout(prisma, auth.context, candidateId, actor));
});
