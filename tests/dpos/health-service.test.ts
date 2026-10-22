/**
 * Stage 4D integration tests: governed health evidence, the stored immutable Health Score history, component availability and
 * renormalization from real stored data, and Action Resolution computed from canonical workflow tracking. Throw-away governed
 * databases only.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { DatabaseSync } from "node:sqlite";
import {
  HEALTH_VERSION,
  calculateHealth,
  compareHealth,
  latestHealthChange,
  latestHealthScore,
  listHealthHistory,
  readHealthEvidence,
  recordHealthEvidence,
  type BackorderProvider,
  type BackorderLine,
  type StoredHealth,
} from "../../src/lib/dpos/health";
import { SYSTEM_ACTOR, completeAction, updateConditionReduction } from "../../src/lib/dpos/workflow";
import { boundContext, createTestDb, makeConfig, type TestDb } from "./helpers";
import { MANAGER, OWNER_USER, VIEWER, at, expectCode, startedCandidate, type Fixture } from "./workflow-helpers";

async function withFixture(fn: (f: Fixture, tdb: TestDb) => Promise<void>): Promise<void> {
  const tdb = await createTestDb();
  try {
    const ctx = await boundContext(tdb.prisma, makeConfig());
    await fn({ db: tdb.prisma, ctx }, tdb);
  } finally {
    await tdb.close();
  }
}

const NOW = at(8); // Tuesday 2026-11-03 15:00Z

const line = (over: Partial<BackorderLine> = {}): BackorderLine => ({
  orderRef: "T-1",
  parentSku: "SKU-1",
  childPartOrVariant: "10.0",
  locationRef: "Main",
  quantity: 5,
  value: 1000,
  originalOrderDate: "2026-11-02",
  promisedDate: null,
  ...over,
});
const provider = (lines: BackorderLine[], asOf = NOW): BackorderProvider => ({ fetch: async () => ({ ok: true, input: { lines, asOf, sourceRefs: ["datahub:CUSTOMER_BACKORDER_LINE:batch-9"] } }) });
const failingProvider: BackorderProvider = { fetch: async () => ({ ok: false, reason: "The Customer Backorder feed is NO_SUCCESSFUL_RUN in the Data Hub, so shortage cannot be measured." }) };

async function seedEvidence(f: Fixture, at0: Date = NOW) {
  const refs = { sourceRefs: ["rse-run-77"], asOf: at0, at: at0 };
  await recordHealthEvidence(f.db, f.ctx, MANAGER, "POSITION_BALANCE", { totalInventoryBookValue: 1000, belowMinExposureValue: 50, aboveMaxExcessValue: 150 }, refs);
  await recordHealthEvidence(f.db, f.ctx, MANAGER, "EFFICIENCY", { inventoryTurns: 3 }, refs);
  await recordHealthEvidence(f.db, f.ctx, MANAGER, "SLOW_NONMOVING", { totalInventoryBookValue: 1000, slowMovingValue: 100, nonMovingValue: 100 }, refs);
  await recordHealthEvidence(f.db, f.ctx, MANAGER, "COMPANY_FACTS", { turnsTarget: 4, averageWeeklyRevenue: 100000 }, { sourceRefs: ["company-governance-1"], at: at0 });
}

const comp = (h: StoredHealth, key: string) => h.components.find((c) => c.key === key)!;

describe("health evidence", () => {
  it("requires a stable DPOS user id, a governed source and a valid payload", async () => {
    await withFixture(async (f) => {
      const ok = { sourceRefs: ["rse-run-1"], at: NOW };
      const payload = { inventoryTurns: 4 };
      await expectCode(recordHealthEvidence(f.db, f.ctx, { actorId: "someone@example.com", role: "MANAGER" }, "EFFICIENCY", payload, ok), "STABLE_USER_ID_REQUIRED");
      await expectCode(recordHealthEvidence(f.db, f.ctx, MANAGER, "EFFICIENCY", payload, { sourceRefs: [], at: NOW }), "HEALTH_EVIDENCE_SOURCE_REQUIRED");
      await expectCode(recordHealthEvidence(f.db, f.ctx, MANAGER, "EFFICIENCY", { inventoryTurns: -1 }, ok), "HEALTH_EVIDENCE_INVALID");
      await expectCode(recordHealthEvidence(f.db, f.ctx, VIEWER, "EFFICIENCY", payload, ok), "SYSTEM_OR_MANAGEMENT_REQUIRED");
      await expectCode(recordHealthEvidence(f.db, f.ctx, OWNER_USER, "EFFICIENCY", payload, ok), "SYSTEM_OR_MANAGEMENT_REQUIRED");
      assert.equal((await recordHealthEvidence(f.db, f.ctx, SYSTEM_ACTOR, "EFFICIENCY", payload, ok)).evidenceVersion, 1);
    });
  });

  it("versions append-only: identical evidence adds nothing, changed evidence adds a version, and rows cannot be edited", async () => {
    await withFixture(async (f, tdb) => {
      const o = { sourceRefs: ["rse-run-1"], asOf: NOW, at: NOW };
      const a = await recordHealthEvidence(f.db, f.ctx, MANAGER, "EFFICIENCY", { inventoryTurns: 4 }, o);
      const same = await recordHealthEvidence(f.db, f.ctx, MANAGER, "EFFICIENCY", { inventoryTurns: 4 }, o);
      assert.equal(same.unchanged, true);
      assert.equal(same.evidenceId, a.evidenceId);
      const b = await recordHealthEvidence(f.db, f.ctx, MANAGER, "EFFICIENCY", { inventoryTurns: 5 }, o);
      assert.equal(b.evidenceVersion, 2);
      assert.equal((await readHealthEvidence(f.db, f.ctx)).EFFICIENCY?.evidenceVersion, 2);
      const raw = new DatabaseSync(tdb.file);
      assert.throws(() => raw.exec(`UPDATE iam_core_health_evidence SET evidence_json = '{}'`), /IAM_CORE_LEDGER_APPEND_ONLY/);
      assert.throws(() => raw.exec(`DELETE FROM iam_core_health_evidence`), /IAM_CORE_LEDGER_APPEND_ONLY/);
      raw.close();
    });
  });
});

describe("Health Score calculation and history", () => {
  it("calculates all five components from governed values, stores version, curve status, weights, drivers and source refs", async () => {
    await withFixture(async (f) => {
      await seedEvidence(f);
      // an Action Resolution input: one completed action with 40% measured condition reduction
      const id = await startedCandidate(f, { baselineExposure: 1000 });
      await updateConditionReduction(f.db, f.ctx, OWNER_USER, id, { currentExposure: 600, at: at(6) });
      await completeAction(f.db, f.ctx, OWNER_USER, id, { at: at(7) });

      const r = await calculateHealth(f.db, f.ctx, SYSTEM_ACTOR, { at: NOW, backorder: provider([line()]) });
      const h = r.health;
      assert.equal(h.healthVersion, HEALTH_VERSION);
      assert.equal(h.curveStatus, "PROVISIONAL");
      assert.equal(h.status, "CALCULATED");
      assert.equal(h.availableComponents, 5);
      assert.equal(h.operatingWeekStart, "2026-11-01", "the company-local Sunday-Saturday review cycle");
      assert.equal(h.companyTimeZone, "America/Chicago");
      // A: 200/1000 = 20% of 40 -> 50 ; B: 3/4 -> 50 ; C: 200/1000 = 20% of 30 -> 33.33 ; D: 1000 x 0.5 (age 1d) = 500 -> 0.5% of 25 -> 98 ; E: 40
      assert.deepEqual(h.components.map((c) => c.score), [50, 50, 33.33, 98, 40]);
      assert.deepEqual(h.components.map((c) => c.effectiveWeight), [40, 20, 15, 15, 10]);
      // (5000*40 + 5000*20 + 3333*15 + 9800*15 + 4000*10) / 100 = 5370.0 -> 53.70
      assert.equal(h.score, 53.7);
      assert.equal(h.label, "NEEDS_ATTENTION");
      assert.ok(comp(h, "POSITION_BALANCE").drivers.length > 0);
      assert.ok(comp(h, "POSITION_BALANCE").evidenceRefs.some((e) => e.startsWith("health-evidence:")));
      assert.deepEqual((h.sourceRefs as { backorderFeed: { sourceRefs: string[] } }).backorderFeed.sourceRefs, ["datahub:CUSTOMER_BACKORDER_LINE:batch-9"]);
      assert.equal(h.dataCurrentThrough, NOW.toISOString());
      assert.equal(h.requestedBy, "iam-system");
    });
  });

  it("renormalizes from stored data when a component is unavailable (never zero) and says why", async () => {
    await withFixture(async (f) => {
      await recordHealthEvidence(f.db, f.ctx, MANAGER, "POSITION_BALANCE", { totalInventoryBookValue: 1000, belowMinExposureValue: 0, aboveMaxExcessValue: 100 }, { sourceRefs: ["rse-1"], asOf: NOW, at: NOW });
      const r = await calculateHealth(f.db, f.ctx, MANAGER, { at: NOW, backorder: failingProvider });
      const h = r.health;
      assert.equal(h.availableComponents, 1);
      assert.equal(h.score, 75, "only Position & Balance counts: 100/1000 = 10% of 40 -> 75");
      assert.equal(h.label, "HEALTHY");
      assert.equal(comp(h, "POSITION_BALANCE").effectiveWeight, 100);
      for (const k of ["EFFICIENCY", "SLOW_NONMOVING", "SHORTAGE_BACKORDER", "ACTION_RESOLUTION"]) {
        assert.equal(comp(h, k).available, false, k);
        assert.equal(comp(h, k).score, null, k);
        assert.equal(comp(h, k).effectiveWeight, null, k);
        assert.ok(comp(h, k).unavailableReason, k);
      }
      assert.match(String(comp(h, "SHORTAGE_BACKORDER").unavailableReason), /NO_SUCCESSFUL_RUN/);
    });
  });

  it("stores NO_COMPONENT_AVAILABLE (no score, no label) when nothing is available, and the database refuses an inconsistent row", async () => {
    await withFixture(async (f, tdb) => {
      const r = await calculateHealth(f.db, f.ctx, MANAGER, { at: NOW });
      assert.equal(r.health.status, "NO_COMPONENT_AVAILABLE");
      assert.equal(r.health.score, null);
      assert.equal(r.health.label, null);
      const raw = new DatabaseSync(tdb.file);
      const insert = (status: string, score: string, label: string) =>
        raw.exec(`INSERT INTO iam_core_health_scores (health_score_id, dpos_company_id, health_version, curve_status, config_hash, operating_week_start, calculated_at, status, score, label, available_components, components_json, source_refs_json, requested_by) VALUES ('x-${status}-${score}', 'co', 'v', 'PROVISIONAL', 'h', '2026-11-01', 0, '${status}', ${score}, ${label}, 0, '[]', '{}', 'u')`);
      assert.throws(() => insert("CALCULATED", "NULL", "NULL"), /IAM_HEALTH_VOCABULARY/);
      assert.throws(() => insert("NO_COMPONENT_AVAILABLE", "50", "'WATCH'"), /IAM_HEALTH_VOCABULARY/);
      assert.throws(() => insert("CALCULATED", "150", "'STRONG'"), /IAM_HEALTH_VOCABULARY/);
      assert.throws(() => insert("CALCULATED", "50", "'GREAT'"), /IAM_HEALTH_VOCABULARY/);
      raw.close();
    });
  });

  it("keeps immutable history: an unchanged recalculation returns the stored row, a changed one adds a row, rows cannot be edited", async () => {
    await withFixture(async (f, tdb) => {
      await seedEvidence(f);
      const first = await calculateHealth(f.db, f.ctx, MANAGER, { at: NOW, backorder: provider([line()]) });
      const again = await calculateHealth(f.db, f.ctx, MANAGER, { at: at(8, 2), backorder: provider([line()]) });
      assert.equal(again.unchanged, true);
      assert.equal(again.health.healthScoreId, first.health.healthScoreId);
      assert.equal((await listHealthHistory(f.db, f.ctx)).length, 1);

      // the Customer Backorder worsens: a new immutable row, with the change against the prior
      const worse = await calculateHealth(f.db, f.ctx, MANAGER, { at: at(8, 3), backorder: provider([line(), line({ orderRef: "T-2", parentSku: "SKU-2", value: 20000, originalOrderDate: "2026-09-01" })]) });
      assert.equal(worse.unchanged, false);
      assert.equal(worse.prior?.healthScoreId, first.health.healthScoreId);
      assert.ok(worse.change!.scoreChange! < 0);
      assert.equal(worse.change!.comparable, true);
      const shortage = worse.change!.components.find((c) => c.key === "SHORTAGE_BACKORDER")!;
      assert.ok(shortage.change! < 0 && shortage.material);
      assert.equal(worse.change!.components.find((c) => c.key === "POSITION_BALANCE")!.change, 0, "unchanged components report no change");

      const hist = await listHealthHistory(f.db, f.ctx);
      assert.equal(hist.length, 2);
      assert.equal(hist[0]!.healthScoreId, worse.health.healthScoreId, "newest first");
      assert.equal((await latestHealthScore(f.db, f.ctx))!.healthScoreId, worse.health.healthScoreId);
      assert.equal((await latestHealthChange(f.db, f.ctx))!.change!.priorHealthScoreId, first.health.healthScoreId);
      // the stored first row still reads exactly as calculated (never reinterpreted)
      const stored = (await listHealthHistory(f.db, f.ctx)).find((h) => h.healthScoreId === first.health.healthScoreId)!;
      assert.deepEqual(stored.components.map((c) => c.score), first.health.components.map((c) => c.score));
      const raw = new DatabaseSync(tdb.file);
      assert.throws(() => raw.exec(`UPDATE iam_core_health_scores SET score = 99`), /IAM_CORE_LEDGER_APPEND_ONLY/);
      assert.throws(() => raw.exec(`DELETE FROM iam_core_health_scores`), /IAM_CORE_LEDGER_APPEND_ONLY/);
      raw.close();
    });
  });

  it("history is kept by company-local review cycle (Analysis Period)", async () => {
    await withFixture(async (f) => {
      await seedEvidence(f);
      const w1 = await calculateHealth(f.db, f.ctx, MANAGER, { at: NOW, backorder: provider([line()]) });
      const nextWeek = at(15);
      await recordHealthEvidence(f.db, f.ctx, MANAGER, "EFFICIENCY", { inventoryTurns: 4 }, { sourceRefs: ["rse-run-78"], asOf: nextWeek, at: nextWeek });
      const w2 = await calculateHealth(f.db, f.ctx, MANAGER, { at: nextWeek, backorder: provider([line()], nextWeek) });
      assert.equal(w1.health.operatingWeekStart, "2026-11-01");
      assert.equal(w2.health.operatingWeekStart, "2026-11-08");
      assert.equal((await listHealthHistory(f.db, f.ctx, { operatingWeekStart: "2026-11-01" })).length, 1);
      assert.equal((await listHealthHistory(f.db, f.ctx, { operatingWeekStart: "2026-11-08" })).length, 1);
      assert.equal((await listHealthHistory(f.db, f.ctx)).length, 2);
    });
  });

  it("never reinterprets old values: scores from different formula versions are not compared as if equal", async () => {
    await withFixture(async (f) => {
      await seedEvidence(f);
      const r = await calculateHealth(f.db, f.ctx, MANAGER, { at: NOW, backorder: provider([line()]) });
      const v2: StoredHealth = { ...r.health, healthVersion: "IAM_HEALTH_SCORE_V2", score: 80, healthScoreId: "future" };
      const change = compareHealth(v2, r.health);
      assert.equal(change.comparable, false);
      assert.equal(change.scoreChange, null);
      assert.ok(change.components.every((c) => c.change === null));
    });
  });

  it("refuses to calculate without a valid company time zone (no UTC fallback) and for non-management actors", async () => {
    await withFixture(async (f) => {
      await expectCode(calculateHealth(f.db, { ...f.ctx, companyTimeZone: "Not/AZone" }, MANAGER, { at: NOW }), "COMPANY_TIME_ZONE_REQUIRED");
      await expectCode(calculateHealth(f.db, f.ctx, VIEWER, { at: NOW }), "SYSTEM_OR_MANAGEMENT_REQUIRED");
      await expectCode(calculateHealth(f.db, f.ctx, OWNER_USER, { at: NOW }), "SYSTEM_OR_MANAGEMENT_REQUIRED");
    });
  });

  it("Action Resolution reads canonical tracking: 100% completion with no measured reduction earns no credit", async () => {
    await withFixture(async (f) => {
      const id = await startedCandidate(f, { baselineExposure: 1000 });
      await completeAction(f.db, f.ctx, OWNER_USER, id, { at: at(7) });
      const unmeasured = await calculateHealth(f.db, f.ctx, MANAGER, { at: NOW });
      const e = comp(unmeasured.health, "ACTION_RESOLUTION");
      assert.equal(e.available, false);
      assert.match(String(e.unavailableReason), /awaiting condition-reduction measurement/);

      // a second action: completed AND measured at 25%
      const id2 = await startedCandidate(f, { key: "second", baselineExposure: 400 });
      await updateConditionReduction(f.db, f.ctx, OWNER_USER, id2, { currentExposure: 300, at: at(6) });
      await completeAction(f.db, f.ctx, OWNER_USER, id2, { at: at(7) });
      const measured = await calculateHealth(f.db, f.ctx, MANAGER, { at: at(8, 1) });
      const e2 = comp(measured.health, "ACTION_RESOLUTION");
      assert.equal(e2.available, true);
      assert.equal(e2.score, 25, "credit follows the 25% condition reduction; the unmeasured completion earns nothing");
    });
  });
});
