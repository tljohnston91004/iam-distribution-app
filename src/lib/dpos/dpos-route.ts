/**
 * Helper for the new `/api/dpos/*` integration endpoints. Unlike `withDposAccess` (pass-through in standalone mode),
 * these endpoints exist only in DPOS_INTEGRATED mode and are ALWAYS eligibility-enforced.
 */
import { NextResponse } from "next/server";
import { authorizeOperationalRequest, ADMIN_CAPABLE_ROLES, type GuardResult } from "./access-guard";
import { errorBody, isDposError } from "./errors";
import { guardDeps, integratedConfig } from "./runtime";
import { DposConfigError, type DposIntegrationConfig } from "./config";

export type Authorized = Extract<GuardResult, { ok: true }> & { config: DposIntegrationConfig };

export function dposRoute<C = unknown>(
  handler: (req: Request, auth: Authorized, ctx: C) => Promise<Response>,
  options: { adminOnly?: boolean } = {},
): (req: Request, ctx: C) => Promise<Response> {
  return async (req: Request, ctx: C) => {
    try {
      const config = integratedConfig();
      if (!config) {
        return NextResponse.json(
          { error: { code: "IAM_NOT_DPOS_INTEGRATED", message: "These endpoints exist only when IAM_DEPLOYMENT_MODE=DPOS_INTEGRATED." } },
          { status: 503 },
        );
      }
      const g = await authorizeOperationalRequest(req.headers, guardDeps(config), {
        requireAnyRole: options.adminOnly ? ADMIN_CAPABLE_ROLES : undefined,
      });
      if (!g.ok) {
        return NextResponse.json({ error: { code: g.code, message: g.message, ...(g.details ? { details: g.details } : {}) } }, { status: g.status });
      }
      return await handler(req, { ...g, config }, ctx);
    } catch (e) {
      if (isDposError(e)) return NextResponse.json(errorBody(e), { status: e.httpStatus });
      // Invalid/missing configuration is a closed, explicit failure (never a silent default) — same as withDposAccess.
      if (e instanceof DposConfigError) return NextResponse.json(errorBody(e), { status: 503 });
      return NextResponse.json(errorBody(e), { status: 500 });
    }
  };
}
