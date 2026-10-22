/**
 * Stage 4D server wiring for the board pages and routes (the only board module that touches the process-level Prisma client).
 *
 * The V4 board exists ONLY in DPOS_INTEGRATED mode. In standalone mode every board URL is a 404 and V1.5 is untouched. In integrated
 * mode the same trusted-front-door and Installed -> Entitled -> Ready -> Enabled -> User Authorized chain as the rest of IAM applies.
 */
import { headers } from "next/headers";
import { notFound } from "next/navigation";
import type { ReactElement } from "react";
import { prisma } from "@/lib/db";
import { authorizeOperationalRequest } from "../access-guard";
import type { DposCompanyContext } from "../company-context";
import type { DposIntegrationConfig } from "../config";
import { errorBody, isDposError } from "../errors";
import { getRefreshStatus } from "../refresh";
import { guardDeps, integratedConfig } from "../runtime";
import type { WorkflowActor } from "../workflow";
import { actorFromFrontDoor } from "./actor";
import { buildBoard, type BoardView } from "./board";
import { readActionPlan, type ActionPlanView } from "./plan";
import { readCloseout, readEffectiveness, type CloseoutView, type EffectivenessView } from "../closeout";

export interface BoardSession {
  config: DposIntegrationConfig;
  context: DposCompanyContext;
  ctx: { dposCompanyId: string; companyTimeZone: string | null };
  actor: WorkflowActor;
}

export type SessionResult = { ok: true; session: BoardSession } | { ok: false; element: ReactElement };

export async function boardSession(): Promise<SessionResult> {
  let config: DposIntegrationConfig | null;
  try {
    config = integratedConfig();
  } catch (e) {
    return { ok: false, element: blocked("CONFIGURATION_INVALID", errorBody(e).error.message) };
  }
  if (!config) notFound();
  try {
    const g = await authorizeOperationalRequest(await headers(), guardDeps(config));
    if (!g.ok) return { ok: false, element: blocked(g.code, g.message) };
    const actor = actorFromFrontDoor({ userId: g.user.userId ?? null, identityId: g.user.identityId ?? null, roles: g.user.roles ?? [] });
    return { ok: true, session: { config, context: g.context, ctx: { dposCompanyId: g.context.dposCompanyId, companyTimeZone: g.context.companyTimeZone }, actor } };
  } catch (e) {
    if (isDposError(e)) return { ok: false, element: blocked(e.code, e.message) };
    throw e;
  }
}

export async function loadBoard(s: BoardSession, query: { location?: string | null; period?: string | null } = {}): Promise<BoardView> {
  const refreshStatus = await getRefreshStatus({ db: prisma, config: s.config, context: s.context });
  return buildBoard(prisma, s.ctx, s.actor, { refreshStatus, location: query.location ?? null, period: query.period ?? null });
}

export async function loadPlan(s: BoardSession, candidateId: string): Promise<ActionPlanView | null> {
  try {
    return await readActionPlan(prisma, s.ctx, candidateId, s.actor);
  } catch (e) {
    if (isDposError(e) && e.httpStatus === 404) return null;
    throw e;
  }
}

export async function loadCloseout(s: BoardSession, candidateId: string): Promise<CloseoutView | null> {
  try {
    return await readCloseout(prisma, s.ctx, candidateId, s.actor);
  } catch (e) {
    if (isDposError(e) && e.httpStatus === 404) return null;
    throw e;
  }
}

export async function loadLearning(s: BoardSession): Promise<EffectivenessView> {
  return readEffectiveness(prisma, s.ctx);
}

export function blocked(code: string, message: string): ReactElement {
  return (
    <main style={{ maxWidth: 640, margin: "0 auto", padding: "64px 24px" }}>
      <h1 style={{ fontSize: 22 }}>The Decision Board is not available</h1>
      <p style={{ color: "var(--muted)" }}>{message}</p>
      <p style={{ color: "var(--muted)", fontSize: 12 }}>Reference: {code}</p>
    </main>
  );
}
