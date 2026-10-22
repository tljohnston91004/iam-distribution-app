/**
 * Stage 4C closeout (Product Owner decisions D1-D8) integration and pure tests:
 *   D1 company-local Sunday-Saturday persistence      D5 additional emergency review
 *   D2 explicit economic attribution / no double count D6 Trigger C retained exactly
 *   D3 tie-break step 12 (creation timestamp)          D7 explicit UNSCORED / NOT_RANKABLE scoring state
 *   D4 Critical protection from burden-only demotion   D8 immediate display governance vs new-run scoring inputs
 * plus the negative condition-reduction reconfirmation. Pure unit tests of the calculation live in scoring-pure.test.ts.
 * Every database test runs on a throw-away governed-migrated database; the real data/iam.db is never opened.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { PrismaClient } from "@prisma/client";
import {
  authorizeStrategic,
  calculateScore,
  confirmEmergency,
  explainScore,
  lockRank,
  orderItems,
  recordManualTieBreak,
  recordScoringInputs,
  revokeStrategic,
  runScoring,
  setPriorityOverride,
  unlockRank,
  validateScoringInputs,
  type ScoringInputs,
} from "../../src/lib/dpos/scoring";
import { computeConditionReduction, releaseSuppression, suppressCandidate, SYSTEM_ACTOR } from "../../src/lib/dpos/workflow";
import { boundContext, createTestDb, makeConfig, type TestDb } from "./helpers";
import { MANAGER, at, eventTypes, expectCode, presentedCandidate, type Fixture } from "./workflow-helpers";
import { MAX, P41, P80, P86, P89, ZERO, fromPoints, pts, rankItem, scoredCandidate } from "./scoring-helpers";

async function withFixture(fn: (f: Fixture, tdb: TestDb) => Promise<void>): Promise<void> {
  const tdb = await createTestDb();
  try {
    const ctx = await boundContext(tdb.prisma, makeConfig());
    await fn({ db: tdb.prisma, ctx }, tdb);
  } finally {
    await tdb.close();
  }
}

type Payload = Record<string, Record<string, unknown>>;
const payloadsOf = async (db: PrismaClient, candidateId: string, eventType?: string): Promise<Payload[]> =>
  (await db.dposResultsReturnOutbox.findMany({ where: { candidateId, ...(eventType ? { eventType } : {}) }, orderBy: { createdAt: "asc" } })).map((r) => JSON.parse(r.payloadJson) as Payload);
const runAt = (f: Fixture, when: Date, key?: string, ctx = f.ctx) => runScoring(f.db, ctx, MANAGER, { at: when, ...(key ? { runKey: key } : {}) });
const result = (db: PrismaClient, runId: string, candidateId: string) => db.iamCoreScoreResult.findFirstOrThrow({ where: { scoringRunId: runId, candidateId } });
const open = (db: PrismaClient, candidateId: string, reasonCode: string) => db.iamCoreForcedReview.findFirst({ where: { candidateId, reasonCode, status: "OPEN" } });
const occurrenceOf = async (f: Fixture, runId: string, id: string) =>
  ((await explainScore(f.db, f.ctx, id, runId)).breakdown as { operatingWeek: { operatingWeekStart: string; consecutiveQualifiedOccurrences: number } }).operatingWeek;

/** A candidate created at a chosen time (creation order decides which candidate owns a shared economic amount). */
async function scoredCreatedAt(f: Fixture, key: string, inputs: ScoringInputs, created: Date): Promise<string> {
  const id = await presentedCandidate(f, { key, at: created });
  await recordScoringInputs(f.db, f.ctx, SYSTEM_ACTOR, id, inputs, { at: at(0, 5) });
  return id;
}

/** Scoring inputs for P with the cash attribution pointed at a chosen evidence identity. */
function withCashRef(p: Parameters<typeof fromPoints>[0], cashRef: string, over: Partial<ScoringInputs> = {}): ScoringInputs {
  const i = fromPoints(p, over);
  return { ...i, economicAttribution: i.economicAttribution.map((a) => (a.impactType === "CASH_IMPACT" ? { ...a, evidenceRef: cashRef } : a)) };
}

// =====================================================================================================================
describe("4C-D1 company-local Sunday-Saturday persistence (through the governed run)", () => {
  // 2026-10-27 15:00Z = Tuesday in Chicago, week starting Sunday 2026-10-25. at(8) = 2026-11-03 (week 2026-11-01), at(15) = 2026-11-10 (week 2026-11-08).
  it("consecutive local weeks increment; several runs in the same week count once; the week and zone are stored on the run", () =>
    withFixture(async (f) => {
      const id = await scoredCandidate(f, "persist", fromPoints(P80));
      const r1 = await runAt(f, at(1));
      const r1b = await runAt(f, at(3));
      assert.deepEqual(await occurrenceOf(f, r1.scoringRunId, id), { companyTimeZone: "America/Chicago", operatingWeekStart: "2026-10-25", consecutiveQualifiedOccurrences: 1 });
      assert.equal((await occurrenceOf(f, r1b.scoringRunId, id)).consecutiveQualifiedOccurrences, 1, "a second run in the same week is the same occurrence");
      const r2 = await runAt(f, at(8));
      assert.deepEqual(await occurrenceOf(f, r2.scoringRunId, id), { companyTimeZone: "America/Chicago", operatingWeekStart: "2026-11-01", consecutiveQualifiedOccurrences: 2 });
      const r2b = await runAt(f, at(9));
      assert.equal((await occurrenceOf(f, r2b.scoringRunId, id)).consecutiveQualifiedOccurrences, 2);
      const r3 = await runAt(f, at(15));
      assert.equal((await occurrenceOf(f, r3.scoringRunId, id)).consecutiveQualifiedOccurrences, 3);
      const run = await f.db.iamCoreScoringRun.findUniqueOrThrow({ where: { scoringRunId: r3.scoringRunId } });
      assert.equal(run.companyTimeZone, "America/Chicago");
      assert.equal(run.operatingWeekStart, "2026-11-08");
      assert.equal((await result(f.db, r3.scoringRunId, id)).operatingWeekStart, "2026-11-08");
    }));

  it("skipped weeks are neutral (documented rule); a week where the candidate was not qualified breaks the streak", () =>
    withFixture(async (f) => {
      const id = await scoredCandidate(f, "skip", fromPoints(P80));
      await runAt(f, at(1)); // week 10-25
      const r3 = await runAt(f, at(15)); // week 11-08 (week 11-01 had no cycle)
      assert.equal((await occurrenceOf(f, r3.scoringRunId, id)).consecutiveQualifiedOccurrences, 2, "a missed cycle neither counts nor breaks the streak");
      await recordScoringInputs(f.db, f.ctx, SYSTEM_ACTOR, id, fromPoints(P80, { dataConfidence: "INSUFFICIENT" }), { at: at(15, 5) });
      const rBad = await runAt(f, at(22)); // week 11-15: not rankable
      assert.equal((await result(f.db, rBad.scoringRunId, id)).outcome, "EXCLUDED");
      await recordScoringInputs(f.db, f.ctx, SYSTEM_ACTOR, id, fromPoints(P80), { at: at(22, 5) });
      const rBack = await runAt(f, at(29)); // week 11-22
      assert.equal((await occurrenceOf(f, rBack.scoringRunId, id)).consecutiveQualifiedOccurrences, 1, "the unqualified week broke the streak");
    }));

  it("the UTC date does not decide the week: a local Saturday-night run is still that week, and the next local Sunday run is the next occurrence", () =>
    withFixture(async (f) => {
      const id = await scoredCandidate(f, "utc", fromPoints(P80));
      const satNight = new Date("2026-10-31T23:30:00-05:00"); // 2026-11-01T04:30Z: Sunday in UTC, Saturday in Chicago
      const satLater = new Date("2026-10-31T23:55:00-05:00");
      const sunMorning = new Date("2026-11-01T12:00:00Z"); // 06:00 CST after the DST change
      const a = await runAt(f, satNight);
      const b = await runAt(f, satLater);
      const c = await runAt(f, sunMorning);
      assert.equal((await occurrenceOf(f, a.scoringRunId, id)).operatingWeekStart, "2026-10-25");
      assert.equal((await occurrenceOf(f, b.scoringRunId, id)).consecutiveQualifiedOccurrences, 1, "no false persistence across the UTC midnight");
      assert.deepEqual([(await occurrenceOf(f, c.scoringRunId, id)).operatingWeekStart, (await occurrenceOf(f, c.scoringRunId, id)).consecutiveQualifiedOccurrences], ["2026-11-01", 2]);
    }));

  it("two companies in different time zones are in different operating weeks at the same UTC instant", () =>
    withFixture(async (f) => {
      await scoredCandidate(f, "zones", fromPoints(P80));
      const instant = new Date("2026-11-01T03:30:00Z");
      const chicago = await runAt(f, instant, "chi", { ...f.ctx, companyTimeZone: "America/Chicago" });
      const auckland = await runAt(f, new Date(instant.getTime() + 1000), "akl", { ...f.ctx, companyTimeZone: "Pacific/Auckland" });
      const w = async (runId: string) => (await f.db.iamCoreScoringRun.findUniqueOrThrow({ where: { scoringRunId: runId } })).operatingWeekStart;
      assert.equal(await w(chicago.scoringRunId), "2026-10-25");
      assert.equal(await w(auckland.scoringRunId), "2026-11-01");
    }));

  it("a company with no valid IANA time zone is refused (persistence is company-local, never silently UTC)", () =>
    withFixture(async (f) => {
      await scoredCandidate(f, "notz", fromPoints(P80));
      await expectCode(runAt(f, at(1), undefined, { ...f.ctx, companyTimeZone: "Mars/Olympus" }), "COMPANY_TIME_ZONE_REQUIRED");
    }));
});

// =====================================================================================================================
describe("4C-D2 explicit economic attribution: one scoring home per quantified amount", () => {
  it("every quantified amount needs an attribution; the amounts scored are the sums of their attributions", () => {
    const base = fromPoints(P80);
    const { economicAttribution: _omit, ...noAttr } = base;
    const missing = validateScoringInputs(noAttr);
    assert.equal(missing.ok, false);
    assert.ok(missing.issues.some((i) => /economicAttribution: required/.test(i)));
    const mismatched = validateScoringInputs({ ...base, economicAttribution: base.economicAttribution.map((a) => (a.impactType === "CASH_IMPACT" ? { ...a, amount: a.amount + 500 } : a)) });
    assert.equal(mismatched.ok, false);
    assert.ok(mismatched.issues.some((i) => /CASH_IMPACT attributions add up/.test(i)));
    const zero = validateScoringInputs({ ...fromPoints(ZERO), economicAttribution: undefined as never });
    assert.equal(zero.ok, true, "an all-zero candidate has nothing to attribute");
  });

  it("an impact type may only be scored in its own home, and an attribution carries identity, type, home and amount", () => {
    const base = fromPoints(P80);
    const wrongHome = validateScoringInputs({ ...base, economicAttribution: base.economicAttribution.map((a) => (a.impactType === "CASH_IMPACT" ? { ...a, scoringHome: "profitability" as const } : a)) });
    assert.equal(wrongHome.ok, false);
    assert.ok(wrongHome.issues.some((i) => /CASH_IMPACT is scored in cash/.test(i)));
    const noRef = validateScoringInputs({ ...base, economicAttribution: base.economicAttribution.map((a) => ({ ...a, evidenceRef: "" })) });
    assert.equal(noRef.ok, false);
    const twice = validateScoringInputs({ ...base, economicAttribution: [...base.economicAttribution, base.economicAttribution[0]!] });
    assert.equal(twice.ok, false);
    assert.ok(twice.issues.some((i) => /ONE scoring home/.test(i)));
    const ok = validateScoringInputs({ ...base, economicAttribution: base.economicAttribution.map((a) => ({ ...a, candidateRef: "c-1" })), contextualEvidence: [{ evidenceRef: "po-9", influences: ["SEVERITY", "ROOT_CAUSE"] }] });
    assert.equal(ok.ok, true, ok.issues.join("; "));
    const badCtx = validateScoringInputs({ ...base, contextualEvidence: [{ evidenceRef: "po-9", influences: ["CASH"] as never }] });
    assert.equal(badCtx.ok, false);
  });

  it("the same quantified amount is counted ONCE: the later candidate is not scored and a forced review is raised; nothing is double counted", () =>
    withFixture(async (f) => {
      const a = await scoredCreatedAt(f, "first", withCashRef(P80, "po-4471"), at(-5));
      const b = await scoredCreatedAt(f, "second", withCashRef(P41, "po-4471"), at(-2));
      const r = await runAt(f, at(1));
      assert.equal((await result(f.db, r.scoringRunId, a)).outcome, "RANKED");
      const rb = await result(f.db, r.scoringRunId, b);
      assert.equal(rb.outcome, "EXCLUDED");
      assert.equal(rb.exclusionReason, "ECONOMIC_AMOUNT_ALREADY_ATTRIBUTED");
      assert.match(rb.exclusionDetail ?? "", /po-4471\|CASH_IMPACT is already attributed to candidate/);
      assert.ok(await open(f.db, b, "POSSIBLE_DOUBLE_COUNTING"));
      assert.equal(await open(f.db, a, "POSSIBLE_DOUBLE_COUNTING"), null, "the owning candidate is not penalized");
      assert.equal(r.candidatesRanked, 1);
      // the amount is scored once: only the owner has a cash factor from po-4471
      const ex = await explainScore(f.db, f.ctx, a, r.scoringRunId);
      assert.deepEqual((ex.breakdown as { economicAttribution: Array<{ evidenceRef: string }> }).economicAttribution.map((x) => x.evidenceRef).filter((x) => x === "po-4471"), ["po-4471"]);
    }));

  it("the same evidence reused as CONTEXT (severity / root cause) never earns the amount twice", () =>
    withFixture(async (f) => {
      const a = await scoredCandidate(f, "owner", withCashRef(P80, "po-777"));
      const b = await scoredCandidate(f, "context", fromPoints(P41, { contextualEvidence: [{ evidenceRef: "po-777", influences: ["SEVERITY", "ROOT_CAUSE"] }] }));
      const r = await runAt(f, at(1));
      const plain = calculateScore(fromPoints(P41), { persistence: { consecutiveQualifiedOccurrences: 1 } });
      const rb = await result(f.db, r.scoringRunId, b);
      assert.equal(rb.outcome, "RANKED", "context evidence is allowed to overlap");
      assert.equal(rb.domainScore, plain.domainScore, "context influences nothing quantified: the score is the same as without it");
      assert.equal(await open(f.db, b, "POSSIBLE_DOUBLE_COUNTING"), null);
      assert.equal((await result(f.db, r.scoringRunId, a)).outcome, "RANKED");
      const bd = (await explainScore(f.db, f.ctx, b, r.scoringRunId)).breakdown as { contextualEvidence: Array<{ evidenceRef: string; influences: string[] }> };
      assert.deepEqual(bd.contextualEvidence, [{ evidenceRef: "po-777", influences: ["SEVERITY", "ROOT_CAUSE"] }]);
    }));

  it("an attribution naming a different candidate is refused for this one", () =>
    withFixture(async (f) => {
      const id = await scoredCandidate(f, "ref", fromPoints(P80));
      const i = fromPoints(P80);
      await recordScoringInputs(f.db, f.ctx, SYSTEM_ACTOR, id, { ...i, economicAttribution: i.economicAttribution.map((a) => ({ ...a, candidateRef: "some-other-candidate" })) }, { at: at(0, 9) });
      const r = await runAt(f, at(1));
      const row = await result(f.db, r.scoringRunId, id);
      assert.equal(row.exclusionReason, "ECONOMIC_AMOUNT_ALREADY_ATTRIBUTED");
      assert.match(row.exclusionDetail ?? "", /not to this candidate/);
    }));
});

// =====================================================================================================================
describe("4C-D3 tie-break step 12: earlier candidate creation timestamp; id only as the technical fallback", () => {
  const items = (...over: Array<Partial<ReturnType<typeof rankItem>> & { id: string }>) => over.map((o) => rankItem(o.id, 80, {}, { createdAt: o.createdAt ?? "2026-10-01T00:00:00.000Z" }));
  it("two candidates identical through step 11: the EARLIER created one ranks first, whatever the ids", () => {
    const earlyHighId = { id: "zzz", createdAt: "2026-09-01T00:00:00.000Z" };
    const lateLowId = { id: "aaa", createdAt: "2026-10-01T00:00:00.000Z" };
    const r = orderItems(items(lateLowId, earlyHighId), (i) => i.domainScore);
    assert.deepEqual(r.order, ["zzz", "aaa"]);
    assert.equal(r.notes.get("zzz")!.usedDeterministicFallback, false, "decided by the creation timestamp, not the fallback");
    assert.equal(r.notes.get("zzz")!.levelNames.next, "EARLIER_CANDIDATE_CREATION");
  });
  it("exactly identical creation timestamps: the candidate id is the deterministic technical fallback", () => {
    const same = "2026-10-01T00:00:00.000Z";
    const r1 = orderItems(items({ id: "bbb", createdAt: same }, { id: "aaa", createdAt: same }), (i) => i.domainScore);
    const r2 = orderItems(items({ id: "aaa", createdAt: same }, { id: "bbb", createdAt: same }), (i) => i.domainScore);
    assert.deepEqual(r1.order, ["aaa", "bbb"]);
    assert.deepEqual(r2.order, ["aaa", "bbb"], "input order never matters");
    assert.equal(r1.notes.get("aaa")!.usedDeterministicFallback, true);
  });
  it("a recorded manual tie-break is honoured before the id fallback, and never replaces step 12 when timestamps differ", () => {
    const same = "2026-10-01T00:00:00.000Z";
    const manual = orderItems(items({ id: "aaa", createdAt: same }, { id: "bbb", createdAt: same }), (i) => i.domainScore, [["bbb", "aaa"]]);
    assert.deepEqual(manual.order, ["bbb", "aaa"]);
    assert.equal(manual.notes.get("bbb")!.usedManualTieBreak, true);
    const stamped = orderItems(items({ id: "aaa", createdAt: "2026-10-02T00:00:00.000Z" }, { id: "bbb", createdAt: "2026-10-01T00:00:00.000Z" }), (i) => i.domainScore, [["aaa", "bbb"]]);
    assert.deepEqual(stamped.order, ["bbb", "aaa"], "an earlier creation timestamp is decided at step 12, before the manual step is consulted");
  });
  it("through the engine the earlier created candidate wins a full tie", () =>
    withFixture(async (f) => {
      const late = await presentedCandidate(f, { key: "late", at: at(-1) });
      const early = await presentedCandidate(f, { key: "early", at: at(-5) });
      for (const id of [late, early]) await recordScoringInputs(f.db, f.ctx, SYSTEM_ACTOR, id, fromPoints(P80), { at: at(0, 5) });
      const r = await runAt(f, at(1));
      assert.deepEqual(r.ranked.map((x) => x.candidateId), [early, late]);
    }));
});

// =====================================================================================================================
describe("4C-D4 Critical protection through the governed run", () => {
  it("the protected result stores the mathematical score and flag, and publishes them", () =>
    withFixture(async (f) => {
      const id = await scoredCandidate(f, "prot", fromPoints(P86, { modifiers: { executionBurden: "MAJOR_BARRIERS" } }));
      const r = await runAt(f, at(1));
      const row = await result(f.db, r.scoringRunId, id);
      assert.equal(row.domainScore, 85);
      assert.equal(row.mathematicalDomainScore, 82);
      assert.equal(row.priorityBand, "CRITICAL");
      assert.equal(row.rawCoreScore, 86);
      assert.equal(row.cappedModifierTotal, -4);
      assert.equal(row.uncappedModifierTotal, -4);
      assert.deepEqual(JSON.parse(row.scoreFlagsJson ?? "[]"), ["CRITICAL_PROTECTED_FROM_BURDEN_DEMOTION"]);
      const ev = (await payloadsOf(f.db, id, "CANDIDATE_SCORED"))[0]!.recommendation!;
      assert.equal(ev.domainScore, 85);
      assert.equal(ev.mathematicalDomainScore, 82);
      assert.deepEqual(ev.scoreFlags, ["CRITICAL_PROTECTED_FROM_BURDEN_DEMOTION"]);
      const why = (await explainScore(f.db, f.ctx, id)).breakdown as { calculation: { criticalProtection: { reason: string } } };
      assert.match(why.calculation.criticalProtection.reason, /Execution burden alone/);
    }));
});

// =====================================================================================================================
describe("4C-D5 additional emergency review", () => {
  const EM = pts(ZERO, { op: 15, time: 8, cash: 6 }); // Trigger A
  it("one qualifying candidate: a normal emergency review candidate, not additional", () =>
    withFixture(async (f) => {
      const one = await scoredCandidate(f, "one", fromPoints(EM));
      const r = await runAt(f, at(1));
      const row = await result(f.db, r.scoringRunId, one);
      assert.equal(row.emergencyReviewCandidate, true);
      assert.equal(row.additionalEmergencyReviewRequired, false);
      assert.equal(await open(f.db, one, "ADDITIONAL_EMERGENCY"), null);
    }));

  it("two qualifying: the second is marked Additional Emergency Review Required with a forced review; both keep every trigger; none is auto-published or dropped", () =>
    withFixture(async (f) => {
      const one = await scoredCandidate(f, "one", fromPoints(EM));
      const two = await scoredCandidate(f, "two", fromPoints(pts(EM, { cash: 0 })));
      const r = await runAt(f, at(1));
      const rows = await Promise.all([one, two].map((id) => result(f.db, r.scoringRunId, id)));
      assert.equal(rows.filter((x) => x.additionalEmergencyReviewRequired).length, 1);
      assert.ok(rows.every((x) => x.emergencyReviewCandidate), "neither is dropped");
      const extra = rows.find((x) => x.additionalEmergencyReviewRequired)!.candidateId;
      assert.ok(await open(f.db, extra, "ADDITIONAL_EMERGENCY"), "forced management review");
      const reviews = await f.db.iamCoreEmergencyReview.findMany();
      assert.equal(reviews.length, 2);
      assert.ok(reviews.every((x) => x.status === "CANDIDATE" && JSON.parse(x.triggersJson).includes("A")), "every trigger is preserved; nothing is auto-published");
      const ev = (await payloadsOf(f.db, extra, "CANDIDATE_SCORED"))[0]?.recommendation ?? (await payloadsOf(f.db, extra))[0]!.recommendation!;
      assert.equal(ev.additionalEmergencyReviewRequired, true);
      assert.ok((ev.emergencyTriggers as string[]).includes("A"));
      assert.equal((await payloadsOf(f.db, extra)).some((p) => p.recommendation?.emergencyPriority === true), false, "no emergency was published");
    }));

  it("management can later confirm the additional emergency (explicit acknowledgement) and the published emergency state is recorded", () =>
    withFixture(async (f) => {
      const one = await scoredCandidate(f, "one", fromPoints(EM));
      const two = await scoredCandidate(f, "two", fromPoints(pts(EM, { cash: 0 })));
      const r = await runAt(f, at(1));
      const extra = (await result(f.db, r.scoringRunId, one)).additionalEmergencyReviewRequired ? one : two;
      const first = extra === one ? two : one;
      await confirmEmergency(f.db, f.ctx, MANAGER, first, { reason: "Real.", at: at(2) });
      await expectCode(confirmEmergency(f.db, f.ctx, MANAGER, extra, { reason: "Also real.", at: at(3) }), "ADDITIONAL_EMERGENCY_ACKNOWLEDGEMENT_REQUIRED");
      const ok = await confirmEmergency(f.db, f.ctx, MANAGER, extra, { reason: "Also real.", acknowledgeAdditionalEmergency: true, at: at(4) });
      assert.equal(ok.status, "CONFIRMED");
      assert.equal(await open(f.db, extra, "ADDITIONAL_EMERGENCY"), null);
    }));
});

// =====================================================================================================================
describe("4C-D6 Trigger C is kept exactly: Operational Risk >= 12 AND Customer & Revenue >= 8 AND Time Sensitivity >= 6", () => {
  const emergency = (op: number, cu: number, time: number) => calculateScore(fromPoints(pts(ZERO, { op, cu, time })), { persistence: { consecutiveQualifiedOccurrences: 1 } }).emergency;
  it("fires only when all three hold, is an emergency REVIEW candidate only", () => {
    const hit = emergency(12, 8, 6);
    assert.equal(hit.candidate, true);
    assert.deepEqual(hit.triggers, ["C"]);
    for (const [op, cu, time] of [[9, 8, 6], [12, 6, 6], [12, 8, 4], [15, 10, 4]] as const) assert.equal(emergency(op, cu, time).triggers.includes("C"), false, `${op}/${cu}/${time}`);
    assert.equal(emergency(15, 10, 8).triggers.includes("C"), true);
  });
  it("through the run it raises only an emergency review candidate - never a published emergency", () =>
    withFixture(async (f) => {
      const id = await scoredCandidate(f, "c", fromPoints(pts(ZERO, { op: 12, cu: 8, time: 6 })));
      const r = await runAt(f, at(1));
      assert.equal((await result(f.db, r.scoringRunId, id)).emergencyReviewCandidate, true);
      assert.equal((await f.db.iamCoreEmergencyReview.findFirstOrThrow({ where: { candidateId: id } })).status, "CANDIDATE");
      assert.equal((await payloadsOf(f.db, id)).some((p) => p.recommendation?.emergencyPriority === true), false);
    }));
});

// =====================================================================================================================
describe("4C-D7 explicit current scoring state: SCORED / UNSCORED / NOT_RANKABLE", () => {
  it("first scored -> later insufficient confidence publishes an explicit NOT_RANKABLE state (no score, no rank) with the reason; history stays; scored again later", () =>
    withFixture(async (f) => {
      const id = await scoredCandidate(f, "state", fromPoints(P80));
      const r1 = await runAt(f, at(1));
      const first = await result(f.db, r1.scoringRunId, id);
      assert.equal(first.scoringState, "SCORED");
      assert.equal(first.publishedEventType, "CANDIDATE_SCORED");
      assert.equal(first.publishedScoringState, "SCORED");

      await recordScoringInputs(f.db, f.ctx, SYSTEM_ACTOR, id, fromPoints(P80, { dataConfidence: "INSUFFICIENT" }), { at: at(1, 5) });
      const r2 = await runAt(f, at(8));
      const bad = await result(f.db, r2.scoringRunId, id);
      assert.equal(bad.outcome, "EXCLUDED");
      assert.equal(bad.scoringState, "NOT_RANKABLE");
      assert.match(bad.scoringStateReason ?? "", /INSUFFICIENT_DATA_CONFIDENCE/);
      assert.equal(bad.publishedEventType, "SCORING_STATE_CHANGED");
      assert.equal(bad.domainScore, null);
      const ev = (await payloadsOf(f.db, id, "SCORING_STATE_CHANGED"))[0]!.recommendation!;
      assert.equal(ev.scoringState, "NOT_RANKABLE");
      assert.match(String(ev.notRankableReason), /INSUFFICIENT_DATA_CONFIDENCE/);
      for (const k of ["domainScore", "domainRank", "priorityBand", "displayedDomainRank", "uncappedDomainScore"]) assert.equal(ev[k], undefined, `never a fabricated ${k}`);
      // history is immutable: the earlier scored result and its event remain
      assert.equal((await result(f.db, r1.scoringRunId, id)).domainScore, 80);
      assert.equal((await payloadsOf(f.db, id, "CANDIDATE_SCORED")).length, 1);

      // running again with the same state does not republish
      const r2b = await runAt(f, at(9));
      assert.equal((await result(f.db, r2b.scoringRunId, id)).publishedEventType, null);

      await recordScoringInputs(f.db, f.ctx, SYSTEM_ACTOR, id, fromPoints(P80), { at: at(9, 5) });
      const r3 = await runAt(f, at(15));
      const again = await result(f.db, r3.scoringRunId, id);
      assert.equal(again.scoringState, "SCORED");
      assert.equal(again.publishedEventType, "CANDIDATE_SCORED", "scored again later through a new run");
    }));

  it("a previously scored candidate whose economic amount is now owned elsewhere is UNSCORED with the reason (not NOT_RANKABLE)", () =>
    withFixture(async (f) => {
      const owner = await scoredCreatedAt(f, "owner", withCashRef(P89, "po-shared"), at(-5));
      const mover = await scoredCreatedAt(f, "mover", fromPoints(P80), at(-2));
      const r1 = await runAt(f, at(1));
      assert.equal((await result(f.db, r1.scoringRunId, mover)).scoringState, "SCORED");
      await recordScoringInputs(f.db, f.ctx, SYSTEM_ACTOR, mover, withCashRef(P80, "po-shared"), { at: at(1, 5) });
      const r2 = await runAt(f, at(8));
      const row = await result(f.db, r2.scoringRunId, mover);
      assert.equal(row.scoringState, "UNSCORED");
      assert.match(row.scoringStateReason ?? "", /ECONOMIC_AMOUNT_ALREADY_ATTRIBUTED/);
      assert.equal(row.publishedEventType, "SCORING_STATE_CHANGED");
      assert.equal((await payloadsOf(f.db, mover, "SCORING_STATE_CHANGED"))[0]!.recommendation!.scoringState, "UNSCORED");
      assert.equal((await result(f.db, r2.scoringRunId, owner)).scoringState, "SCORED");
    }));

  it("a candidate that was never scored publishes no scoring-state event (there is nothing to clear)", () =>
    withFixture(async (f) => {
      const id = await scoredCandidate(f, "never", fromPoints(P80, { dataConfidence: "INSUFFICIENT" }));
      const r = await runAt(f, at(1));
      const row = await result(f.db, r.scoringRunId, id);
      assert.equal(row.scoringState, "NOT_RANKABLE");
      assert.equal((await payloadsOf(f.db, id, "SCORING_STATE_CHANGED")).length, 0);
    }));
});

// =====================================================================================================================
describe("4C-D8 override timing: immediate display governance vs scoring inputs through a new run", () => {
  it("suppression and suppression release are immediate workflow events (no scoring run needed)", () =>
    withFixture(async (f) => {
      const id = await scoredCandidate(f, "sup", fromPoints(P80));
      await runAt(f, at(1));
      const before = (await eventTypes(f.db, id)).length;
      await suppressCandidate(f.db, f.ctx, MANAGER, id, { reason: "Waiting for the vendor.", at: at(2) });
      assert.ok((await eventTypes(f.db, id)).slice(before).includes("SUPPRESSED"), "published at once");
      const mid = (await eventTypes(f.db, id)).length;
      await releaseSuppression(f.db, f.ctx, MANAGER, id, { reason: "Vendor delivered.", at: at(3) });
      assert.ok((await eventTypes(f.db, id)).length > mid, "the release is published at once");
    }));

  it("a rank lock is immediate: displayed rank published at once; calculated rank and score untouched; the release is immediate too", () =>
    withFixture(async (f) => {
      const a = await scoredCandidate(f, "a", fromPoints(P89));
      const b = await scoredCandidate(f, "b", fromPoints(P80));
      const c = await scoredCandidate(f, "c", fromPoints(P41));
      const r1 = await runAt(f, at(1));
      assert.equal((await result(f.db, r1.scoringRunId, c)).displayedRank, 3);
      const lock = await lockRank(f.db, f.ctx, MANAGER, c, { rank: 1, reason: "Contractual commitment.", at: at(2) });
      assert.ok(lock.events.length >= 1);
      const ev = (await payloadsOf(f.db, c, "DOMAIN_PRIORITY_CHANGED")).at(-1)!.recommendation!;
      assert.equal(ev.displayedDomainRank, 1);
      assert.equal(ev.rankLockActive, true);
      assert.ok(ev.rankLockedUntil);
      assert.equal(ev.domainScore, undefined);
      const stored = await result(f.db, r1.scoringRunId, c);
      assert.equal(stored.displayedRank, 3, "the stored run result is not rewritten");
      assert.equal(stored.calculatedRank, 3);
      assert.equal(stored.domainScore, 41);
      const shifted = await f.db.iamCoreDisplayChange.findMany({ where: { candidateId: { in: [a, b] } } });
      assert.ok(shifted.length >= 1, "the candidates pushed down are published too");

      const unlock = await unlockRank(f.db, f.ctx, MANAGER, c, { reason: "Commitment met.", at: at(3) });
      assert.ok(unlock.events.length >= 1);
      const after = (await payloadsOf(f.db, c, "DOMAIN_PRIORITY_CHANGED")).at(-1)!.recommendation!;
      assert.equal(after.displayedDomainRank, 3);
      assert.equal(after.rankLockActive, false);
    }));

  it("a manual display-priority override (promote / demote) is immediate and does not rewrite the calculated score or rank", () =>
    withFixture(async (f) => {
      const a = await scoredCandidate(f, "a", fromPoints(P80));
      const b = await scoredCandidate(f, "b", fromPoints(P80, { dataConfidence: "MEDIUM" }));
      const r1 = await runAt(f, at(1));
      const set = await setPriorityOverride(f.db, f.ctx, MANAGER, b, { points: 6, reason: "Key customer.", at: at(2) });
      assert.ok(set.events.length >= 1);
      assert.equal((await payloadsOf(f.db, b, "DOMAIN_PRIORITY_CHANGED")).at(-1)!.recommendation!.displayedDomainRank, 1);
      const stored = await result(f.db, r1.scoringRunId, b);
      assert.deepEqual([stored.domainScore, stored.calculatedRank, stored.displayedRank], [76, 2, 2]);
      assert.equal((await result(f.db, r1.scoringRunId, a)).calculatedRank, 1);
    }));

  it("a strategic authorization never mutates the old score; a NEW scoring run applies it", () =>
    withFixture(async (f) => {
      const id = await scoredCandidate(f, "strat", fromPoints(P80));
      const r1 = await runAt(f, at(1));
      const before = await result(f.db, r1.scoringRunId, id);
      const events = (await eventTypes(f.db, id)).length;
      await authorizeStrategic(f.db, f.ctx, MANAGER, id, { level: "IMPORTANT", reason: "Board initiative.", at: at(2) });
      assert.equal((await eventTypes(f.db, id)).length, events, "no immediate score event: it is a scoring input");
      const same = await result(f.db, r1.scoringRunId, id);
      assert.equal(same.domainScore, before.domainScore, "the published score is unchanged");
      const r2 = await runAt(f, at(4)); // same operating week
      const after = await result(f.db, r2.scoringRunId, id);
      assert.ok(after.domainScore! > before.domainScore!, "the new run applies the strategic modifier");
      assert.equal(after.publishedEventType, "CANDIDATE_SCORED");
      assert.equal((await result(f.db, r1.scoringRunId, id)).domainScore, before.domainScore, "the original calculated score history is preserved");
      await revokeStrategic(f.db, f.ctx, MANAGER, id, { reason: "Initiative ended.", at: at(5) });
      assert.equal((await result(f.db, r2.scoringRunId, id)).domainScore, after.domainScore, "revocation also waits for the next run");
    }));

  it("scoring-input changes (confidence, execution burden, benefit uncertainty, factor inputs) only take effect through a new run", () =>
    withFixture(async (f) => {
      const id = await scoredCandidate(f, "inputs", fromPoints(P89));
      const r1 = await runAt(f, at(1));
      const published = (await eventTypes(f.db, id)).length;
      await recordScoringInputs(f.db, f.ctx, SYSTEM_ACTOR, id, fromPoints(P89, { dataConfidence: "LOW", modifiers: { executionBurden: "MAJOR_BARRIERS" } }), { at: at(2) });
      assert.equal((await eventTypes(f.db, id)).length, published, "recording new inputs publishes nothing");
      assert.equal((await result(f.db, r1.scoringRunId, id)).domainScore, 89);
      const r2 = await runAt(f, at(4));
      assert.ok((await result(f.db, r2.scoringRunId, id)).domainScore! < 89);
    }));
});

// =====================================================================================================================
describe("Negative condition reduction is signed and never clamped (reconfirmed)", () => {
  it("100 -> 80 = +20%, 100 -> 100 = 0%, 100 -> 120 = -20%", () => {
    assert.equal(computeConditionReduction(100, 80).pct, 20);
    assert.equal(computeConditionReduction(100, 100).pct, 0);
    const worse = computeConditionReduction(100, 120);
    assert.equal(worse.pct, -20);
    assert.equal(worse.contractPct, -20, "the contract value is not clamped to zero");
    assert.equal(worse.status === "MEASURED" && worse.worseThanBaseline, true);
    assert.equal(computeConditionReduction(100, 1000).pct, -900, "no clamp at any depth of deterioration");
  });
  it("a zero or missing baseline is NOT measurable and produces no percentage", () => {
    for (const baseline of [0, -5, null, undefined, Number.NaN]) {
      const r = computeConditionReduction(baseline as never, 50);
      assert.equal(r.status, "NOT_YET_MEASURED");
      assert.equal(r.pct, null);
      assert.equal(r.contractPct, null);
    }
  });
});

void MAX;
