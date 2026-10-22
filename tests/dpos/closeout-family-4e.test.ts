/**
 * Stage 4E-C4: the governed condition-family vocabulary. A candidate's governed FAMILY (stable code, versioned vocabulary, immutable
 * classification) is the analytical key; the candidate-specific condition DETAIL stays free text and is never a grouping key.
 */
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { describe, it } from "node:test";
import {
  CONDITION_FAMILIES,
  CONDITION_FAMILY_VOCABULARY_VERSION,
  FALLBACK_CONDITION_FAMILY,
  approveCloseout,
  completeCloseout,
  conditionFamilyLabel,
  readCloseout,
  readEffectiveness,
  recordLearning,
  recordMeasurement,
  requireConditionFamily,
  assessWindow,
  measureCondition,
  resolutionGuidance,
  validateAssertedStatus,
  startCloseout,
} from "../../src/lib/dpos/closeout";
import { ingestGovernedEvidence } from "../../src/lib/dpos/workflow";
import { boundContext, createTestDb, makeConfig, type TestDb } from "./helpers";
import { completedHistoryCandidate, measurement } from "./closeout-helpers";
import { MANAGER, MANAGER_2, at, describeGroup, evidence, expectCode, type Fixture } from "./workflow-helpers";

async function withFixture(fn: (f: Fixture, tdb: TestDb) => Promise<void>): Promise<void> {
  const tdb = await createTestDb();
  try {
    const ctx = await boundContext(tdb.prisma, makeConfig());
    await fn({ db: tdb.prisma, ctx }, tdb);
  } finally {
    await tdb.close();
  }
}

const LEARN = { whatWorked: "Early vendor contact released the open orders.", evidenceRefs: ["ev-final-balance-1"] };

/** Drive a Completed History candidate through measurement, approval, learning (optional) and permanent closure. */
async function closeOut(f: Fixture, id: string, learning: Record<string, unknown> | null, learningNa = "No transferable lesson."): Promise<void> {
  await startCloseout(f.db, f.ctx, MANAGER, id, { at: at(20) });
  await recordMeasurement(f.db, f.ctx, MANAGER, id, measurement({ at: at(30) }));
  await approveCloseout(f.db, f.ctx, MANAGER_2, id, { finalStatus: "FULLY_RESOLVED", ...(learning ? {} : { learningNotApplicableReason: learningNa }), at: at(31) });
  if (learning) await recordLearning(f.db, f.ctx, MANAGER, id, { ...learning, at: at(32) } as never);
  await completeCloseout(f.db, f.ctx, MANAGER, id, { at: at(33) });
}

describe("Stage 4E-C4: governed condition-family vocabulary", () => {
  it("is exactly the nine approved families with stable codes and the approved display labels", () => {
    assert.deepEqual(
      CONDITION_FAMILIES.map((x) => [x.code, x.label]),
      [
        ["EXCESS_OVER_INVENTORY", "Excess / Over-Inventory"],
        ["SLOW_NONMOVING_INVENTORY", "Slow / Nonmoving Inventory"],
        ["SHORTAGE_BACKORDER", "Shortage / Backorder"],
        ["INVENTORY_POSITION_REPLENISHMENT_IMBALANCE", "Inventory Position / Replenishment Imbalance"],
        ["DEMAND_MOVEMENT_DETERIORATION", "Demand / Movement Deterioration"],
        ["VENDOR_SUPPLY_CONSTRAINT", "Vendor / Supply Constraint"],
        ["INVENTORY_PROFITABILITY_MARGIN_EXPOSURE", "Inventory Profitability / Margin Exposure"],
        ["DATA_EVIDENCE_INVESTIGATION", "Data / Evidence Investigation"],
        ["OTHER_GOVERNED_CONDITION", "Other Governed Condition"],
      ],
    );
    assert.equal(CONDITION_FAMILY_VOCABULARY_VERSION, "IAM_CONDITION_FAMILY_V1");
    assert.equal(FALLBACK_CONDITION_FAMILY, "OTHER_GOVERNED_CONDITION");
  });

  it("refuses free text: only a governed code is accepted, and a code outside today's vocabulary still displays from its stored code", () => {
    assert.throws(() => requireConditionFamily("Excess open purchase orders - Vendor A"), /governed condition families/);
    assert.throws(() => requireConditionFamily("excess_over_inventory"), /governed condition families/);
    assert.equal(requireConditionFamily("SHORTAGE_BACKORDER"), "SHORTAGE_BACKORDER");
    assert.equal(conditionFamilyLabel("SHORTAGE_BACKORDER"), "Shortage / Backorder");
    // Historical records keep the code they were written under even if a later vocabulary version retires it.
    assert.equal(conditionFamilyLabel("RETIRED_FAMILY_FROM_AN_OLDER_VERSION"), "RETIRED_FAMILY_FROM_AN_OLDER_VERSION");
    assert.equal(conditionFamilyLabel(null), "Unclassified");
  });

  it("a producer-supplied family is validated at candidate creation and recorded as an immutable classification; the free-text detail and the grouped key are unaffected", () =>
    withFixture(async (f, tdb) => {
      await expectCode(
        ingestGovernedEvidence(f.db, f.ctx, MANAGER, { evidence: [evidence("bad-1")], sourceRunId: "run-bad", describe: describeGroup({ conditionFamily: "Excess open purchase orders" }), at: at(0) }),
        "VOCABULARY_VIOLATION",
      );
      const plain = await ingestGovernedEvidence(f.db, f.ctx, MANAGER, { evidence: [evidence("fam-a1")], sourceRunId: "run-a", describe: describeGroup(), at: at(0) });
      const withFamily = await ingestGovernedEvidence(f.db, f.ctx, MANAGER, { evidence: [evidence("fam-b1", { conditionKey: "Condition fam-b" })], sourceRunId: "run-b", describe: describeGroup({ conditionFamily: "EXCESS_OVER_INVENTORY" }), at: at(0) });
      const idPlain = plain.groups[0]!.candidateId;
      const idFamily = withFamily.groups[0]!.candidateId;
      assert.equal(await f.db.iamCoreConditionClassification.count({ where: { candidateId: idPlain } }), 0, "no family supplied: nothing is invented");
      const row = await f.db.iamCoreConditionClassification.findUniqueOrThrow({ where: { candidateId: idFamily } });
      assert.deepEqual([row.familyCode, row.vocabularyVersion, row.source], ["EXCESS_OVER_INVENTORY", "IAM_CONDITION_FAMILY_V1", "PRODUCER"]);
      // The grouped identity (and so recurrence matching) is exactly what it was: the family does not enter the key.
      const cand = await f.db.iamCoreCandidate.findUniqueOrThrow({ where: { candidateId: idFamily } });
      assert.match(cand.groupedConditionKey, /^condition fam-b\|/i);
      assert.ok(!/EXCESS_OVER_INVENTORY/i.test(cand.groupedConditionKey));
      // The classification is immutable.
      const raw = new DatabaseSync(tdb.file);
      try {
        assert.throws(() => raw.exec(`UPDATE iam_core_condition_classifications SET family_code = 'OTHER_GOVERNED_CONDITION' WHERE candidate_id = '${idFamily}'`), /IAM_CORE_LEDGER_APPEND_ONLY/);
        assert.throws(() => raw.exec(`DELETE FROM iam_core_condition_classifications WHERE candidate_id = '${idFamily}'`), /IAM_CORE_LEDGER_APPEND_ONLY/);
        assert.throws(() => raw.exec(`INSERT INTO iam_core_condition_classifications VALUES ('x','c','X','v','GUESS','a','2026-01-01',NULL)`), /FOREIGN KEY|IAM_CORE_CONDITION_FAMILY_SOURCE_VOCABULARY/);
      } finally {
        raw.close();
      }
    }));

  it("the learning record stores the family (with vocabulary version and source) separately from the condition detail", () =>
    withFixture(async (f) => {
      const id = await completedHistoryCandidate(f, { key: "learn-fam", describe: { conditionFamily: "SLOW_NONMOVING_INVENTORY" } });
      await closeOut(f, id, LEARN);
      const l = await f.db.iamCoreLearningRecord.findFirstOrThrow({ where: { candidateId: id } });
      assert.deepEqual([l.conditionFamily, l.conditionFamilyVersion, l.conditionFamilySource], ["SLOW_NONMOVING_INVENTORY", "IAM_CONDITION_FAMILY_V1", "PRODUCER"]);
      assert.equal(l.conditionType, "Condition learn-fam", "the free-text detail is kept, in its own field");
      const view = await readCloseout(f.db, f.ctx, id, MANAGER, at(40));
      assert.equal(view.conditionFamily?.code, "SLOW_NONMOVING_INVENTORY");
      assert.equal(view.conditionFamily?.label, "Slow / Nonmoving Inventory");
      assert.equal(view.conditionDetail, "Condition learn-fam");
      assert.equal(view.learning?.conditionFamilyLabel, "Slow / Nonmoving Inventory");
      // The learning record also keeps recommendation, plan, deviation, execution, condition result, attribution, expected vs actual, recurrence, lessons, limitations.
      for (const col of ["recommendationText", "planSummary", "managementResponse", "executionResultJson", "conditionResultJson", "attributionCategory", "expectedVsActualJson", "recurrenceJson", "whatWorked", "dataLimitationsJson"] as const) {
        assert.ok(col in l, col);
      }
      assert.ok(l.recommendationText && l.planSummary && l.executionResultJson && l.conditionResultJson && l.recurrenceJson);
    }));

  it("management may classify an unclassified candidate when recording learning; a different code against an existing classification is refused; nothing supplied records the labelled default", () =>
    withFixture(async (f) => {
      const classified = await completedHistoryCandidate(f, { key: "mgmt-conflict", describe: { conditionFamily: "SHORTAGE_BACKORDER" } });
      await startCloseout(f.db, f.ctx, MANAGER, classified, { at: at(20) });
      await recordMeasurement(f.db, f.ctx, MANAGER, classified, measurement({ at: at(30) }));
      await approveCloseout(f.db, f.ctx, MANAGER_2, classified, { finalStatus: "FULLY_RESOLVED", at: at(31) });
      await expectCode(recordLearning(f.db, f.ctx, MANAGER, classified, { ...LEARN, conditionFamily: "EXCESS_OVER_INVENTORY", at: at(32) }), "CONDITION_FAMILY_CONFLICT");
      await expectCode(recordLearning(f.db, f.ctx, MANAGER, classified, { ...LEARN, conditionFamily: "free text", at: at(32) }), "VOCABULARY_VIOLATION");
      await recordLearning(f.db, f.ctx, MANAGER, classified, { ...LEARN, conditionFamily: "SHORTAGE_BACKORDER", at: at(32) });

      const open = await completedHistoryCandidate(f, { key: "mgmt-classify" });
      await closeOut(f, open, { ...LEARN, conditionFamily: "VENDOR_SUPPLY_CONSTRAINT" });
      const cls = await f.db.iamCoreConditionClassification.findUniqueOrThrow({ where: { candidateId: open } });
      assert.deepEqual([cls.familyCode, cls.source], ["VENDOR_SUPPLY_CONSTRAINT", "MANAGEMENT"]);
      assert.equal((await f.db.iamCoreLearningRecord.findFirstOrThrow({ where: { candidateId: open } })).conditionFamilySource, "MANAGEMENT");

      const none = await completedHistoryCandidate(f, { key: "mgmt-none" });
      await closeOut(f, none, LEARN);
      const l = await f.db.iamCoreLearningRecord.findFirstOrThrow({ where: { candidateId: none } });
      assert.deepEqual([l.conditionFamily, l.conditionFamilySource], ["OTHER_GOVERNED_CONDITION", "DEFAULT_UNCLASSIFIED"]);
      assert.equal(await f.db.iamCoreConditionClassification.count({ where: { candidateId: none } }), 0, "the default is recorded on the learning record only; the candidate is not silently classified");
    }));

  it("effectiveness segments by condition FAMILY: different free-text details in one family share a segment; a learning-not-applicable closeout uses its classification", () =>
    withFixture(async (f) => {
      const a = await completedHistoryCandidate(f, { key: "eff-a", describe: { conditionFamily: "EXCESS_OVER_INVENTORY" } });
      const b = await completedHistoryCandidate(f, { key: "eff-b", describe: { conditionFamily: "EXCESS_OVER_INVENTORY" } });
      const c = await completedHistoryCandidate(f, { key: "eff-c", describe: { conditionFamily: "SHORTAGE_BACKORDER" } });
      await closeOut(f, a, LEARN);
      await closeOut(f, b, LEARN);
      await closeOut(f, c, null);
      const e = await readEffectiveness(f.db, f.ctx, at(40));
      assert.ok(!("conditionType" in e.segments), "the free-text detail is no longer an analytical segment");
      const byKey = Object.fromEntries(e.segments.conditionFamily.map((g) => [g.key, g]));
      assert.equal(byKey["EXCESS_OVER_INVENTORY"]?.closed, 2, "two different condition details, one governed family");
      assert.equal(byKey["EXCESS_OVER_INVENTORY"]?.label, "Excess / Over-Inventory");
      assert.equal(byKey["SHORTAGE_BACKORDER"]?.closed, 1, "the learning-not-applicable closeout is segmented by its classification");
      assert.equal(byKey["SHORTAGE_BACKORDER"]?.label, "Shortage / Backorder");
      assert.equal(e.segments.conditionFamily.some((g) => g.key === "Unspecified"), false);
    }));
});

describe("Stage 4E-C3: no universal resolution thresholds", () => {
  const adequate = assessWindow({ actionCompletedAt: new Date("2026-08-01T00:00:00Z"), measurementStart: new Date("2026-08-02T00:00:00Z"), measurementEnd: new Date("2026-08-20T00:00:00Z"), evidenceCurrentThrough: new Date("2026-08-21T00:00:00Z") });

  it("any partial reduction (1%, 50%, 99%) needs management judgement: the system never maps a percentage band to a status", () => {
    for (const final of [990, 500, 10]) {
      const m = measureCondition(1000, final, "USD");
      const g = resolutionGuidance(m, adequate);
      assert.equal(g.recommendedStatus, null, `reduction ${m.pct}% has no recommended status`);
      assert.equal(g.judgementRequired, true);
      assert.equal(g.basis.rule, "JUDGEMENT_REQUIRED");
      assert.match(g.basis.explanation, /No threshold is defined/);
    }
  });

  it("Substantially Resolved, Partially Resolved and Controlled but Continuing each require an explicit rationale (and are accepted with one)", () => {
    const m = measureCondition(1000, 400, "USD");
    const g = resolutionGuidance(m, adequate);
    for (const status of ["SUBSTANTIALLY_RESOLVED", "PARTIALLY_RESOLVED", "CONTROLLED_BUT_CONTINUING"]) {
      assert.throws(() => validateAssertedStatus(status, { measurement: m, guidance: g, rationale: null, evidenceRefs: ["ev-1"], field: "status" }), (e: { code?: string }) => e.code === "RATIONALE_REQUIRED", status);
      assert.equal(validateAssertedStatus(status, { measurement: m, guidance: g, rationale: "Management judged the remaining exposure acceptable.", evidenceRefs: ["ev-1"], field: "status" }), status);
    }
  });
});
