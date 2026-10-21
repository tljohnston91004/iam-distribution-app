import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { dposRoute } from "@/lib/dpos/dpos-route";
import { flushOutbox, summarizeOutbox } from "@/lib/dpos/outbox";
import { operationalServices } from "@/lib/dpos/runtime";
import { IAM_SERVICE_CAPABILITIES } from "@/lib/dpos/service-identity";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** GET /api/dpos/outbox — every Results Return event IAM has produced and its sync state. */
export const GET = dposRoute(async (_req, auth) => {
  return NextResponse.json(await summarizeOutbox(prisma, auth.context.dposCompanyId));
});

/** POST /api/dpos/outbox — transmit due events now (same producerEventId and payload on every retry). */
export const POST = dposRoute(
  async () => {
    const { client, context, config } = await operationalServices(IAM_SERVICE_CAPABILITIES.RESULTS_RETURN_WRITE);
    return NextResponse.json(await flushOutbox({ db: prisma, config, context, client }));
  },
  { adminOnly: true },
);
