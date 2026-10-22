/**
 * The ONE Health refresh pipeline, shared by the manual "Refresh from Data Hub" and the scheduled Sunday refresh (4DR-C4).
 *
 *   action statuses -> read governed RSE Health input (Data Hub) -> record evidence -> recalculate the Health Score.
 *
 * Health recalculation is separate from candidate scoring: nothing here runs Stage 4C scoring or ranking, so a scoring-input
 * change still shows "Pending Next Scoring Run". A failed RSE read keeps the previous evidence (it ages by its SOURCE time), and a
 * failed calculation is reported, never hidden. Time zone failures surface as an explicit status (no UTC fallback).
 */
import type { PrismaClient } from "@prisma/client";
import { isDposError } from "../errors";
import { SYSTEM_ACTOR } from "../workflow/permissions";
import { evaluateAllActions } from "../workflow";
import { createDataHubBackorderProvider, type BackorderProvider } from "./backorder";
import { createDataHubRseHealthProvider, ingestRseHealthInputs, type RseHealthProvider, type RseIngestResult } from "./rse-input";
import { calculateHealth } from "./service";

export interface HealthRefreshDeps {
  rse: RseHealthProvider;
  backorder?: BackorderProvider | null;
}

export interface HealthPipelineResult {
  rseInputs: RseIngestResult;
  calculation:
    | { status: "CALCULATED" | "UNCHANGED"; calculatedAt: string; score: number | null; label: string | null; healthScoreId: string | null }
    | { status: "FAILED"; code: string; message: string; calculatedAt: string };
  /** Business time the Health evidence is current through (oldest contributing source time), never the Data Hub read time. */
  dataHubReadAt: string;
}

type Ctx = { dposCompanyId: string; companyTimeZone?: string | null };

export async function runHealthPipeline(db: PrismaClient, ctx: Ctx, deps: HealthRefreshDeps, opts: { at?: Date } = {}): Promise<HealthPipelineResult> {
  const at = opts.at ?? new Date();
  await evaluateAllActions(db, ctx as never);
  const rseInputs = await ingestRseHealthInputs(db, ctx, SYSTEM_ACTOR, deps.rse, { at });
  try {
    const result = await calculateHealth(db, ctx, SYSTEM_ACTOR, { backorder: deps.backorder ?? null, at });
    const h = result.health;
    return {
      rseInputs,
      dataHubReadAt: rseInputs.readAt,
      calculation: { status: result.unchanged ? "UNCHANGED" : "CALCULATED", calculatedAt: h.calculatedAt, score: h.score, label: h.label, healthScoreId: h.healthScoreId },
    };
  } catch (e) {
    return {
      rseInputs,
      dataHubReadAt: rseInputs.readAt,
      calculation: { status: "FAILED", code: isDposError(e) ? e.code : "HEALTH_CALCULATION_FAILED", message: e instanceof Error ? e.message : String(e), calculatedAt: at.toISOString() },
    };
  }
}

/** The Data Hub providers for the Health pipeline, built from the one governed client (used by the manual route and the scheduler). */
export function healthDepsFromClient(client: Parameters<typeof createDataHubRseHealthProvider>[0] & Parameters<typeof createDataHubBackorderProvider>[0]): HealthRefreshDeps {
  return { rse: createDataHubRseHealthProvider(client), backorder: createDataHubBackorderProvider(client) };
}
