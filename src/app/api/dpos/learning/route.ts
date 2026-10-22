import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { dposRoute } from "@/lib/dpos/dpos-route";
import { readEffectiveness } from "@/lib/dpos/closeout";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** GET /api/dpos/learning - the descriptive learning / action-effectiveness view (evidence only: it never changes scoring, Health, RSE policy or recommendations). */
export const GET = dposRoute(async (_req, auth) => {
  return NextResponse.json(await readEffectiveness(prisma, auth.context));
});
