/**
 * Server-side page gate for DPOS_INTEGRATED mode (Stage 4A).
 *
 * Mirrors the API guard for pages: governed company context, trusted front-door caller, end-user context, and the
 * Installed -> Entitled -> Implementation Ready -> Enabled -> User Authorized chain. A page for a run that belongs to
 * another company is "not found". In STANDALONE_LEGACY mode this returns null immediately (V1.5 behaviour unchanged).
 *
 * This is a gate, not a redesign: the denial notice is a plain message and no V1.5 screen is altered.
 */
import { headers } from "next/headers";
import { notFound } from "next/navigation";
import type { ReactElement } from "react";
import { prisma } from "@/lib/db";
import { authorizeOperationalRequest } from "./access-guard";
import { errorBody, isDposError } from "./errors";
import { guardDeps, integratedConfig } from "./runtime";

export async function pageGate(scope: { runId?: string; companyId?: string } = {}): Promise<ReactElement | null> {
  let config;
  try {
    config = integratedConfig();
  } catch (e) {
    return blocked("CONFIGURATION_INVALID", errorBody(e).error.message);
  }
  if (!config) return null;
  try {
    const result = await authorizeOperationalRequest(await headers(), guardDeps(config), { suppliedCompanyId: scope.companyId ?? null });
    if (!result.ok) return blocked(result.code, result.message);
    if (scope.runId) {
      const run = await prisma.iamRun.findUnique({ where: { id: scope.runId }, select: { companyId: true } });
      if (run && run.companyId !== result.context.iamCompanyId) notFound();
    }
  } catch (e) {
    if (isDposError(e)) return blocked(e.code, e.message);
    throw e;
  }
  return null;
}

function blocked(code: string, message: string): ReactElement {
  return (
    <main style={{ maxWidth: 640, margin: "0 auto", padding: "64px 24px" }}>
      <h1 style={{ fontSize: 22 }}>Inventory Action Manager is not available</h1>
      <p style={{ color: "var(--muted)" }}>{message}</p>
      <p style={{ color: "var(--muted)", fontSize: 12 }}>Reference: {code}</p>
    </main>
  );
}
