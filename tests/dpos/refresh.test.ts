import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { nextIamAuthoritativeRefreshAfter } from "../../src/lib/dpos/contract/iam-results-return";
import { DataHubClientError, type InputStatusResponse } from "../../src/lib/dpos/data-hub-client";
import { DposError } from "../../src/lib/dpos/errors";
import { computeDataCurrentThrough, computeNextScheduledRefresh, getRefreshStatus, resolveCompanySchedule, runRefresh, summarizeSources } from "../../src/lib/dpos/refresh";
import { latestOccurrenceAtOrBefore, schedulerTick } from "../../src/lib/dpos/scheduler";
import { boundContext, createTestDb, makeConfig, type TestDb } from "./helpers";

const iso = (d: Date | null) => (d ? d.toISOString() : null);

function status(sources: Array<{ family: string; ref: string | null; availability?: string }>): InputStatusResponse {
  return {
    companyId: "x",
    generatedAt: "2026-10-21T00:00:00.000Z",
    sources: sources.map((s) => ({
      objectFamily: s.family as never,
      availability: (s.availability ?? "AVAILABLE") as never,
      latestSuccessfulRun: s.availability && s.availability !== "AVAILABLE" ? null : { importBatchId: "b-" + s.family, dataSourceId: "ds", status: "SUCCEEDED", receivedAt: "2026-10-20T00:00:00.000Z", sourceRunAt: s.ref },
      freshness: s.ref ? { status: "CURRENT", referenceTimestamp: s.ref } : null,
    })),
  };
}

const GOOD = status([
  { family: "OPEN_PURCHASE_ORDER_LINE", ref: "2026-10-20T00:00:00.000Z" },
  { family: "CUSTOMER_BACKORDER_LINE", ref: "2026-10-18T00:00:00.000Z" },
]);

function stubClient(opts: { status?: InputStatusResponse; fail?: DataHubClientError; hubTz?: string | null } = {}) {
  const calls = { status: 0, sync: 0 };
  return {
    calls,
    client: {
      async getInputStatus() {
        calls.status += 1;
        if (opts.fail) throw opts.fail;
        return opts.status ?? GOOD;
      },
      async getSyncStatus() {
        calls.sync += 1;
        return { refresh: { schedule: opts.hubTz === null ? {} : { timeZone: opts.hubTz ?? "America/Chicago", refreshHourLocal: 2 } } };
      },
    },
  };
}

describe("Sunday 02:00 company-local schedule (pure rules)", () => {
  it("next refresh is Sunday 02:00 local in the company zone, not UTC", () => {
    const from = new Date("2026-10-21T15:00:00Z"); // Wednesday
    assert.equal(iso(nextIamAuthoritativeRefreshAfter(from, "America/Chicago", 2)), "2026-10-25T07:00:00.000Z"); // 02:00 CDT
    assert.equal(iso(nextIamAuthoritativeRefreshAfter(from, "Pacific/Auckland", 2)), "2026-10-24T13:00:00.000Z"); // Sunday 02:00 NZDT is SATURDAY in UTC
    assert.equal(iso(nextIamAuthoritativeRefreshAfter(from, "Asia/Kolkata", 2)), "2026-10-24T20:30:00.000Z");
    assert.equal(iso(nextIamAuthoritativeRefreshAfter(from, "UTC", 2)), "2026-10-25T02:00:00.000Z");
  });

  it("is strictly after the reference instant (at exactly 02:00 the next week is chosen)", () => {
    assert.equal(iso(nextIamAuthoritativeRefreshAfter(new Date("2026-10-25T07:00:00Z"), "America/Chicago", 2)), "2026-11-01T08:00:00.000Z");
  });

  it("DST spring-forward: the non-existent Sunday 02:00 runs at the first instant after the gap", () => {
    // America/Chicago 2026-03-08: 02:00 -> 03:00 CDT (gap). First valid instant = 03:00 CDT = 08:00Z.
    assert.equal(iso(nextIamAuthoritativeRefreshAfter(new Date("2026-03-02T00:00:00Z"), "America/Chicago", 2)), "2026-03-08T08:00:00.000Z");
  });

  it("DST fall-back: an ambiguous local time runs at its FIRST occurrence", () => {
    // America/Chicago 2026-11-01: 01:00-02:00 occurs twice. First = CDT = 06:00Z.
    assert.equal(iso(nextIamAuthoritativeRefreshAfter(new Date("2026-10-26T00:00:00Z"), "America/Chicago", 1)), "2026-11-01T06:00:00.000Z");
    // Pacific/Auckland 2026-04-05: 02:00-03:00 occurs twice. First = NZDT (+13) = 2026-04-04T13:00Z.
    assert.equal(iso(nextIamAuthoritativeRefreshAfter(new Date("2026-03-30T00:00:00Z"), "Pacific/Auckland", 2)), "2026-04-04T13:00:00.000Z");
    // and the standard Sunday 02:00 in Chicago on fall-back day is unambiguous (CST = 08:00Z)
    assert.equal(iso(nextIamAuthoritativeRefreshAfter(new Date("2026-10-26T00:00:00Z"), "America/Chicago", 2)), "2026-11-01T08:00:00.000Z");
  });

  it("a missing or invalid time zone is an explicit failure — never a silent UTC fallback", () => {
    assert.throws(() => nextIamAuthoritativeRefreshAfter(new Date(), "Mars/Olympus", 2), RangeError);
    for (const tz of [null, undefined, ""]) {
      const r = computeNextScheduledRefresh({ companyTimeZone: tz as never }, 2, new Date("2026-10-21T00:00:00Z"));
      assert.equal(r.ok, false);
      assert.equal((r as { status: string }).status, "MISSING");
      assert.match((r as { reason: string }).reason, /UTC is not assumed/);
    }
    const bad = computeNextScheduledRefresh({ companyTimeZone: "Mars/Olympus" }, 2, new Date("2026-10-21T00:00:00Z"));
    assert.equal(bad.ok, false);
    assert.equal((bad as { status: string }).status, "INVALID");
    assert.equal(resolveCompanySchedule({ companyTimeZone: "UTC" }).ok, true);
  });

  it("finds the most recent occurrence at or before a time (used for catch-up)", () => {
    assert.equal(iso(latestOccurrenceAtOrBefore(new Date("2026-10-21T15:00:00Z"), "America/Chicago", 2)), "2026-10-18T07:00:00.000Z");
    assert.equal(iso(latestOccurrenceAtOrBefore(new Date("2026-10-25T07:00:00Z"), "America/Chicago", 2)), "2026-10-25T07:00:00.000Z");
    assert.equal(iso(latestOccurrenceAtOrBefore(new Date("2026-10-25T06:59:59Z"), "America/Chicago", 2)), "2026-10-18T07:00:00.000Z");
  });

  it("data-current-through is the OLDEST reference time among AVAILABLE sources (a missing source never makes it newer)", () => {
    assert.equal(iso(computeDataCurrentThrough(summarizeSources(GOOD))), "2026-10-18T00:00:00.000Z");
    const partial = status([
      { family: "OPEN_PURCHASE_ORDER_LINE", ref: "2026-10-20T00:00:00.000Z" },
      { family: "CUSTOMER_BACKORDER_LINE", ref: null, availability: "NOT_SUPPLIED" },
    ]);
    assert.equal(iso(computeDataCurrentThrough(summarizeSources(partial))), "2026-10-20T00:00:00.000Z");
    assert.equal(computeDataCurrentThrough(summarizeSources(status([{ family: "OPEN_PURCHASE_ORDER_LINE", ref: null, availability: "NO_SUCCESSFUL_RUN" }]))), null);
  });
});

describe("scheduler (Chicago)", () => {
  let t: TestDb;
  const config = makeConfig();
  before(async () => {
    t = await createTestDb();
  });
  after(async () => t.close());

  it("runs a missed occurrence once as catch-up, never twice, then the next Sunday on time", async () => {
    const context = await boundContext(t.prisma, config);
    const { client, calls } = stubClient();
    const deps = (now: string) => ({ db: t.prisma, config, context, client, now: () => new Date(now) });

    const first = await schedulerTick(deps("2026-10-21T15:00:00Z")); // Wednesday: Sunday 18th 02:00 CDT was missed
    assert.equal(first.action, "RAN");
    assert.equal((first as { occurrence: string }).occurrence, "2026-10-18T07:00:00.000Z");
    assert.equal((first as { catchUp: boolean }).catchUp, true);
    assert.equal((await schedulerTick(deps("2026-10-21T15:05:00Z"))).action, "ALREADY_COMPLETE");
    assert.equal((await schedulerTick(deps("2026-10-25T06:59:00Z"))).action, "ALREADY_COMPLETE"); // 01:59 CDT — not due yet
    assert.equal(calls.status, 1, "no second call to Data Hub for an occurrence already served");

    const onTime = await schedulerTick(deps("2026-10-25T07:00:30Z"));
    assert.equal(onTime.action, "RAN");
    assert.equal((onTime as { occurrence: string }).occurrence, "2026-10-25T07:00:00.000Z");
    assert.equal((onTime as { catchUp: boolean }).catchUp, false);
    const result = (onTime as { result: { ok: boolean; nextScheduledRefreshAt: string } }).result;
    assert.equal(result.ok, true);
    assert.equal(result.nextScheduledRefreshAt, "2026-11-01T08:00:00.000Z"); // Sunday 02:00 CST after fall-back

    const attempts = await t.prisma.dposRefreshAttempt.findMany({ where: { trigger: "SCHEDULED_WEEKLY" }, orderBy: { startedAt: "asc" } });
    assert.deepEqual(attempts.map((a) => a.scheduledFor), ["2026-10-18T07:00:00.000Z", "2026-10-25T07:00:00.000Z"]);
    assert.ok(attempts.every((a) => a.status === "SUCCEEDED"));
  });

  it("the occurrence is unique in the database (a concurrent duplicate is refused)", async () => {
    const context = await boundContext(t.prisma, config);
    await assert.rejects(
      () => runRefresh({ db: t.prisma, config, context, client: stubClient().client, now: () => new Date("2026-10-25T07:05:00Z") }, { trigger: "SCHEDULED_WEEKLY", requestedBy: "dup", scheduledFor: "2026-10-25T07:00:00.000Z" }),
      (e: unknown) => e instanceof DposError && e.code === "REFRESH_OCCURRENCE_ALREADY_RUN",
    );
  });
});

describe("scheduler failure handling", () => {
  it("retries a failed occurrence after the wait, then gives up visibly after the maximum attempts", async () => {
    const t = await createTestDb();
    try {
      const config = makeConfig({ IAM_REFRESH_MAX_ATTEMPTS: "2", IAM_REFRESH_RETRY_MINUTES: "15" });
      const context = await boundContext(t.prisma, config);
      const down = stubClient({ fail: new DataHubClientError("TEMPORARY_TECHNICAL", "NETWORK_ERROR", "Data Hub could not be reached") });
      const deps = (now: string) => ({ db: t.prisma, config, context, client: down.client, now: () => new Date(now) });
      const a = await schedulerTick(deps("2026-10-25T07:00:30Z"));
      assert.equal(a.action, "RAN");
      assert.equal((a as { result: { ok: boolean; failureCode: string } }).result.ok, false);
      assert.equal((a as { result: { failureCode: string } }).result.failureCode, "NETWORK_ERROR");
      assert.equal((await schedulerTick(deps("2026-10-25T07:05:00Z"))).action, "RETRY_WAIT");
      const b = await schedulerTick(deps("2026-10-25T07:20:00Z"));
      assert.equal(b.action, "RAN");
      const gaveUp = await schedulerTick(deps("2026-10-25T08:00:00Z"));
      assert.equal(gaveUp.action, "GAVE_UP");
      const attempts = await t.prisma.dposRefreshAttempt.findMany({ where: { trigger: "SCHEDULED_WEEKLY" }, orderBy: { startedAt: "asc" } });
      assert.deepEqual(attempts.map((x) => x.scheduledFor), ["2026-10-25T07:00:00.000Z", "2026-10-25T07:00:00.000Z#2"]);
      assert.ok(attempts.every((x) => x.status === "FAILED" && x.failureCategory === "TEMPORARY_TECHNICAL"), "failures stay visible");
      const state = await t.prisma.dposRefreshState.findFirst();
      assert.equal(state?.lastSuccessAt, null, "a failed run never advances last success");
    } finally {
      await t.close();
    }
  });

  for (const [label, tz, code] of [
    ["invalid", "Mars/Olympus", "TIME_ZONE_INVALID"],
    ["missing", undefined, "TIME_ZONE_MISSING"],
  ] as const) {
    it(`a ${label} company time zone produces an explicit recorded failure, never a UTC run`, async () => {
      const t = await createTestDb();
      try {
        const config = makeConfig({ IAM_COMPANY_TIME_ZONE: tz });
        const context = await boundContext(t.prisma, config);
        const stub = stubClient();
        const deps = (now: string) => ({ db: t.prisma, config, context, client: stub.client, now: () => new Date(now) });
        // a Sunday 02:30 UTC — would have fired if UTC were silently assumed
        const r = await schedulerTick(deps("2026-10-25T02:30:00Z"));
        assert.equal(r.action, "TIME_ZONE_FAILURE");
        assert.equal((r as { code: string }).code, code);
        assert.equal((r as { recorded: boolean }).recorded, true);
        const again = await schedulerTick(deps("2026-10-25T09:00:00Z"));
        assert.equal((again as { recorded: boolean }).recorded, false, "recorded once per UTC day, not flooded");
        assert.equal(stub.calls.status, 0, "Data Hub was never called on a guessed schedule");
        const attempts = await t.prisma.dposRefreshAttempt.findMany();
        assert.equal(attempts.length, 1);
        assert.equal(attempts[0]!.status, "FAILED");
        assert.equal(attempts[0]!.failureCode, code);
        assert.equal(attempts[0]!.scheduledFor, "UNRESOLVED:2026-10-25");
        const st = await getRefreshStatus({ db: t.prisma, config, context });
        assert.equal(st.nextScheduledRefreshAt, null);
        assert.equal(st.scheduleStatus, code.replace("TIME_ZONE_", ""));
        assert.equal(await t.prisma.dposRefreshAttempt.count({ where: { status: "SUCCEEDED" } }), 0);
      } finally {
        await t.close();
      }
    });
  }
});

describe("manual refresh (backend operation)", () => {
  let t: TestDb;
  const config = makeConfig();
  before(async () => {
    t = await createTestDb();
  });
  after(async () => t.close());

  it("requests the latest governed state, records the attempt, retains data-current-through and last IAM refresh, computes the next scheduled refresh — and scores nothing", async () => {
    const context = await boundContext(t.prisma, config);
    const stub = stubClient();
    const r = await runRefresh({ db: t.prisma, config, context, client: stub.client, now: () => new Date("2026-10-21T15:00:00Z") }, { trigger: "MANUAL_REFRESH", requestedBy: "user-7" });
    assert.equal(r.ok, true);
    assert.equal(r.status, "SUCCEEDED");
    assert.equal(r.lastIamRefreshAt, "2026-10-21T15:00:00.000Z");
    assert.equal(r.dataCurrentThrough, "2026-10-18T00:00:00.000Z");
    assert.equal(r.nextScheduledRefreshAt, "2026-10-25T07:00:00.000Z");
    assert.equal(stub.calls.status, 1);
    const attempt = await t.prisma.dposRefreshAttempt.findUnique({ where: { id: r.attemptId } });
    assert.equal(attempt?.trigger, "MANUAL_REFRESH");
    assert.equal(attempt?.requestedBy, "user-7");
    assert.equal(attempt?.operatingPeriodStart, "2026-10-18");
    assert.equal(attempt?.operatingPeriodEnd, "2026-10-24");
    const summary = JSON.parse(attempt!.inputSummaryJson!) as { sources: Array<{ importBatchId: string }> };
    assert.deepEqual(summary.sources.map((s) => s.importBatchId).sort(), ["b-CUSTOMER_BACKORDER_LINE", "b-OPEN_PURCHASE_ORDER_LINE"]);
    // nothing was scored, recommended or ranked
    assert.equal(await t.prisma.recommendation.count(), 0);
    assert.equal(await t.prisma.iamRun.count(), 0);
    assert.equal(await t.prisma.iamCoreCandidate.count(), 0);
    assert.equal(await t.prisma.iamCoreSystemRecommendation.count(), 0);
  });

  it("a failed manual refresh is recorded with its failure category and does not erase the retained state", async () => {
    const context = await boundContext(t.prisma, config);
    const down = stubClient({ fail: new DataHubClientError("CONFIGURATION_SYSTEM", "HTTP_403", "Forbidden", 403) });
    const r = await runRefresh({ db: t.prisma, config, context, client: down.client, now: () => new Date("2026-10-22T10:00:00Z") }, { trigger: "MANUAL_REFRESH", requestedBy: "user-7" });
    assert.equal(r.ok, false);
    assert.equal(r.failureCategory, "CONFIGURATION_SYSTEM");
    assert.equal(r.failureCode, "HTTP_403");
    assert.equal(r.lastIamRefreshAt, "2026-10-21T15:00:00.000Z", "last successful IAM refresh retained");
    assert.equal(r.dataCurrentThrough, "2026-10-18T00:00:00.000Z", "data-current-through retained");
    const st = await getRefreshStatus({ db: t.prisma, config, context, now: () => new Date("2026-10-22T10:00:00Z") });
    assert.equal(st.lastAttemptStatus, "FAILED");
    assert.equal(st.lastSuccessAt, "2026-10-21T15:00:00.000Z");
    assert.equal(st.nextScheduledRefreshAt, "2026-10-25T07:00:00.000Z");
    assert.equal(st.recentAttempts[0]!.status, "FAILED");
  });

  it("refuses a concurrent refresh, and closes an abandoned one explicitly", async () => {
    const context = await boundContext(t.prisma, config);
    await t.prisma.dposRefreshAttempt.create({ data: { dposCompanyId: context.dposCompanyId, trigger: "MANUAL_REFRESH", requestedBy: "x", startedAt: new Date("2026-10-23T10:00:00Z"), status: "STARTED" } });
    await assert.rejects(
      () => runRefresh({ db: t.prisma, config, context, client: stubClient().client, now: () => new Date("2026-10-23T10:05:00Z") }, { trigger: "MANUAL_REFRESH", requestedBy: "y" }),
      (e: unknown) => e instanceof DposError && e.code === "REFRESH_IN_PROGRESS",
    );
    const ok = await runRefresh({ db: t.prisma, config, context, client: stubClient().client, now: () => new Date("2026-10-23T11:00:00Z") }, { trigger: "MANUAL_REFRESH", requestedBy: "y" });
    assert.equal(ok.ok, true);
    const abandoned = await t.prisma.dposRefreshAttempt.findFirst({ where: { failureCode: "ABANDONED" } });
    assert.equal(abandoned?.status, "FAILED");
  });

  it("without a usable time zone a manual refresh still works but reports that no schedule exists", async () => {
    const t2 = await createTestDb();
    try {
      const cfg = makeConfig({ IAM_COMPANY_TIME_ZONE: "Mars/Olympus" });
      const context = await boundContext(t2.prisma, cfg);
      const r = await runRefresh({ db: t2.prisma, config: cfg, context, client: stubClient().client, now: () => new Date("2026-10-21T15:00:00Z") }, { trigger: "MANUAL_REFRESH", requestedBy: "u" });
      assert.equal(r.ok, true);
      assert.equal(r.nextScheduledRefreshAt, null);
      assert.equal(r.scheduleStatus, "INVALID");
      assert.ok(r.warnings.some((w) => w.startsWith("SCHEDULE_INVALID")));
    } finally {
      await t2.close();
    }
  });
});
