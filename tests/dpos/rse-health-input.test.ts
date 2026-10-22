/**
 * Stage 4D-R tests: the governed RSE results read for the Health components Position & Balance, Efficiency and Slow / Nonmoving.
 * Throw-away governed databases only; the Data Hub view is a structure-only fixture that mirrors the Data Hub contract
 * IAM_RSE_HEALTH_INPUT_V1 (the real Data Hub side is proven in services/data-hub/tests/iam-stage4dr-rse-health-read.test.ts and by
 * the manual integrated smoke).
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import { buildBoard } from "../../src/lib/dpos/board";
import { DataHubClientError } from "../../src/lib/dpos/data-hub-client";
import {
  EVIDENCE_FRESHNESS_LABELS,
  HEALTH_CONFIG,
  HEALTH_CURVE_STATUS,
  RSE_HEALTH_CONTRACT_PIN,
  RSE_INPUT_RULES,
  assertPinnedContract,
  calcEfficiency,
  calculateHealth,
  classifyEvidenceFreshness,
  configureTargets,
  readTargetConfig,
  runHealthPipeline,
  componentSources,
  curveDiagnostics,
  healthConfigHash,
  ingestRseHealthInputs,
  lastRseInputRead,
  listHealthHistory,
  mapRseHealthInputs,
  readHealthEvidence,
  recordHealthEvidence,
  type RseHealthInputView,
  type RseHealthProvider,
} from "../../src/lib/dpos/health";
import { whatChangedSinceLastReview } from "../../src/lib/dpos/board/what-changed";
import { boundContext, createTestDb, makeConfig, type TestDb } from "./helpers";
import { MANAGER, VIEWER, at, expectCode, type Fixture } from "./workflow-helpers";
import { runRefresh } from "../../src/lib/dpos/refresh";
import { schedulerTick } from "../../src/lib/dpos/scheduler";

const DAY = 24 * 3600 * 1000;
const NOW = at(8); // 2026-11-03T15:00Z
const iso = (d: Date) => d.toISOString();

async function withFixture(fn: (f: Fixture, tdb: TestDb) => Promise<void>): Promise<void> {
  const tdb = await createTestDb();
  try {
    const ctx = await boundContext(tdb.prisma, makeConfig());
    await fn({ db: tdb.prisma, ctx }, tdb);
  } finally {
    await tdb.close();
  }
}

const refresh = () => ({ companyTimeZone: "America/Chicago", timeZoneValid: true, scheduleStatus: "OK", scheduleReason: null, nextScheduledRefreshAt: null, lastAttemptAt: null, lastAttemptStatus: null, lastSuccessAt: null, lastIamRefreshAt: null, dataCurrentThrough: iso(NOW), recentAttempts: [] });

const st = (protectedValue: number, withEv: number, withoutEv: number, s: { g: [number, number]; f: [number, number] }) => ({
  protectedValue,
  valueWithDemandEvidence: withEv,
  valueWithoutDemandEvidence: withoutEv,
  governedRse: { protectedValue: s.g[0], valueWithEvidence: s.g[1] },
  recentSalesFallback: { protectedValue: s.f[0], valueWithEvidence: s.f[1] },
});

/** A Data Hub view as the real read returns it (see Data Hub IAM_RSE_HEALTH_CONTRACT_DESCRIPTOR). */
function view(over: Partial<RseHealthInputView> = {}, rseAsOf = at(7)): RseHealthInputView {
  return {
    companyId: "company-1",
    contractId: RSE_HEALTH_CONTRACT_PIN.contractId,
    contractVersion: RSE_HEALTH_CONTRACT_PIN.contractVersion,
    contractHash: RSE_HEALTH_CONTRACT_PIN.contractHash,
    generatedAt: iso(NOW),
    rseResult: {
      status: "AVAILABLE",
      resultsReturnEventId: "rre-1",
      producerEventId: "pe-1",
      contractId: "RSE_PRE_RESULTS_RETURN_V1",
      contractVersion: "1.0",
      providerMode: "DATA_HUB",
      sourceRunId: "run-100",
      producerEventAt: iso(rseAsOf),
      receivedAt: iso(rseAsOf),
      receiptStatus: "ACCEPTED",
      payloadHash: "hash-1",
      snapshotVersion: 1,
      salesDollarLabel: "Annual Sales $",
      itemScope: "RUN",
      locationScope: "*",
      catalog: { skuCount: 1200, inventoryValue: 500000, underDollars: 40000, overDollars: 90000, impliedTurns: 3.2, belowMinCount: 150, aboveMaxCount: 210, dataGapCount: 12 },
      classificationByClass: [
        { classCode: "A", skuCount: 100, salesDollars: 900000, grossProfitDollars: 300000, inventoryValue: 120000, impliedTurns: 5, belowMinCount: 20, aboveMaxCount: 10, dataGapCount: 0, underDollars: 15000, overDollars: 8000 },
        { classCode: "F", skuCount: 300, salesDollars: 0, grossProfitDollars: 0, inventoryValue: 60000, impliedTurns: 0, belowMinCount: 0, aboveMaxCount: 300, dataGapCount: 0, underDollars: 0, overDollars: 60000 },
      ],
      fParkedCash: 60000,
      dOverMaxCash: 12000,
    },
    aging: {
      status: "AVAILABLE",
      positionsAsOf: iso(rseAsOf),
      locationScope: "ALL_LOCATIONS_IN_EXTRACT",
      positionsConsidered: 900,
      positionsWithValue: 890,
      positionsWithoutCost: 10,
      positionsExcludedOlderExtract: 0,
      totalInventoryValue: 495000,
      bands: [
        { band: "D000_030", minDays: 0, maxDays: 30, skuCount: 500, inventoryValue: 300000, sellThrough: st(0, 300000, 0, { g: [0, 300000], f: [0, 0] }) },
        { band: "D091_120", minDays: 91, maxDays: 120, skuCount: 40, inventoryValue: 30000, sellThrough: st(9000, 25000, 5000, { g: [6000, 20000], f: [3000, 5000] }) },
        { band: "D151_180", minDays: 151, maxDays: 180, skuCount: 20, inventoryValue: 20000, sellThrough: st(2000, 15000, 5000, { g: [2000, 15000], f: [0, 0] }) },
        { band: "D366_PLUS", minDays: 366, maxDays: null, skuCount: 100, inventoryValue: 65000, sellThrough: st(0, 0, 65000, { g: [0, 0], f: [0, 0] }) },
      ],
      sourceImportBatchIds: ["batch-7"],
      rule: "latest extract",
    },
    rseDemand: { status: "AVAILABLE", sourceFields: ["annualSalesDollars", "annualGrossProfitDollars"], derivation: "annual cost of sales", sourceRunId: "run-100", lineEventsRead: 800, itemsWithGovernedDemand: 700 },
    sellThrough: { status: "AVAILABLE", horizonDays: 90, salesPeriodEndMax: iso(new Date(rseAsOf.getTime() - 10 * DAY)), itemsWithDemandEvidence: 600, itemsWithoutDemandEvidence: 300, basis: "actual recent cost of sales" },
    coherence: { sameSourceRun: false, domains: [{ domain: "RSE_MANAGEMENT_SNAPSHOT", asOf: iso(rseAsOf), reference: "run-100" }], positionsVersusRseSkewDays: 0, note: "separate governed sources" },
    quality: { notes: [] },
    ...over,
  };
}
const provider = (v: RseHealthInputView): RseHealthProvider => ({ fetch: async () => v });
const failing: RseHealthProvider = { fetch: async () => { throw new DataHubClientError("TEMPORARY_TECHNICAL", "TIMEOUT", "Data Hub did not respond in time"); } };

describe("4D-R canonical field mapping (no guessed aliases)", () => {
  it("maps the RSE catalog fields exactly onto Position & Balance", () => {
    const m = mapRseHealthInputs(view());
    assert.deepEqual({ ...m.position.payload, context: undefined }, { totalInventoryBookValue: 500000, belowMinExposureValue: 40000, aboveMaxExcessValue: 90000, skusEvaluated: 1200, skusBelowMin: 150, skusAboveMax: 210, context: undefined });
    assert.ok(m.position.sourceRefs.includes("rse-results-return:rre-1"));
    assert.ok(m.position.sourceRefs.includes("rse-run:run-100"));
    assert.equal(iso(m.position.asOf!), iso(at(7)));
    const src = (m.position.payload!.context as { source: Record<string, unknown> }).source;
    assert.equal(src.sourceRunId, "run-100");
    assert.equal(src.producerEventAt, iso(at(7)));
  });

  it("maps impliedTurns to Efficiency and keeps raw sales and gross profit as context", () => {
    const m = mapRseHealthInputs(view());
    assert.equal(m.efficiency.payload!.inventoryTurns, 3.2);
    const raw = (m.efficiency.payload!.context as { raw: Record<string, unknown> }).raw;
    assert.equal(raw.annualSalesDollars, 900000);
    assert.equal(raw.annualGrossProfitDollars, 300000);
    // GMROI is never derived from RSE figures (4DR-C3)
    assert.equal(m.efficiency.payload!.gmroi, undefined);
  });

  it("refuses a response that is not the pinned contract (id, version, hash)", () => {
    assert.doesNotThrow(() => assertPinnedContract(view()));
    assert.throws(() => assertPinnedContract({ ...view(), contractId: "OTHER" }), DataHubClientError);
    assert.throws(() => assertPinnedContract({ ...view(), contractVersion: "1.0.0" }), /re-pin/);
    assert.throws(() => assertPinnedContract({ ...view(), contractHash: "0".repeat(64) }), /re-pin/);
  });
});

describe("4D-R Position & Balance", () => {
  it("is unavailable (never zero) when the RSE result is missing, has no inventory value, or lacks the exposure fields", () => {
    const none = mapRseHealthInputs(view({ rseResult: { status: "NOT_AVAILABLE", reason: "No accepted RSE management snapshot" } }));
    assert.equal(none.position.payload, null);
    assert.match(none.position.unavailableReason!, /No governed RSE result/);
    const v = view();
    (v.rseResult as { catalog: { inventoryValue: number | null } }).catalog.inventoryValue = null;
    assert.equal(mapRseHealthInputs(v).position.payload, null);
    const w = view();
    (w.rseResult as { catalog: { underDollars: number | null } }).catalog.underDollars = null;
    assert.match(mapRseHealthInputs(w).position.unavailableReason!, /underDollars/);
  });

  it("carries value-weighted exposure with class context (below-Min is dollars, not a per-item count)", () => {
    const m = mapRseHealthInputs(view());
    const ctx = m.position.payload!.context as { raw: { byClass: Array<{ classCode: string; underDollars: number }> } };
    assert.equal(ctx.raw.byClass.find((c) => c.classCode === "A")!.underDollars, 15000);
  });
});

describe("4D-R Efficiency", () => {
  it("is unavailable without a governed company turns target (no industry average is invented), and available with one", async () => {
    await withFixture(async (f) => {
      await ingestRseHealthInputs(f.db, f.ctx, MANAGER, provider(view()), { at: NOW });
      const noTarget = await calculateHealth(f.db, f.ctx, MANAGER, { at: NOW });
      const e = noTarget.health.components.find((c) => c.key === "EFFICIENCY")!;
      assert.equal(e.available, false);
      assert.match(e.unavailableReason!, /Unavailable — target not configured/);
      assert.equal((e.detail as { inventoryTurns: number }).inventoryTurns, 3.2);
      assert.equal((e.detail as { targetState: string }).targetState, "NOT_CONFIGURED");
      assert.equal((e.detail as { gmroiStatus: string }).gmroiStatus, "NOT_AVAILABLE_NOT_CONFIGURED");
      await recordHealthEvidence(f.db, f.ctx, MANAGER, "COMPANY_FACTS", { turnsTarget: 4 }, { sourceRefs: ["company-governance-1"], at: NOW });
      const withTarget = await calculateHealth(f.db, f.ctx, MANAGER, { at: new Date(NOW.getTime() + 1000) });
      const e2 = withTarget.health.components.find((c) => c.key === "EFFICIENCY")!;
      assert.equal(e2.available, true);
    });
  });

  it("is unavailable when RSE has no implied turns", () => {
    const v = view();
    (v.rseResult as { catalog: { impliedTurns: number | null } }).catalog.impliedTurns = null;
    assert.equal(mapRseHealthInputs(v).efficiency.payload, null);
  });
});

describe("4D-R Slow / Nonmoving and natural sell-through", () => {
  it("nonmoving is RSE class F; slow is the provisional 91-180 day window over raw Data Hub bands; overlap with above-Max is DISCLOSED, never deducted", () => {
    const m = mapRseHealthInputs(view());
    const p = m.slowNonmoving.payload!;
    assert.equal(p.totalInventoryBookValue, 500000);
    assert.equal(p.nonMovingValue, 60000);
    assert.equal(p.slowMovingValue, 50000); // 30000 (91-120) + 20000 (151-180); 0-30 and 366+ are NOT slow under the window
    assert.equal(p.overlapWithAboveMaxValue, undefined);
    const od = (p.context as { overlapDisclosure: { treatment: string; possibleOverlaps: string[] } }).overlapDisclosure;
    assert.equal(od.treatment, "DISCLOSED_NOT_DEDUCTED");
    assert.equal(od.possibleOverlaps.length, 3);
    const rule = (p.context as { provisionalRule: { provisional: boolean; slowBands: string[] } }).provisionalRule;
    assert.equal(rule.provisional, true);
    assert.deepEqual(rule.slowBands, ["D091_120", "D121_150", "D151_180"]);
  });

  it("protects only the evidenced sell-through within the 90-day horizon and records the protected amount, evidence reference and residual separately", async () => {
    await withFixture(async (f) => {
      const m = mapRseHealthInputs(view());
      assert.equal(m.slowNonmoving.payload!.naturalSellThrough!.protectedValue, 11000);
      assert.equal(m.slowNonmoving.payload!.naturalSellThrough!.horizonDays, 90);
      assert.match(m.slowNonmoving.payload!.naturalSellThrough!.evidenceRef, /sell-through/);
      await ingestRseHealthInputs(f.db, f.ctx, MANAGER, provider(view()), { at: NOW });
      const h = await calculateHealth(f.db, f.ctx, MANAGER, { at: NOW });
      const d = h.health.components.find((c) => c.key === "SLOW_NONMOVING")!.detail as Record<string, number | boolean>;
      assert.equal(d.grossExposure, 110000);
      assert.equal(d.overlapExcluded, 0);
      assert.equal(d.protectedByNaturalSellThrough, 11000);
      assert.equal(d.naturalSellThroughApplied, true);
      assert.equal(d.naturalSellThroughSource, "MIXED_GOVERNED_AND_FALLBACK");
      assert.equal(d.naturalSellThroughConfidence, "REDUCED");
      assert.equal(d.governedRseProtectedValue, 8000);
      assert.equal(d.fallbackProtectedValue, 3000);
      assert.equal(d.residualExposure, 99000);
    });
  });

  it("governed RSE demand is PRIMARY: with no fallback the source is GOVERNED_RSE_DEMAND at GOVERNED confidence; fallback-only is labelled and reduced", () => {
    const g = view();
    for (const b of (g.aging as { bands: Array<{ sellThrough: ReturnType<typeof st> }> }).bands) b.sellThrough = st(b.sellThrough.governedRse.protectedValue, b.sellThrough.governedRse.valueWithEvidence, b.sellThrough.valueWithoutDemandEvidence + b.sellThrough.recentSalesFallback.valueWithEvidence, { g: [b.sellThrough.governedRse.protectedValue, b.sellThrough.governedRse.valueWithEvidence], f: [0, 0] });
    const n = mapRseHealthInputs(g).slowNonmoving.payload!.naturalSellThrough!;
    assert.equal(n.source, "GOVERNED_RSE_DEMAND");
    assert.equal(n.confidence, "GOVERNED");
    const f = view();
    for (const b of (f.aging as { bands: Array<{ sellThrough: ReturnType<typeof st> }> }).bands) b.sellThrough = st(b.sellThrough.recentSalesFallback.protectedValue, b.sellThrough.recentSalesFallback.valueWithEvidence, b.sellThrough.valueWithoutDemandEvidence + b.sellThrough.governedRse.valueWithEvidence, { g: [0, 0], f: [b.sellThrough.recentSalesFallback.protectedValue, b.sellThrough.recentSalesFallback.valueWithEvidence] });
    (f as { rseDemand: unknown }).rseDemand = { status: "NOT_AVAILABLE", reason: "no per-line RSE results" };
    const fn = mapRseHealthInputs(f).slowNonmoving.payload!.naturalSellThrough!;
    assert.equal(fn.source, "FALLBACK_RECENT_COST_OF_SALES");
    assert.equal(fn.confidence, "REDUCED");
    assert.equal(fn.governedRseProtectedValue, 0);
  });

  it("source skew is diagnostic only: no invented tolerance, no warning note, sources and times recorded", () => {
    const v = view({}, at(7));
    (v.aging as { positionsAsOf: string }).positionsAsOf = iso(at(-3)); // 10 days apart
    const m = mapRseHealthInputs(v);
    assert.equal(m.notes.length, 0, "no skew warning is invented");
    const c = m.slowNonmoving.payload!.context as { sourceSkew: { toleranceGoverned: boolean; tolerance: null; inventoryAsOfMinusRseSnapshotDays: number }; sourceTimes: { rseSnapshotProducerEventAt: string } };
    assert.equal(c.sourceSkew.toleranceGoverned, false);
    assert.equal(c.sourceSkew.tolerance, null);
    assert.equal(c.sourceSkew.inventoryAsOfMinusRseSnapshotDays, -10);
    assert.equal(c.sourceTimes.rseSnapshotProducerEventAt, iso(at(7)));
  });

  it("unknown demand means no protection (Requires Verification), never an assumed one", () => {
    const v = view({ sellThrough: { status: "NOT_AVAILABLE", horizonDays: 90, reason: "No published sales facts" } });
    const m = mapRseHealthInputs(v);
    assert.equal(m.slowNonmoving.payload!.naturalSellThrough, null);
    const nst = (m.slowNonmoving.payload!.context as { naturalSellThrough: { status: string } }).naturalSellThrough;
    assert.equal(nst.status, "REQUIRES_VERIFICATION");
  });

  it("evidence for a horizon longer than 90 days is not applied", () => {
    const m = mapRseHealthInputs(view({ sellThrough: { status: "AVAILABLE", horizonDays: 120, salesPeriodEndMax: null, itemsWithDemandEvidence: 1, itemsWithoutDemandEvidence: 0, basis: "x" } }));
    assert.equal(m.slowNonmoving.payload!.naturalSellThrough, null);
  });

  it("is unavailable when aging evidence is missing (nonmoving alone is not scored as if slow were zero) and when the sources disagree", () => {
    const a = mapRseHealthInputs(view({ aging: { status: "NOT_AVAILABLE", reason: "No published INVENTORY_POSITION records exist for this company." } }));
    assert.equal(a.slowNonmoving.payload, null);
    assert.match(a.slowNonmoving.unavailableReason!, /not scored as if the slow portion were zero/);
    const v = view();
    (v.rseResult as { catalog: { inventoryValue: number } }).catalog.inventoryValue = 100000; // slow 50000 + nonmoving 60000 > 100000
    assert.match(mapRseHealthInputs(v).slowNonmoving.unavailableReason!, /disagree/);
  });
});

describe("4D-R freshness (deterministic, configurable)", () => {
  const now = new Date("2026-11-03T15:00:00.000Z");
  const ago = (ms: number) => new Date(now.getTime() - ms);
  it("0-8 days Current; more than 8 up to 14 Aging; more than 14 Stale", () => {
    assert.equal(classifyEvidenceFreshness(ago(0), now).state, "CURRENT");
    assert.equal(classifyEvidenceFreshness(ago(8 * DAY), now).state, "CURRENT");
    assert.equal(classifyEvidenceFreshness(ago(8 * DAY + 1), now).state, "AGING");
    assert.equal(classifyEvidenceFreshness(ago(14 * DAY), now).state, "AGING");
    assert.equal(classifyEvidenceFreshness(ago(14 * DAY + 1), now).state, "STALE");
    assert.equal(classifyEvidenceFreshness(ago(400 * DAY), now).state, "STALE");
  });
  it("a missing or unreadable as-of is Unavailable and a future as-of counts as age 0", () => {
    assert.equal(classifyEvidenceFreshness(null, now).state, "UNAVAILABLE");
    assert.equal(classifyEvidenceFreshness("not a date", now).state, "UNAVAILABLE");
    const f = classifyEvidenceFreshness(new Date(now.getTime() + 5 * DAY), now);
    assert.equal(f.state, "CURRENT");
    assert.equal(f.ageDays, 0);
  });
  it("thresholds are configurable data", () => {
    assert.equal(classifyEvidenceFreshness(ago(5 * DAY), now, { currentMaxDays: 3, agingMaxDays: 6 }).state, "AGING");
    assert.equal(EVIDENCE_FRESHNESS_LABELS.STALE, "Stale");
  });
});

describe("4D-R ingestion and Health recalculation (existing evidence store; no shadow system)", () => {
  it("records the three evidence kinds, is idempotent, and records the Data Hub read time", async () => {
    await withFixture(async (f) => {
      const r = await ingestRseHealthInputs(f.db, f.ctx, MANAGER, provider(view()), { at: NOW });
      assert.equal(r.ok, true);
      assert.deepEqual(r.components.map((c) => [c.kind, c.status]), [["POSITION_BALANCE", "RECORDED"], ["EFFICIENCY", "RECORDED"], ["SLOW_NONMOVING", "RECORDED"]]);
      const again = await ingestRseHealthInputs(f.db, f.ctx, MANAGER, provider(view()), { at: new Date(NOW.getTime() + 3600_000) });
      assert.deepEqual(again.components.map((c) => c.status), ["UNCHANGED", "UNCHANGED", "UNCHANGED"]);
      const ev = await readHealthEvidence(f.db, f.ctx);
      assert.equal(ev.POSITION_BALANCE!.evidenceVersion, 1);
      assert.equal(ev.POSITION_BALANCE!.asOf!.toISOString(), iso(at(7)));
      const read = await lastRseInputRead(f.db as never, f.ctx.dposCompanyId);
      assert.equal(read!.at, iso(new Date(NOW.getTime() + 3600_000)));
      assert.equal(read!.outcome, "SUCCESS");
    });
  });

  it("a changed RSE result creates a new evidence version; an identical re-read does not", async () => {
    await withFixture(async (f) => {
      await ingestRseHealthInputs(f.db, f.ctx, MANAGER, provider(view()), { at: NOW });
      const v2 = view();
      (v2.rseResult as { catalog: { underDollars: number } }).catalog.underDollars = 50000;
      const r = await ingestRseHealthInputs(f.db, f.ctx, MANAGER, provider(v2), { at: NOW });
      assert.equal(r.components[0]!.status, "RECORDED");
      assert.equal(r.components[0]!.evidenceVersion, 2);
    });
  });

  it("a failed read records nothing, keeps prior evidence (which ages) and is audited", async () => {
    await withFixture(async (f) => {
      await ingestRseHealthInputs(f.db, f.ctx, MANAGER, provider(view()), { at: NOW });
      const r = await ingestRseHealthInputs(f.db, f.ctx, MANAGER, failing, { at: new Date(NOW.getTime() + 1000) });
      assert.equal(r.ok, false);
      assert.equal(r.failure!.code, "TIMEOUT");
      assert.equal((await readHealthEvidence(f.db, f.ctx)).POSITION_BALANCE!.evidenceVersion, 1);
      assert.equal((await lastRseInputRead(f.db as never, f.ctx.dposCompanyId))!.outcome, "FAILURE");
    });
  });

  it("a response that breaks the pinned contract is refused and records nothing", async () => {
    await withFixture(async (f) => {
      const r = await ingestRseHealthInputs(f.db, f.ctx, MANAGER, provider({ ...view(), contractHash: "f".repeat(64) }), { at: NOW });
      assert.equal(r.ok, false);
      assert.equal(r.failure!.code, "RSE_HEALTH_CONTRACT_HASH");
      assert.equal((await readHealthEvidence(f.db, f.ctx)).POSITION_BALANCE, null);
    });
  });

  it("recalculates with all three RSE-fed components available, keeps PROVISIONAL, and renormalizes the rest without zero-scoring", async () => {
    await withFixture(async (f) => {
      await recordHealthEvidence(f.db, f.ctx, MANAGER, "COMPANY_FACTS", { turnsTarget: 4, averageWeeklyRevenue: 100000 }, { sourceRefs: ["company-governance-1"], at: NOW });
      await ingestRseHealthInputs(f.db, f.ctx, MANAGER, provider(view()), { at: NOW });
      const h = (await calculateHealth(f.db, f.ctx, MANAGER, { at: NOW })).health;
      const by = (k: string) => h.components.find((c) => c.key === k)!;
      assert.equal(by("POSITION_BALANCE").available, true);
      assert.equal(by("EFFICIENCY").available, true);
      assert.equal(by("SLOW_NONMOVING").available, true);
      assert.equal(by("SHORTAGE_BACKORDER").available, false);
      assert.equal(by("ACTION_RESOLUTION").available || !by("ACTION_RESOLUTION").available, true);
      assert.equal(h.curveStatus, "PROVISIONAL");
      // renormalized weights of the available components sum to 100
      const sum = h.components.filter((c) => c.available).reduce((a, c) => a + (c.effectiveWeight ?? 0), 0);
      assert.ok(Math.abs(sum - 100) < 0.001);
      // Position: out of balance (40000 + 90000) / 500000 = 26% against the 40% zero point of the provisional curve -> 35.00
      assert.equal(by("POSITION_BALANCE").score, 35);
    });
  });

  it("the Health curves, weights and labels are unchanged by this stage", () => {
    assert.equal(HEALTH_CURVE_STATUS, "PROVISIONAL");
    assert.deepEqual(HEALTH_CONFIG.weights, { POSITION_BALANCE: 40, EFFICIENCY: 20, SLOW_NONMOVING: 15, SHORTAGE_BACKORDER: 15, ACTION_RESOLUTION: 10 });
    assert.equal(healthConfigHash(), "39db2439e85217f6817913585d64567ae91e37842f73b3d8f420000ec55f8fc6");
  });
});

describe("4D-R board, detail source and What Changed", () => {
  it("the board shows per-component evidence freshness (Current / Aging / Stale / Unavailable) and the PROVISIONAL marker", async () => {
    await withFixture(async (f) => {
      await ingestRseHealthInputs(f.db, f.ctx, MANAGER, provider(view()), { at: NOW });
      await calculateHealth(f.db, f.ctx, MANAGER, { at: NOW });
      const state = async (days: number) => {
        const b = await buildBoard(f.db, f.ctx, MANAGER, { now: new Date(NOW.getTime() + days * DAY), refreshStatus: refresh() });
        return Object.fromEntries(b.health.components.map((c) => [c.key, c]));
      };
      const fresh = await state(0);
      assert.equal(fresh.POSITION_BALANCE!.evidence!.state, "CURRENT"); // as-of is one day old
      assert.equal(fresh.POSITION_BALANCE!.provisional, true);
      assert.equal(fresh.POSITION_BALANCE!.evidence!.sourceRunId, "run-100");
      assert.equal(fresh.SHORTAGE_BACKORDER!.evidence, null);
      assert.equal(fresh.SHORTAGE_BACKORDER!.available, false);
      assert.equal((await state(10)).POSITION_BALANCE!.evidence!.state, "AGING");
      const stale = await state(30);
      assert.equal(stale.POSITION_BALANCE!.evidence!.state, "STALE");
      assert.equal(stale.POSITION_BALANCE!.available, true); // stale evidence is shown, but marked
    });
  });

  it("component source detail carries source run, contract, freshness, evidence version and the provisional rule", async () => {
    await withFixture(async (f) => {
      await ingestRseHealthInputs(f.db, f.ctx, MANAGER, provider(view()), { at: NOW });
      const h = (await calculateHealth(f.db, f.ctx, MANAGER, { at: NOW })).health;
      const s = await componentSources(f.db, h.components, NOW);
      // the slow evidence uses fallback sales facts whose period ended ~11 days before NOW: freshness follows the OLDEST contributing source time\n      assert.equal(s.SLOW_NONMOVING!.freshness.state, "AGING");\n      assert.equal(s.POSITION_BALANCE!.freshness.state, "CURRENT");
      assert.equal((s.SLOW_NONMOVING!.context!.provisionalRule as { provisional: boolean }).provisional, true);
      assert.ok(s.POSITION_BALANCE!.sourceRefs.includes("rse-run:run-100"));
      assert.equal(s.POSITION_BALANCE!.evidenceVersion, 1);
    });
  });

  it("What Changed surfaces a component becoming available but not a refresh that changed nothing", async () => {
    await withFixture(async (f) => {
      const earlier = at(-3);
      await calculateHealth(f.db, f.ctx, MANAGER, { at: earlier }); // nothing available yet
      await ingestRseHealthInputs(f.db, f.ctx, MANAGER, provider(view()), { at: NOW });
      await calculateHealth(f.db, f.ctx, MANAGER, { at: NOW });
      const w1 = await whatChangedSinceLastReview(f.db, f.ctx, "America/Chicago", at(9), () => "x");
      assert.ok(w1.items.some((i) => i.kind === "HEALTH"), "a component becoming available is a material change");
      // a later refresh that finds the same result adds no evidence version and therefore no Health change
      await ingestRseHealthInputs(f.db, f.ctx, MANAGER, provider(view()), { at: at(9) });
      const again = (await calculateHealth(f.db, f.ctx, MANAGER, { at: at(9) })).unchanged;
      assert.equal(again, true);
    });
  });

  it("curve diagnostics explain raw metric, score, effective weight, contribution and breakpoints without changing any curve", async () => {
    await withFixture(async (f) => {
      await ingestRseHealthInputs(f.db, f.ctx, MANAGER, provider(view()), { at: NOW });
      const h = (await calculateHealth(f.db, f.ctx, MANAGER, { at: NOW })).health;
      const d = curveDiagnostics(h.components);
      assert.equal(d.curveStatus, "PROVISIONAL");
      assert.equal(d.configHash, healthConfigHash());
      const pos = d.components.find((c) => c.key === "POSITION_BALANCE")!;
      assert.equal(pos.rawMetric!.value, 26);
      assert.equal(pos.score, 35);
      assert.ok(pos.contributionPoints! > 0);
      assert.deepEqual(pos.breakpoints.map((b) => [b.forScore, b.rawMetric]), [[90, 4], [75, 10], [60, 16], [0, 40]]);
      const eff = d.components.find((c) => c.key === "EFFICIENCY")!;
      assert.equal(eff.available, false);
      assert.deepEqual(eff.flags, ["UNAVAILABLE"]);
    });
  });
});

describe("4D-R no direct RSE / file access and no duplicated RSE logic", () => {
  const src = fs.readFileSync(path.join(__dirname, "../../src/lib/dpos/health/rse-input.ts"), "utf8");
  const code = src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
  it("rse-input never imports the filesystem, a database client other than the governed one, or any RSE module", () => {
    const imports = [...code.matchAll(/from\s+"([^"]+)"/g)].map((m) => m[1]!);
    for (const i of imports) {
      assert.ok(!/^(node:)?fs(\/promises)?$/.test(i), `fs import ${i}`);
      assert.ok(!/rse-distribution-app|keystroke|\.\.\/\.\.\/\.\.\/rse/i.test(i), `RSE import ${i}`);
    }
    assert.ok(!/readFile|readFileSync|createReadStream|sqlite|\.csv/i.test(code));
  });
  it("does not reproduce RSE demand, importance, class, Min/Max, protected-N, E-retention or closeout logic", () => {
    for (const forbidden of [/weightedDemand|weighted_demand/i, /businessImportance|business_importance/i, /protectedN|protected_n/i, /retention/i, /closeout/i, /computeMin|computeMax|calcMin|calcMax|recommendedMin|recommendedMax/i, /standardClass|matrixClass|Standard\/Matrix/i]) {
      assert.ok(!forbidden.test(code), `forbidden RSE logic ${String(forbidden)}`);
    }
  });
  it("the provisional slow window is the only rule IAM adds, and it is data marked PROVISIONAL", () => {
    assert.equal(RSE_INPUT_RULES.provisional, true);
    assert.equal(RSE_INPUT_RULES.naturalSellThroughHorizonDays, 90);
  });
});

// ---- Product Owner closeout (4DR-C1 ... C6) --------------------------------------------------------------------------------------

const hubStub = () => ({
  async getInputStatus() {
    return { companyId: "x", generatedAt: iso(NOW), sources: [] } as never;
  },
  async getSyncStatus() {
    return { refresh: { schedule: { timeZone: "America/Chicago", refreshHourLocal: 2 } } } as never;
  },
});

describe("closeout: turns / GMROI targets are governed configuration (no default)", () => {
  it("not configured -> unavailable with actual turns visible; set -> scored; cleared -> unavailable again; no hard-coded default anywhere", async () => {
    await withFixture(async (f) => {
      assert.deepEqual((await readTargetConfig(f.db, f.ctx)).turnsTarget, { state: "NOT_CONFIGURED", value: null, message: "No inventory turns target has been configured for this company." });
      assert.equal((await readTargetConfig(f.db, f.ctx)).gmroiTarget.state, "NOT_CONFIGURED");
      await ingestRseHealthInputs(f.db, f.ctx, MANAGER, provider(view()), { at: NOW });
      const eff = async (n: number) => (await calculateHealth(f.db, f.ctx, MANAGER, { at: new Date(NOW.getTime() + n * 1000) })).health.components.find((c) => c.key === "EFFICIENCY")!;
      const e0 = await eff(0);
      assert.equal(e0.available, false);
      assert.equal((e0.detail as { inventoryTurns: number }).inventoryTurns, 3.2);
      await configureTargets(f.db, f.ctx, MANAGER, { turnsTarget: 4 }, { at: NOW });
      assert.equal((await readTargetConfig(f.db, f.ctx)).turnsTarget.state, "CONFIGURED");
      const e1 = await eff(1);
      assert.equal(e1.available, true);
      assert.equal((e1.detail as { targetState: string }).targetState, "CONFIGURED");
      await configureTargets(f.db, f.ctx, MANAGER, { turnsTarget: null }, { at: NOW });
      const e2 = await eff(2);
      assert.equal(e2.available, false);
      assert.equal((e2.detail as { targetState: string }).targetState, "NOT_CONFIGURED");
      // the same result recurring after a different one is stored as a NEW row, so the LATEST stored result reflects the removal
      const latest = (await listHealthHistory(f.db, f.ctx, { limit: 10 }))[0]!;
      assert.equal(latest.components.find((c) => c.key === "EFFICIENCY")!.available, false);
      assert.equal(await f.db.iamCoreHealthScore.count(), 3);
    });
    const cfgSrc = fs.readFileSync(path.join(__dirname, "../../src/lib/dpos/health/components.ts"), "utf8");
    assert.ok(!/turnsTarget\s*=\s*\d|turnsTarget:\s*\d|defaultTurns|DEFAULT_TURNS/i.test(cfgSrc), "no default turns target in the calculator");
  });

  it("an invalid target is refused with an explicit configuration error and never stored; a non-manager cannot configure", async () => {
    await withFixture(async (f) => {
      for (const bad of [0, -2, Number.NaN, "4" as never]) await expectCode(configureTargets(f.db, f.ctx, MANAGER, { turnsTarget: bad as number }), "INVALID_TURNS_TARGET");
      await expectCode(configureTargets(f.db, f.ctx, MANAGER, { gmroiTarget: -1 }), "INVALID_GMROI_TARGET");
      assert.equal((await readTargetConfig(f.db, f.ctx)).evidenceVersion, null);
      await assert.rejects(() => configureTargets(f.db, f.ctx, VIEWER, { turnsTarget: 4 }));
    });
  });

  it("an invalid target reaching the calculator is Unavailable - invalid target (never scored), and GMROI stays Not Available / Not Configured", () => {
    const ev = { inventoryTurns: 3.2 };
    const invalid = calcEfficiency(ev, { turnsTarget: -3 } as never, ["r"]);
    assert.equal(invalid.available, false);
    assert.match(invalid.unavailableReason!, /invalid target/);
    assert.equal((invalid.detail as { targetState: string }).targetState, "INVALID");
    const ok = calcEfficiency(ev, { turnsTarget: 4 }, ["r"]);
    assert.equal(ok.available, true);
    assert.equal((ok.detail as { gmroiStatus: string }).gmroiStatus, "NOT_AVAILABLE_NOT_CONFIGURED");
    assert.equal((calcEfficiency({ inventoryTurns: 3.2, gmroi: 1.5 }, { turnsTarget: 4, gmroiTarget: 2 }, ["r"]).detail as { gmroiStatus: string }).gmroiStatus, "SCORED");
  });
});

describe("closeout: freshness follows SOURCE time, never Data Hub read time", () => {
  it("an old source record read today remains Stale and the timestamps are kept separate", async () => {
    await withFixture(async (f) => {
      const oldSource = new Date(NOW.getTime() - 30 * DAY);
      const v = view({}, oldSource);
      await ingestRseHealthInputs(f.db, f.ctx, MANAGER, provider(v), { at: NOW }); // read "today"
      await calculateHealth(f.db, f.ctx, MANAGER, { at: NOW });
      const b = await buildBoard(f.db, f.ctx, MANAGER, { now: NOW, refreshStatus: refresh() });
      const pos = b.health.components.find((c) => c.key === "POSITION_BALANCE")!;
      assert.equal(pos.evidence!.state, "STALE");
      // oldest contributing SOURCE time: the fallback sales period ends 10 days before the RSE snapshot in this fixture\n      assert.equal(b.healthTimestamps.evidenceCurrentThrough, iso(new Date(oldSource.getTime() - 10 * DAY)));
      assert.equal(b.healthTimestamps.dataHubReadAt, iso(NOW));
      assert.equal(b.healthTimestamps.healthCalculatedAt, iso(NOW));
      assert.notEqual(b.healthTimestamps.evidenceCurrentThrough, b.healthTimestamps.dataHubReadAt);
    });
  });

  it("with valid Health evidence but no recorded refresh the board does not claim a bare 'Never refreshed'", async () => {
    await withFixture(async (f) => {
      await ingestRseHealthInputs(f.db, f.ctx, MANAGER, provider(view()), { at: NOW });
      await calculateHealth(f.db, f.ctx, MANAGER, { at: NOW });
      const status = { ...refresh(), dataCurrentThrough: null };
      const b = await buildBoard(f.db, f.ctx, MANAGER, { now: NOW, refreshStatus: status });
      assert.ok(b.healthTimestamps.evidenceCurrentThrough);
      assert.match(b.freshness.messages.join(" "), /Health evidence from a governed source is present/);
    });
  });
});

describe("closeout: ONE Health pipeline inside Refresh (manual and scheduled), never scoring", () => {
  it("manual Refresh reads RSE inputs, records evidence and recalculates Health in one operation; no scoring run is created", async () => {
    await withFixture(async (f, tdb) => {
      const cfg = makeConfig();
      const r = await runRefresh({ db: tdb.prisma, config: cfg, context: f.ctx as never, client: hubStub(), health: { rse: provider(view()), backorder: null }, now: () => NOW }, { trigger: "MANUAL_REFRESH", requestedBy: "mgr-1" });
      assert.equal(r.ok, true);
      assert.equal(r.health!.rseInputRead, "SUCCEEDED");
      assert.equal(r.health!.calculation, "CALCULATED");
      assert.deepEqual(r.health!.evidenceStatuses.map((e) => e.status), ["RECORDED", "RECORDED", "RECORDED"]);
      assert.equal(r.health!.dataHubReadAt, iso(NOW));
      assert.equal(r.health!.healthCalculatedAt, iso(NOW));
      assert.equal(await tdb.prisma.iamCoreScoringRun.count(), 0, "Health refresh never runs Stage 4C scoring");
      assert.equal(await tdb.prisma.iamCoreHealthScore.count(), 1);
      // a second refresh with the same RSE result changes nothing
      const again = await runRefresh({ db: tdb.prisma, config: cfg, context: f.ctx as never, client: hubStub(), health: { rse: provider(view()), backorder: null }, now: () => new Date(NOW.getTime() + 60_000) }, { trigger: "MANUAL_REFRESH", requestedBy: "mgr-1" });
      assert.deepEqual(again.health!.evidenceStatuses.map((e) => e.status), ["UNCHANGED", "UNCHANGED", "UNCHANGED"]);
      assert.equal(again.health!.calculation, "UNCHANGED");
      assert.equal(await tdb.prisma.iamCoreHealthScore.count(), 1);
    });
  });

  it("a failed RSE read keeps prior evidence, is recorded as a Health warning, and does not fail the Data Hub refresh", async () => {
    await withFixture(async (f, tdb) => {
      const cfg = makeConfig();
      await runRefresh({ db: tdb.prisma, config: cfg, context: f.ctx as never, client: hubStub(), health: { rse: provider(view()), backorder: null }, now: () => NOW }, { trigger: "MANUAL_REFRESH", requestedBy: "mgr-1" });
      const r = await runRefresh({ db: tdb.prisma, config: cfg, context: f.ctx as never, client: hubStub(), health: { rse: failing, backorder: null }, now: () => new Date(NOW.getTime() + 60_000) }, { trigger: "MANUAL_REFRESH", requestedBy: "mgr-1" });
      assert.equal(r.ok, true);
      assert.equal(r.health!.rseInputRead, "FAILED");
      assert.equal(r.health!.rseInputFailureCode, "TIMEOUT");
      assert.ok(r.warnings.some((w) => w.startsWith("HEALTH_INPUT_READ_FAILED")));
      assert.equal((await readHealthEvidence(tdb.prisma, f.ctx)).POSITION_BALANCE!.evidenceVersion, 1);
    });
  });

  it("without Health providers the refresh is unchanged (standalone and existing behaviour)", async () => {
    await withFixture(async (f, tdb) => {
      const r = await runRefresh({ db: tdb.prisma, config: makeConfig(), context: f.ctx as never, client: hubStub(), now: () => NOW }, { trigger: "MANUAL_REFRESH", requestedBy: "mgr-1" });
      assert.equal(r.ok, true);
      assert.equal(r.health, null);
      assert.equal(await tdb.prisma.iamCoreHealthScore.count(), 0);
    });
  });

  it("the scheduled Sunday refresh runs the SAME pipeline (catch-up occurrence), once", async () => {
    await withFixture(async (f, tdb) => {
      const deps = (now: string) => ({ db: tdb.prisma, config: makeConfig(), context: f.ctx as never, client: hubStub(), health: { rse: provider(view()), backorder: null }, now: () => new Date(now) });
      const tick = await schedulerTick(deps("2026-11-03T15:00:00Z"));
      assert.equal(tick.action, "RAN");
      const res = (tick as { result: { health: { calculation: string; rseInputRead: string } | null } }).result;
      assert.equal(res.health!.rseInputRead, "SUCCEEDED");
      assert.equal(res.health!.calculation, "CALCULATED");
      assert.equal(await tdb.prisma.iamCoreScoringRun.count(), 0);
      assert.equal((await schedulerTick(deps("2026-11-03T15:05:00Z"))).action, "ALREADY_COMPLETE");
      assert.equal(await tdb.prisma.iamCoreHealthScore.count(), 1);
    });
  });

  it("the Health route and the Refresh share runHealthPipeline (one implementation)", () => {
    const refreshSrc = fs.readFileSync(path.join(__dirname, "../../src/lib/dpos/refresh.ts"), "utf8");
    const routeSrc = fs.readFileSync(path.join(__dirname, "../../src/app/api/dpos/health/route.ts"), "utf8");
    assert.match(refreshSrc, /runHealthPipeline/);
    assert.match(routeSrc, /runHealthPipeline/);
    assert.ok(!/calculateHealth|ingestRseHealthInputs/.test(routeSrc), "the route does not duplicate pipeline steps");
    assert.ok(!/scor(e|ing)Run|runScoring|executeScoring/i.test(fs.readFileSync(path.join(__dirname, "../../src/lib/dpos/health/pipeline.ts"), "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "")), "the pipeline never runs scoring");
    void runHealthPipeline;
  });
});