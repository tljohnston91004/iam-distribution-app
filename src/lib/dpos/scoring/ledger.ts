/**
 * Stage 4C: shared helpers for the priority-governance ledger (`iam_core_priority_governance`).
 *
 * The ledger is append-only. "Current" overrides, rank locks, strategic authorizations and manual tie-breaks are always
 * derived by reading the ledger, so the full history of who decided what, when and why is never lost.
 */
import type { Prisma } from "@prisma/client";
import { DposError } from "../errors";
import { parseJson } from "../workflow/internal";
import type { WorkflowActor } from "../workflow/permissions";
import type { StrategicLevel } from "./config";
import type { ManualTieBreaks, RankLockInput } from "./ranking";

export type Tx = Prisma.TransactionClient;

/** Workflow states that make a candidate part of the scoring pool (new, not yet an assigned/active action). */
export const POOL_STATES = ["NEW_CANDIDATE", "PRESENTED", "ESCALATED", "SUPPRESSED"] as const;
/** States that are eligible for the NEW-candidate Top 2 (suppressed candidates are scored but not presented). */
export const TOP2_STATES = ["NEW_CANDIDATE", "PRESENTED", "ESCALATED"] as const;

/**
 * 4C-D5: workflow identity is the stable DPOS user id. A display name or email is never an identity key, so an id that looks
 * like an email address or contains whitespace is refused.
 */
export function assertStableUserId(actor: WorkflowActor, operation: string): void {
  const id = actor.actorId;
  if (actor.role === "SYSTEM") return;
  if (/[\s@]/.test(id)) {
    throw new DposError("STABLE_USER_ID_REQUIRED", `${operation} requires the stable DPOS user id of the actor, not a name or email address.`, 400, { actorId: id });
  }
}

/** Never earlier than the candidate's latest ledger entry, so "latest wins" is unambiguous even for same-millisecond writes. */
export async function monotonicEffectiveAt(tx: Tx, candidateId: string, requested: Date): Promise<Date> {
  const latest = await tx.iamCorePriorityGovernance.findFirst({ where: { candidateId }, orderBy: [{ effectiveAt: "desc" }, { createdAt: "desc" }], select: { effectiveAt: true } });
  return latest && latest.effectiveAt.getTime() >= requested.getTime() ? new Date(latest.effectiveAt.getTime() + 1) : requested;
}

export interface StrategicAuthorization {
  level: StrategicLevel;
  authorizedBy: string;
  authorizedByRole: string;
  reason: string;
  governanceId: string;
  at: Date;
}
export interface ActiveOverride {
  points: number;
  magnitudeClass: string | null;
  by: string;
  role: string;
  reason: string;
  at: Date;
  expiresAt: Date | null;
  governanceId: string;
}
export interface ActiveLock extends RankLockInput {
  by: string;
  reason: string;
  expiresAt: Date;
}

async function rows(tx: Tx, candidateIds: string[], types: string[]) {
  if (!candidateIds.length) return [];
  return tx.iamCorePriorityGovernance.findMany({
    where: { candidateId: { in: candidateIds }, actionType: { in: types } },
    orderBy: [{ effectiveAt: "asc" }, { createdAt: "asc" }, { governanceId: "asc" }],
  });
}

export async function activeStrategic(tx: Tx, candidateIds: string[], at: Date): Promise<Map<string, StrategicAuthorization>> {
  const out = new Map<string, StrategicAuthorization>();
  for (const r of await rows(tx, candidateIds, ["STRATEGIC_AUTHORIZED", "STRATEGIC_REVOKED"])) {
    if (r.effectiveAt.getTime() > at.getTime()) continue;
    if (r.actionType === "STRATEGIC_REVOKED") out.delete(r.candidateId);
    else {
      const d = parseJson<{ level?: StrategicLevel }>(r.detailJson, {});
      if (d.level) out.set(r.candidateId, { level: d.level, authorizedBy: r.actorId, authorizedByRole: r.actorRole, reason: r.reason, governanceId: r.governanceId, at: r.effectiveAt });
    }
  }
  return out;
}

export async function activeOverrides(tx: Tx, candidateIds: string[], at: Date): Promise<Map<string, ActiveOverride>> {
  const out = new Map<string, ActiveOverride>();
  for (const r of await rows(tx, candidateIds, ["PRIORITY_OVERRIDE", "OVERRIDE_REVOKED"])) {
    if (r.effectiveAt.getTime() > at.getTime()) continue;
    if (r.actionType === "OVERRIDE_REVOKED") out.delete(r.candidateId);
    else if (r.points !== null) {
      out.set(r.candidateId, { points: r.points, magnitudeClass: r.magnitudeClass, by: r.actorId, role: r.actorRole, reason: r.reason, at: r.effectiveAt, expiresAt: r.expiresAt, governanceId: r.governanceId });
    }
  }
  for (const [id, o] of out) if (o.expiresAt && o.expiresAt.getTime() <= at.getTime()) out.delete(id);
  return out;
}

export async function activeLocks(tx: Tx, candidateIds: string[], at: Date): Promise<Map<string, ActiveLock>> {
  const out = new Map<string, ActiveLock>();
  for (const r of await rows(tx, candidateIds, ["RANK_LOCK", "RANK_UNLOCK"])) {
    if (r.effectiveAt.getTime() > at.getTime()) continue;
    if (r.actionType === "RANK_UNLOCK") out.delete(r.candidateId);
    else {
      const d = parseJson<{ rank?: number }>(r.detailJson, {});
      if (d.rank && r.expiresAt) out.set(r.candidateId, { candidateId: r.candidateId, rank: d.rank, effectiveAt: r.effectiveAt, governanceId: r.governanceId, by: r.actorId, reason: r.reason, expiresAt: r.expiresAt });
    }
  }
  for (const [id, l] of out) if (l.expiresAt.getTime() <= at.getTime()) out.delete(id);
  return out;
}

/** Manual tie-break groups for the candidates in a run, newest decision first (the newest decision governs). */
export async function manualTieBreakGroups(tx: Tx, companyId: string, candidateIds: string[]): Promise<{ groups: ManualTieBreaks; batches: Array<{ batchId: string; order: string[]; by: string; reason: string }> }> {
  if (!candidateIds.length) return { groups: [], batches: [] };
  const all = await tx.iamCorePriorityGovernance.findMany({
    where: { dposCompanyId: companyId, actionType: "MANUAL_TIEBREAK", candidateId: { in: candidateIds } },
    orderBy: [{ effectiveAt: "desc" }, { createdAt: "desc" }],
  });
  const byBatch = new Map<string, typeof all>();
  for (const r of all) {
    const key = r.batchId ?? r.governanceId;
    byBatch.set(key, [...(byBatch.get(key) ?? []), r]);
  }
  const batches: Array<{ batchId: string; order: string[]; by: string; reason: string }> = [];
  for (const [batchId, list] of byBatch) {
    const ordered = [...list].sort((a, b) => (parseJson<{ position?: number }>(a.detailJson, {}).position ?? 0) - (parseJson<{ position?: number }>(b.detailJson, {}).position ?? 0));
    batches.push({ batchId, order: ordered.map((r) => r.candidateId), by: ordered[0]!.actorId, reason: ordered[0]!.reason });
  }
  return { groups: batches.map((b) => b.order), batches };
}
