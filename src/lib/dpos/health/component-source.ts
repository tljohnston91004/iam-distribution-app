/**
 * Stage 4D-R: where each RSE-fed Health component's evidence came from and how fresh it is (read model for the board and the
 * component pages). Freshness is DERIVED at read time from the evidence the stored calculation used (never stored), so a stored
 * Health row is never rewritten: an old calculation simply shows its evidence aging.
 */
import type { Db } from "../errors";
import type { ComponentResult } from "./composite";
import type { ComponentKey } from "./config";
import { classifyEvidenceFreshness, EVIDENCE_FRESHNESS_LABELS, type EvidenceFreshnessState } from "./rse-input";

export const RSE_FED_COMPONENTS = ["POSITION_BALANCE", "EFFICIENCY", "SLOW_NONMOVING"] as const satisfies readonly ComponentKey[];
export type RseFedComponent = (typeof RSE_FED_COMPONENTS)[number];

export interface ComponentSourceView {
  key: ComponentKey;
  evidenceId: string | null;
  evidenceVersion: number | null;
  /** Data currency of the governed result (RSE producer time; the oldest contributing source for Slow / Nonmoving). */
  asOf: string | null;
  recordedAt: string | null;
  freshness: { state: EvidenceFreshnessState; label: string; ageDays: number | null };
  sourceRefs: string[];
  /** Provenance + raw inputs carried with the evidence (source run, contract, rule ids, raw metrics). */
  context: Record<string, unknown> | null;
  provisional: boolean;
}

const EVIDENCE_REF = /^health-evidence:(.+)$/;

export async function componentSources(db: Db, components: ComponentResult[], now: Date): Promise<Record<string, ComponentSourceView>> {
  const out: Record<string, ComponentSourceView> = {};
  for (const c of components) {
    if (!(RSE_FED_COMPONENTS as readonly string[]).includes(c.key)) continue;
    const unavailable = (): ComponentSourceView => ({ key: c.key, evidenceId: null, evidenceVersion: null, asOf: null, recordedAt: null, freshness: { state: "UNAVAILABLE", label: EVIDENCE_FRESHNESS_LABELS.UNAVAILABLE, ageDays: null }, sourceRefs: [], context: null, provisional: true });
    const ref = c.evidenceRefs.map((r) => EVIDENCE_REF.exec(r)?.[1]).find(Boolean);
    if (!c.available || !ref) {
      out[c.key] = unavailable();
      continue;
    }
    const row = await db.iamCoreHealthEvidence.findUnique({ where: { evidenceId: ref } });
    if (!row) {
      out[c.key] = unavailable();
      continue;
    }
    let context: Record<string, unknown> | null = null;
    try {
      const v = JSON.parse(row.evidenceJson) as { context?: Record<string, unknown> };
      context = v.context ?? null;
    } catch {
      context = null;
    }
    let sourceRefs: string[] = [];
    try {
      sourceRefs = JSON.parse(row.sourceRefsJson) as string[];
    } catch {
      sourceRefs = [];
    }
    const f = classifyEvidenceFreshness(row.asOf, now);
    out[c.key] = { key: c.key, evidenceId: row.evidenceId, evidenceVersion: row.evidenceVersion, asOf: row.asOf ? row.asOf.toISOString() : null, recordedAt: row.recordedAt.toISOString(), freshness: { state: f.state, label: EVIDENCE_FRESHNESS_LABELS[f.state], ageDays: f.ageDays }, sourceRefs, context, provisional: true };
  }
  return out;
}
