/** Stage 4E closeout: small shared helpers for the service modules (history, loading, date parsing, event sections). */
import { DposError } from "../errors";
import { toJson, type Ctx, type Tx, type WorkflowRow } from "../workflow/internal";
import type { WorkflowActor } from "../workflow/permissions";

export type CloseoutRow = NonNullable<Awaited<ReturnType<Tx["iamCoreCloseout"]["findUnique"]>>>;
export type CloseoutVersionRow = NonNullable<Awaited<ReturnType<Tx["iamCoreCloseoutVersion"]["findUnique"]>>>;

export async function loadCloseout(tx: Tx, candidateId: string): Promise<CloseoutRow | null> {
  return tx.iamCoreCloseout.findUnique({ where: { candidateId } });
}

export async function requireCloseout(tx: Tx, candidateId: string, operation: string): Promise<CloseoutRow> {
  const co = await loadCloseout(tx, candidateId);
  if (!co) throw new DposError("CLOSEOUT_NOT_STARTED", `${operation}: formal closeout has not been started for this candidate.`, 409);
  if (co.status === "CLOSED") throw new DposError("CLOSEOUT_ALREADY_CLOSED", "This candidate is permanently closed; its closeout is final and is never reopened or revised.", 409);
  return co;
}

export async function currentVersion(tx: Tx, co: CloseoutRow): Promise<CloseoutVersionRow | null> {
  if (co.currentVersion <= 0) return null;
  return tx.iamCoreCloseoutVersion.findUnique({ where: { closeoutId_closeoutVersion: { closeoutId: co.closeoutId, closeoutVersion: co.currentVersion } } });
}

/** Append-only closeout timeline row plus the matching workflow-history row (the workflow state itself does not change). */
export async function appendHistory(
  tx: Tx,
  ctx: Ctx,
  co: { closeoutId: string; candidateId: string },
  wf: Pick<WorkflowRow, "workflowState">,
  h: { operation: string; from?: string | null; to?: string | null; version?: number | null; actor: WorkflowActor; at: Date; reason?: string | null; detail?: unknown },
) {
  await tx.iamCoreCloseoutHistory.create({
    data: {
      closeoutId: co.closeoutId,
      candidateId: co.candidateId,
      dposCompanyId: ctx.dposCompanyId,
      operation: h.operation,
      fromStatus: h.from ?? null,
      toStatus: h.to ?? null,
      closeoutVersion: h.version ?? null,
      actorId: h.actor.actorId,
      actorRole: h.actor.role,
      reason: h.reason ?? null,
      detailJson: toJson(h.detail),
      at: h.at,
    },
  });
  await tx.iamCoreWorkflowHistory.create({
    data: {
      candidateId: co.candidateId,
      dposCompanyId: ctx.dposCompanyId,
      fromState: wf.workflowState,
      toState: wf.workflowState,
      operation: h.operation,
      actorId: h.actor.actorId,
      actorRole: h.actor.role,
      reason: h.reason ?? null,
      detailJson: toJson({ closeoutId: co.closeoutId, closeoutVersion: h.version ?? null, ...(typeof h.detail === "object" && h.detail ? (h.detail as Record<string, unknown>) : {}) }),
      at: h.at,
    },
  });
}

/** A calendar date (YYYY-MM-DD, midnight UTC) or a full ISO instant. */
export function parseInstant(value: string | Date | null | undefined, field: string): Date | null {
  if (value === null || value === undefined || value === "") return null;
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) throw new DposError("INVALID_DATE", `${field} is not a valid date.`, 400);
    return value;
  }
  const d = /^\d{4}-\d{2}-\d{2}$/.test(value) ? new Date(`${value}T00:00:00.000Z`) : new Date(value);
  if (Number.isNaN(d.getTime())) throw new DposError("INVALID_DATE", `${field} is not a valid date.`, 400);
  return d;
}

export const isoDay = (d: Date | null | undefined): string | undefined => (d ? d.toISOString().slice(0, 10) : undefined);
export const isoTs = (d: Date | null | undefined): string | undefined => (d ? d.toISOString() : undefined);
export const clip = (s: string | null | undefined, n = 4000): string | undefined => (s ? s.slice(0, n) : undefined);
export const clipList = (xs: readonly string[] | null | undefined, n = 500, max = 100): string[] | undefined => (xs && xs.length ? xs.slice(0, max).map((x) => x.slice(0, n)) : undefined);

export function uniqueStrings(xs: readonly string[] | null | undefined, field: string, max = 100): string[] {
  const out: string[] = [];
  for (const raw of xs ?? []) {
    const v = String(raw ?? "").trim();
    if (!v) continue;
    if (v.length > 500) throw new DposError("TEXT_TOO_LONG", `${field} entries must not exceed 500 characters.`, 400, { field });
    if (!out.includes(v)) out.push(v);
  }
  if (out.length > max) throw new DposError("OUT_OF_RANGE", `${field} exceeds ${max} entries.`, 400, { field });
  return out;
}
