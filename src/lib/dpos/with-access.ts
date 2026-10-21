/**
 * `withDposAccess` wraps a V1.5 route handler without changing it.
 *
 *   STANDALONE_LEGACY (default): pass-through — V1.5 behaviour is byte-for-byte the baseline.
 *   DPOS_INTEGRATED: the request must pass the governed company context + Installed -> Entitled -> Implementation Ready
 *   -> Enabled -> User Authorized chain, must not carry a service principal, must name the bound company, and any
 *   run / recommendation / action / batch it addresses must belong to the bound company.
 */
import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { authorizeOperationalRequest } from "./access-guard";
import { errorBody, isDposError } from "./errors";
import { guardDeps, integratedConfig } from "./runtime";

export interface WithAccessOptions {
  /** Not available at all in integrated mode (demo/seed/validation data creators). */
  blockInIntegrated?: boolean;
  /** Inspect `reviewCycleId` / `iamRunId` in the query string or JSON body to scope the request to a run. */
  peekRunReference?: boolean;
  requireAnyRole?: readonly string[];
}

type Params = Record<string, string | string[] | undefined>;
type RouteCtx = { params?: Promise<Params> | Params } | undefined;

async function runCompany(runId: string | null | undefined): Promise<string | null | undefined> {
  if (!runId) return undefined;
  const run = await prisma.iamRun.findUnique({ where: { id: runId }, select: { companyId: true } });
  return run ? run.companyId : undefined;
}

/** Company that owns the addressed resource, if one is addressed and found. `undefined` = nothing addressed/found. */
async function resourceCompany(req: Request, params: Params, opts: WithAccessOptions): Promise<string | undefined> {
  const single = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);
  const candidates: Array<Promise<string | null | undefined>> = [];
  const runId = single(params.runId);
  if (runId) candidates.push(runCompany(runId));
  const recId = single(params.id);
  if (recId) {
    candidates.push(
      prisma.recommendation.findUnique({ where: { id: recId }, select: { run: { select: { companyId: true } } } }).then((r) => (r ? r.run.companyId : undefined)),
    );
  }
  const actionId = single(params.actionId);
  if (actionId) {
    candidates.push(
      prisma.action.findUnique({ where: { id: actionId }, select: { run: { select: { companyId: true } } } }).then((r) => (r ? r.run.companyId : undefined)),
    );
  }
  const batchId = single(params.batchId);
  if (batchId) {
    candidates.push(
      prisma.evidenceBatch.findUnique({ where: { id: batchId }, select: { run: { select: { companyId: true } } } }).then((r) => (r ? r.run.companyId : undefined)),
    );
  }
  if (opts.peekRunReference) {
    const url = new URL(req.url);
    let ref = url.searchParams.get("reviewCycleId") ?? url.searchParams.get("iamRunId");
    if (!ref && (req.headers.get("content-type") ?? "").includes("json")) {
      try {
        const body = (await req.clone().json()) as Record<string, unknown>;
        const v = body?.reviewCycleId ?? body?.iamRunId;
        if (typeof v === "string") ref = v;
      } catch {
        /* handler will report the malformed body */
      }
    }
    if (ref) candidates.push(runCompany(ref));
  }
  const found = (await Promise.all(candidates)).filter((c): c is string => typeof c === "string");
  if (found.length === 0) return undefined;
  // Every addressed resource must belong to the same company; return the first, callers compare it to the bound one.
  return found.find((c) => c !== found[0]) ? "__MIXED__" : found[0];
}

export function withDposAccess<A extends [Request, RouteCtx?]>(
  handler: (...args: A) => Promise<Response>,
  options: WithAccessOptions = {},
): (...args: A) => Promise<Response> {
  return async (...args: A): Promise<Response> => {
    let config;
    try {
      config = integratedConfig();
    } catch (e) {
      return NextResponse.json(errorBody(e), { status: 503 });
    }
    if (!config) return handler(...args); // STANDALONE_LEGACY: V1.5 behaviour unchanged

    const req = args[0];
    const ctx = args[1];
    const rawParams = ctx?.params ? await ctx.params : {};
    const params = (rawParams ?? {}) as Params;
    try {
      const companyParam = Array.isArray(params.companyId) ? params.companyId[0] : params.companyId;
      const result = await authorizeOperationalRequest(req.headers, guardDeps(config), {
        suppliedCompanyId: companyParam ?? null,
        requireAnyRole: options.requireAnyRole,
      });
      if (!result.ok) {
        return NextResponse.json({ error: { code: result.code, message: result.message, ...(result.details ? { details: result.details } : {}) } }, { status: result.status });
      }
      if (options.blockInIntegrated) {
        return NextResponse.json(
          { error: { code: "NOT_AVAILABLE_IN_INTEGRATED_MODE", message: "This demonstration/seed endpoint is not available in a DPOS-integrated installation." } },
          { status: 403 },
        );
      }
      const owner = await resourceCompany(req, params, options);
      if (owner !== undefined && owner !== result.context.iamCompanyId) {
        return NextResponse.json({ error: { code: "NOT_FOUND", message: "Not found." } }, { status: 404 });
      }
    } catch (e) {
      if (isDposError(e)) return NextResponse.json(errorBody(e), { status: e.httpStatus });
      throw e;
    }
    return handler(...args);
  };
}
