import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { dposRoute } from "@/lib/dpos/dpos-route";
import { getRefreshStatus, runRefresh } from "@/lib/dpos/refresh";
import { operationalServices } from "@/lib/dpos/runtime";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** GET /api/dpos/refresh — last refresh, data-current-through, next scheduled refresh. */
export const GET = dposRoute(async (_req, auth) => {
  return NextResponse.json(await getRefreshStatus({ db: prisma, config: auth.config, context: auth.context }));
});

/** POST /api/dpos/refresh — manual "Refresh from Data Hub" (backend operation; records the attempt; no scoring). */
export const POST = dposRoute(
  async (_req, auth) => {
    const { client, context, config } = await operationalServices();
    const result = await runRefresh(
      { db: prisma, config, context, client },
      { trigger: "MANUAL_REFRESH", requestedBy: auth.user.userId ?? auth.user.identityId ?? "unknown" },
    );
    return NextResponse.json(result, { status: result.ok ? 200 : 502 });
  },
  { adminOnly: true },
);
