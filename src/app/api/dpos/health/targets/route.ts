import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { dposRoute } from "@/lib/dpos/dpos-route";
import { actorFromFrontDoor } from "@/lib/dpos/board";
import { configureTargets, readTargetConfig } from "@/lib/dpos/health";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** GET /api/dpos/health/targets - the governed Health targets (turns / GMROI). Never returns a default. */
export const GET = dposRoute(async (_req, auth) => NextResponse.json(await readTargetConfig(prisma, auth.context)));

/**
 * PUT /api/dpos/health/targets - configure the company turns / GMROI target (management only). Body: { turnsTarget?: number | null,
 * gmroiTarget?: number | null }. A positive number sets it, null clears it. An invalid value is refused with an explicit error.
 */
export const PUT = dposRoute(
  async (req, auth) => {
    const body = (await req.json().catch(() => null)) as { turnsTarget?: number | null; gmroiTarget?: number | null } | null;
    if (!body || typeof body !== "object") return NextResponse.json({ error: "INVALID_BODY", message: "Send a JSON object with turnsTarget and/or gmroiTarget." }, { status: 400 });
    const actor = actorFromFrontDoor({ userId: auth.user.userId ?? null, identityId: auth.user.identityId ?? null, roles: auth.user.roles ?? [] });
    return NextResponse.json(await configureTargets(prisma, auth.context, actor, { turnsTarget: body.turnsTarget, gmroiTarget: body.gmroiTarget }));
  },
  { adminOnly: true },
);