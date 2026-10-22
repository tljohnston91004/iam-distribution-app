/**
 * Stage 4C integration tests: governed scoring runs, ranking, Top 2, ties, emergency review, forced reviews, overrides,
 * rank locks, strategic authorization, suppression, rejection, Results Return publication and database guards.
 * Every test runs on a throw-away governed-migrated database; the real data/iam.db is never opened.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import { DatabaseSync } from "node:sqlite";
import type { PrismaClient } from "@prisma/client";
import { legacyFingerprint, legacyTableNames } from "../../src/lib/dpos/migrate/governed-migrate";
import {
  SCORING_CONFIG,
  SCORING_VERSION,
  authorizeStrategic,
  clearEmergency,
  configHash,
  confirmEmergency,
  declineEmergency,
  explainScore,
  getScoringRun,
  lockRank,
  recordManualTieBreak,
  recordScoringInputs,
  resolveForcedReview,
  revokePriorityOverride,
  revokeStrategic,
  routeToDataInvestigation,
  runScoring,
  setPriorityOverride,
  unlockRank,
} from "../../src/lib/dpos/scoring";
import {
  SYSTEM_ACTOR,
  decidePause,
  ingestGovernedEvidence,
  presentCandidate,
  reassign,
  rejectCandidate,
  requestPause,
  returnForReview,
  riskAcceptCandidate,
  suppressCandidate,
} from "../../src/lib/dpos/workflow";
import { REPO_ROOT, boundContext, createTestDb, makeConfig, type TestDb } from "./helpers";
import { ADMIN, MANAGER, OWNER_USER, VIEWER, at, describeGroup, evidence, eventTypes, expectCode, presentedCandidate, startedCandidate, type Fixture } from "./workflow-helpers";
import { P41, P80, P89, ZERO, fromPoints, pts, scoredCandidate } from "./scoring-helpers";

async function withFixture(fn: (f: Fixture, tdb: TestDb) => Promise<void>): Promise<void> {
  const tdb = await createTestDb();
  try {
    const ctx = await boundContext(tdb.prisma, makeConfig());
    await fn({ db: tdb.prisma, ctx }, tdb);
  } finally {
    await tdb.close();
  }
}

function sqlThrows(file: string, sql: string, re: RegExp): void {
  const raw = new DatabaseSync(file);
  try {
    assert.throws(() => raw.exec(sql), re, sql);
  } finally {
    raw.close();
  }
}

type Payload = Record<string, Record<string, unknown>>;
const payloadsOf = async (db: PrismaClient, candidateId: string, eventType?: string): Promise<Payload[]> =>
  (await db.dposResultsReturnOutbox.findMany({ where: { candidateId, ...(eventType ? { eventType } : {}) }, orderBy: { createdAt: "asc" } })).map((r) => JSON.parse(r.payloadJson) as Payload);
const outboxCount = (db: PrismaClient) => db.dposResultsReturnOutbox.count();
const run = (f: Fixture, day: number, over: { runKey?: string; actor?: typeof MANAGER } = {}) => runScoring(f.db, f.ctx, over.actor ?? MANAGER, { runKey: over.runKey, at: at(day) });
const result = (db: PrismaClient, runId: string, candidateId: string) => db.iamCoreScoreResult.findFirstOrThrow({ where: { scoringRunId: runId, candidateId } });
/** The stored explanation of a result, parsed. */
const bj = (row: { breakdownJson: string | null }) => JSON.parse(row.breakdownJson ?? "{}");
const open = (db: PrismaClient, candidateId: string, reasonCode: string) => db.iamCoreForcedReview.findFirst({ where: { candidateId, reasonCode, status: "OPEN" } });

// =====================================================================================================================
describe("SCORING RUN: governed, versioned, deterministic, idempotent", () => {
  it("scores and ranks the open candidates with one stored version and configuration", () =>
    withFixture(async (f, tdb) => {
      const c89 = await scoredCandidate(f, "k89", fromPoints(P89));
      const c80 = await scoredCandidate(f, "k80", fromPoints(P80));
      const c41 = await scoredCandidate(f, "k41", fromPoints(P41));
      const legacyBefore = legacyFingerprint(tdb.file, legacyTableNames(REPO_ROOT));
      const r = await run(f, 1, { runKey: "wk-43" });
      assert.equal(r.replayed, false);
      assert.equal(r.scoringVersion, SCORING_VERSION);
      assert.equal(r.candidatesConsidered, 3);
      assert.equal(r.candidatesRanked, 3);
      assert.deepEqual(r.ranked.map((x) => [x.candidateId, x.domainScore, x.priorityBand, x.calculatedRank]), [[c89, 89, "CRITICAL", 1], [c80, 80, "HIGH", 2], [c41, 41, "WATCH", 3]]);
      assert.deepEqual(r.top2, [c89, c80]);
      assert.deepEqual(r.criticalOutsideTop2, []);

      const run0 = await f.db.iamCoreScoringRun.findUniqueOrThrow({ where: { scoringRunId: r.scoringRunId } });
      assert.equal(run0.status, "FINALIZED");
      assert.equal(run0.scoringVersion, "IAM_PRIORITY_SCORING_V1");
      assert.equal(run0.configHash, configHash());
      assert.deepEqual(JSON.parse(run0.configJson).factorMax, SCORING_CONFIG.factorMax, "the full configuration is snapshotted in the run");
      assert.equal(run0.requestedBy, MANAGER.actorId);
      assert.equal(run0.runKey, "wk-43");

      // the calculation is explainable from the stored record alone
      const why = await explainScore(f.db, f.ctx, c80);
      assert.equal(why.scoringVersion, SCORING_VERSION);
      const calc = (why.breakdown as { calculation: { factors: Record<string, { score: number }>; rawCoreScore: number; modifiers: Record<string, unknown>; operationOrder: string[] } }).calculation;
      assert.equal(calc.rawCoreScore, 80);
      assert.equal(calc.factors.cash!.score, 30);
      assert.equal(Object.keys(calc.modifiers).length, 6);
      assert.ok(calc.operationOrder.length >= 5);
      assert.ok((why.tieBreak as { values: unknown }).values, "tie-break values are stored");

      // legacy V1.5 tables are never touched
      assert.deepEqual(legacyFingerprint(tdb.file, legacyTableNames(REPO_ROOT)), legacyBefore);
      // the original system recommendation is unchanged: IAM scoring never rewrites what was recommended
      const rec = await f.db.iamCoreSystemRecommendation.findFirstOrThrow({ where: { candidateId: c80 } });
      assert.equal(rec.domainScore, null);
    }));

  it("a repeated run key returns the stored run: no second run, no duplicate results, no duplicate events", () =>
    withFixture(async (f) => {
      await scoredCandidate(f, "a", fromPoints(P89));
      await scoredCandidate(f, "b", fromPoints(P80));
      const first = await run(f, 1, { runKey: "wk-43" });
      const outbox = await outboxCount(f.db);
      const again = await run(f, 2, { runKey: "wk-43" });
      assert.equal(again.replayed, true);
      assert.equal(again.scoringRunId, first.scoringRunId);
      assert.deepEqual(again.top2, first.top2);
      assert.equal(await f.db.iamCoreScoringRun.count(), 1);
      assert.equal(await f.db.iamCoreScoreResult.count(), 2);
      assert.equal(await outboxCount(f.db), outbox);
      await expectCode(runScoring(f.db, f.ctx, MANAGER, { runKey: "   " }), "RUN_KEY_INVALID");
    }));

  it("is deterministic: the same stored inputs give the same scores and ranks, and an unchanged state publishes nothing new", () =>
    withFixture(async (f) => {
      const ids = [await scoredCandidate(f, "a", fromPoints(P89)), await scoredCandidate(f, "b", fromPoints(P80)), await scoredCandidate(f, "c", fromPoints(P41))];
      const r1 = await run(f, 1);
      const events = await outboxCount(f.db);
      const r2 = await run(f, 2);
      assert.notEqual(r2.scoringRunId, r1.scoringRunId);
      assert.deepEqual(r2.ranked.map((x) => [x.candidateId, x.domainScore, x.calculatedRank, x.displayedRank]), r1.ranked.map((x) => [x.candidateId, x.domainScore, x.calculatedRank, x.displayedRank]));
      assert.equal(await outboxCount(f.db), events, "nothing changed, so nothing is published again");
      assert.equal(r2.events.length, 0);
      for (const id of ids) {
        const a = await result(f.db, r1.scoringRunId, id);
        const b = await result(f.db, r2.scoringRunId, id);
        assert.equal(a.domainScore, b.domainScore);
        assert.equal(bj(a).calculation.rawCoreScore, bj(b).calculation.rawCoreScore);
      }
      assert.equal((await f.db.iamCoreScoreResult.count()), 6, "every run stores a result per candidate (history is preserved)");
    }));

  it("records exclusions: no inputs, assigned/active actions, invalid facts and insufficient confidence are never ranked", () =>
    withFixture(async (f) => {
      const ranked = await scoredCandidate(f, "ranked", fromPoints(P80));
      const noInputs = await presentedCandidate(f, { key: "noinputs" });
      const active = await startedCandidate(f, { key: "active" });
      await recordScoringInputs(f.db, f.ctx, SYSTEM_ACTOR, active, fromPoints(P89));
      const insufficient = await scoredCandidate(f, "thin", fromPoints(P80, { dataConfidence: "INSUFFICIENT" }));
      const r = await run(f, 1);
      assert.equal(r.candidatesConsidered, 4);
      assert.equal(r.candidatesRanked, 1);
      assert.equal(r.candidatesExcluded, 3);
      const reason = (id: string) => r.excluded.find((e) => e.candidateId === id)?.reason;
      assert.equal(reason(noInputs), "NO_SCORING_INPUTS");
      assert.equal(reason(active), "NOT_A_NEW_CANDIDATE");
      assert.equal(reason(insufficient), "INSUFFICIENT_DATA_CONFIDENCE");
      assert.deepEqual(r.top2, [ranked]);
      const stored = await result(f.db, r.scoringRunId, active);
      assert.equal(stored.outcome, "EXCLUDED");
      assert.equal(stored.domainScore, null);
      assert.equal(stored.calculatedRank, null);
      assert.match(stored.exclusionDetail ?? "", /assigned\/active/);
    }));

  it("only the IAM system or management may run scoring or record inputs; a name or email is never an identity", () =>
    withFixture(async (f) => {
      const id = await presentedCandidate(f, { key: "x" });
      await expectCode(runScoring(f.db, f.ctx, OWNER_USER), "SYSTEM_OR_MANAGEMENT_REQUIRED");
      await expectCode(runScoring(f.db, f.ctx, VIEWER), "SYSTEM_OR_MANAGEMENT_REQUIRED");
      await expectCode(recordScoringInputs(f.db, f.ctx, OWNER_USER, id, fromPoints(P80)), "SYSTEM_OR_MANAGEMENT_REQUIRED");
      await expectCode(runScoring(f.db, f.ctx, { actorId: "Morgan Manager", role: "MANAGER" }), "STABLE_USER_ID_REQUIRED");
      await expectCode(runScoring(f.db, f.ctx, { actorId: "morgan@example.com", role: "MANAGER" }), "STABLE_USER_ID_REQUIRED");
      await expectCode(recordScoringInputs(f.db, f.ctx, { actorId: "Morgan Manager", role: "MANAGER" }, id, fromPoints(P80)), "STABLE_USER_ID_REQUIRED");
      await expectCode(setPriorityOverride(f.db, f.ctx, { actorId: "morgan@example.com", role: "MANAGER" }, id, { points: 3, reason: "x" }), "STABLE_USER_ID_REQUIRED");
      assert.equal((await run(f, 1, { actor: ADMIN })).candidatesConsidered, 1, "a stable id is accepted");
    }));

  it("scoring inputs: invalid facts are refused with every issue, identical facts are not re-versioned, a closed candidate is never rescored", () =>
    withFixture(async (f) => {
      const id = await presentedCandidate(f, { key: "inp" });
      const err = await recordScoringInputs(f.db, f.ctx, SYSTEM_ACTOR, id, { ...fromPoints(P80), operationalRisk: "HUGE", surprise: 1 }).catch((e) => e as { code: string; details?: { issues: string[] } });
      assert.equal((err as { code: string }).code, "SCORING_INPUTS_INVALID");
      assert.ok(((err as { details?: { issues: string[] } }).details?.issues ?? []).length >= 2);
      const inp80 = fromPoints(P80);
      const v1 = await recordScoringInputs(f.db, f.ctx, SYSTEM_ACTOR, id, inp80, { at: at(0, 6) });
      const same = await recordScoringInputs(f.db, f.ctx, SYSTEM_ACTOR, id, inp80, { at: at(0, 7) });
      assert.equal(v1.inputVersion, 1);
      assert.equal(same.unchanged, true);
      assert.equal(same.inputId, v1.inputId);
      const v2 = await recordScoringInputs(f.db, f.ctx, SYSTEM_ACTOR, id, fromPoints(P89), { at: at(0, 8) });
      assert.equal(v2.inputVersion, 2);
      assert.equal(await f.db.iamCoreScoringInput.count({ where: { candidateId: id } }), 2, "every version is kept");
      const r = await run(f, 1);
      assert.equal(r.ranked[0]!.domainScore, 89, "the latest stored version is scored");
      await rejectCandidate(f.db, f.ctx, MANAGER, id, { reason: "Not now.", at: at(1, 5) });
      await expectCode(recordScoringInputs(f.db, f.ctx, SYSTEM_ACTOR, id, fromPoints(P41)), "CLOSED_CANDIDATE_NO_REOPEN");
      const after = await run(f, 2);
      assert.equal(after.candidatesConsidered, 0, "a closed candidate is no longer in the scoring pool");
    }));
});

// =====================================================================================================================
describe("RESULTS RETURN publication of score and rank", () => {
  it("publishes CANDIDATE_SCORED once per changed result, with the contract fields, a deterministic operation key and a stable id", () =>
    withFixture(async (f) => {
      const a = await scoredCandidate(f, "a", fromPoints(P89, { dataConfidence: "MEDIUM" }));
      const b = await scoredCandidate(f, "b", fromPoints(P80));
      const r = await run(f, 1);
      assert.equal(r.events.length, 2);
      assert.ok(r.events.every((e) => e.eventType === "CANDIDATE_SCORED"));
      const pa = (await payloadsOf(f.db, a, "CANDIDATE_SCORED"))[0]!.recommendation!;
      assert.equal(pa.domainScore, 84.55);
      assert.equal(pa.domainRank, 1);
      assert.equal(pa.displayedDomainRank, 1);
      assert.equal(pa.priorityBand, "HIGH", "84.55 is just under the Critical edge");
      assert.equal(pa.scoreVersion, SCORING_VERSION);
      assert.equal(pa.scoringRunId, r.scoringRunId);
      assert.equal(pa.dataConfidence, "MEDIUM");
      assert.equal(pa.confidenceMultiplier, 0.95);
      assert.equal(pa.rawCoreScore, 89);
      assert.equal(pa.confidenceAdjustedCoreScore, 84.55);
      assert.deepEqual(Object.keys(pa.factorScores as object).sort(), ["actionability", "cash", "customerRevenue", "inventoryExposure", "operationalRisk", "profitability", "timeSensitivity"]);
      assert.equal(pa.top2Qualified, true);
      assert.equal(typeof pa.scoredAt, "string");
      assert.equal(((await payloadsOf(f.db, b, "CANDIDATE_SCORED"))[0]!.recommendation as { domainRank: number }).domainRank, 2);

      const rows = await f.db.dposResultsReturnOutbox.findMany({ where: { eventType: "CANDIDATE_SCORED" } });
      const stored = await f.db.iamCoreScoreResult.findMany({ where: { scoringRunId: r.scoringRunId } });
      for (const row of rows) {
        const res = stored.find((s) => s.candidateId === row.candidateId)!;
        assert.equal(row.operationKey, `sc4c:CANDIDATE_SCORED:${res.scoreResultId}`);
        assert.equal(row.syncStatus, "PENDING", "valid against the Results Return contract locally");
        assert.equal(res.publishedOutboxId, row.id);
        assert.equal(res.publishedEventType, "CANDIDATE_SCORED");
      }
      assert.equal(await f.db.dposResultsReturnOutbox.count({ where: { syncStatus: "REJECTED_CORRECTION_REQUIRED" } }), 0);
      // no person is identified by name or email anywhere in what was published
      const all = (await f.db.dposResultsReturnOutbox.findMany()).map((x) => x.payloadJson).join("\n");
      assert.doesNotMatch(all, /Morgan Manager|@example\.com/);
    }));

  it("a later change publishes a new CANDIDATE_SCORED and the earlier results and events stay as they were (history is immutable)", () =>
    withFixture(async (f, tdb) => {
      const a = await scoredCandidate(f, "a", fromPoints(P80));
      const r1 = await run(f, 1);
      const first = await result(f.db, r1.scoringRunId, a);
      await recordScoringInputs(f.db, f.ctx, SYSTEM_ACTOR, a, fromPoints(P89), { at: at(2) });
      const r2 = await run(f, 8);
      assert.equal(r2.events.length, 1);
      const events = await payloadsOf(f.db, a, "CANDIDATE_SCORED");
      assert.equal(events.length, 2);
      assert.equal((events[0]!.recommendation as { domainScore: number }).domainScore, 80);
      assert.equal((events[1]!.recommendation as { domainScore: number }).domainScore, 90, "89 plus the +1 persistence of a second weekly cycle");
      const again = await f.db.iamCoreScoreResult.findUniqueOrThrow({ where: { scoreResultId: first.scoreResultId } });
      assert.equal(again.domainScore, 80, "the historical result is untouched");
      sqlThrows(tdb.file, `UPDATE iam_core_score_results SET domain_score = 1 WHERE score_result_id = '${first.scoreResultId}'`, /IAM_CORE_LEDGER_APPEND_ONLY/);
    }));
});

// =====================================================================================================================
describe("PERSISTENCE across weekly cycles (engine integration)", () => {
  it("earns +1, +2, ... in consecutive weekly cycles, never twice in one week, and is broken by an excluded week", () =>
    withFixture(async (f) => {
      const a = await scoredCandidate(f, "a", fromPoints(P41));
      const persistence = async (runId: string) => (bj(await result(f.db, runId, a)).calculation.modifiers.persistence as { value: number }).value;
      const w0 = await run(f, 1);
      const w0b = await run(f, 2); // same week: still occurrence 1
      const w1 = await run(f, 8);
      const w2 = await run(f, 15);
      assert.equal(await persistence(w0.scoringRunId), 0);
      assert.equal(await persistence(w0b.scoringRunId), 0);
      assert.equal(await persistence(w1.scoringRunId), 1);
      assert.equal(await persistence(w2.scoringRunId), 2);
      assert.equal((await result(f.db, w2.scoringRunId, a)).domainScore, 43);
      // an excluded week (insufficient confidence) breaks the streak
      await recordScoringInputs(f.db, f.ctx, SYSTEM_ACTOR, a, fromPoints(P41, { dataConfidence: "INSUFFICIENT" }), { at: at(16) });
      await run(f, 22);
      await recordScoringInputs(f.db, f.ctx, SYSTEM_ACTOR, a, fromPoints(P41), { at: at(23) });
      const w4 = await run(f, 29);
      assert.equal(await persistence(w4.scoringRunId), 0, "the streak starts again");
    }));

  it("does not apply to a suppressed candidate", () =>
    withFixture(async (f) => {
      const a = await scoredCandidate(f, "a", fromPoints(P41));
      await run(f, 1);
      await suppressCandidate(f.db, f.ctx, MANAGER, a, { reason: "Waiting for the vendor.", at: at(2) });
      const w1 = await run(f, 8);
      const m = bj(await result(f.db, w1.scoringRunId, a)).calculation.modifiers.persistence as { value: number; applied: boolean };
      assert.equal(m.value, 0);
      assert.equal(m.applied, false);
    }));
});

// =====================================================================================================================
describe("TOP 2 through the engine", () => {
  it("two qualified, one qualified, none qualified; the Top 2 is never filled with a candidate under 70", () =>
    withFixture(async (f) => {
      const a = await scoredCandidate(f, "a", fromPoints(P89));
      const b = await scoredCandidate(f, "b", fromPoints(P80));
      const c = await scoredCandidate(f, "c", fromPoints(pts(P80, { cash: 12, prof: 6, inv: 6 }))); // 80 - 12 - 6 - 6 = 56
      const two = await run(f, 1);
      assert.deepEqual(two.top2, [a, b]);
      assert.equal((await result(f.db, two.scoringRunId, c)).top2Qualified, false);

      await recordScoringInputs(f.db, f.ctx, SYSTEM_ACTOR, b, fromPoints(P41), { at: at(2) });
      const one = await run(f, 8);
      assert.deepEqual(one.top2, [a], "a single qualified candidate: the second slot stays empty");

      await recordScoringInputs(f.db, f.ctx, SYSTEM_ACTOR, a, fromPoints(P41), { at: at(9) });
      const none = await run(f, 15);
      assert.deepEqual(none.top2, []);
      assert.equal(none.ranked.length, 3, "everything is still scored and ranked");
    }));

  it("assigned/active actions are excluded from the new-candidate Top 2 and the next qualified new candidate takes the slot", () =>
    withFixture(async (f) => {
      const active = await startedCandidate(f, { key: "active" });
      await recordScoringInputs(f.db, f.ctx, SYSTEM_ACTOR, active, fromPoints(P89));
      const a = await scoredCandidate(f, "a", fromPoints(P80));
      const r = await run(f, 2);
      assert.deepEqual(r.top2, [a]);
      assert.equal(r.excluded.find((e) => e.candidateId === active)?.reason, "NOT_A_NEW_CANDIDATE");
    }));

  it("a suppressed candidate is scored and ranked but never enters the Top 2", () =>
    withFixture(async (f) => {
      const a = await scoredCandidate(f, "a", fromPoints(P89));
      const b = await scoredCandidate(f, "b", fromPoints(P80));
      await suppressCandidate(f.db, f.ctx, MANAGER, a, { reason: "Waiting for the vendor.", at: at(0, 8) });
      const r = await run(f, 1);
      assert.equal(r.ranked.find((x) => x.candidateId === a)?.calculatedRank, 1);
      assert.deepEqual(r.top2, [b]);
      assert.equal((await result(f.db, r.scoringRunId, a)).top2Qualified, false);
    }));
});

// =====================================================================================================================
describe("TIES through the engine", () => {
  it("equal scores are separated by the approved sequence and the level used is stored", () =>
    withFixture(async (f) => {
      const hiCash = await scoredCandidate(f, "hicash", fromPoints({ cash: 24, prof: 15, inv: 15, op: 9, cu: 6, time: 8, act: 3 })); // 80
      const loCash = await scoredCandidate(f, "locash", fromPoints({ cash: 18, prof: 15, inv: 15, op: 12, cu: 6, time: 10, act: 4 })); // 80 again
      const r = await run(f, 1);
      assert.equal(r.ranked.find((x) => x.candidateId === hiCash)!.domainScore, r.ranked.find((x) => x.candidateId === loCash)!.domainScore);
      assert.deepEqual(r.ranked.map((x) => x.candidateId), [hiCash, loCash]);
      const tie = (await explainScore(f.db, f.ctx, hiCash)).tieBreak as { calculated: { separatedFromNextAt: number; levelNames: { next: string } } };
      assert.equal(tie.calculated.separatedFromNextAt, 1);
      assert.equal(tie.calculated.levelNames.next, "CASH_IMPACT_SCORE");
    }));

  it("scores within 0.5 points are a tie even though the displayed scores differ (76.0 vs 75.7)", () =>
    withFixture(async (f) => {
      const higherScore = await scoredCandidate(f, "hs", fromPoints(P80, { dataConfidence: "MEDIUM" })); // 76.00
      const betterCash = await scoredCandidate(f, "bc", fromPoints(P89, { dataConfidence: "LOW" })); // 75.65 -> 75.7
      const r = await run(f, 1);
      const byId = new Map(r.ranked.map((x) => [x.candidateId, x]));
      assert.equal(byId.get(higherScore)!.domainScore, 76);
      assert.equal(byId.get(betterCash)!.displayScore, 75.7);
      assert.deepEqual(r.ranked.map((x) => x.candidateId), [betterCash, higherScore], "tied: cash and expected cash are level, so Time Sensitivity (10 vs 8) decides");
    }));

  it("steps 1-12 leave candidates level: the earlier-created candidate wins (step 12); without it the id fallback is flagged", () =>
    withFixture(async (f) => {
      const earlier = await presentedCandidate(f, { key: "e", at: at(-3) } as never);
      const later = await presentedCandidate(f, { key: "l" });
      await recordScoringInputs(f.db, f.ctx, SYSTEM_ACTOR, later, fromPoints(P80));
      await recordScoringInputs(f.db, f.ctx, SYSTEM_ACTOR, earlier, fromPoints(P80));
      const r = await run(f, 1);
      assert.equal(r.ranked[0]!.calculatedRank, 1);
      assert.equal(r.ranked.length, 2);
      const tie = (await explainScore(f.db, f.ctx, r.ranked[0]!.candidateId)).tieBreak as { calculated: { separatedFromNextAt: number } };
      assert.ok([12, 14].includes(tie.calculated.separatedFromNextAt), `decided at level ${tie.calculated.separatedFromNextAt}`);
    }));

  it("a manual tie-break needs a management actor, a reason and genuinely tied candidates; it takes effect IMMEDIATELY on the displayed order and never rewrites the calculated rank", () =>
    withFixture(async (f) => {
      const a = await scoredCandidate(f, "a", fromPoints(P80));
      const b = await scoredCandidate(f, "b", fromPoints(P80));
      const clear = await scoredCandidate(f, "far", fromPoints(P41));
      await expectCode(recordManualTieBreak(f.db, f.ctx, MANAGER, { candidateIds: [a, b], reason: "Before any run" }), "NOT_A_TIE");
      const r1 = await run(f, 1);
      const [first, second] = r1.ranked.slice(0, 2).map((x) => x.candidateId) as [string, string];
      await expectCode(recordManualTieBreak(f.db, f.ctx, OWNER_USER, { candidateIds: [second, first], reason: "Operator" }), "MANAGEMENT_AUTHORIZATION_REQUIRED");
      await expectCode(recordManualTieBreak(f.db, f.ctx, MANAGER, { candidateIds: [second, first], reason: "  " }), "REASON_REQUIRED");
      await expectCode(recordManualTieBreak(f.db, f.ctx, MANAGER, { candidateIds: [second, clear], reason: "Not tied" }), "NOT_A_TIE");
      await expectCode(recordManualTieBreak(f.db, f.ctx, MANAGER, { candidateIds: [second], reason: "One" }), "TIE_BREAK_CANDIDATES_INVALID");
      const tb = await recordManualTieBreak(f.db, f.ctx, MANAGER, { candidateIds: [second, first], reason: "Customer commitment", at: at(2) });
      assert.equal(tb.entries.length, 2);
      const rows = await f.db.iamCorePriorityGovernance.findMany({ where: { actionType: "MANUAL_TIEBREAK" } });
      assert.equal(rows.length, 2);
      assert.ok(rows.every((x) => x.actorId === MANAGER.actorId && x.reason === "Customer commitment" && x.batchId === tb.batchId));
      // 4C-D8: published immediately, in the same transaction - before any new scoring run.
      assert.ok(tb.events.length >= 1, "the governed tie-break published a displayed-priority event at once");
      const change = await f.db.iamCoreDisplayChange.findFirstOrThrow({ where: { candidateId: second }, orderBy: { createdAt: "desc" } });
      assert.equal((JSON.parse(change.stateJson) as { displayedRank: number }).displayedRank, 1);
      assert.equal((await result(f.db, r1.scoringRunId, second)).displayedRank, 2, "the calculated run history is immutable");
      const r2 = await run(f, 4); // same operating week: persistence does not change the score
      assert.deepEqual([...r2.ranked].sort((x, y) => x.displayedRank - y.displayedRank).slice(0, 2).map((x) => x.candidateId), [second, first]);
      assert.equal(r2.ranked.find((x) => x.candidateId === first)!.calculatedRank, 1, "the calculated rank is pure calculation: a management tie-break never rewrites it");
      assert.equal((await result(f.db, r2.scoringRunId, second)).publishedEventType, null, "the next run does not republish what was already published immediately");
      const note = (await explainScore(f.db, f.ctx, second)).tieBreak as { effective: { usedManualTieBreak: boolean } };
      assert.equal(note.effective.usedManualTieBreak, true);
      // the calculated scores are the same: only the displayed order was decided by management
      assert.equal(r2.ranked[0]!.domainScore, r2.ranked[1]!.domainScore);    }));
});

// =====================================================================================================================
describe("EMERGENCY REVIEW (candidate only; management confirms; separate from Top 2)", () => {
  const EMERGENCY_A = pts(ZERO, { op: 15, time: 8, cash: 6 }); // 29 points: far below the Top 2

  it("a scoring run only flags a candidate; no emergency exists until management confirms, and the score is unchanged", () =>
    withFixture(async (f) => {
      const high = await scoredCandidate(f, "high", fromPoints(P89));
      const em = await scoredCandidate(f, "em", fromPoints(EMERGENCY_A));
      const r = await run(f, 1);
      assert.deepEqual(r.emergencyReviewCandidates, [em]);
      const review = await f.db.iamCoreEmergencyReview.findFirstOrThrow({ where: { candidateId: em } });
      assert.equal(review.status, "CANDIDATE");
      assert.deepEqual(JSON.parse(review.triggersJson), ["A"]);
      const stored = await result(f.db, r.scoringRunId, em);
      assert.equal(stored.emergencyReviewCandidate, true);
      assert.equal(stored.domainScore, 29, "an emergency flag never inflates the score");
      const ev = (await payloadsOf(f.db, em, "CANDIDATE_SCORED"))[0]!.recommendation!;
      assert.equal(ev.emergencyReviewCandidate, true);
      assert.equal(ev.emergencyPriority, undefined, "not an emergency yet");
      assert.ok(Array.isArray(ev.emergencyReviewReasons));
      // separate from the Top 2: the emergency candidate is not in it, and the real Top 2 is not displaced
      assert.deepEqual(r.top2, [high]);
      assert.equal(await f.db.iamCoreEmergencyReview.count({ where: { status: "CONFIRMED" } }), 0);
    }));

  it("management confirms (published immediately as DOMAIN_PRIORITY_CHANGED with emergencyPriority), declines, or clears", () =>
    withFixture(async (f) => {
      const em = await scoredCandidate(f, "em", fromPoints(EMERGENCY_A));
      await expectCode(confirmEmergency(f.db, f.ctx, MANAGER, em, { reason: "Before a review exists" }), "NO_EMERGENCY_REVIEW");
      await run(f, 1);
      await expectCode(confirmEmergency(f.db, f.ctx, OWNER_USER, em, { reason: "Operator" }), "MANAGEMENT_AUTHORIZATION_REQUIRED");
      await expectCode(confirmEmergency(f.db, f.ctx, MANAGER, em, { reason: " " }), "REASON_REQUIRED");
      const before = await outboxCount(f.db);
      const c = await confirmEmergency(f.db, f.ctx, MANAGER, em, { reason: "Supplier shutdown is real.", at: at(2) });
      assert.equal(c.status, "CONFIRMED");
      assert.equal(await outboxCount(f.db), before + 1, "published at once, without waiting for the next run");
      const ev = (await payloadsOf(f.db, em, "DOMAIN_PRIORITY_CHANGED")).at(-1)!.recommendation!;
      assert.equal(ev.emergencyPriority, true);
      assert.equal(ev.priorityOverrideBy, MANAGER.actorId);
      assert.equal(ev.priorityOverrideReason, "Supplier shutdown is real.");
      const gov = await f.db.iamCorePriorityGovernance.findFirstOrThrow({ where: { candidateId: em, actionType: "EMERGENCY_CONFIRMED" } });
      assert.equal(gov.actorId, MANAGER.actorId);
      await expectCode(confirmEmergency(f.db, f.ctx, MANAGER, em, { reason: "Again" }), "NO_EMERGENCY_REVIEW");
      await clearEmergency(f.db, f.ctx, MANAGER, em, { reason: "Resolved.", at: at(3) });
      assert.equal(((await payloadsOf(f.db, em, "DOMAIN_PRIORITY_CHANGED")).at(-1)!.recommendation as { emergencyPriority: boolean }).emergencyPriority, false);
      assert.equal((await f.db.iamCoreEmergencyReview.findFirstOrThrow({ where: { candidateId: em } })).status, "CLEARED");

      const other = await scoredCandidate(f, "other", fromPoints(EMERGENCY_A));
      await run(f, 8);
      await declineEmergency(f.db, f.ctx, MANAGER, other, { reason: "Not an emergency after review.", at: at(9) });
      assert.equal((await f.db.iamCoreEmergencyReview.findFirstOrThrow({ where: { candidateId: other } })).status, "DECLINED");
      assert.equal(((await payloadsOf(f.db, other, "DOMAIN_PRIORITY_CHANGED")).at(-1)!.recommendation as { emergencyPriority: boolean }).emergencyPriority, false);
    }));

  it("normally one published emergency: a second is flagged Additional Emergency Review Required with a forced management review, and needs an explicit acknowledgement to publish", () =>
    withFixture(async (f) => {
      const one = await scoredCandidate(f, "one", fromPoints(EMERGENCY_A));
      const two = await scoredCandidate(f, "two", fromPoints(pts(EMERGENCY_A, { cash: 0 })));
      const r = await run(f, 1);
      assert.deepEqual(r.emergencyReviewCandidates.sort(), [one, two].sort());
      const flagged = await f.db.iamCoreEmergencyReview.findMany({ where: { additionalEmergency: true } });
      assert.equal(flagged.length, 1, "the additional emergency is marked");
      const extra = flagged[0]!.candidateId;
      const first = extra === one ? two : one;
      assert.ok(await open(f.db, extra, "ADDITIONAL_EMERGENCY"), "extra emergencies force a review (never silently suppressed)");
      await confirmEmergency(f.db, f.ctx, MANAGER, first, { reason: "The first one is real.", at: at(2) });
      assert.equal((await result(f.db, r.scoringRunId, extra)).additionalEmergencyReviewRequired, true, "marked Additional Emergency Review Required");
      assert.equal((await result(f.db, r.scoringRunId, first)).additionalEmergencyReviewRequired, false);
      assert.equal((await result(f.db, r.scoringRunId, extra)).emergencyReviewCandidate, true, "never dropped");
      await expectCode(confirmEmergency(f.db, f.ctx, MANAGER, extra, { reason: "Second", at: at(3) }), "ADDITIONAL_EMERGENCY_ACKNOWLEDGEMENT_REQUIRED");
      const ok = await confirmEmergency(f.db, f.ctx, MANAGER, extra, { reason: "Second is also real.", acknowledgeAdditionalEmergency: true, at: at(4) });
      assert.equal(ok.status, "CONFIRMED");
      assert.equal(await open(f.db, extra, "ADDITIONAL_EMERGENCY"), null, "the emergency decision resolves the forced review");
    }));
});

// =====================================================================================================================
describe("CRITICAL OUTSIDE THE TOP 2 forces a review", () => {
  const C1 = fromPoints(P89); // 89
  const C2 = fromPoints(pts(P89, { act: 3 })); // 88
  const C3 = fromPoints(pts(P89, { act: 1 })); // 86

  it("raises a forced review, flags the result and the published event, and never lets it pass silently", () =>
    withFixture(async (f) => {
      await scoredCandidate(f, "c1", C1);
      await scoredCandidate(f, "c2", C2);
      const c3 = await scoredCandidate(f, "c3", C3);
      const r = await run(f, 1);
      assert.deepEqual(r.criticalOutsideTop2, [c3]);
      const review = await open(f.db, c3, "CRITICAL_OUTSIDE_TOP2");
      assert.ok(review);
      assert.equal(r.forcedReviews.length, 1);
      const stored = await result(f.db, r.scoringRunId, c3);
      assert.equal(stored.criticalOutsideTop2, true);
      assert.equal(stored.forcedReviewRequired, true);
      assert.equal(stored.priorityBand, "CRITICAL");
      const ev = (await payloadsOf(f.db, c3, "CANDIDATE_SCORED"))[0]!.recommendation!;
      assert.equal(ev.criticalOutsideTop2, true);
      assert.equal(ev.forcedReviewRequired, true);
      assert.match(String(ev.forcedReviewReason), /CRITICAL_OUTSIDE_TOP2/);
      // a still-open review is not duplicated by the next run
      await run(f, 8);
      assert.equal(await f.db.iamCoreForcedReview.count({ where: { candidateId: c3, reasonCode: "CRITICAL_OUTSIDE_TOP2" } }), 1);
    }));

  it("resolves only through management review, emergency evaluation, documented demotion or risk acceptance", () =>
    withFixture(async (f) => {
      await scoredCandidate(f, "c1", C1);
      await scoredCandidate(f, "c2", C2);
      const c3 = await scoredCandidate(f, "c3", C3);
      await run(f, 1);
      const review = (await open(f.db, c3, "CRITICAL_OUTSIDE_TOP2"))!;
      await expectCode(resolveForcedReview(f.db, f.ctx, OWNER_USER, review.reviewId, { basis: "MANAGEMENT_REVIEWED", reason: "x" }), "MANAGEMENT_AUTHORIZATION_REQUIRED");
      await expectCode(resolveForcedReview(f.db, f.ctx, MANAGER, review.reviewId, { basis: "MANAGEMENT_REVIEWED", reason: " " }), "REASON_REQUIRED");
      await expectCode(resolveForcedReview(f.db, f.ctx, MANAGER, review.reviewId, { basis: "EMERGENCY_EVALUATED", reason: "No emergency decision exists" }), "EMERGENCY_NOT_EVALUATED");
      await expectCode(resolveForcedReview(f.db, f.ctx, MANAGER, review.reviewId, { basis: "DOCUMENTED_DEMOTION", reason: "No demotion recorded" }), "NO_DOCUMENTED_DEMOTION");
      await expectCode(resolveForcedReview(f.db, f.ctx, MANAGER, review.reviewId, { basis: "MADE_UP" as never, reason: "x" }), "RESOLUTION_BASIS_INVALID");
      await resolveForcedReview(f.db, f.ctx, MANAGER, review.reviewId, { basis: "MANAGEMENT_REVIEWED", reason: "Reviewed: remains a Critical issue behind the Top 2.", at: at(2) });
      const done = await f.db.iamCoreForcedReview.findUniqueOrThrow({ where: { reviewId: review.reviewId } });
      assert.equal(done.status, "RESOLVED");
      assert.equal(done.resolvedBy, MANAGER.actorId);
      await expectCode(resolveForcedReview(f.db, f.ctx, MANAGER, review.reviewId, { basis: "MANAGEMENT_REVIEWED", reason: "again" }), "FORCED_REVIEW_NOT_OPEN");
      const next = await run(f, 8);
      assert.equal(await open(f.db, c3, "CRITICAL_OUTSIDE_TOP2"), null, "a review management already resolved is not reopened while the issue stays Critical");
      assert.equal(next.forcedReviews.length, 0);
    }));

  it("a documented demotion (negative override) resolves it at the next run; the calculated score stays Critical", () =>
    withFixture(async (f) => {
      await scoredCandidate(f, "c1", C1);
      await scoredCandidate(f, "c2", C2);
      const c3 = await scoredCandidate(f, "c3", C3);
      await run(f, 1);
      await setPriorityOverride(f.db, f.ctx, MANAGER, c3, { points: -6, reason: "Mitigated by a temporary supplier; demoted with the Board's agreement.", at: at(2) });
      const r2 = await run(f, 8);
      assert.equal(await open(f.db, c3, "CRITICAL_OUTSIDE_TOP2"), null);
      const resolved = await f.db.iamCoreForcedReview.findFirstOrThrow({ where: { candidateId: c3, reasonCode: "CRITICAL_OUTSIDE_TOP2" } });
      assert.equal(resolved.resolutionBasis, "DOCUMENTED_DEMOTION");
      const stored = await result(f.db, r2.scoringRunId, c3);
      assert.equal(stored.domainScore, 87, "the calculated score (86 + 1 persistence) is preserved beside the override");
      assert.equal(stored.effectiveScore, 81);
    }));

  it("risk acceptance (closing the candidate with a documented decision) resolves it", () =>
    withFixture(async (f) => {
      await scoredCandidate(f, "c1", C1);
      await scoredCandidate(f, "c2", C2);
      const c3 = await scoredCandidate(f, "c3", C3);
      await run(f, 1);
      await riskAcceptCandidate(f.db, f.ctx, MANAGER, c3, { reason: "Accepted: insured and cost-prohibitive to fix this year.", at: at(2) });
      await run(f, 8);
      assert.equal(await open(f.db, c3, "CRITICAL_OUTSIDE_TOP2"), null);
      const row = await f.db.iamCoreForcedReview.findFirstOrThrow({ where: { candidateId: c3, reasonCode: "CRITICAL_OUTSIDE_TOP2" } });
      assert.equal(row.resolutionBasis, "CANDIDATE_CLOSED_BY_DECISION");
    }));

  it("an emergency evaluation resolves it too", () =>
    withFixture(async (f) => {
      await scoredCandidate(f, "c1", C1);
      await scoredCandidate(f, "c2", C2);
      const c3 = await scoredCandidate(f, "c3", fromPoints({ cash: 30, prof: 15, inv: 12, op: 15, cu: 6, time: 8, act: 0 })); // 86, trigger A
      const r = await run(f, 1);
      assert.deepEqual(r.criticalOutsideTop2, [c3]);
      assert.deepEqual(r.emergencyReviewCandidates, [c3]);
      assert.ok(await open(f.db, c3, "CRITICAL_OUTSIDE_TOP2"));
      await declineEmergency(f.db, f.ctx, MANAGER, c3, { reason: "Evaluated: not an emergency.", at: at(2) });
      assert.equal(await open(f.db, c3, "CRITICAL_OUTSIDE_TOP2"), null);
      assert.equal((await f.db.iamCoreForcedReview.findFirstOrThrow({ where: { candidateId: c3, reasonCode: "CRITICAL_OUTSIDE_TOP2" } })).resolutionBasis, "EMERGENCY_EVALUATED");
    }));
});

// =====================================================================================================================
describe("OVERRIDES, STRATEGIC AUTHORIZATION AND RANK LOCK", () => {
  it("a governed override changes the displayed order, not the calculated score; the original is preserved and it takes effect at the next run", () =>
    withFixture(async (f, tdb) => {
      const a = await scoredCandidate(f, "a", fromPoints(P80));
      const b = await scoredCandidate(f, "b", fromPoints(P80, { dataConfidence: "MEDIUM" })); // 76
      const r1 = await run(f, 1);
      assert.deepEqual(r1.ranked.map((x) => x.candidateId), [a, b]);
      await expectCode(setPriorityOverride(f.db, f.ctx, OWNER_USER, b, { points: 6, reason: "Operator" }), "MANAGEMENT_AUTHORIZATION_REQUIRED");
      await expectCode(setPriorityOverride(f.db, f.ctx, MANAGER, b, { points: 6, reason: " " }), "REASON_REQUIRED");
      for (const points of [0, 0.5, 11, -11, 25]) await expectCode(setPriorityOverride(f.db, f.ctx, MANAGER, b, { points, reason: "x" }), "OVERRIDE_OUT_OF_RANGE");
      const set = await setPriorityOverride(f.db, f.ctx, MANAGER, b, { points: 6, reason: "A key customer is waiting on this.", at: at(2) });
      assert.equal(set.magnitudeClass, "MATERIAL");
      assert.equal((await setPriorityOverride(f.db, f.ctx, MANAGER, a, { points: -3, reason: "Mitigated.", at: at(2, 1) })).magnitudeClass, "MINOR");
      // 4C-D8: the promotion is IMMEDIATE governance - published at once as an immutable event, calculated score and rank untouched.
      assert.ok(set.events.some((e) => e.eventType === "DOMAIN_PRIORITY_CHANGED"), "published immediately");
      const immediate = (await payloadsOf(f.db, b, "DOMAIN_PRIORITY_CHANGED")).at(-1)!.recommendation!;
      assert.equal(immediate.displayedDomainRank, 1);
      assert.equal(immediate.priorityOverrideType, "PROMOTE");
      assert.equal(immediate.domainScore, undefined, "no new calculation: the event carries no score");
      const hist = await result(f.db, r1.scoringRunId, b);
      assert.equal(hist.displayedRank, 2, "the stored run result is immutable");
      assert.equal(hist.domainScore, 76);
      assert.equal(hist.calculatedRank, 2);

      const r2 = await run(f, 4); // same weekly cycle: the calculated scores do not move, only the governed display does
      const rb = await result(f.db, r2.scoringRunId, b);
      assert.equal(rb.domainScore, 76, "the calculated score is preserved");
      assert.equal(rb.effectiveScore, 82);
      assert.equal(rb.calculatedRank, 2);
      assert.equal(rb.displayedRank, 1);
      assert.equal(rb.publishedEventType, null, "already published immediately - not republished by the run");
      const ev = (await payloadsOf(f.db, b, "DOMAIN_PRIORITY_CHANGED")).at(-1)!.recommendation!;
      assert.equal(ev.priorityOverrideType, "PROMOTE");
      assert.equal(ev.priorityOverrideBy, MANAGER.actorId);
      assert.equal(ev.priorityOverrideReason, "A key customer is waiting on this.");
      assert.equal(ev.displayedDomainRank, 1);
      assert.equal(bj(await result(f.db, r2.scoringRunId, a)).governance.override.points, -3);
      // the ledger keeps every action, never edited
      const ledgerRows = await f.db.iamCorePriorityGovernance.findMany({ where: { actionType: "PRIORITY_OVERRIDE" } });
      assert.equal(ledgerRows.length, 2);
      sqlThrows(tdb.file, `DELETE FROM iam_core_priority_governance WHERE governance_id = '${ledgerRows[0]!.governanceId}'`, /IAM_CORE_LEDGER_APPEND_ONLY/);
      sqlThrows(tdb.file, `UPDATE iam_core_priority_governance SET reason = 'x' WHERE governance_id = '${ledgerRows[0]!.governanceId}'`, /IAM_CORE_LEDGER_APPEND_ONLY/);

      await revokePriorityOverride(f.db, f.ctx, MANAGER, b, { reason: "The customer issue is resolved.", at: at(9) });
      const r3 = await run(f, 15);
      assert.equal((await result(f.db, r3.scoringRunId, b)).displayedRank, 2, "revoking returns the displayed order to the calculated one");
    }));

  it("a demotion below 70 removes a candidate from the Top 2; a promotion can lift one into it", () =>
    withFixture(async (f) => {
      const a = await scoredCandidate(f, "a", fromPoints(pts(P80, { act: 1 }))); // 78
      const b = await scoredCandidate(f, "b", fromPoints(pts(P80, { cash: 24 }))); // 74
      const c = await scoredCandidate(f, "c", fromPoints(pts(P80, { cash: 18, prof: 9 }))); // 80-12-3 = 65
      const r1 = await run(f, 1);
      assert.deepEqual(r1.top2, [a, b]);
      await setPriorityOverride(f.db, f.ctx, MANAGER, a, { points: -9, reason: "Deferred by the Board.", at: at(2) });
      await setPriorityOverride(f.db, f.ctx, MANAGER, c, { points: 6, reason: "Regulator interest.", at: at(2, 1) });
      const r2 = await run(f, 8);
      assert.deepEqual(r2.top2, [b, c], "c is promoted over the 70 line (65 + 6 = 71) but stays behind b (74)");
    }));

  it("a strategic modifier exists only after a management authorization, preserving who authorized it and why", () =>
    withFixture(async (f) => {
      const a = await scoredCandidate(f, "a", fromPoints(P80));
      await run(f, 1);
      await expectCode(authorizeStrategic(f.db, f.ctx, OWNER_USER, a, { level: "IMPORTANT", reason: "x" }), "MANAGEMENT_AUTHORIZATION_REQUIRED");
      await expectCode(authorizeStrategic(f.db, f.ctx, MANAGER, a, { level: "IMPORTANT", reason: "" }), "REASON_REQUIRED");
      await expectCode(authorizeStrategic(f.db, f.ctx, MANAGER, a, { level: "NORMAL" as never, reason: "x" }), "STRATEGIC_LEVEL_INVALID");
      await authorizeStrategic(f.db, f.ctx, MANAGER, a, { level: "ENTERPRISE_CRITICAL", reason: "Board-approved strategic initiative.", at: at(2) });
      const r2 = await run(f, 8);
      const s = bj(await result(f.db, r2.scoringRunId, a)).calculation.modifiers.strategic as { value: number; authorizedBy: string; authorizationReason: string };
      assert.equal(s.value, 6);
      assert.equal(s.authorizedBy, MANAGER.actorId);
      assert.equal(s.authorizationReason, "Board-approved strategic initiative.");
      assert.equal((await result(f.db, r2.scoringRunId, a)).domainScore, 87, "80 + 6 strategic + 1 persistence");
      await revokeStrategic(f.db, f.ctx, MANAGER, a, { reason: "Initiative completed.", at: at(9) });
      const r3 = await run(f, 15);
      assert.equal((await result(f.db, r3.scoringRunId, a)).domainScore, 82, "strategic revoked; persistence +2");
    }));

  it("a rank lock holds the displayed rank for at most one weekly cycle while scoring keeps running", () =>
    withFixture(async (f) => {
      const a = await scoredCandidate(f, "a", fromPoints(P89));
      const b = await scoredCandidate(f, "b", fromPoints(P80));
      const c = await scoredCandidate(f, "c", fromPoints(P41));
      await expectCode(lockRank(f.db, f.ctx, MANAGER, c, { rank: 1, reason: "Before any run" }), "CANDIDATE_NOT_RANKED");
      await run(f, 1);
      await expectCode(lockRank(f.db, f.ctx, OWNER_USER, c, { rank: 1, reason: "Operator" }), "MANAGEMENT_AUTHORIZATION_REQUIRED");
      await expectCode(lockRank(f.db, f.ctx, MANAGER, c, { rank: 0, reason: "x" }), "RANK_INVALID");
      await expectCode(lockRank(f.db, f.ctx, MANAGER, c, { rank: 1, reason: "x", until: at(2 + 9) , at: at(2) }), "RANK_LOCK_TOO_LONG");
      await expectCode(lockRank(f.db, f.ctx, MANAGER, c, { rank: 1, reason: "x", until: at(1), at: at(2) }), "RANK_LOCK_PERIOD_INVALID");
      await lockRank(f.db, f.ctx, MANAGER, c, { rank: 1, reason: "Presenting this to the lenders on Friday.", at: at(2) });
      // the underlying inputs keep changing while the lock holds: scoring still runs
      await recordScoringInputs(f.db, f.ctx, SYSTEM_ACTOR, c, fromPoints(pts(P41, { cash: 18 })), { at: at(3) });
      const locked = await run(f, 4);
      const rc = await result(f.db, locked.scoringRunId, c);
      assert.equal(rc.displayedRank, 1);
      assert.equal(rc.calculatedRank, 3);
      assert.equal(rc.domainScore, 47, "the calculated score is still recalculated");
      assert.equal(locked.ranked.find((x) => x.candidateId === a)!.displayedRank, 2);
      assert.equal(locked.ranked.find((x) => x.candidateId === b)!.displayedRank, 3);
      assert.deepEqual(locked.top2, [a, b], "the Top 2 keeps only qualified candidates (the locked 47-point candidate is not one)");
      const ev = (await payloadsOf(f.db, c, "CANDIDATE_SCORED")).at(-1)!.recommendation!;
      assert.equal(ev.displayedDomainRank, 1);
      assert.ok(ev.rankLockedUntil, "the end of the lock is published");
      // the lock lapses after one weekly cycle
      const lapsed = await run(f, 11);
      assert.equal((await result(f.db, lapsed.scoringRunId, c)).displayedRank, 3);
      // and can be released early
      await lockRank(f.db, f.ctx, MANAGER, c, { rank: 1, reason: "Again", at: at(11, 1) });
      await unlockRank(f.db, f.ctx, MANAGER, c, { reason: "Meeting cancelled.", at: at(11, 2) });
      const released = await run(f, 12);
      assert.equal((await result(f.db, released.scoringRunId, c)).displayedRank, 3);
    }));
});

// =====================================================================================================================
describe("SUPPRESSION re-review triggers", () => {
  it("a suppressed candidate is still scored; a +10 score rise since suppression raises a forced re-review and returns it to management", () =>
    withFixture(async (f) => {
      const a = await scoredCandidate(f, "a", fromPoints(P41)); // 41
      const first = await run(f, 1);
      await suppressCandidate(f.db, f.ctx, MANAGER, a, { reason: "Waiting for the vendor's revised schedule.", at: at(2) });
      const quiet = await run(f, 8);
      assert.equal(quiet.suppressionReReviews.length, 0, "unchanged: no trigger");
      assert.equal((await result(f.db, quiet.scoringRunId, a)).outcome, "RANKED", "suppression does not stop scoring");
      await recordScoringInputs(f.db, f.ctx, SYSTEM_ACTOR, a, fromPoints(pts(P41, { cash: 24, prof: 12 })), { at: at(9) }); // +12 + 6
      const triggered = await run(f, 15);
      assert.deepEqual(triggered.suppressionReReviews, [a]);
      assert.ok(await open(f.db, a, "SUPPRESSION_RE_REVIEW"));
      const wf = await f.db.iamCoreWorkflowState.findUniqueOrThrow({ where: { candidateId: a } });
      assert.notEqual(wf.workflowState, "SUPPRESSED", "the suppression ended and the candidate returned to management");
      assert.ok(first.scoringRunId);
    }));

  it("an emergency trigger on a suppressed candidate forces a re-review", () =>
    withFixture(async (f) => {
      const a = await scoredCandidate(f, "a", fromPoints(P41));
      await run(f, 1);
      await suppressCandidate(f.db, f.ctx, MANAGER, a, { reason: "Waiting.", at: at(2) });
      await recordScoringInputs(f.db, f.ctx, SYSTEM_ACTOR, a, fromPoints(P41, { emergency: { verifiedThreat: { category: "SAFETY", verifiedBy: "mgr-1", verifiedAt: "2026-11-03T10:00:00Z", evidenceRef: "inspection-77" } } }), { at: at(3) });
      const r = await run(f, 8);
      assert.deepEqual(r.suppressionReReviews, [a]);
      assert.deepEqual(r.emergencyReviewCandidates, [a]);
      assert.notEqual((await f.db.iamCoreWorkflowState.findUniqueOrThrow({ where: { candidateId: a } })).workflowState, "SUPPRESSED");
    }));

  it("a suppressed candidate that becomes Critical forces a re-review", () =>
    withFixture(async (f) => {
      const a = await scoredCandidate(f, "a", fromPoints(P80));
      await run(f, 1);
      await suppressCandidate(f.db, f.ctx, MANAGER, a, { reason: "Waiting.", at: at(2) });
      await recordScoringInputs(f.db, f.ctx, SYSTEM_ACTOR, a, fromPoints(P89), { at: at(3) });
      const r = await run(f, 8);
      assert.deepEqual(r.suppressionReReviews, [a]);
      const row = await open(f.db, a, "SUPPRESSION_RE_REVIEW");
      assert.match(row!.detail ?? "", /became Critical/);
    }));
});

// =====================================================================================================================
describe("REJECTION: no penalty, repeated rejection forces senior review", () => {
  async function appear(f: Fixture, run_: number, day: number): Promise<string> {
    const r = await ingestGovernedEvidence(f.db, f.ctx, MANAGER, { evidence: [evidence("1"), evidence("2")], sourceRunId: `run-${run_}`, describe: describeGroup(), at: at(day) });
    const id = r.groups[0]!.candidateId;
    await presentCandidate(f.db, f.ctx, MANAGER, id, { at: at(day, 1) });
    return id;
  }

  it("a rejection never lowers the score of the next appearance of the same condition", () =>
    withFixture(async (f) => {
      const control = await scoredCandidate(f, "control", fromPoints(P80));
      const first = await appear(f, 1, 0);
      await rejectCandidate(f.db, f.ctx, MANAGER, first, { reason: "Not this quarter.", at: at(0, 2) });
      const second = await appear(f, 2, 3);
      await recordScoringInputs(f.db, f.ctx, SYSTEM_ACTOR, second, fromPoints(P80));
      const r = await run(f, 8);
      assert.equal(r.ranked.find((x) => x.candidateId === second)!.domainScore, r.ranked.find((x) => x.candidateId === control)!.domainScore);
      assert.equal(await open(f.db, second, "REPEATED_REJECTION"), null, "one rejection is not a repeated rejection");
    }));

  it("after 3 qualified rejections the next appearance carries a repeated-rejection flag and a forced SENIOR review (still no penalty)", () =>
    withFixture(async (f) => {
      for (let i = 0; i < 3; i++) {
        const id = await appear(f, i + 1, i * 10);
        await rejectCandidate(f.db, f.ctx, MANAGER, id, { reason: `Rejection ${i + 1}`, at: at(i * 10, 2) });
      }
      const fourth = await appear(f, 4, 40);
      await recordScoringInputs(f.db, f.ctx, SYSTEM_ACTOR, fourth, fromPoints(P80), { at: at(40, 2) });
      const r = await run(f, 41);
      assert.equal(r.ranked[0]!.domainScore, 80, "no penalty: the score is exactly what the facts say");
      const review = await open(f.db, fourth, "REPEATED_REJECTION");
      assert.ok(review, "forced review raised");
      assert.equal((await result(f.db, r.scoringRunId, fourth)).forcedReviewRequired, true);
      await expectCode(resolveForcedReview(f.db, f.ctx, MANAGER, review!.reviewId, { basis: "SENIOR_REVIEWED", reason: "Manager attempt", at: at(42) }), "SENIOR_REVIEW_REQUIRED");
      await expectCode(resolveForcedReview(f.db, f.ctx, ADMIN, review!.reviewId, { basis: "MANAGEMENT_REVIEWED", reason: "Wrong basis", at: at(42) }), "SENIOR_REVIEW_REQUIRED");
      await resolveForcedReview(f.db, f.ctx, ADMIN, review!.reviewId, { basis: "SENIOR_REVIEWED", reason: "Senior review complete: pursue it.", at: at(42, 1) });
      assert.equal(await open(f.db, fourth, "REPEATED_REJECTION"), null);
      assert.equal((await f.db.iamCoreManagementDecision.count({ where: { decisionType: "REJECT", qualifiedRejection: true } })), 3, "full rejection history is preserved");
    }));
});

// =====================================================================================================================
describe("INSUFFICIENT DATA CONFIDENCE routes to data investigation", () => {
  it("is not ranked, raises a data-investigation review, publishes flags only (no invented score) and ranks after better facts arrive", () =>
    withFixture(async (f) => {
      const good = await scoredCandidate(f, "good", fromPoints(P80));
      const thin = await scoredCandidate(f, "thin", fromPoints(pts(P80, { op: 15, time: 8 }), { dataConfidence: "INSUFFICIENT" }));
      const r1 = await run(f, 1);
      assert.deepEqual(r1.ranked.map((x) => x.candidateId), [good]);
      const review = await open(f.db, thin, "DATA_INVESTIGATION");
      assert.ok(review);
      assert.deepEqual(r1.emergencyReviewCandidates, [thin], "the emergency evaluation route stays open for a thin-data emergency");
      const events = await payloadsOf(f.db, thin, "DOMAIN_PRIORITY_CHANGED");
      assert.equal(events.length, 1);
      assert.equal(events[0]!.recommendation!.domainScore, undefined, "no score is invented");
      assert.equal(events[0]!.recommendation!.forcedReviewRequired, true);
      assert.equal(events[0]!.recommendation!.dataConfidence, "INSUFFICIENT");
      await expectCode(resolveForcedReview(f.db, f.ctx, MANAGER, review!.reviewId, { basis: "DATA_INVESTIGATION_COMPLETE", reason: "Done?", at: at(2) }), "DATA_INVESTIGATION_NOT_COMPLETE");
      await recordScoringInputs(f.db, f.ctx, SYSTEM_ACTOR, thin, fromPoints(pts(P80, { op: 15, time: 8 }), { dataConfidence: "MEDIUM" }), { at: at(3) });
      await resolveForcedReview(f.db, f.ctx, MANAGER, review!.reviewId, { basis: "DATA_INVESTIGATION_COMPLETE", reason: "Vendor ledger reconciled.", at: at(4) });
      const r2 = await run(f, 8);
      assert.ok(r2.ranked.some((x) => x.candidateId === thin), "ranked once the facts are good enough");
      await routeToDataInvestigation(f.db, f.ctx, MANAGER, good, { reason: "A figure looks wrong.", at: at(9) });
      assert.ok(await open(f.db, good, "DATA_INVESTIGATION"));
    }));
});

// =====================================================================================================================
// =====================================================================================================================
describe("DEDICATED GOVERNANCE EVENTS (4C-D6)", () => {
  it("PAUSE_REQUESTED, PAUSE_DENIED, PLAN_REVISED and RETURNED_FOR_REVIEW are published as their own events with stable user ids", () =>
    withFixture(async (f) => {
      const id = await startedCandidate(f, { key: "gov" });
      await requestPause(f.db, f.ctx, OWNER_USER, id, { reason: "Waiting on the carrier.", expectedDurationDays: 5, at: at(3) });
      await decidePause(f.db, f.ctx, MANAGER, id, { decision: "DENY", reason: "The deadline cannot move.", at: at(4) });
      await reassign(f.db, f.ctx, MANAGER, id, { reason: "Scope changed.", planChange: { summary: "Cancel only the two oldest purchase orders." }, at: at(5) });
      const types = await eventTypes(f.db, id);
      assert.ok(types.includes("PAUSE_REQUESTED"));
      assert.ok(types.includes("PAUSE_DENIED"));
      assert.ok(!types.includes("PAUSE_APPROVED"));
      assert.ok(types.includes("PLAN_REVISED"));
      const requested = (await payloadsOf(f.db, id, "PAUSE_REQUESTED"))[0]!;
      assert.equal((requested.progress as { pauseRequestedBy?: string }).pauseRequestedBy ?? OWNER_USER.actorId, OWNER_USER.actorId);
      const denied = (await payloadsOf(f.db, id, "PAUSE_DENIED"))[0]!;
      assert.equal((denied.management as { decidedBy: string }).decidedBy, MANAGER.actorId);
      assert.equal((denied.management as { decisionReason: string }).decisionReason, "The deadline cannot move.");

      const r = await presentedCandidate(f, { key: "ret" });
      await returnForReview(f.db, f.ctx, MANAGER, r, { reason: "Need the vendor's position first.", at: at(6) });
      const ret = (await payloadsOf(f.db, r, "RETURNED_FOR_REVIEW"))[0]!;
      assert.equal((ret.management as { decidedBy: string }).decidedBy, MANAGER.actorId);
      assert.equal(await f.db.dposResultsReturnOutbox.count({ where: { syncStatus: "REJECTED_CORRECTION_REQUIRED" } }), 0, "all five dedicated events validate against the contract");
    }));
});

// =====================================================================================================================
describe("DATABASE GUARDS for the Stage 4C tables", () => {
  it("scoring inputs, runs and results are append-only; vocabularies are enforced; reviews cannot be deleted", () =>
    withFixture(async (f, tdb) => {
      const a = await scoredCandidate(f, "a", fromPoints(P89));
      const r = await run(f, 1);
      const input = await f.db.iamCoreScoringInput.findFirstOrThrow({ where: { candidateId: a } });
      const res = await result(f.db, r.scoringRunId, a);
      sqlThrows(tdb.file, `UPDATE iam_core_scoring_inputs SET inputs_json = '{}' WHERE input_id = '${input.inputId}'`, /IAM_CORE_LEDGER_APPEND_ONLY/);
      sqlThrows(tdb.file, `DELETE FROM iam_core_scoring_inputs WHERE input_id = '${input.inputId}'`, /IAM_CORE_LEDGER_APPEND_ONLY/);
      sqlThrows(tdb.file, `UPDATE iam_core_scoring_runs SET scoring_version = 'X' WHERE scoring_run_id = '${r.scoringRunId}'`, /IAM_CORE_LEDGER_APPEND_ONLY/);
      sqlThrows(tdb.file, `DELETE FROM iam_core_scoring_runs WHERE scoring_run_id = '${r.scoringRunId}'`, /IAM_CORE_LEDGER_APPEND_ONLY/);
      sqlThrows(tdb.file, `UPDATE iam_core_score_results SET domain_score = 50 WHERE score_result_id = '${res.scoreResultId}'`, /IAM_CORE_LEDGER_APPEND_ONLY/);
      sqlThrows(tdb.file, `DELETE FROM iam_core_score_results WHERE score_result_id = '${res.scoreResultId}'`, /IAM_CORE_LEDGER_APPEND_ONLY/);
      sqlThrows(tdb.file, `UPDATE iam_core_scoring_runs SET status = 'DRAFT' WHERE scoring_run_id = '${r.scoringRunId}'`, /IAM_CORE_LEDGER_APPEND_ONLY|IAM_CORE_SCORING_VOCABULARY/);
      // a score outside 0..100 or an unknown band is refused by the database itself
      await assert.rejects(f.db.iamCoreScoreResult.create({ data: { scoringRunId: r.scoringRunId, candidateId: a, dposCompanyId: f.ctx.dposCompanyId, groupedConditionKey: "k", outcome: "RANKED", domainScore: 101, priorityBand: "CRITICAL", scoredAt: at(1) } }));
      await assert.rejects(f.db.iamCoreScoreResult.create({ data: { scoringRunId: r.scoringRunId, candidateId: a, dposCompanyId: f.ctx.dposCompanyId, groupedConditionKey: "k", outcome: "RANKED", domainScore: 50, priorityBand: "AMAZING", scoredAt: at(1) } }));
      await assert.rejects(f.db.iamCorePriorityGovernance.create({ data: { dposCompanyId: f.ctx.dposCompanyId, candidateId: a, actionType: "INVENT", actorId: "mgr-1", actorRole: "MANAGER", reason: "x", effectiveAt: at(1) } }));
      await assert.rejects(f.db.iamCorePriorityGovernance.create({ data: { dposCompanyId: f.ctx.dposCompanyId, candidateId: a, actionType: "PRIORITY_OVERRIDE", actorId: "mgr-1", actorRole: "MANAGER", reason: "  ", effectiveAt: at(1) } }));
      // a governed control cannot be added to a closed candidate
      await setPriorityOverride(f.db, f.ctx, MANAGER, a, { points: 2, reason: "x", at: at(2) });
      await riskAcceptCandidate(f.db, f.ctx, MANAGER, a, { reason: "Accepted.", at: at(3) });
      await expectCode(setPriorityOverride(f.db, f.ctx, MANAGER, a, { points: 2, reason: "Again", at: at(4) }), "CLOSED_CANDIDATE_NO_REOPEN");
      await assert.rejects(f.db.iamCorePriorityGovernance.create({ data: { dposCompanyId: f.ctx.dposCompanyId, candidateId: a, actionType: "PRIORITY_OVERRIDE", points: 2, actorId: "mgr-1", actorRole: "MANAGER", reason: "x", effectiveAt: at(5) } }));
    }));

  it("the one-run-per-key rule is enforced by the database as well", () =>
    withFixture(async (f) => {
      await scoredCandidate(f, "a", fromPoints(P89));
      const r = await run(f, 1, { runKey: "k1" });
      await assert.rejects(
        f.db.iamCoreScoringRun.create({ data: { dposCompanyId: f.ctx.dposCompanyId, runKey: "k1", runAt: at(2), scoringVersion: SCORING_VERSION, configVersion: "v", configHash: "h", configJson: "{}", status: "FINALIZED", requestedBy: "mgr-1", requestedByRole: "MANAGER", candidatesConsidered: 0, candidatesRanked: 0, candidatesExcluded: 0, top2Json: "[]", summaryJson: "{}" } }),
      );
      assert.equal((await getScoringRun(f.db, f.ctx, r.scoringRunId)).scoringRunId, r.scoringRunId);
      await expectCode(getScoringRun(f.db, f.ctx, "no-such-run"), "SCORING_RUN_NOT_FOUND");
    }));
});

// =====================================================================================================================
describe("BOUNDARIES: what Stage 4C must not contain", () => {
  const scoringDir = path.join(REPO_ROOT, "src", "lib", "dpos", "scoring");
  const files = fs.readdirSync(scoringDir).filter((f) => f.endsWith(".ts"));
  // comments may legitimately say what the module does NOT do; only executable code is scanned
  const stripComments = (src: string) => src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"'`])\/\/.*$/gm, "$1");
  const text = files.map((f) => stripComments(fs.readFileSync(path.join(scoringDir, f), "utf8"))).join("\n");

  it("does not implement the Inventory Management Health Score, a Decision Board UI, closeout or learning logic, or DPOS enterprise ranking", () => {
    assert.doesNotMatch(text, /HealthScore|Health Score|healthScore/);
    assert.doesNotMatch(text, /DecisionBoard|decision-board/i);
    assert.doesNotMatch(text, /closeout|learning/i);
    assert.doesNotMatch(text, /enterpriseRank|enterprise ranking/i);
  });

  it("does not read or modify RSE/PRE business logic, V1.5 legacy tables, or contain developer paths or secrets", () => {
    assert.doesNotMatch(text, /from ["'][^"']*(rse|pre-|\/pre\/)[^"']*["']/i);
    assert.doesNotMatch(text, new RegExp(["Terry", "Johnston"].join("\\s+") + "|" + ["[A-Z]:", "Users"].join("\\\\")), "no developer machine path");
    assert.doesNotMatch(text, /process\.env\.[A-Z_]*(SECRET|TOKEN|PASSWORD|KEY)/);
    for (const legacy of legacyTableNames(REPO_ROOT)) assert.ok(!text.includes(`"${legacy}"`), `scoring never references the legacy table ${legacy}`);
  });

  it("is built on stable user ids only (no name or email identity is read)", () => {
    assert.doesNotMatch(text, /\.email\b|displayName/);
  });
});
