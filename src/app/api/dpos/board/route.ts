import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { dposRoute } from "@/lib/dpos/dpos-route";
import { getRefreshStatus } from "@/lib/dpos/refresh";
import { actorFromFrontDoor, buildBoard } from "@/lib/dpos/board";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** GET /api/dpos/board?location=&period= - the Decision Board V4 read model (read only: never scores, refreshes or writes). */
export const GET = dposRoute(async (req, auth) => {
  const url = new URL(req.url);
  const actor = actorFromFrontDoor({ userId: auth.user.userId ?? null, identityId: auth.user.identityId ?? null, roles: auth.user.roles ?? [] });
  const refreshStatus = await getRefreshStatus({ db: prisma, config: auth.config, context: auth.context });
  const board = await buildBoard(prisma, auth.context, actor, { refreshStatus, location: url.searchParams.get("location"), period: url.searchParams.get("period") });
  return NextResponse.json(board);
});
