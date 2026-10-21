import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { DposError } from "@/lib/dpos/errors";
import { dposRoute } from "@/lib/dpos/dpos-route";
import { correctOutboxEvent, releaseBlockedOutboxEvent } from "@/lib/dpos/outbox";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type Ctx = { params: Promise<{ outboxId: string }> };

/**
 * POST /api/dpos/outbox/[outboxId]
 *   { "action": "release", "note": "..." }                      — release a BLOCKED_ADMIN_ACTION event after fixing config
 *   { "action": "correct", "reason": "...", "sections": {...} } — correct a REJECTED_CORRECTION_REQUIRED event (same producerEventId)
 */
export const POST = dposRoute<Ctx>(
  async (req, auth, ctx) => {
    const { outboxId } = await ctx.params;
    const body = (await req.json().catch(() => null)) as { action?: string; note?: string; reason?: string; sections?: Record<string, Record<string, unknown>> } | null;
    const actor = auth.user.userId ?? auth.user.identityId ?? "unknown";
    if (body?.action === "release") {
      const row = await releaseBlockedOutboxEvent({ db: prisma, context: auth.context }, outboxId, { actor, note: body.note ?? "" });
      return NextResponse.json({ producerEventId: row.producerEventId, syncStatus: row.syncStatus });
    }
    if (body?.action === "correct") {
      const r = await correctOutboxEvent({ db: prisma, context: auth.context }, outboxId, { actor, reason: body.reason ?? "", sections: body.sections ?? {} });
      return NextResponse.json({ producerEventId: r.row.producerEventId, syncStatus: r.row.syncStatus, locallyValid: r.locallyValid, issues: r.issues ?? null });
    }
    throw new DposError("ACTION_INVALID", "action must be 'release' or 'correct'.", 400);
  },
  { adminOnly: true },
);
