/**
 * IAM Results Return producer + outbox (Stage 4A).
 *
 * Rules enforced here (and, where possible, in the database by triggers):
 *   - An event is PERSISTED in the outbox BEFORE any transmission is attempted, and is never deleted.
 *   - producerEventId is a generated UUIDv4, unique per company, never derived from mutable business fields, and is
 *     REUSED by every retry/correction of the same event.
 *   - Temporary failure      -> SYNC_PENDING_RETRY (automatic retry with backoff, same producerEventId and payload).
 *   - Validation failure     -> REJECTED_CORRECTION_REQUIRED (blind retry stopped; correct, then resubmit same id).
 *   - Config / system failure-> BLOCKED_ADMIN_ACTION (event retained, administrator attention raised and audited).
 *   - Accepted (or idempotent replay) -> SYNCED with the acknowledgement reference recorded.
 *   - Events for one candidate are sent in creation order; a later event never overtakes an unsynced earlier one.
 *   - Locally invalid events are persisted as REJECTED_CORRECTION_REQUIRED and are never transmitted.
 */
import { createHash, randomUUID } from "crypto";
import { writeAudit } from "./audit";
import type { DposIntegrationConfig } from "./config";
import type { DposCompanyContext } from "./company-context";
import {
  IAM_ORIGINATING_MODULE,
  IAM_RESULTS_RETURN_CONTRACT_VERSION,
  IAM_RESULTS_RETURN_V1,
  validateIamResultsReturn,
  type IamEventType,
  type IamSubmissionOutcome,
  type IamSyncState,
  type IamValidationIssue,
} from "./contract/iam-results-return";
import type { DataHubClient } from "./data-hub-client";
import { DposError, type Db } from "./errors";
import { IAM_SERVICE_CAPABILITIES, requireServiceIdentity } from "./service-identity";
import type { PrismaClient } from "@prisma/client";

export const PRODUCER_VERSION_DEFAULT = "iam-dpos-integration-4a";

export function sha256(text: string): string {
  return createHash("sha256").update(text).digest("hex");
}

export interface EnqueueInput {
  eventType: IamEventType;
  candidateId: string;
  actionRef?: string | null;
  /** Payload sections besides the envelope. `subject.candidateId` is set from `candidateId`. */
  sections?: Record<string, Record<string, unknown>>;
  /** Optional idempotency key for one business operation: the same key never creates a second event. */
  operationKey?: string | null;
  producerVersion?: string;
  at?: Date;
}

export type OutboxRow = NonNullable<Awaited<ReturnType<Db["dposResultsReturnOutbox"]["findFirst"]>>>;

export interface EnqueueResult {
  row: OutboxRow;
  created: boolean;
  locallyValid: boolean;
  issues?: IamValidationIssue[];
}

/** Build the full contract payload for an event with the supplied producerEventId. */
export function buildPayload(input: EnqueueInput, producerEventId: string, at: Date): Record<string, unknown> {
  const sections = input.sections ?? {};
  const { subject, ...rest } = sections;
  return {
    envelope: {
      contractId: IAM_RESULTS_RETURN_V1,
      contractVersion: IAM_RESULTS_RETURN_CONTRACT_VERSION,
      eventType: input.eventType,
      producerEventId,
      originatingModule: IAM_ORIGINATING_MODULE,
      producerEventAt: at.toISOString(),
      producerVersion: input.producerVersion ?? process.env.IAM_PRODUCER_VERSION ?? PRODUCER_VERSION_DEFAULT,
    },
    subject: { ...(subject ?? {}), candidateId: input.candidateId },
    ...rest,
  };
}

async function monotonicCreatedAt(db: Db, companyId: string, candidateId: string, at: Date): Promise<Date> {
  const latest = await db.dposResultsReturnOutbox.findFirst({
    where: { dposCompanyId: companyId, candidateId },
    orderBy: { createdAt: "desc" },
    select: { createdAt: true },
  });
  return latest && latest.createdAt.getTime() >= at.getTime() ? new Date(latest.createdAt.getTime() + 1) : at;
}

/**
 * Persist an event in the outbox. Does not transmit. May be called inside the caller's transaction (pass the
 * transaction client as `db`) so the business change and its outbound event commit together.
 */
export async function enqueueResultsReturnEvent(
  db: Db,
  context: Pick<DposCompanyContext, "dposCompanyId">,
  input: EnqueueInput,
): Promise<EnqueueResult> {
  const companyId = context.dposCompanyId;
  if (input.operationKey) {
    const existing = await db.dposResultsReturnOutbox.findUnique({
      where: { dposCompanyId_operationKey: { dposCompanyId: companyId, operationKey: input.operationKey } },
    });
    if (existing) return { row: existing, created: false, locallyValid: existing.syncStatus !== "REJECTED_CORRECTION_REQUIRED" || existing.failureCode !== "LOCAL_VALIDATION_FAILED" };
  }
  const at = input.at ?? new Date();
  const producerEventId = randomUUID();
  const payload = buildPayload(input, producerEventId, at);
  const payloadJson = JSON.stringify(payload);
  const validated = validateIamResultsReturn(payload);
  const base = {
    producerEventId,
    dposCompanyId: companyId,
    candidateId: input.candidateId,
    actionRef: input.actionRef ?? null,
    eventType: input.eventType,
    contractId: IAM_RESULTS_RETURN_V1,
    contractVersion: IAM_RESULTS_RETURN_CONTRACT_VERSION,
    operationKey: input.operationKey ?? null,
    payloadJson,
    payloadHash: sha256(payloadJson),
    // Outbox order: a candidate's events are sent in creation order, so createdAt is strictly increasing per candidate
    // even when two events are enqueued within the same millisecond (the payload keeps the business time `at`).
    createdAt: await monotonicCreatedAt(db, companyId, input.candidateId, at),
  };
  if (!validated.ok) {
    const row = await db.dposResultsReturnOutbox.create({
      data: {
        ...base,
        syncStatus: "REJECTED_CORRECTION_REQUIRED",
        failureCategory: "DATA_VALIDATION",
        failureCode: "LOCAL_VALIDATION_FAILED",
        failureReason: validated.issues.map((i) => `${i.path}: ${i.message}`).join("; ").slice(0, 1500),
        failureIssuesJson: JSON.stringify(validated.issues),
        retryEligible: false,
        manualCorrectionRequired: true,
      },
    });
    await db.dposResultsReturnOutboxAttempt.create({
      data: { outboxId: row.id, attemptNumber: 0, kind: "LOCAL_VALIDATION", outcome: "REJECTED_LOCALLY", failureCategory: "DATA_VALIDATION", failureCode: "LOCAL_VALIDATION_FAILED", payloadHash: row.payloadHash, detailJson: JSON.stringify({ issues: validated.issues }) },
    });
    return { row, created: true, locallyValid: false, issues: validated.issues };
  }
  const row = await db.dposResultsReturnOutbox.create({
    data: { ...base, syncStatus: "PENDING", retryEligible: true, nextAttemptAt: at },
  });
  return { row, created: true, locallyValid: true };
}

export interface OutboxDeps {
  /** Must be the PrismaClient (transmission uses short transactions for the lease). */
  db: PrismaClient;
  config: DposIntegrationConfig;
  context: DposCompanyContext;
  client: Pick<DataHubClient, "submitResultsReturnEvent">;
  now?: () => Date;
}

export function backoffMs(attemptCount: number, baseSeconds: number, maxSeconds: number): number {
  const exp = Math.min(Math.max(attemptCount - 1, 0), 30);
  return Math.min(baseSeconds * 2 ** exp, maxSeconds) * 1000;
}

export type TransmitResult =
  | { status: "SKIPPED"; reason: "ALREADY_SYNCED" | "NOT_ELIGIBLE" | "NOT_DUE" | "LEASED" | "NOT_FOUND"; syncStatus?: string }
  | { status: "ATTEMPTED"; syncStatus: IamSyncState; httpStatus: number | null; attemptCount: number; row: OutboxRow };

/** Transmit one outbox event (honours status, due time and a short lease). Never throws for Data Hub problems. */
export async function transmitOutboxEvent(deps: OutboxDeps, outboxId: string, opts: { ignoreSchedule?: boolean } = {}): Promise<TransmitResult> {
  const now = (deps.now ?? (() => new Date()))();
  const { db, config } = deps;
  const row = await db.dposResultsReturnOutbox.findUnique({ where: { id: outboxId } });
  if (!row || row.dposCompanyId !== deps.context.dposCompanyId) return { status: "SKIPPED", reason: "NOT_FOUND" };
  if (row.syncStatus === "SYNCED") return { status: "SKIPPED", reason: "ALREADY_SYNCED", syncStatus: row.syncStatus };
  if (row.syncStatus !== "PENDING" && row.syncStatus !== "SYNC_PENDING_RETRY") {
    return { status: "SKIPPED", reason: "NOT_ELIGIBLE", syncStatus: row.syncStatus };
  }
  if (!opts.ignoreSchedule && row.nextAttemptAt && row.nextAttemptAt.getTime() > now.getTime()) {
    return { status: "SKIPPED", reason: "NOT_DUE", syncStatus: row.syncStatus };
  }

  // Lease: exactly one worker transmits a given event at a time.
  const leased = await db.dposResultsReturnOutbox.updateMany({
    where: {
      id: outboxId,
      syncStatus: { in: ["PENDING", "SYNC_PENDING_RETRY"] },
      OR: [{ leaseUntil: null }, { leaseUntil: { lt: now } }],
    },
    data: { leaseUntil: new Date(now.getTime() + config.outbox.leaseSeconds * 1000) },
  });
  if (leased.count !== 1) return { status: "SKIPPED", reason: "LEASED" };

  const attemptNumber = row.attemptCount + 1;

  // The service identity must be valid for THIS company/installation/environment and hold the write capability.
  try {
    await requireServiceIdentity(db, config, config.serviceIdentity.identityId, IAM_SERVICE_CAPABILITIES.RESULTS_RETURN_WRITE, now);
  } catch (e) {
    const code = e instanceof DposError ? e.code : "SERVICE_IDENTITY_UNAVAILABLE";
    const updated = await db.dposResultsReturnOutbox.update({
      where: { id: outboxId },
      data: {
        attemptCount: attemptNumber,
        lastAttemptAt: now,
        syncStatus: "BLOCKED_ADMIN_ACTION",
        failureCategory: "CONFIGURATION_SYSTEM",
        failureCode: code,
        failureReason: e instanceof Error ? e.message : String(e),
        retryEligible: false,
        adminAlertRaised: true,
        nextAttemptAt: null,
        leaseUntil: null,
      },
    });
    await db.dposResultsReturnOutboxAttempt.create({
      data: { outboxId, attemptNumber, kind: "TRANSMISSION", at: now, outcome: "NOT_SENT_SERVICE_IDENTITY", failureCategory: "CONFIGURATION_SYSTEM", failureCode: code, payloadHash: row.payloadHash },
    });
    await writeAudit(db, { category: "OUTBOX", action: "ADMIN_ATTENTION", outcome: "FAILURE", dposCompanyId: row.dposCompanyId, subjectType: "DposResultsReturnOutbox", subjectId: row.producerEventId, detail: { code } });
    return { status: "ATTEMPTED", syncStatus: "BLOCKED_ADMIN_ACTION", httpStatus: null, attemptCount: attemptNumber, row: updated };
  }

  const result = await deps.client.submitResultsReturnEvent(row.payloadJson);
  const outcome: IamSubmissionOutcome = result.outcome;
  const ack = result.acknowledgement;
  const completedAt = (deps.now ?? (() => new Date()))();

  const data: Record<string, unknown> = {
    attemptCount: attemptNumber,
    lastAttemptAt: now,
    leaseUntil: null,
    syncStatus: outcome.syncState,
  };
  if (outcome.syncState === "SYNCED") {
    const received = ack?.receivedAt ? new Date(ack.receivedAt) : completedAt;
    Object.assign(data, {
      acceptedAt: Number.isNaN(received.getTime()) ? completedAt : received,
      acknowledgementId: ack?.acknowledgementId ?? null,
      acknowledgementJson: ack ? JSON.stringify(ack) : null,
      failureCategory: null,
      failureCode: null,
      failureReason: null,
      failureIssuesJson: null,
      retryEligible: false,
      manualCorrectionRequired: false,
      nextAttemptAt: null,
    });
  } else {
    Object.assign(data, {
      failureCategory: outcome.failureCategory,
      failureCode: outcome.failureReasonCode,
      failureReason: outcome.failureReason,
      failureIssuesJson: ack?.rejection?.issues ? JSON.stringify(ack.rejection.issues) : null,
      retryEligible: outcome.automaticRetry,
      manualCorrectionRequired: outcome.manualCorrectionNeeded,
      adminAlertRaised: row.adminAlertRaised || outcome.adminAlertRequired,
      nextAttemptAt: outcome.automaticRetry ? new Date(completedAt.getTime() + backoffMs(attemptNumber, config.outbox.retryBaseSeconds, config.outbox.retryMaxSeconds)) : null,
    });
  }
  const updated = await db.dposResultsReturnOutbox.update({ where: { id: outboxId }, data });
  await db.dposResultsReturnOutboxAttempt.create({
    data: {
      outboxId,
      attemptNumber,
      kind: "TRANSMISSION",
      at: now,
      httpStatus: result.httpStatus,
      outcome: outcome.syncState,
      failureCategory: outcome.failureCategory,
      failureCode: outcome.failureReasonCode,
      acknowledgementJson: ack ? JSON.stringify(ack) : null,
      durationMs: result.durationMs,
      payloadHash: row.payloadHash,
      detailJson: JSON.stringify({ correlationId: result.correlationId, duplicate: ack?.duplicate ?? false }),
    },
  });
  if (outcome.adminAlertRequired) {
    await writeAudit(db, { category: "OUTBOX", action: "ADMIN_ATTENTION", outcome: "FAILURE", dposCompanyId: row.dposCompanyId, subjectType: "DposResultsReturnOutbox", subjectId: row.producerEventId, detail: { code: outcome.failureReasonCode } });
  }
  return { status: "ATTEMPTED", syncStatus: outcome.syncState, httpStatus: result.httpStatus, attemptCount: attemptNumber, row: updated };
}

export interface FlushResult {
  considered: number;
  attempted: Array<{ producerEventId: string; syncStatus: string }>;
  heldBehindEarlierEvent: number;
}

/** Send due events in order; a candidate's later events wait for its earlier, unsynced events. */
export async function flushOutbox(deps: OutboxDeps, opts: { limit?: number } = {}): Promise<FlushResult> {
  const now = (deps.now ?? (() => new Date()))();
  const limit = opts.limit ?? deps.config.outbox.maxBatch;
  const open = await deps.db.dposResultsReturnOutbox.findMany({
    where: { dposCompanyId: deps.context.dposCompanyId, syncStatus: { not: "SYNCED" } },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    take: 2000,
  });
  const firstPerCandidate = new Map<string, OutboxRow>();
  let held = 0;
  for (const r of open) {
    if (!firstPerCandidate.has(r.candidateId)) firstPerCandidate.set(r.candidateId, r);
    else held += 1;
  }
  const attempted: FlushResult["attempted"] = [];
  for (const r of firstPerCandidate.values()) {
    if (attempted.length >= limit) break;
    if (r.syncStatus !== "PENDING" && r.syncStatus !== "SYNC_PENDING_RETRY") continue;
    if (r.nextAttemptAt && r.nextAttemptAt.getTime() > now.getTime()) continue;
    const t = await transmitOutboxEvent(deps, r.id);
    if (t.status === "ATTEMPTED") attempted.push({ producerEventId: r.producerEventId, syncStatus: t.syncStatus });
  }
  return { considered: open.length, attempted, heldBehindEarlierEvent: held };
}

/**
 * Correct a REJECTED_CORRECTION_REQUIRED event and re-queue it. The producerEventId is REUSED (a rejected event was
 * never accepted, so the id is still free); the previous payload hash is kept in the append-only ledger.
 */
export async function correctOutboxEvent(
  deps: Pick<OutboxDeps, "db" | "context" | "now">,
  outboxId: string,
  input: { actor: string; reason: string; sections: Record<string, Record<string, unknown>> },
): Promise<EnqueueResult> {
  const now = (deps.now ?? (() => new Date()))();
  const row = await deps.db.dposResultsReturnOutbox.findUnique({ where: { id: outboxId } });
  if (!row || row.dposCompanyId !== deps.context.dposCompanyId) throw new DposError("OUTBOX_EVENT_NOT_FOUND", "Unknown outbox event.", 404);
  if (row.syncStatus !== "REJECTED_CORRECTION_REQUIRED") {
    throw new DposError("OUTBOX_EVENT_NOT_CORRECTABLE", `Only events awaiting correction can be corrected (current state ${row.syncStatus}).`, 409);
  }
  if (!input.reason.trim()) throw new DposError("REASON_REQUIRED", "A correction reason is required.", 400);
  const original = JSON.parse(row.payloadJson) as { envelope: Record<string, unknown>; subject: Record<string, unknown> } & Record<string, unknown>;
  const { subject, ...rest } = input.sections;
  const payload = {
    envelope: original.envelope, // same producerEventId and envelope
    subject: { ...(subject ?? original.subject), candidateId: row.candidateId },
    ...rest,
  };
  const payloadJson = JSON.stringify(payload);
  const validated = validateIamResultsReturn(payload);
  const hash = sha256(payloadJson);
  await deps.db.dposResultsReturnOutboxAttempt.create({
    data: { outboxId, attemptNumber: row.attemptCount, kind: "CORRECTION", at: now, outcome: validated.ok ? "CORRECTED_REQUEUED" : "CORRECTION_STILL_INVALID", payloadHash: hash, detailJson: JSON.stringify({ actor: input.actor, reason: input.reason, previousPayloadHash: row.payloadHash }) },
  });
  if (!validated.ok) {
    const updated = await deps.db.dposResultsReturnOutbox.update({
      where: { id: outboxId },
      data: { payloadJson, payloadHash: hash, failureCode: "LOCAL_VALIDATION_FAILED", failureReason: validated.issues.map((i) => `${i.path}: ${i.message}`).join("; ").slice(0, 1500), failureIssuesJson: JSON.stringify(validated.issues) },
    });
    return { row: updated, created: false, locallyValid: false, issues: validated.issues };
  }
  const updated = await deps.db.dposResultsReturnOutbox.update({
    where: { id: outboxId },
    data: { payloadJson, payloadHash: hash, syncStatus: "PENDING", retryEligible: true, manualCorrectionRequired: false, failureCategory: null, failureCode: null, failureReason: null, failureIssuesJson: null, nextAttemptAt: now },
  });
  await writeAudit(deps.db, { category: "OUTBOX", action: "CORRECTED", outcome: "SUCCESS", actor: input.actor, dposCompanyId: row.dposCompanyId, subjectType: "DposResultsReturnOutbox", subjectId: row.producerEventId, detail: { reason: input.reason } });
  return { row: updated, created: false, locallyValid: true };
}

/** Administrator releases a BLOCKED_ADMIN_ACTION event after fixing the configuration; it is retried with the same id. */
export async function releaseBlockedOutboxEvent(
  deps: Pick<OutboxDeps, "db" | "context" | "now">,
  outboxId: string,
  input: { actor: string; note: string },
): Promise<OutboxRow> {
  const now = (deps.now ?? (() => new Date()))();
  const row = await deps.db.dposResultsReturnOutbox.findUnique({ where: { id: outboxId } });
  if (!row || row.dposCompanyId !== deps.context.dposCompanyId) throw new DposError("OUTBOX_EVENT_NOT_FOUND", "Unknown outbox event.", 404);
  if (row.syncStatus !== "BLOCKED_ADMIN_ACTION") {
    throw new DposError("OUTBOX_EVENT_NOT_BLOCKED", `Only blocked events can be released (current state ${row.syncStatus}).`, 409);
  }
  const updated = await deps.db.dposResultsReturnOutbox.update({
    where: { id: outboxId },
    data: { syncStatus: "SYNC_PENDING_RETRY", retryEligible: true, nextAttemptAt: now, adminAlertRaised: false },
  });
  await deps.db.dposResultsReturnOutboxAttempt.create({
    data: { outboxId, attemptNumber: row.attemptCount, kind: "ADMIN_RELEASE", at: now, outcome: "RELEASED", detailJson: JSON.stringify({ actor: input.actor, note: input.note }) },
  });
  await writeAudit(deps.db, { category: "OUTBOX", action: "ADMIN_RELEASED", outcome: "SUCCESS", actor: input.actor, dposCompanyId: row.dposCompanyId, subjectType: "DposResultsReturnOutbox", subjectId: row.producerEventId, detail: { note: input.note } });
  return updated;
}

/** Operator view of the outbox (what the later "Data Hub Sync" drill-down reads). */
export async function summarizeOutbox(db: Db, companyId: string) {
  const rows = await db.dposResultsReturnOutbox.findMany({ where: { dposCompanyId: companyId }, orderBy: { createdAt: "desc" }, take: 200 });
  const counts: Record<string, number> = {};
  for (const r of rows) counts[r.syncStatus] = (counts[r.syncStatus] ?? 0) + 1;
  return {
    counts,
    adminAttentionRequired: rows.filter((r) => r.syncStatus === "BLOCKED_ADMIN_ACTION").length,
    correctionRequired: rows.filter((r) => r.syncStatus === "REJECTED_CORRECTION_REQUIRED").length,
    events: rows.map((r) => ({
      producerEventId: r.producerEventId,
      candidateId: r.candidateId,
      actionRef: r.actionRef,
      eventType: r.eventType,
      createdAt: r.createdAt.toISOString(),
      attemptCount: r.attemptCount,
      lastAttemptAt: r.lastAttemptAt?.toISOString() ?? null,
      nextAttemptAt: r.nextAttemptAt?.toISOString() ?? null,
      syncStatus: r.syncStatus,
      failureCategory: r.failureCategory,
      failureCode: r.failureCode,
      failureReason: r.failureReason,
      retryEligible: r.retryEligible,
      manualCorrectionRequired: r.manualCorrectionRequired,
      adminAlertRaised: r.adminAlertRaised,
      acceptedAt: r.acceptedAt?.toISOString() ?? null,
      acknowledgementId: r.acknowledgementId,
    })),
  };
}
