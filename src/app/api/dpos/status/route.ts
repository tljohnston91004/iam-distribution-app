import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { describeConfig } from "@/lib/dpos/config";
import { dposRoute } from "@/lib/dpos/dpos-route";
import { summarizeOutbox } from "@/lib/dpos/outbox";
import { getRefreshStatus } from "@/lib/dpos/refresh";
import { listServiceIdentities } from "@/lib/dpos/service-identity";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** GET /api/dpos/status — integration status (non-customer-facing): context, eligibility, identity, refresh, outbox. */
export const GET = dposRoute(async (_req, auth) => {
  const { config, context, verdict } = auth;
  const identities = (await listServiceIdentities(prisma, context.dposCompanyId)).map((i) => ({
    identityId: i.identityId,
    status: i.status,
    issuanceKind: i.issuanceKind,
    capabilities: i.capabilities,
    environmentClass: i.environmentClass,
    issuedAt: i.issuedAt.toISOString(),
    revokedAt: i.revokedAt?.toISOString() ?? null,
  }));
  return NextResponse.json({
    config: describeConfig(config),
    companyContext: context,
    eligibility: verdict,
    serviceIdentities: identities,
    refresh: await getRefreshStatus({ db: prisma, config, context }),
    outbox: { ...(await summarizeOutbox(prisma, context.dposCompanyId)), events: undefined },
  });
});
