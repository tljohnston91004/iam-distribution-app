import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { dposRoute } from "@/lib/dpos/dpos-route";
import { actorFromFrontDoor, markBoardReviewed } from "@/lib/dpos/board";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** POST /api/dpos/board/review - management marks the board reviewed (the "since last review" window restarts here). */
export const POST = dposRoute(
  async (req, auth) => {
    const actor = actorFromFrontDoor({ userId: auth.user.userId ?? null, identityId: auth.user.identityId ?? null, roles: auth.user.roles ?? [] });
    const body = (await req.json().catch(() => ({}))) as { note?: unknown };
    const review = await markBoardReviewed(prisma, auth.context, actor, { note: typeof body.note === "string" ? body.note : undefined });
    return NextResponse.json({ ok: true, message: "The board was marked as reviewed.", review });
  },
  { adminOnly: true },
);
