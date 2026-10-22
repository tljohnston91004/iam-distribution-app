import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { dposRoute } from "@/lib/dpos/dpos-route";
import { curveDiagnostics, healthDepsFromClient, latestHealthChange, listHealthHistory, runHealthPipeline } from "@/lib/dpos/health";
import { operationalServices } from "@/lib/dpos/runtime";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** GET /api/dpos/health - the stored Health Score history (immutable) and the latest change. */
export const GET = dposRoute(async (_req, auth) => {
  const history = await listHealthHistory(prisma, auth.context, { limit: 30 });
  const latest = await latestHealthChange(prisma, auth.context);
  return NextResponse.json({ history, latest });
});

/**
 * POST /api/dpos/health - recalculate the Inventory Management Health Score now. Brings action statuses up to date first, reads the governed RSE results (Position & Balance, Efficiency, Slow / Nonmoving evidence) and the
 * Customer Backorder feed through the Data Hub, then stores a NEW immutable calculation. It never runs scoring and never refreshes data.
 */
export const POST = dposRoute(
  async (_req, auth) => {
    const { client } = await operationalServices();
    // The same pipeline the Refresh operation runs (read governed RSE inputs -> evidence -> recalculate). Never runs scoring or refreshes data.
    const p = await runHealthPipeline(prisma, auth.context, healthDepsFromClient(client));
    if (p.calculation.status === "FAILED") return NextResponse.json({ ok: false, ...p }, { status: 409 });
    const latest = await latestHealthChange(prisma, auth.context);
    return NextResponse.json({ ok: true, ...p, curveDiagnostics: latest ? curveDiagnostics(latest.health.components) : null, health: latest?.health ?? null, prior: latest?.prior ?? null, change: latest?.change ?? null, unchanged: p.calculation.status === "UNCHANGED" });
  },
  { adminOnly: true },
);
