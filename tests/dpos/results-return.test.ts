import type { PrismaClient } from "@prisma/client";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { after, before, describe, it } from "node:test";
import { validateIamResultsReturn, iamAcknowledgementHttpStatus, type IamResultsReturnAcknowledgement } from "../../src/lib/dpos/contract/iam-results-return";
import type { DposCompanyContext } from "../../src/lib/dpos/company-context";
import { DataHubClient } from "../../src/lib/dpos/data-hub-client";
import { DposError } from "../../src/lib/dpos/errors";
import { FIXTURE_EVENT_TYPES, assertFixturesAllowed, fixtureEvent } from "../../src/lib/dpos/fixtures";
import { correctOutboxEvent, enqueueResultsReturnEvent, flushOutbox, releaseBlockedOutboxEvent, summarizeOutbox, transmitOutboxEvent, backoffMs } from "../../src/lib/dpos/outbox";
import { WorkshopServiceIdentityProvider, issueServiceIdentity, revokeServiceIdentity } from "../../src/lib/dpos/service-identity";
import { boundContext, createTestDb, makeConfig, uuid, type TestDb } from "./helpers";

type Mode = "ok" | "http503" | "network" | "validation" | "config403" | "success-without-ack" | { status: number };

/** A faithful in-memory Data Hub Results Return receiver (idempotent by producerEventId, validates with the shared contract). */
class FakeHub {
  mode: Mode = "ok";
  accepted = new Map<string, string>();
  received: Array<{ producerEventId: string; eventType: string; hash: string; at: number; mode: string; snapshot?: { syncStatus: string; attemptCount: number } | null }> = [];
  constructor(private readonly prisma: PrismaClient) {}

  private ack(p: Partial<IamResultsReturnAcknowledgement>): IamResultsReturnAcknowledgement {
    return {
      accepted: false,
      processingResult: "REJECTED" as never,
      duplicate: false,
      producerEventId: null,
      eventType: null,
      contractId: "IAM_RESULTS_RETURN_V1",
      contractVersion: "1.0.0",
      resultsReturnEventId: null,
      acknowledgementId: null,
      payloadHash: null,
      receivedAt: null,
      rejection: null,
      retryGuidance: "NONE" as never,
      ...p,
    };
  }

  fetchImpl = (async (_url: unknown, init: RequestInit) => {
    const body = String(init.body);
    const payload = JSON.parse(body);
    const id: string = payload.envelope.producerEventId;
    const hash = createHash("sha256").update(body).digest("hex");
    const row = await this.prisma.dposResultsReturnOutbox.findFirst({ where: { producerEventId: id } });
    this.received.push({ producerEventId: id, eventType: payload.envelope.eventType, hash, at: Date.now(), mode: typeof this.mode === "string" ? this.mode : "status", snapshot: row ? { syncStatus: row.syncStatus, attemptCount: row.attemptCount } : null });
    const json = (status: number, b: unknown) => new Response(JSON.stringify(b), { status, headers: { "content-type": "application/json" } });
    const m = this.mode;
    if (m === "network") throw new TypeError("fetch failed");
    if (m === "http503") return json(503, { error: { code: "UNAVAILABLE", message: "down" } });
    if (typeof m === "object") return json(m.status, { error: { code: "X", message: "x" } });
    if (m === "success-without-ack") return json(200, {});
    if (m === "config403") return json(403, { error: { code: "NOT_AUTHORIZED", message: "no" } });
    if (m === "validation") {
      const a = this.ack({
        producerEventId: id,
        eventType: payload.envelope.eventType,
        rejection: { category: "DATA_VALIDATION", reasonCode: "MISSING_REQUIRED_FIELD", message: "recommendation.title is required", issues: [{ path: "recommendation.title", code: "MISSING_REQUIRED_FIELD", message: "required" }] } as never,
        retryGuidance: "CORRECT_AND_RESUBMIT" as never,
      });
      return json(iamAcknowledgementHttpStatus(a), { acknowledgement: a });
    }
    const check = validateIamResultsReturn(payload);
    if (!check.ok) {
      const a = this.ack({ producerEventId: id, rejection: { category: "DATA_VALIDATION", reasonCode: "CONTRACT_INVALID", message: "invalid", issues: check.issues } as never });
      return json(422, { acknowledgement: a });
    }
    const prior = this.accepted.get(id);
    if (prior && prior !== hash) {
      const a = this.ack({ producerEventId: id, rejection: { category: "DATA_VALIDATION", reasonCode: "PAYLOAD_CONFLICT", message: "id reused with a different payload" } as never });
      return json(409, { acknowledgement: a });
    }
    this.accepted.set(id, hash);
    const a = this.ack({
      accepted: true,
      processingResult: (prior ? "IDEMPOTENT_REPLAY" : "ACCEPTED") as never,
      duplicate: !!prior,
      producerEventId: id,
      eventType: payload.envelope.eventType,
      acknowledgementId: "ack-" + id.slice(0, 8),
      resultsReturnEventId: "rr-" + id.slice(0, 8),
      payloadHash: hash,
      receivedAt: new Date().toISOString(),
    });
    return json(prior ? 200 : 201, { acknowledgement: a });
  }) as typeof fetch;
}

async function setup() {
  const t = await createTestDb();
  const base = makeConfig();
  const context = await boundContext(t.prisma, base);
  const identity = await issueServiceIdentity(t.prisma, base, new WorkshopServiceIdentityProvider(), { actor: "op", issuanceKind: "WORKSHOP" });
  const config = makeConfig({ IAM_SERVICE_IDENTITY_ID: identity.identityId });
  const hub = new FakeHub(t.prisma);
  const client = new DataHubClient({ config, identity, fetchImpl: hub.fetchImpl });
  let clock = new Date("2026-10-21T15:00:00Z").getTime();
  const deps = { db: t.prisma, config, context, client, now: () => new Date(clock) };
  return { t, config, context, identity, hub, client, deps, advance: (ms: number) => (clock += ms) };
}

const T0 = new Date("2026-10-21T14:00:00Z");
const open = (db: PrismaClient, id: string) => db.dposResultsReturnOutbox.findFirstOrThrow({ where: { producerEventId: id } });

describe("Results Return producer + outbox", () => {
  it("submits the three controlled fixture events; each is persisted BEFORE it is sent and the acknowledgement is recorded", async () => {
    const s = await setup();
    try {
      const candidateId = uuid();
      const rows = [];
      for (const type of FIXTURE_EVENT_TYPES) rows.push((await enqueueResultsReturnEvent(s.t.prisma, s.context, fixtureEvent(type, candidateId, new Date("2026-10-21T14:00:00Z")))).row);
      // persisted, pending, nothing sent yet
      assert.equal(s.hub.received.length, 0);
      for (const r of rows) {
        assert.equal(r.syncStatus, "PENDING");
        assert.equal(r.attemptCount, 0);
        assert.equal(r.acceptedAt, null);
      }
      assert.deepEqual(rows.map((r) => r.eventType), ["CANDIDATE_CREATED", "ACTION_STATUS_CHANGED", "CLOSEOUT_COMPLETED"]);

      // events of one candidate are sent in order: one per flush
      for (let i = 0; i < 3; i++) await flushOutbox(s.deps);
      assert.deepEqual(s.hub.received.map((r) => r.eventType), ["CANDIDATE_CREATED", "ACTION_STATUS_CHANGED", "CLOSEOUT_COMPLETED"]);
      for (const r of s.hub.received) assert.deepEqual(r.snapshot, { syncStatus: "PENDING", attemptCount: 0 }, "the outbox row existed (pending) when Data Hub received the event");

      for (const r of rows) {
        const done = await open(s.t.prisma, r.producerEventId);
        assert.equal(done.syncStatus, "SYNCED");
        assert.equal(done.attemptCount, 1);
        assert.ok(done.acceptedAt, "accepted timestamp recorded");
        assert.equal(done.acknowledgementId, "ack-" + r.producerEventId.slice(0, 8));
        assert.ok(done.acknowledgementJson);
        assert.equal(done.failureCode, null);
        assert.equal(done.retryEligible, false);
      }
      const summary = await summarizeOutbox(s.t.prisma, s.context.dposCompanyId);
      assert.deepEqual(summary.counts, { SYNCED: 3 });
      const ledger = await s.t.prisma.dposResultsReturnOutboxAttempt.findMany({ where: { kind: "TRANSMISSION" } });
      assert.equal(ledger.length, 3);
      assert.ok(ledger.every((l) => l.outcome === "SYNCED" && l.httpStatus === 201));
    } finally {
      await s.t.close();
    }
  });

  it("producerEventId is a company-unique UUID that is not derived from mutable business fields; one business operation never makes two events", async () => {
    const s = await setup();
    try {
      const same = { eventType: "ACTION_STATUS_CHANGED" as const, candidateId: uuid(), sections: { progress: { actionStatus: "ON_TRACK" } }, at: new Date("2026-10-21T14:00:00Z") };
      const a = (await enqueueResultsReturnEvent(s.t.prisma, s.context, same)).row;
      const b = (await enqueueResultsReturnEvent(s.t.prisma, s.context, same)).row;
      assert.match(a.producerEventId, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
      assert.notEqual(a.producerEventId, b.producerEventId, "identical business fields still get distinct ids (not derived from content)");
      assert.equal(JSON.parse(a.payloadJson).envelope.producerEventId, a.producerEventId);
      // idempotency of ONE operation is by explicit operation key, not by business fields
      const k1 = await enqueueResultsReturnEvent(s.t.prisma, s.context, { ...same, operationKey: "op-1" });
      const k2 = await enqueueResultsReturnEvent(s.t.prisma, s.context, { ...same, operationKey: "op-1" });
      assert.equal(k1.created, true);
      assert.equal(k2.created, false);
      assert.equal(k2.row.producerEventId, k1.row.producerEventId);
      assert.equal(await s.t.prisma.dposResultsReturnOutbox.count({ where: { operationKey: "op-1" } }), 1);
      // the id is unique within the company at the database level
      await assert.rejects(() =>
        s.t.prisma.dposResultsReturnOutbox.create({ data: { ...{ ...a, id: undefined }, id: uuid() } as never }),
      );
    } finally {
      await s.t.close();
    }
  });

  it("a temporary failure leaves the event pending/retryable and every retry reuses the SAME producerEventId and payload — no duplicates", async () => {
    const s = await setup();
    try {
      const { row } = await enqueueResultsReturnEvent(s.t.prisma, s.context, fixtureEvent("CANDIDATE_CREATED", uuid(), new Date("2026-10-21T14:00:00Z")));
      s.hub.mode = "http503";
      const r1 = await transmitOutboxEvent(s.deps, row.id);
      assert.equal(r1.status, "ATTEMPTED");
      let cur = await open(s.t.prisma, row.producerEventId);
      assert.equal(cur.syncStatus, "SYNC_PENDING_RETRY");
      assert.equal(cur.retryEligible, true);
      assert.equal(cur.failureCategory, "TEMPORARY_TECHNICAL");
      assert.equal(cur.attemptCount, 1);
      assert.equal(cur.acceptedAt, null);
      assert.ok(cur.nextAttemptAt && cur.nextAttemptAt.getTime() > s.deps.now().getTime(), "backoff scheduled");

      // not due yet: nothing is sent
      const early = await transmitOutboxEvent(s.deps, row.id);
      assert.deepEqual(early, { status: "SKIPPED", reason: "NOT_DUE", syncStatus: "SYNC_PENDING_RETRY" });

      // network error and a success-without-acknowledgement are both treated as temporary
      s.advance(backoffMs(1, s.config.outbox.retryBaseSeconds, s.config.outbox.retryMaxSeconds) + 1000);
      s.hub.mode = "network";
      await transmitOutboxEvent(s.deps, row.id);
      cur = await open(s.t.prisma, row.producerEventId);
      assert.equal(cur.syncStatus, "SYNC_PENDING_RETRY");
      assert.equal(cur.failureCode, "NETWORK_ERROR");
      s.advance(backoffMs(2, s.config.outbox.retryBaseSeconds, s.config.outbox.retryMaxSeconds) + 1000);
      s.hub.mode = "success-without-ack";
      await transmitOutboxEvent(s.deps, row.id);
      cur = await open(s.t.prisma, row.producerEventId);
      assert.equal(cur.syncStatus, "SYNC_PENDING_RETRY");
      assert.equal(cur.failureCode, "MALFORMED_SUCCESS_RESPONSE");

      s.advance(backoffMs(3, s.config.outbox.retryBaseSeconds, s.config.outbox.retryMaxSeconds) + 1000);
      s.hub.mode = "ok";
      await transmitOutboxEvent(s.deps, row.id);
      cur = await open(s.t.prisma, row.producerEventId);
      assert.equal(cur.syncStatus, "SYNCED");
      assert.equal(cur.attemptCount, 4);

      assert.equal(s.hub.received.length, 4);
      assert.equal(new Set(s.hub.received.map((r) => r.producerEventId)).size, 1, "all four attempts carried the same producerEventId");
      assert.equal(new Set(s.hub.received.map((r) => r.hash)).size, 1, "and the identical payload");
      assert.equal(s.hub.accepted.size, 1, "Data Hub accepted it exactly once");
      assert.equal((await transmitOutboxEvent(s.deps, row.id)).status, "SKIPPED", "an accepted event is never sent again");
      assert.equal(s.hub.received.length, 4);
      assert.equal(backoffMs(1, 30, 3600), 30_000);
      assert.equal(backoffMs(20, 30, 3600), 3_600_000, "backoff is capped");
    } finally {
      await s.t.close();
    }
  });

  it("an idempotent replay acknowledgement (Data Hub already had it) still ends SYNCED", async () => {
    const s = await setup();
    try {
      const { row } = await enqueueResultsReturnEvent(s.t.prisma, s.context, fixtureEvent("CANDIDATE_CREATED", uuid(), T0));
      // Data Hub accepted it but the response was lost -> IAM thinks it failed
      s.hub.mode = "ok";
      await s.hub.fetchImpl("http://x", { method: "POST", body: row.payloadJson });
      s.hub.mode = "network";
      await transmitOutboxEvent(s.deps, row.id);
      s.advance(60_000);
      s.hub.mode = "ok";
      await transmitOutboxEvent(s.deps, row.id);
      const cur = await open(s.t.prisma, row.producerEventId);
      assert.equal(cur.syncStatus, "SYNCED");
      assert.equal(JSON.parse(cur.acknowledgementJson!).duplicate, true);
      assert.equal(s.hub.accepted.size, 1);
    } finally {
      await s.t.close();
    }
  });

  it("a validation failure stops automatic retry and requires correction; correction reuses the same producerEventId", async () => {
    const s = await setup();
    try {
      const { row } = await enqueueResultsReturnEvent(s.t.prisma, s.context, fixtureEvent("CANDIDATE_CREATED", uuid(), T0));
      s.hub.mode = "validation";
      await transmitOutboxEvent(s.deps, row.id);
      let cur = await open(s.t.prisma, row.producerEventId);
      assert.equal(cur.syncStatus, "REJECTED_CORRECTION_REQUIRED");
      assert.equal(cur.failureCategory, "DATA_VALIDATION");
      assert.equal(cur.retryEligible, false);
      assert.equal(cur.manualCorrectionRequired, true);
      assert.equal(cur.nextAttemptAt, null);
      assert.ok(cur.failureIssuesJson?.includes("recommendation.title"));

      // flushing never resends it
      s.advance(3_600_000 * 3);
      s.hub.mode = "ok";
      const before = s.hub.received.length;
      const flush = await flushOutbox(s.deps);
      assert.equal(flush.attempted.length, 0);
      assert.equal(s.hub.received.length, before);
      assert.deepEqual(await transmitOutboxEvent(s.deps, row.id), { status: "SKIPPED", reason: "NOT_ELIGIBLE", syncStatus: "REJECTED_CORRECTION_REQUIRED" });

      // correction: same producerEventId, corrected payload, then sent and accepted
      const original = JSON.parse(cur.payloadJson);
      const fixed = await correctOutboxEvent(s.deps, row.id, { actor: "admin-1", reason: "Title supplied", sections: { subject: original.subject, source: original.source, recommendation: { ...original.recommendation, title: "Corrected title" } } });
      assert.equal(fixed.locallyValid, true);
      assert.equal(fixed.row.producerEventId, row.producerEventId);
      assert.equal(fixed.row.syncStatus, "PENDING");
      await transmitOutboxEvent(s.deps, row.id);
      cur = await open(s.t.prisma, row.producerEventId);
      assert.equal(cur.syncStatus, "SYNCED");
      assert.equal(JSON.parse(cur.payloadJson).recommendation.title, "Corrected title");
      const kinds = (await s.t.prisma.dposResultsReturnOutboxAttempt.findMany({ where: { outboxId: row.id }, orderBy: { attemptNumber: "asc" } })).map((a) => a.kind);
      assert.ok(kinds.includes("CORRECTION") && kinds.includes("TRANSMISSION"), "the correction is in the append-only ledger");
      await assert.rejects(() => correctOutboxEvent(s.deps, row.id, { actor: "a", reason: "again", sections: {} }), (e: unknown) => e instanceof DposError && e.code === "OUTBOX_EVENT_NOT_CORRECTABLE");
    } finally {
      await s.t.close();
    }
  });

  it("a locally invalid event is retained as needing correction and is never sent", async () => {
    const s = await setup();
    try {
      const bad = fixtureEvent("CANDIDATE_CREATED", uuid(), T0);
      (bad.sections!.recommendation as Record<string, unknown>).title = "";
      const r = await enqueueResultsReturnEvent(s.t.prisma, s.context, bad);
      assert.equal(r.locallyValid, false);
      assert.equal(r.row.syncStatus, "REJECTED_CORRECTION_REQUIRED");
      assert.equal(r.row.failureCode, "LOCAL_VALIDATION_FAILED");
      assert.equal(r.row.retryEligible, false);
      await flushOutbox(s.deps);
      assert.equal(s.hub.received.length, 0);
    } finally {
      await s.t.close();
    }
  });

  it("a configuration/system failure retains the event, surfaces it for administrator attention, and does not retry until released", async () => {
    const s = await setup();
    try {
      const { row } = await enqueueResultsReturnEvent(s.t.prisma, s.context, fixtureEvent("CANDIDATE_CREATED", uuid(), T0));
      s.hub.mode = "config403";
      await transmitOutboxEvent(s.deps, row.id);
      let cur = await open(s.t.prisma, row.producerEventId);
      assert.equal(cur.syncStatus, "BLOCKED_ADMIN_ACTION");
      assert.equal(cur.failureCategory, "CONFIGURATION_SYSTEM");
      assert.equal(cur.adminAlertRaised, true);
      assert.equal(cur.retryEligible, false);
      const summary = await summarizeOutbox(s.t.prisma, s.context.dposCompanyId);
      assert.equal(summary.adminAttentionRequired, 1);
      assert.ok(await s.t.prisma.dposAuditEvent.findFirst({ where: { category: "OUTBOX", action: "ADMIN_ATTENTION", subjectId: row.producerEventId } }));

      s.advance(24 * 3_600_000);
      s.hub.mode = "ok";
      assert.equal((await flushOutbox(s.deps)).attempted.length, 0, "blocked events are not auto-retried");
      await releaseBlockedOutboxEvent(s.deps, row.id, { actor: "admin-1", note: "Authorization grant fixed" });
      await transmitOutboxEvent(s.deps, row.id);
      cur = await open(s.t.prisma, row.producerEventId);
      assert.equal(cur.syncStatus, "SYNCED");
      assert.equal(s.hub.accepted.size, 1);
      assert.equal(new Set(s.hub.received.map((r) => r.producerEventId)).size, 1);
    } finally {
      await s.t.close();
    }
  });

  it("a revoked service identity blocks transmission for administrator action WITHOUT contacting Data Hub", async () => {
    const s = await setup();
    try {
      const { row } = await enqueueResultsReturnEvent(s.t.prisma, s.context, fixtureEvent("CANDIDATE_CREATED", uuid(), T0));
      await revokeServiceIdentity(s.t.prisma, s.identity.identityId, { actor: "op", reason: "rotated" });
      await transmitOutboxEvent(s.deps, row.id);
      const cur = await open(s.t.prisma, row.producerEventId);
      assert.equal(cur.syncStatus, "BLOCKED_ADMIN_ACTION");
      assert.equal(cur.failureCode, "SERVICE_IDENTITY_REVOKED");
      assert.equal(s.hub.received.length, 0);
    } finally {
      await s.t.close();
    }
  });

  it("events never silently disappear and an accepted event is final (database-enforced)", async () => {
    const s = await setup();
    try {
      const { row } = await enqueueResultsReturnEvent(s.t.prisma, s.context, fixtureEvent("CANDIDATE_CREATED", uuid(), T0));
      await assert.rejects(() => s.t.prisma.dposResultsReturnOutbox.delete({ where: { id: row.id } }));
      await assert.rejects(() => s.t.prisma.dposResultsReturnOutbox.update({ where: { id: row.id }, data: { producerEventId: uuid() } }), /./, "producerEventId is immutable");
      await transmitOutboxEvent(s.deps, row.id);
      assert.equal((await open(s.t.prisma, row.producerEventId)).syncStatus, "SYNCED");
      await assert.rejects(() => s.t.prisma.dposResultsReturnOutbox.update({ where: { id: row.id }, data: { payloadJson: "{}" } }), /./, "an accepted event cannot be altered");
      await assert.rejects(() => s.t.prisma.dposResultsReturnOutbox.update({ where: { id: row.id }, data: { syncStatus: "PENDING" } }), /./, "an accepted event cannot be reopened");
      await assert.rejects(() => s.t.prisma.dposResultsReturnOutboxAttempt.deleteMany({}), /./, "the attempt ledger is append-only");
      assert.equal(await s.t.prisma.dposResultsReturnOutbox.count(), 1);
    } finally {
      await s.t.close();
    }
  });

  it("only one worker transmits a given event at a time (lease)", async () => {
    const s = await setup();
    try {
      const { row } = await enqueueResultsReturnEvent(s.t.prisma, s.context, fixtureEvent("CANDIDATE_CREATED", uuid(), T0));
      const results = await Promise.all([transmitOutboxEvent(s.deps, row.id), transmitOutboxEvent(s.deps, row.id), transmitOutboxEvent(s.deps, row.id)]);
      assert.equal(results.filter((r) => r.status === "ATTEMPTED").length, 1);
      assert.equal(s.hub.received.length, 1);
    } finally {
      await s.t.close();
    }
  });

  it("an earlier unsynced event holds back the same candidate's later events (order preserved)", async () => {
    const s = await setup();
    try {
      const c = uuid();
      await enqueueResultsReturnEvent(s.t.prisma, s.context, fixtureEvent("CANDIDATE_CREATED", c, new Date("2026-10-21T14:00:00Z")));
      await enqueueResultsReturnEvent(s.t.prisma, s.context, fixtureEvent("ACTION_STATUS_CHANGED", c, new Date("2026-10-21T14:01:00Z")));
      s.hub.mode = "http503";
      const f = await flushOutbox(s.deps);
      assert.equal(f.attempted.length, 1);
      assert.equal(f.heldBehindEarlierEvent, 1);
      assert.deepEqual(s.hub.received.map((r) => r.eventType), ["CANDIDATE_CREATED"]);
    } finally {
      await s.t.close();
    }
  });

  it("an event enqueued inside a caller's transaction commits or rolls back together with the business change", async () => {
    const s = await setup();
    try {
      await assert.rejects(() =>
        s.t.prisma.$transaction(async (tx) => {
          await enqueueResultsReturnEvent(tx, s.context, fixtureEvent("CANDIDATE_CREATED", uuid(), T0));
          throw new Error("business change failed");
        }),
      );
      assert.equal(await s.t.prisma.dposResultsReturnOutbox.count(), 0);
      await s.t.prisma.$transaction(async (tx) => {
        await enqueueResultsReturnEvent(tx, s.context, fixtureEvent("CANDIDATE_CREATED", uuid(), T0));
      });
      assert.equal(await s.t.prisma.dposResultsReturnOutbox.count(), 1);
    } finally {
      await s.t.close();
    }
  });

  it("controlled fixtures are refused in a PRODUCTION environment", () => {
    assert.throws(() => assertFixturesAllowed(makeConfig({ IAM_ENVIRONMENT_CLASS: "PRODUCTION" })), (e: unknown) => e instanceof DposError && e.code === "FIXTURES_NOT_ALLOWED_IN_PRODUCTION");
    assertFixturesAllowed(makeConfig({ IAM_ENVIRONMENT_CLASS: "WORKSHOP" }));
  });

  it("company isolation: another company's context cannot transmit, correct or release this company's events", async () => {
    const s = await setup();
    try {
      const { row } = await enqueueResultsReturnEvent(s.t.prisma, s.context, fixtureEvent("CANDIDATE_CREATED", uuid(), T0));
      const other: DposCompanyContext = { ...s.context, dposCompanyId: uuid() };
      assert.deepEqual(await transmitOutboxEvent({ ...s.deps, context: other }, row.id), { status: "SKIPPED", reason: "NOT_FOUND" });
      await assert.rejects(() => releaseBlockedOutboxEvent({ db: s.t.prisma, context: other }, row.id, { actor: "x", note: "" }), (e: unknown) => e instanceof DposError && e.code === "OUTBOX_EVENT_NOT_FOUND");
      assert.equal(s.hub.received.length, 0);
    } finally {
      await s.t.close();
    }
  });
});
