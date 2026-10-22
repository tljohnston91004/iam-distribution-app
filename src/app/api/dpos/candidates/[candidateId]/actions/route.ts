import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { dposRoute } from "@/lib/dpos/dpos-route";
import { actorFromFrontDoor, performBoardAction } from "@/lib/dpos/board";
import { DposError } from "@/lib/dpos/errors";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * POST /api/dpos/candidates/:id/actions  { action, ...fields }
 * One governed workflow operation. Permissions are the workflow's own (management for management actions; the assigned owner or an
 * authorized manager for owner actions; contributors are limited), so any signed-in eligible user may call it and is refused by rule.
 */
export const POST = dposRoute(async (req, auth, ctx: { params: Promise<{ candidateId: string }> }) => {
  const { candidateId } = await ctx.params;
  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body || typeof body.action !== "string") throw new DposError("ACTION_REQUIRED", "The request must name an action.", 400);
  const actor = actorFromFrontDoor({ userId: auth.user.userId ?? null, identityId: auth.user.identityId ?? null, roles: auth.user.roles ?? [] });
  const { action, ...fields } = body;
  const result = await performBoardAction(prisma, auth.context, actor, candidateId, action as string, fields);
  return NextResponse.json({ ok: true, action: result.action, label: result.label, message: result.message });
});
