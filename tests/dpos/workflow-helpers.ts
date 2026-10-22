/**
 * Stage 4B test fixtures: actors, governed evidence, and short-cuts that drive a candidate to a given workflow position.
 * Everything runs against throw-away governed-migrated databases (never data/iam.db).
 */
import type { PrismaClient } from "@prisma/client";
import assert from "node:assert/strict";
import type { DposCompanyContext } from "../../src/lib/dpos/company-context";
import {
  acceptOwnership,
  approveCandidate,
  ingestGovernedEvidence,
  presentCandidate,
  startAction,
  type EvidenceGroup,
  type EvidenceItem,
  type GroupDescription,
  type WorkflowActor,
} from "../../src/lib/dpos/workflow";

export const DAY = 24 * 60 * 60 * 1000;

export const MANAGER: WorkflowActor = { actorId: "mgr-1", role: "MANAGER", displayName: "Morgan Manager" };
export const MANAGER_2: WorkflowActor = { actorId: "mgr-2", role: "MANAGER" };
export const ADMIN: WorkflowActor = { actorId: "admin-1", role: "ADMINISTRATOR" };
export const OWNER_USER: WorkflowActor = { actorId: "owner-1", role: "OPERATOR", displayName: "Olivia Owner" };
export const OWNER_USER_2: WorkflowActor = { actorId: "owner-2", role: "OPERATOR" };
export const CONTRIBUTOR: WorkflowActor = { actorId: "contrib-1", role: "OPERATOR" };
export const STRANGER: WorkflowActor = { actorId: "stranger-1", role: "OPERATOR" };
export const VIEWER: WorkflowActor = { actorId: "viewer-1", role: "VIEW_ONLY" };
export { SYSTEM_ACTOR } from "../../src/lib/dpos/workflow";

/** A fixed Monday so day arithmetic in the tests is readable. */
export const T0 = new Date("2026-10-26T15:00:00.000Z");
export const at = (days: number, hours = 0) => new Date(T0.getTime() + days * DAY + hours * 60 * 60 * 1000);
export const dateStr = (days: number) => at(days).toISOString().slice(0, 10);

export function evidence(ref: string, over: Partial<EvidenceItem> = {}): EvidenceItem {
  return {
    evidenceRef: `ev-${ref}`,
    conditionKey: "Excess open purchase orders - Vendor A",
    actionPath: "Reduce or defer open purchase orders",
    responsibleDepartment: "Purchasing",
    businessObjective: "Reduce excess inventory exposure",
    kind: "SKU",
    sku: `SKU-${ref}`,
    vendor: "Vendor A",
    category: "Hardware",
    ...over,
  };
}

export const describeGroup = (over: Partial<GroupDescription> = {}) => (g: EvidenceGroup): GroupDescription => ({
  title: `${g.facets.conditionKey}`,
  summary: `${g.items.length} governed evidence item(s) support this condition.`,
  category: "EXCESS_INVENTORY",
  candidateType: "EXCESS",
  recommendedActionDirection: "Cancel or defer open purchase orders for the affected items.",
  ...over,
});

export interface Fixture {
  db: PrismaClient;
  ctx: DposCompanyContext;
}

/** Create one candidate (3 evidence items) and return its id. */
export async function newCandidate(f: Fixture, opts: { refs?: string[]; over?: Partial<EvidenceItem>; at?: Date; sourceRunId?: string; describe?: Partial<GroupDescription> } = {}): Promise<string> {
  const refs = opts.refs ?? ["1", "2", "3"];
  const r = await ingestGovernedEvidence(f.db, f.ctx, MANAGER, {
    evidence: refs.map((x) => evidence(x, opts.over)),
    sourceRunId: opts.sourceRunId ?? "run-1",
    describe: describeGroup(opts.describe),
    at: opts.at ?? T0,
  });
  return r.groups[0]!.candidateId;
}

export async function presentedCandidate(f: Fixture, opts: Parameters<typeof newCandidate>[1] & { key?: string } = {}): Promise<string> {
  const id = await newCandidate(f, opts.key ? { ...opts, refs: opts.refs ?? [opts.key], over: { ...opts.over, conditionKey: `Condition ${opts.key}` } } : opts);
  await presentCandidate(f.db, f.ctx, MANAGER, id, { at: at(0, 1) });
  return id;
}

export const PLAN = { summary: "Cancel the three oldest open POs and defer the rest by 30 days." } as const;

/** Approved with department only (state Approved and Assigned). */
export async function approvedCandidate(f: Fixture, opts: { key?: string; department?: string; targetStart?: string; targetResolution?: string; baselineExposure?: number } = {}): Promise<string> {
  const id = await presentedCandidate(f, { key: opts.key });
  await approveCandidate(f.db, f.ctx, MANAGER, id, {
    plan: PLAN,
    assignment: { responsibleDepartment: opts.department ?? "Purchasing" },
    targetStart: opts.targetStart ?? dateStr(1),
    targetResolution: opts.targetResolution ?? dateStr(29),
    baselineExposure: opts.baselineExposure,
    exposureUnit: opts.baselineExposure !== undefined ? "USD" : undefined,
    at: at(0, 2),
  });
  return id;
}

/** Approved, owner assigned (Pending Owner Acceptance). */
export async function pendingAcceptanceCandidate(f: Fixture, opts: Parameters<typeof approvedCandidate>[1] & { contributors?: string[]; describe?: Partial<GroupDescription> } = {}): Promise<string> {
  const id = await presentedCandidate(f, { key: opts.key, ...(opts.describe ? { describe: opts.describe } : {}) });
  await approveCandidate(f.db, f.ctx, MANAGER, id, {
    plan: PLAN,
    assignment: {
      responsibleDepartment: opts.department ?? "Purchasing",
      taskOwnerId: OWNER_USER.actorId,
      taskOwnerName: "Olivia Owner",
      contributors: (opts.contributors ?? []).map((userId) => ({ userId })),
    },
    targetStart: opts.targetStart ?? dateStr(1),
    targetResolution: opts.targetResolution ?? dateStr(29),
    baselineExposure: opts.baselineExposure,
    exposureUnit: opts.baselineExposure !== undefined ? "USD" : undefined,
    at: at(0, 2),
  });
  return id;
}

/** Accepted (Active Action, not started). */
export async function acceptedCandidate(f: Fixture, opts: Parameters<typeof pendingAcceptanceCandidate>[1] = {}): Promise<string> {
  const id = await pendingAcceptanceCandidate(f, opts);
  await acceptOwnership(f.db, f.ctx, OWNER_USER, id, { at: at(0, 3) });
  return id;
}

/** Started on day 1 (Active Action, ON_TRACK). */
export async function startedCandidate(f: Fixture, opts: Parameters<typeof pendingAcceptanceCandidate>[1] = {}): Promise<string> {
  const id = await acceptedCandidate(f, opts);
  await startAction(f.db, f.ctx, OWNER_USER, id, { at: at(1) });
  return id;
}

export async function eventTypes(db: PrismaClient, candidateId: string): Promise<string[]> {
  const rows = await db.dposResultsReturnOutbox.findMany({ where: { candidateId }, orderBy: { createdAt: "asc" }, select: { eventType: true } });
  return rows.map((r) => r.eventType);
}

export async function expectCode(promise: Promise<unknown>, code: string): Promise<void> {
  try {
    await promise;
  } catch (e) {
    assert.equal((e as { code?: string }).code, code, `expected ${code}, got ${(e as Error).message}`);
    return;
  }
  assert.fail(`expected ${code} but the call succeeded`);
}
