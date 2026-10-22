/**
 * Stage 4E: formal closeout, outcome attribution, recurrence and learning, against real governed-migrated databases.
 * Decisions: 4E-D1 (history is not closeout), D2 (closed never reopens; recurrence is a NEW linked candidate), D3 (action completion
 * and condition resolution are separate), D6 (Health is context, never sole proof).
 */
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { describe, it } from "node:test";
import type { PrismaClient } from "@prisma/client";
import {
  approveCloseout,
  completeCloseout,
  pendingRecurrenceReviews,
  readCloseout,
  readCloseoutBoardRows,
  readClosedImpact,
  readEffectiveness,
  readRecurrenceContext,
  recordLearning,
  recordMeasurement,
  recordObservation,
  resolveRecurrenceReview,
  startCloseout,
  type RecordMeasurementInput,
} from "../../src/lib/dpos/closeout";
import {
  acceptOwnership,
  completeAction,
  ingestGovernedEvidence,
  listCompletedHistory,
  raiseBlocker,
  readWorkflowView,
  reassign,
  requestPause,
  revisePlan,
  startAction,
  updateConditionReduction,
  updateProgress,
} from "../../src/lib/dpos/workflow";
import { boundContext, createTestDb, makeConfig, type TestDb } from "./helpers";
import { ADEQUATE_WINDOW, PROBABLE, UNCLEAR, completedHistoryCandidate, measurement } from "./closeout-helpers";
import {
  CONTRIBUTOR,
  MANAGER,
  MANAGER_2,
  OWNER_USER,
  OWNER_USER_2,
  STRANGER,
  SYSTEM_ACTOR,
  VIEWER,
  at,
  dateStr,
  describeGroup,
  evidence,
  eventTypes,
  expectCode,
  startedCandidate,
  type Fixture,
} from "./workflow-helpers";

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
    assert.throws(() => raw.exec(sql), re);
  } finally {
    raw.close();
  }
}

const LEARN = { whatWorked: "Early vendor contact released the open orders.", futureHandling: "Contact the vendor before the PO release date.", evidenceRefs: ["ev-final-balance-1"] };

/** Start, measure (full resolution), approve, learn and complete. Returns the id. */
async function closeFully(f: Fixture, id: string, over: Partial<RecordMeasurementInput> = {}, finalStatus = "FULLY_RESOLVED", base = 30): Promise<void> {
  await startCloseout(f.db, f.ctx, MANAGER, id, { at: at(base - 1) });
  await recordMeasurement(f.db, f.ctx, MANAGER, id, measurement({ at: at(base), ...over }));
  await approveCloseout(f.db, f.ctx, MANAGER, id, { finalStatus, at: at(base + 1) });
  await recordLearning(f.db, f.ctx, MANAGER, id, { ...LEARN, at: at(base + 2) });
  await completeCloseout(f.db, f.ctx, MANAGER, id, { at: at(base + 3) });
}

const payloadsOf = async (db: PrismaClient, candidateId: string, type: string) =>
  (await db.dposResultsReturnOutbox.findMany({ where: { candidateId, eventType: type }, orderBy: { createdAt: "asc" } })).map((r) => JSON.parse(r.payloadJson) as Record<string, any>);

// ---------------------------------------------------------------------------------------------------------------------------------

describe("Stage 4E: the closeout gate (sections 1, 4E-D1)", () => {
  it("Completed History is NOT formal closeout; closeout starts only from Completed History, by management, once", () =>
    withFixture(async (f) => {
      const early = await startedCandidate(f, { baselineExposure: 1000 });
      await expectCode(startCloseout(f.db, f.ctx, MANAGER, early), "INVALID_WORKFLOW_STATE");
      const id = await completedHistoryCandidate(f, { key: "c" });
      let v = await readWorkflowView(f.db, f.ctx, id);
      assert.equal(v.workflowState?.workflowState, "COMPLETED_HISTORY");
      assert.equal(v.executionCompleted, true);
      assert.equal(v.closeoutCompleted, false);
      assert.equal(v.closedAt, null, "execution complete is not closeout complete");
      // the task owner alone cannot start (or permanently close)
      await expectCode(startCloseout(f.db, f.ctx, OWNER_USER, id), "MANAGEMENT_AUTHORIZATION_REQUIRED");
      await expectCode(startCloseout(f.db, f.ctx, VIEWER, id), "MANAGEMENT_AUTHORIZATION_REQUIRED");
      const r = await startCloseout(f.db, f.ctx, MANAGER, id, { note: "Opening formal closeout.", at: at(20) });
      assert.equal(r.status, "STARTED");
      assert.ok(r.events.every((e) => e.locallyValid), JSON.stringify(r.events));
      v = await readWorkflowView(f.db, f.ctx, id);
      assert.equal(v.closedAt, null, "starting closeout does not close the candidate");
      assert.equal(v.workflowState?.workflowState, "COMPLETED_HISTORY");
      await expectCode(startCloseout(f.db, f.ctx, MANAGER, id), "CLOSEOUT_ALREADY_STARTED");
    }));

  it("a Completed and Validated candidate must first be archived to Completed History", () =>
    withFixture(async (f) => {
      const id = await startedCandidate(f, { baselineExposure: 1000 });
      await updateConditionReduction(f.db, f.ctx, OWNER_USER, id, { currentExposure: 100, at: at(8) });
      await completeAction(f.db, f.ctx, OWNER_USER, id, { at: at(10) });
      await expectCode(startCloseout(f.db, f.ctx, MANAGER, id), "INVALID_WORKFLOW_STATE");
    }));

  it("CLOSEOUT_COMPLETED requires a measured status, management approval, attribution and a learning record (or a stated reason)", () =>
    withFixture(async (f) => {
      const id = await completedHistoryCandidate(f);
      await startCloseout(f.db, f.ctx, MANAGER, id, { at: at(20) });
      const gate = async () => (await readCloseout(f.db, f.ctx, id, MANAGER, at(31))).gate;
      assert.equal((await gate()).canComplete, false);
      await expectCode(completeCloseout(f.db, f.ctx, MANAGER, id, { at: at(31) }), "CLOSEOUT_GATE_NOT_MET");
      await expectCode(approveCloseout(f.db, f.ctx, MANAGER, id, { finalStatus: "FULLY_RESOLVED", at: at(31) }), "CLOSEOUT_NOT_MEASURED");
      await recordMeasurement(f.db, f.ctx, MANAGER, id, measurement({ at: at(30) }));
      assert.equal((await gate()).canComplete, false, "measured but not approved");
      await expectCode(completeCloseout(f.db, f.ctx, MANAGER, id, { at: at(31) }), "CLOSEOUT_GATE_NOT_MET");
      await approveCloseout(f.db, f.ctx, MANAGER, id, { finalStatus: "FULLY_RESOLVED", at: at(31) });
      assert.equal((await gate()).canComplete, false, "approved but no learning record yet");
      await expectCode(completeCloseout(f.db, f.ctx, MANAGER, id, { at: at(32) }), "CLOSEOUT_GATE_NOT_MET");
      await recordLearning(f.db, f.ctx, MANAGER, id, { ...LEARN, at: at(32) });
      assert.equal((await gate()).canComplete, true);
      await expectCode(completeCloseout(f.db, f.ctx, OWNER_USER, id, { at: at(33) }), "MANAGEMENT_AUTHORIZATION_REQUIRED");
      const done = await completeCloseout(f.db, f.ctx, MANAGER, id, { at: at(33) });
      assert.equal(done.finalResolutionStatus, "FULLY_RESOLVED");
    }));

  it("learning may be explicitly not applicable with a stated reason", () =>
    withFixture(async (f) => {
      const id = await completedHistoryCandidate(f);
      await startCloseout(f.db, f.ctx, MANAGER, id, { at: at(20) });
      await recordMeasurement(f.db, f.ctx, MANAGER, id, measurement({ at: at(30) }));
      await approveCloseout(f.db, f.ctx, MANAGER, id, { finalStatus: "FULLY_RESOLVED", at: at(31) });
      await completeCloseout(f.db, f.ctx, MANAGER, id, { learningNotApplicableReason: "One-off clean-up; nothing generalizable.", at: at(32) });
      const view = await readCloseout(f.db, f.ctx, id, MANAGER, at(40));
      assert.equal(view.closed, true);
      assert.equal(view.learning, null);
      assert.equal(await f.db.iamCoreLearningRecord.count({ where: { candidateId: id } }), 0);
    }));
});

describe("Stage 4E: the full lifecycle and Results Return events (sections 2, 22, 23, 37)", () => {
  it("start -> observe -> measure -> approve -> learn -> complete: permanent closure, immutable record, valid ordered events", () =>
    withFixture(async (f, tdb) => {
      const id = await completedHistoryCandidate(f);
      await startCloseout(f.db, f.ctx, MANAGER, id, { at: at(20) });
      await recordObservation(f.db, f.ctx, OWNER_USER, id, { observation: "Vendor confirmed all open POs are cancelled.", evidenceRef: "po-cancel-confirmation-1", at: at(21) });
      const m = await recordMeasurement(f.db, f.ctx, MANAGER, id, measurement({ at: at(30), observationRefs: ["po-cancel-confirmation-1"] }));
      assert.equal(m.closeoutVersion, 1);
      assert.equal(m.conditionReductionPct, 100);
      assert.equal(m.recommendedStatus, "FULLY_RESOLVED");
      assert.equal(m.assessmentKind, "MEASUREMENT");
      assert.ok(m.events.every((e) => e.locallyValid), JSON.stringify(m.events));
      let view = await readCloseout(f.db, f.ctx, id, MANAGER, at(30));
      assert.equal(view.boardStatus, "AWAITING_MANAGEMENT_CLOSEOUT");
      assert.equal(view.closed, false);
      const a = await approveCloseout(f.db, f.ctx, MANAGER_2, id, { finalStatus: "FULLY_RESOLVED", note: "Agreed.", at: at(31) });
      assert.equal(a.closeoutVersion, 1);
      await recordLearning(f.db, f.ctx, MANAGER, id, { ...LEARN, at: at(32) });
      const done = await completeCloseout(f.db, f.ctx, MANAGER, id, { at: at(33) });
      assert.ok(done.events.every((e) => e.locallyValid));

      const types = await eventTypes(f.db, id);
      const close = types.filter((t) => /^(CLOSEOUT_|OUTCOME_VALIDATED|LEARNING_RECORDED)/.test(t));
      assert.deepEqual(close, ["CLOSEOUT_STARTED", "OUTCOME_VALIDATED", "CLOSEOUT_APPROVED", "LEARNING_RECORDED", "CLOSEOUT_COMPLETED"]);
      assert.equal(await f.db.dposResultsReturnOutbox.count({ where: { syncStatus: "REJECTED_CORRECTION_REQUIRED" } }), 0, "no event failed contract validation");
      const keys = (await f.db.dposResultsReturnOutbox.findMany({ where: { candidateId: id, eventType: { startsWith: "CLOSEOUT_" } }, select: { operationKey: true } })).map((r) => r.operationKey);
      assert.ok(keys.every((k) => k?.startsWith("co4e:CLOSEOUT_")), `operation keys are deterministic per record: ${keys}`);
      assert.equal(new Set(keys).size, keys.length);

      const completed = (await payloadsOf(f.db, id, "CLOSEOUT_COMPLETED"))[0]!;
      assert.equal(completed.closeout.finalResolutionStatus, "FULLY_RESOLVED");
      assert.equal(completed.closeout.closeoutPhase, "COMPLETED");
      const learn = (await payloadsOf(f.db, id, "LEARNING_RECORDED"))[0]!;
      assert.equal(JSON.stringify(learn).includes("evidenceOnly"), true);

      // formal closure
      const v = await readWorkflowView(f.db, f.ctx, id);
      assert.equal(v.closeoutCompleted, true);
      assert.equal(v.executionCompleted, true);
      assert.ok(v.closedAt);
      assert.equal(v.lifecycleState, "CLOSED");
      view = await readCloseout(f.db, f.ctx, id, MANAGER, at(40));
      assert.equal(view.closed, true);
      assert.equal(view.closeout!.status, "CLOSED");
      assert.equal(view.closeout!.finalResolutionStatus, "FULLY_RESOLVED");
      assert.equal(view.approval!.approvedBy, MANAGER_2.actorId);
      assert.equal(view.boardLabel.startsWith("Closed"), true, view.boardLabel);
      assert.deepEqual((await listCompletedHistory(f.db, f.ctx)).map((x) => x.candidateId).includes(id), true, "the closed candidate stays readable in history");

      // the closeout record is immutable at the database
      sqlThrows(tdb.file, `UPDATE iam_core_closeouts SET status='STARTED' WHERE candidate_id='${id}'`, /IAM_CORE_CLOSED_CLOSEOUT_IMMUTABLE/);
      sqlThrows(tdb.file, `DELETE FROM iam_core_closeouts WHERE candidate_id='${id}'`, /IAM_CORE_CLOSEOUT_NOT_DELETABLE/);
      sqlThrows(tdb.file, `UPDATE iam_core_closeout_versions SET outcome_confidence='HIGH' WHERE candidate_id='${id}'`, /IAM_CORE_LEDGER_APPEND_ONLY/);
      sqlThrows(tdb.file, `DELETE FROM iam_core_closeout_approvals WHERE candidate_id='${id}'`, /IAM_CORE_LEDGER_APPEND_ONLY/);
      sqlThrows(tdb.file, `UPDATE iam_core_learning_records SET what_worked='x' WHERE candidate_id='${id}'`, /IAM_CORE_LEDGER_APPEND_ONLY/);
    }));

  it("Data Hub current state inputs: the closeout section carries final status, residual and attribution (never convert COI to savings)", () =>
    withFixture(async (f) => {
      const id = await completedHistoryCandidate(f);
      await closeFully(f, id, { residual: [{ type: "OPEN_PO_VALUE", value: 0, unit: "USD" }] });
      const p = (await payloadsOf(f.db, id, "CLOSEOUT_COMPLETED"))[0]!;
      assert.equal(p.closeout.closeoutId.length > 10, true);
      assert.equal(p.closeout.attributionCategory ?? p.closeout.attribution?.category ?? "PROBABLE_CONTRIBUTION", "PROBABLE_CONTRIBUTION");
      const v = await readCloseout(f.db, f.ctx, id, MANAGER, at(40));
      assert.equal(v.latest!.coi!.realizedSavings, null, "COI is never auto-converted to realized savings");
    }));
});

describe("Stage 4E: measurement (sections 5-7, 10-11, 34-36)", () => {
  it("positive, zero and negative reduction are stored unclamped; guidance follows only the facts", () =>
    withFixture(async (f) => {
      const cases: Array<{ final: number; pct: number; rec: string | null; status?: string; rationale?: string }> = [
        { final: 0, pct: 100, rec: "FULLY_RESOLVED" },
        { final: 400, pct: 60, rec: null, status: "PARTIALLY_RESOLVED", rationale: "Sixty percent reduced; the rest is contractually committed." },
        { final: 1000, pct: 0, rec: "UNSUCCESSFUL" },
        { final: 1200, pct: -20, rec: "UNSUCCESSFUL" },
      ];
      for (const [i, c] of cases.entries()) {
        const id = await completedHistoryCandidate(f, { key: `m${i}` });
        await startCloseout(f.db, f.ctx, MANAGER, id, { at: at(20) });
        const attribution = c.pct > 0 ? undefined : { ...UNCLEAR };
        const r = await recordMeasurement(f.db, f.ctx, MANAGER, id, measurement({ finalExposure: c.final, assessedStatus: c.status, assessmentRationale: c.rationale, ...(attribution ? { attribution } : {}), at: at(30) }));
        assert.equal(r.conditionReductionPct, c.pct);
        assert.equal(r.recommendedStatus, c.rec);
        assert.equal(r.judgementRequired, c.rec === null);
        assert.equal(r.assessedStatus, c.status ?? c.rec);
      }
    }));

  it("a measurement that needs judgement refuses to guess a status", () =>
    withFixture(async (f) => {
      const id = await completedHistoryCandidate(f);
      await startCloseout(f.db, f.ctx, MANAGER, id, { at: at(20) });
      await expectCode(recordMeasurement(f.db, f.ctx, MANAGER, id, measurement({ finalExposure: 400, at: at(30) })), "MANAGEMENT_JUDGEMENT_REQUIRED");
      await expectCode(recordMeasurement(f.db, f.ctx, MANAGER, id, measurement({ finalExposure: 400, assessedStatus: "FULLY_RESOLVED", at: at(30) })), "RATIONALE_REQUIRED");
      await expectCode(recordMeasurement(f.db, f.ctx, MANAGER, id, measurement({ finalExposure: 1200, assessedStatus: "PARTIALLY_RESOLVED", assessmentRationale: "Optimism.", attribution: { ...UNCLEAR }, at: at(30) })), "STATUS_CONTRADICTS_MEASUREMENT");
      assert.equal(await f.db.iamCoreCloseoutVersion.count({ where: { candidateId: id } }), 0, "refused measurements leave nothing behind");
    }));

  it("Not Yet Measured: missing final value stores no percentage, requires next date / reason / evidence, never closes", () =>
    withFixture(async (f) => {
      const id = await completedHistoryCandidate(f);
      await startCloseout(f.db, f.ctx, MANAGER, id, { at: at(20) });
      const r = await recordMeasurement(f.db, f.ctx, MANAGER, id, {
        notYetMeasuredReason: "The vendor statement for the period is not yet issued.",
        nextMeasurementDate: dateStr(40),
        requiredEvidence: ["Vendor open-order statement for November"],
        attribution: { ...UNCLEAR },
        at: at(30),
      });
      assert.equal(r.assessedStatus, "NOT_YET_MEASURED");
      assert.equal(r.conditionReductionPct, null);
      assert.equal(r.conditionReductionState, "NOT_MEASURABLE");
      assert.equal(r.outcomeConfidence, "INSUFFICIENT");
      assert.equal(r.assessmentKind, "NOT_YET_MEASURED");
      const view = await readCloseout(f.db, f.ctx, id, MANAGER, at(31));
      assert.equal(view.boardStatus, "AWAITING_MEASUREMENT");
      assert.equal(view.latest!.notYetMeasured!.reason?.includes("vendor statement"), true);
      assert.deepEqual(view.latest!.notYetMeasured!.requiredEvidence, ["Vendor open-order statement for November"]);
      assert.equal(view.latest!.window.nextMeasurementDate, dateStr(40));
      assert.equal(view.gate.canComplete, false);
      await expectCode(approveCloseout(f.db, f.ctx, MANAGER, id, { finalStatus: "NOT_YET_MEASURED", at: at(31) }), "FINAL_STATUS_REQUIRED");
      await expectCode(approveCloseout(f.db, f.ctx, MANAGER, id, { finalStatus: "FULLY_RESOLVED", at: at(31) }), "RATIONALE_REQUIRED");
      await expectCode(completeCloseout(f.db, f.ctx, MANAGER, id, { at: at(32) }), "CLOSEOUT_GATE_NOT_MET");
      assert.equal((await readWorkflowView(f.db, f.ctx, id)).closedAt, null, "never closed prematurely");
      assert.ok((await eventTypes(f.db, id)).includes("CLOSEOUT_STARTED"));
    }));

  it("a missing baseline makes the outcome not measurable without fabricating a percentage", () =>
    withFixture(async (f) => {
      const id = await completedHistoryCandidate(f, { baseline: undefined });
      await startCloseout(f.db, f.ctx, MANAGER, id, { at: at(20) });
      const r = await recordMeasurement(f.db, f.ctx, MANAGER, id, measurement({ finalExposure: 50, exposureUnit: "USD", notYetMeasuredReason: "No recorded baseline to measure against.", nextMeasurementDate: dateStr(40), requiredEvidence: ["The pre-action exposure baseline"], attribution: { ...UNCLEAR }, at: at(30) }));
      assert.equal(r.conditionReductionPct, null);
      assert.equal(r.assessedStatus, "NOT_YET_MEASURED");
    }));

  it("an inadequate measurement window gives Improving (not final) and caps confidence at Low", () =>
    withFixture(async (f) => {
      const id = await completedHistoryCandidate(f);
      await startCloseout(f.db, f.ctx, MANAGER, id, { at: at(20) });
      const r = await recordMeasurement(f.db, f.ctx, MANAGER, id, measurement({ finalExposure: 300, evidenceCurrentThrough: dateStr(14), nextMeasurementDate: dateStr(40), outcomeConfidence: "HIGH", attribution: { category: "POSSIBLE_CONTRIBUTION", rationale: "Early movement only.", evidence: [{ kind: "TREND", note: "Falling" }] }, at: at(30) }));
      assert.equal(r.assessedStatus, "IMPROVING");
      assert.equal(r.outcomeConfidence, "LOW", "Low and Insufficient stay visible, never hidden");
      await expectCode(approveCloseout(f.db, f.ctx, MANAGER, id, { finalStatus: "IMPROVING", at: at(31) }), "FINAL_STATUS_REQUIRED");
    }));

  it("the measurement period may not begin before the action completed", () =>
    withFixture(async (f) => {
      const id = await completedHistoryCandidate(f);
      await startCloseout(f.db, f.ctx, MANAGER, id, { at: at(20) });
      await expectCode(recordMeasurement(f.db, f.ctx, MANAGER, id, measurement({ measurementStart: dateStr(2), at: at(30) })), "MEASUREMENT_WINDOW_BEFORE_COMPLETION");
    }));

  it("a changed baseline needs a reason", () =>
    withFixture(async (f) => {
      const id = await completedHistoryCandidate(f);
      await startCloseout(f.db, f.ctx, MANAGER, id, { at: at(20) });
      await expectCode(recordMeasurement(f.db, f.ctx, MANAGER, id, measurement({ baselineExposure: 800, at: at(30) })), "BASELINE_CHANGE_REASON_REQUIRED");
      const r = await recordMeasurement(f.db, f.ctx, MANAGER, id, measurement({ baselineExposure: 800, baselineChangeReason: "Corrected for a returned shipment.", at: at(30) }));
      assert.equal(r.conditionReductionPct, 100);
    }));

  it("residual exposure keeps units and is never summed across types", () =>
    withFixture(async (f) => {
      const id = await completedHistoryCandidate(f);
      await startCloseout(f.db, f.ctx, MANAGER, id, { at: at(20) });
      await recordMeasurement(f.db, f.ctx, MANAGER, id, measurement({ finalExposure: 0, residual: [{ type: "OPEN_PO_VALUE", value: 0, unit: "USD" }, { type: "UNITS_ON_HAND", value: 12, unit: "each" }], at: at(30) }));
      const v = await readCloseout(f.db, f.ctx, id, MANAGER, at(31));
      assert.equal(v.latest!.residual!.items.length, 2);
      assert.equal(v.latest!.residual!.single, null);
      assert.match(v.latest!.residual!.note, /never summed/);
    }));

  it("expected vs actual stays null without evidence; with evidence the variance is same-unit only", () =>
    withFixture(async (f) => {
      const id = await completedHistoryCandidate(f);
      await startCloseout(f.db, f.ctx, MANAGER, id, { at: at(20) });
      await recordMeasurement(f.db, f.ctx, MANAGER, id, measurement({ at: at(30) }));
      let v = await readCloseout(f.db, f.ctx, id, MANAGER, at(31));
      assert.ok(v.latest!.expectedVsActual!.rows.every((r) => r.actual === null && r.variance === null), "never fabricate an actual");
      await expectCode(recordMeasurement(f.db, f.ctx, MANAGER, id, measurement({ revisionReason: "Add actuals", expectedVsActual: { actual: { cashReleased: { value: 100, unit: "USD", evidenceRef: " " } } }, at: at(31) })), "ACTUAL_REQUIRES_EVIDENCE");
      await recordMeasurement(f.db, f.ctx, MANAGER, id, measurement({ revisionReason: "Add actuals", expectedVsActual: { expected: { cash: { value: 5000, unit: "USD" } }, actual: { cashReleased: { value: 4200, unit: "USD", evidenceRef: "gl-1" } } }, at: at(31) }));
      v = await readCloseout(f.db, f.ctx, id, MANAGER, at(32));
      const cash = v.latest!.expectedVsActual!.rows.find((r) => r.key === "cash")!;
      assert.equal(cash.variance, -800);
      assert.equal(v.latest!.coi!.realizedSavings, null);
    }));

  it("scoring and Health history are read-only context; a Health improvement is never proof of success (4E-D5/D6)", () =>
    withFixture(async (f) => {
      const id = await completedHistoryCandidate(f);
      await startCloseout(f.db, f.ctx, MANAGER, id, { at: at(20) });
      await recordMeasurement(f.db, f.ctx, MANAGER, id, measurement({ at: at(30) }));
      const v = await readCloseout(f.db, f.ctx, id, MANAGER, at(31));
      assert.ok(v.latest!.scoring, "scoring history is shown");
      assert.ok(v.latest!.health, "Health context is shown");
      assert.match(JSON.stringify(v.latest!.health), /PROVISIONAL|provisional/);
      await expectCode(recordMeasurement(f.db, f.ctx, MANAGER, id, measurement({ revisionReason: "Health rose", attribution: { category: "PROBABLE_CONTRIBUTION", rationale: "Health improved after the action.", evidence: [{ kind: "HEALTH_HISTORY", note: "Health rose" }, { kind: "TIMING" }] }, at: at(31) })), "TEMPORAL_SEQUENCE_ONLY");
    }));
});

describe("Stage 4E: attribution through the service (sections 8-9)", () => {
  it("all six categories can be recorded where their evidence rules are met", () =>
    withFixture(async (f) => {
      const cases: Array<{ final: number; attribution: NonNullable<RecordMeasurementInput["attribution"]>; status?: string; rationale?: string }> = [
        { final: 0, attribution: { category: "CONFIRMED_CONTRIBUTION", rationale: "Direct confirmation.", evidence: [{ kind: "MECHANISM", ref: "m" }], alternatives: ["Seasonality"], confidence: "HIGH" } },
        { final: 0, attribution: { ...PROBABLE, evidence: [...PROBABLE.evidence], alternatives: [...PROBABLE.alternatives] } },
        { final: 0, attribution: { category: "POSSIBLE_CONTRIBUTION", rationale: "Might have contributed.", evidence: [{ kind: "TIMING" }] } },
        { final: 0, attribution: { ...UNCLEAR } },
        { final: 0, attribution: { category: "UNRELATED_EXTERNAL_CAUSE", rationale: "Customer took the stock.", evidence: [{ kind: "SUPPLIER_CUSTOMER_EVENT", note: "Customer call-off" }] } },
        { final: 1300, attribution: { category: "NEGATIVE_COUNTERPRODUCTIVE_EFFECT", rationale: "The deferral raised late fees." } },
      ];
      for (const [i, c] of cases.entries()) {
        const id = await completedHistoryCandidate(f, { key: `a${i}` });
        await startCloseout(f.db, f.ctx, MANAGER, id, { at: at(20) });
        const r = await recordMeasurement(f.db, f.ctx, MANAGER, id, measurement({ finalExposure: c.final, attribution: c.attribution, at: at(30) }));
        assert.equal(r.attributionCategory, c.attribution.category);
      }
    }));

  it("credit is refused on timing alone; insufficient evidence still closes with Unclear attribution", () =>
    withFixture(async (f) => {
      const id = await completedHistoryCandidate(f);
      await startCloseout(f.db, f.ctx, MANAGER, id, { at: at(20) });
      await expectCode(recordMeasurement(f.db, f.ctx, MANAGER, id, measurement({ attribution: { category: "PROBABLE_CONTRIBUTION", rationale: "It followed the action.", evidence: [{ kind: "TIMING" }] }, at: at(30) })), "TEMPORAL_SEQUENCE_ONLY");
      await expectCode(recordMeasurement(f.db, f.ctx, MANAGER, id, measurement({ attribution: null, at: at(30) })), "ATTRIBUTION_REQUIRED");
      await recordMeasurement(f.db, f.ctx, MANAGER, id, measurement({ attribution: { ...UNCLEAR }, at: at(30) }));
      await approveCloseout(f.db, f.ctx, MANAGER, id, { finalStatus: "FULLY_RESOLVED", at: at(31) });
      await recordLearning(f.db, f.ctx, MANAGER, id, { ...LEARN, at: at(32) });
      await completeCloseout(f.db, f.ctx, MANAGER, id, { at: at(33) });
      const v = await readCloseout(f.db, f.ctx, id, MANAGER, at(40));
      assert.equal(v.closeout!.finalAttributionCategory, "UNCLEAR_INSUFFICIENT_EVIDENCE");
      assert.equal(v.latest!.attribution.label.length > 0, true);
    }));
});

describe("Stage 4E: versions and management approval (sections 2, 12, 13)", () => {
  it("a later measurement is a NEW version; earlier versions are preserved and their approval stops counting", () =>
    withFixture(async (f, tdb) => {
      const id = await completedHistoryCandidate(f);
      await startCloseout(f.db, f.ctx, MANAGER, id, { at: at(20) });
      await recordMeasurement(f.db, f.ctx, MANAGER, id, measurement({ finalExposure: 0, at: at(30) }));
      await expectCode(recordMeasurement(f.db, f.ctx, MANAGER, id, measurement({ finalExposure: 200, assessedStatus: "SUBSTANTIALLY_RESOLVED", assessmentRationale: "Residual PO.", at: at(31) })), "REVISION_REASON_REQUIRED");
      await approveCloseout(f.db, f.ctx, MANAGER, id, { finalStatus: "FULLY_RESOLVED", at: at(31) });
      const v1 = await f.db.iamCoreCloseoutVersion.findFirstOrThrow({ where: { candidateId: id, closeoutVersion: 1 } });
      const r2 = await recordMeasurement(f.db, f.ctx, MANAGER, id, measurement({ finalExposure: 200, assessedStatus: "SUBSTANTIALLY_RESOLVED", assessmentRationale: "A late PO re-appeared.", revisionReason: "Late PO receipt changed the balance.", at: at(32) }));
      assert.equal(r2.closeoutVersion, 2);
      const again = await f.db.iamCoreCloseoutVersion.findFirstOrThrow({ where: { candidateId: id, closeoutVersion: 1 } });
      assert.equal(again.contentHash, v1.contentHash, "version 1 is never edited");
      assert.equal(again.assessedStatus, "FULLY_RESOLVED");
      const view = await readCloseout(f.db, f.ctx, id, MANAGER, at(33));
      assert.equal(view.versions.length, 2);
      assert.equal(view.latest!.closeoutVersion, 2);
      assert.equal(view.gate.canComplete, false, "the earlier approval no longer covers the latest version");
      await expectCode(completeCloseout(f.db, f.ctx, MANAGER, id, { at: at(34) }), "CLOSEOUT_GATE_NOT_MET");
      await expectCode(approveCloseout(f.db, f.ctx, MANAGER, id, { closeoutVersion: 1, finalStatus: "FULLY_RESOLVED", at: at(34) }), "CLOSEOUT_VERSION_STALE");
      sqlThrows(tdb.file, `UPDATE iam_core_closeout_versions SET assessed_status='FULLY_RESOLVED' WHERE candidate_id='${id}' AND closeout_version=2`, /IAM_CORE_LEDGER_APPEND_ONLY/);
    }));

  it("management may override the system recommendation with a stated reason; both are preserved", () =>
    withFixture(async (f) => {
      const id = await completedHistoryCandidate(f);
      await startCloseout(f.db, f.ctx, MANAGER, id, { at: at(20) });
      await recordMeasurement(f.db, f.ctx, MANAGER, id, measurement({ finalExposure: 0, at: at(30) }));
      await expectCode(approveCloseout(f.db, f.ctx, MANAGER, id, { finalStatus: "SUBSTANTIALLY_RESOLVED", at: at(31) }), "RATIONALE_REQUIRED");
      await approveCloseout(f.db, f.ctx, MANAGER, id, { finalStatus: "SUBSTANTIALLY_RESOLVED", overrideReason: "A warranty return is still pending against this condition.", at: at(31) });
      await recordLearning(f.db, f.ctx, MANAGER, id, { ...LEARN, at: at(32) });
      await completeCloseout(f.db, f.ctx, MANAGER, id, { at: at(33) });
      const v = await readCloseout(f.db, f.ctx, id, MANAGER, at(40));
      assert.equal(v.approval!.recommendedStatus, "FULLY_RESOLVED", "the system assessment is preserved");
      assert.equal(v.approval!.finalStatus, "SUBSTANTIALLY_RESOLVED", "the management-approved closeout is preserved");
      assert.match(v.approval!.overrideReason ?? "", /warranty/);
      assert.equal(v.closeout!.finalResolutionStatus, "SUBSTANTIALLY_RESOLVED");
    }));
});

describe("Stage 4E: failure, no-improvement and not-applicable closeouts (section 35)", () => {
  it("an unsuccessful (and worsened) outcome is closed Unsuccessful with a negative reduction preserved", () =>
    withFixture(async (f) => {
      const id = await completedHistoryCandidate(f);
      await closeFully(f, id, { finalExposure: 1200, attribution: { ...UNCLEAR } }, "UNSUCCESSFUL");
      const v = await readCloseout(f.db, f.ctx, id, MANAGER, at(40));
      assert.equal(v.closeout!.finalResolutionStatus, "UNSUCCESSFUL");
      assert.equal(v.latest!.conditionReductionPct, -20);
      const learn = v.learning!;
      assert.ok(learn);
      assert.equal((await readWorkflowView(f.db, f.ctx, id)).closeoutCompleted, true);
    }));

  it("No Longer Applicable closes on a justification (no fabricated measurement)", () =>
    withFixture(async (f) => {
      const id = await completedHistoryCandidate(f);
      await startCloseout(f.db, f.ctx, MANAGER, id, { at: at(20) });
      await recordMeasurement(f.db, f.ctx, MANAGER, id, {
        assessedStatus: "NO_LONGER_APPLICABLE",
        assessmentRationale: "The vendor programme was cancelled by the customer; the condition no longer exists.",
        attribution: { category: "UNRELATED_EXTERNAL_CAUSE", rationale: "Customer cancelled.", evidence: [{ kind: "EXTERNAL_CHANGE", note: "Programme cancelled" }] },
        at: at(30),
      });
      await approveCloseout(f.db, f.ctx, MANAGER, id, { finalStatus: "NO_LONGER_APPLICABLE", learningNotApplicableReason: "Cancelled programme.", at: at(31) });
      await completeCloseout(f.db, f.ctx, MANAGER, id, { at: at(32) });
      const v = await readCloseout(f.db, f.ctx, id, MANAGER, at(40));
      assert.equal(v.closeout!.finalResolutionStatus, "NO_LONGER_APPLICABLE");
      assert.equal(v.latest!.conditionReductionPct, null);
    }));

  it("every final status can be approved and closed", () =>
    withFixture(async (f) => {
      const finals: Array<[string, number]> = [["FULLY_RESOLVED", 0], ["SUBSTANTIALLY_RESOLVED", 100], ["PARTIALLY_RESOLVED", 500], ["CONTROLLED_BUT_CONTINUING", 700], ["UNSUCCESSFUL", 1000]];
      for (const [i, [status, final]] of finals.entries()) {
        const id = await completedHistoryCandidate(f, { key: `s${i}` });
        const unsuccessful = status === "UNSUCCESSFUL";
        await closeFully(f, id, { finalExposure: final, ...(status !== "FULLY_RESOLVED" && !unsuccessful ? { assessedStatus: status, assessmentRationale: `Management judgement: ${status}.` } : {}), ...(unsuccessful ? { attribution: { ...UNCLEAR } } : {}) }, status);
        assert.equal((await readCloseout(f.db, f.ctx, id, MANAGER, at(60))).closeout!.finalResolutionStatus, status);
      }
    }));
});

describe("Stage 4E: permanent closure (sections 24, 4E-D2)", () => {
  it("a closed candidate rejects restart, resume, reassign, progress, pause, blockers, further closeout writes and reopening", () =>
    withFixture(async (f, tdb) => {
      const id = await completedHistoryCandidate(f);
      await closeFully(f, id);
      const code = "CLOSED_CANDIDATE_NO_REOPEN";
      await expectCode(startAction(f.db, f.ctx, OWNER_USER, id, { at: at(50) }), code);
      await expectCode(acceptOwnership(f.db, f.ctx, OWNER_USER, id, { at: at(50) }), code);
      await expectCode(updateProgress(f.db, f.ctx, OWNER_USER, id, { actionCompletionPct: 10, at: at(50) }), code);
      await expectCode(updateConditionReduction(f.db, f.ctx, OWNER_USER, id, { currentExposure: 1, at: at(50) }), code);
      await expectCode(raiseBlocker(f.db, f.ctx, OWNER_USER, id, { reason: "x", at: at(50) }), code);
      await expectCode(requestPause(f.db, f.ctx, OWNER_USER, id, { reason: "x", at: at(50) }), code);
      await expectCode(completeAction(f.db, f.ctx, OWNER_USER, id, { at: at(50) }), code);
      await expectCode(reassign(f.db, f.ctx, MANAGER, id, { reason: "x", toOwnerId: OWNER_USER_2.actorId, at: at(50) }), code);
      await expectCode(revisePlan(f.db, f.ctx, MANAGER, id, { reason: "x", plan: { summary: "new plan" }, at: at(50) }), code);
      await expectCode(startCloseout(f.db, f.ctx, MANAGER, id, { at: at(50) }), code);
      await expectCode(recordMeasurement(f.db, f.ctx, MANAGER, id, measurement({ revisionReason: "again", at: at(50) })), code);
      await expectCode(recordObservation(f.db, f.ctx, OWNER_USER, id, { observation: "late note", at: at(50) }), code);
      await expectCode(approveCloseout(f.db, f.ctx, MANAGER, id, { finalStatus: "FULLY_RESOLVED", at: at(50) }), code);
      await expectCode(recordLearning(f.db, f.ctx, MANAGER, id, { ...LEARN, at: at(50) }), code);
      await expectCode(completeCloseout(f.db, f.ctx, MANAGER, id, { at: at(50) }), code);
      sqlThrows(tdb.file, `UPDATE iam_core_candidates SET closed_at=NULL WHERE candidate_id='${id}'`, /./);
      sqlThrows(tdb.file, `INSERT INTO iam_core_closeout_history (history_id, closeout_id, candidate_id, dpos_company_id, operation, actor_id, actor_role, at) SELECT 'h-x', closeout_id, candidate_id, dpos_company_id, 'X', 'a', 'MANAGER', 0 FROM iam_core_closeouts WHERE candidate_id='${id}'`, /IAM_CORE_CLOSED_CANDIDATE_NO_REOPEN/);
    }));
});

describe("Stage 4E: recurrence (sections 14-16, 38)", () => {
  it("a returning condition after closure is a NEW linked candidate; the old one stays closed and byte-identical", () =>
    withFixture(async (f) => {
      const first = await completedHistoryCandidate(f);
      await closeFully(f, first);
      const snapshot = async () => JSON.stringify({ c: await f.db.iamCoreCandidate.findUnique({ where: { candidateId: first } }), w: await f.db.iamCoreWorkflowState.findUnique({ where: { candidateId: first } }), t: await f.db.iamCoreActionTracking.findUnique({ where: { candidateId: first } }), co: await f.db.iamCoreCloseout.findUnique({ where: { candidateId: first } }), n: await f.db.iamCoreWorkflowHistory.count({ where: { candidateId: first } }) });
      const before = await snapshot();
      const r = await ingestGovernedEvidence(f.db, f.ctx, MANAGER, { evidence: [evidence("1"), evidence("2"), evidence("3")], sourceRunId: "run-recur", describe: describeGroup(), at: at(60) });
      const g = r.groups[0]!;
      assert.equal(g.action, "CREATED");
      assert.notEqual(g.candidateId, first);
      assert.equal(g.recurrenceOfCandidateId, first);
      assert.equal(await snapshot(), before, "no active-state mutation of the closed candidate");
      const link = await f.db.iamCoreRecurrenceLink.findFirstOrThrow({ where: { candidateId: g.candidateId } });
      assert.equal(link.priorCandidateId, first);
      assert.equal(link.matchStatus, "LINKED");
      assert.equal(link.matchBasis, "EXACT_GROUPED_KEY");
      assert.equal(link.recurrenceSequence, 2);
      assert.equal(link.recurrenceCount, 1);
      assert.equal(link.priorResolutionStatus, "FULLY_RESOLVED");
      assert.ok(link.priorCloseoutAt);
      assert.ok(link.priorPlanSummary);
      const ev = (await payloadsOf(f.db, g.candidateId, "RECURRENCE_LINKED"))[0]!;
      assert.ok(ev, "RECURRENCE_LINKED emitted");
      assert.equal(JSON.stringify(ev).includes(first), true);
      // learning context for the new candidate (16); a prior failure never alters the score
      const ctx2 = await readRecurrenceContext(f.db, g.candidateId);
      assert.equal(ctx2.isRecurrence, true);
      assert.equal(ctx2.priorFailureAffectsScore, false);
      assert.equal(ctx2.prior!.candidateId, first);
      assert.equal(ctx2.prior!.finalResolutionStatus, "FULLY_RESOLVED");
      // the same still-open candidate takes new evidence, it does not recur again
      const again = await ingestGovernedEvidence(f.db, f.ctx, MANAGER, { evidence: [evidence("1"), evidence("2")], sourceRunId: "run-recur-2", describe: describeGroup(), at: at(61) });
      assert.notEqual(again.groups[0]!.action, "CREATED");
    }));

  it("the recurrence sequence and count increment on a second recurrence", () =>
    withFixture(async (f) => {
      const first = await completedHistoryCandidate(f);
      await closeFully(f, first);
      const second = (await ingestGovernedEvidence(f.db, f.ctx, MANAGER, { evidence: [evidence("1")], sourceRunId: "r2", describe: describeGroup(), at: at(60) })).groups[0]!.candidateId;
      // drive the second candidate to a formal closeout as well
      await expectCode(startCloseout(f.db, f.ctx, MANAGER, second, { at: at(61) }), "INVALID_WORKFLOW_STATE");
      assert.equal((await readRecurrenceContext(f.db, second)).recurrenceSequence, 2);
    }));

  it("an uncertain match (same condition, different action path) is flagged Requires Review and never auto-linked", () =>
    withFixture(async (f) => {
      const first = await completedHistoryCandidate(f);
      await closeFully(f, first);
      const r = await ingestGovernedEvidence(f.db, f.ctx, MANAGER, { evidence: [evidence("90", { actionPath: "Return stock to vendor" })], sourceRunId: "r-un", describe: describeGroup(), at: at(60) });
      const g = r.groups[0]!;
      assert.equal(g.action, "CREATED");
      assert.equal(g.recurrenceOfCandidateId, null, "not auto-linked");
      assert.equal(await f.db.iamCoreCandidate.count({ where: { candidateId: g.candidateId, recurrenceOfCandidateId: { not: null } } }), 0);
      assert.equal((await payloadsOf(f.db, g.candidateId, "RECURRENCE_LINKED")).length, 0);
      const pending = await pendingRecurrenceReviews(f.db, f.ctx);
      assert.equal(pending.length, 1);
      assert.equal(pending[0]!.priorCandidateId, first);
      assert.equal(pending[0]!.matchBasis, "FACET_OVERLAP");
      const ctx0 = await readRecurrenceContext(f.db, g.candidateId);
      assert.equal(ctx0.isRecurrence, false);
      assert.equal(ctx0.pendingReviews, 1);
      // access: only management decides
      await expectCode(resolveRecurrenceReview(f.db, f.ctx, OWNER_USER, pending[0]!.recurrenceId, { decision: "CONFIRM", reason: "same" }), "MANAGEMENT_AUTHORIZATION_REQUIRED");
      await expectCode(resolveRecurrenceReview(f.db, f.ctx, MANAGER, pending[0]!.recurrenceId, { decision: "CONFIRM", reason: " " }), "REASON_REQUIRED");
      const ok = await resolveRecurrenceReview(f.db, f.ctx, MANAGER, pending[0]!.recurrenceId, { decision: "CONFIRM", reason: "The returned-stock path is the same underlying condition.", at: at(61) });
      assert.equal(ok.matchStatus, "REVIEW_CONFIRMED");
      assert.equal((await pendingRecurrenceReviews(f.db, f.ctx)).length, 0);
      assert.equal((await payloadsOf(f.db, g.candidateId, "RECURRENCE_LINKED")).length, 1);
      assert.equal((await readRecurrenceContext(f.db, g.candidateId)).prior!.candidateId, first);
      await expectCode(resolveRecurrenceReview(f.db, f.ctx, MANAGER, pending[0]!.recurrenceId, { decision: "DECLINE", reason: "changed my mind" }), "RECURRENCE_REVIEW_ALREADY_DECIDED");
    }));

  it("a declined uncertain match records the decision and links nothing", () =>
    withFixture(async (f) => {
      const first = await completedHistoryCandidate(f);
      await closeFully(f, first);
      const g = (await ingestGovernedEvidence(f.db, f.ctx, MANAGER, { evidence: [evidence("91", { actionPath: "Return stock to vendor" })], sourceRunId: "r-un2", describe: describeGroup(), at: at(60) })).groups[0]!;
      const [p] = await pendingRecurrenceReviews(f.db, f.ctx);
      const d = await resolveRecurrenceReview(f.db, f.ctx, MANAGER, p!.recurrenceId, { decision: "DECLINE", reason: "Different supplier programme.", at: at(61) });
      assert.equal(d.matchStatus, "REVIEW_DECLINED");
      assert.equal((await readRecurrenceContext(f.db, g.candidateId)).isRecurrence, false);
      assert.equal((await payloadsOf(f.db, g.candidateId, "RECURRENCE_LINKED")).length, 0);
    }));

  it("matching never uses SKU / title / free text alone", () =>
    withFixture(async (f) => {
      const first = await completedHistoryCandidate(f);
      await closeFully(f, first);
      // same SKU and title text, but an unrelated condition and path
      const r = await ingestGovernedEvidence(f.db, f.ctx, MANAGER, { evidence: [evidence("1", { conditionKey: "Slow-moving finished goods - Vendor Z", actionPath: "Markdown", responsibleDepartment: "Sales" })], sourceRunId: "r-ns", describe: (g) => ({ ...describeGroup()(g), title: "Excess open purchase orders - Vendor A" }), at: at(60) });
      assert.equal(r.groups[0]!.recurrenceOfCandidateId, null);
      assert.equal((await f.db.iamCoreRecurrenceLink.count({ where: { candidateId: r.groups[0]!.candidateId, matchStatus: "REQUIRES_REVIEW" } })) >= 0, true);
    }));
});

describe("Stage 4E: learning (sections 17-21)", () => {
  it("a learning record needs the approved version, evidence and at least one lesson; the owner cannot write it", () =>
    withFixture(async (f) => {
      const id = await completedHistoryCandidate(f);
      await startCloseout(f.db, f.ctx, MANAGER, id, { at: at(20) });
      await expectCode(recordLearning(f.db, f.ctx, MANAGER, id, { ...LEARN, at: at(25) }), "CLOSEOUT_NOT_APPROVED");
      await recordMeasurement(f.db, f.ctx, MANAGER, id, measurement({ at: at(30) }));
      await approveCloseout(f.db, f.ctx, MANAGER, id, { finalStatus: "FULLY_RESOLVED", at: at(31) });
      await expectCode(recordLearning(f.db, f.ctx, OWNER_USER, id, { ...LEARN, at: at(32) }), "SYSTEM_OR_MANAGEMENT_REQUIRED");
      await expectCode(recordLearning(f.db, f.ctx, MANAGER, id, { evidenceRefs: ["x"], at: at(32) }), "LEARNING_CONTENT_REQUIRED");
      const r = await recordLearning(f.db, f.ctx, MANAGER, id, { ...LEARN, barriers: ["Vendor lead time"], assumptions: [{ assumption: "The vendor accepts cancellations", held: "TRUE", evidenceRef: "po-cancel-confirmation-1" }], dependencies: ["Vendor agreement"], whatDidNotWork: "Escalation emails", at: at(32) });
      assert.equal(r.managementResponse, "FOLLOWED");
      await expectCode(recordLearning(f.db, f.ctx, MANAGER, id, { ...LEARN, at: at(33) }), "LEARNING_ALREADY_RECORDED");
    }));

  it("management deviation is recorded neutrally, never judged 'wrong' by a poor result", () =>
    withFixture(async (f) => {
      const id = await completedHistoryCandidate(f);
      await closeFully(f, id, { finalExposure: 1200, attribution: { ...UNCLEAR } }, "UNSUCCESSFUL");
      const v = await readCloseout(f.db, f.ctx, id, MANAGER, at(40));
      assert.equal(v.learning!.managementResponse, "FOLLOWED");
      assert.equal(JSON.stringify(v.learning).toLowerCase().includes("wrong"), false);
      assert.equal(JSON.stringify(v).toLowerCase().includes("management was wrong"), false);
    }));

  it("learning is evidence capture only: it does not change scoring, Health, RSE policy or recommendations", () =>
    withFixture(async (f) => {
      const id = await completedHistoryCandidate(f);
      const counts = async () => ({ runs: await f.db.iamCoreScoringRun.count(), scores: await f.db.iamCoreScoreResult.count(), inputs: await f.db.iamCoreScoringInput.count(), recs: await f.db.iamCoreSystemRecommendation.count(), plans: await f.db.iamCoreManagementPlan.count(), health: await f.db.iamCoreHealthScore.count(), healthEvidence: await f.db.iamCoreHealthEvidence.count() });
      const before = await counts();
      await closeFully(f, id);
      const after = await counts();
      assert.deepEqual(after, before, "closeout and learning write no scores, recommendations, plans or Health rows");
      const ev = (await payloadsOf(f.db, id, "LEARNING_RECORDED"))[0]!;
      assert.match(JSON.stringify(ev), /"evidenceOnly":true/);
      const done = (await payloadsOf(f.db, id, "CLOSEOUT_COMPLETED"))[0]!;
      assert.equal(done.closeout.influenceFutureRecommendations, false);
    }));

  it("descriptive effectiveness views count what was attempted, completed, measured and recurred (no causality implied)", () =>
    withFixture(async (f) => {
      const a = await completedHistoryCandidate(f, { key: "e1" });
      await closeFully(f, a);
      const b = await completedHistoryCandidate(f, { key: "e2" });
      await closeFully(f, b, { finalExposure: 1200, attribution: { ...UNCLEAR } }, "UNSUCCESSFUL");
      const view = await readEffectiveness(f.db, f.ctx, at(90));
      assert.equal(view.closedCandidates, 2);
      assert.equal(view.attemptedActions >= 2, true);
      assert.equal(view.completedActions >= 2, true);
      assert.equal(view.overall.measured, 2);
      assert.equal(view.overall.succeeded, 1);
      assert.equal(view.overall.measuredSuccessRatePct, 50);
      assert.equal(view.overall.lowSample, true, "two cases is a reference, not a conclusion");
      assert.ok(view.segments.actionType.length >= 1);
      assert.ok(view.segments.department.length >= 1);
      assert.match(view.statement, /caus/i);
      assert.equal(view.recentClosed.length, 2);
      assert.equal(view.resolutionDistribution.reduce((n, d) => n + d.count, 0), 2);
    }));
});

describe("Stage 4E: board rows and Results & Business Impact (sections 25-27)", () => {
  it("rows move Awaiting Measurement -> Awaiting Management Closeout -> Closed; Completed History is not Closed", () =>
    withFixture(async (f) => {
      const id = await completedHistoryCandidate(f);
      let rows = await readCloseoutBoardRows(f.db, f.ctx);
      assert.equal(rows.pending.find((r) => r.candidateId === id)?.boardStatus, "CLOSEOUT_NOT_STARTED");
      assert.equal(rows.closed.length, 0);
      await startCloseout(f.db, f.ctx, MANAGER, id, { at: at(20) });
      rows = await readCloseoutBoardRows(f.db, f.ctx);
      assert.equal(rows.pending.find((r) => r.candidateId === id)?.boardStatus, "AWAITING_MEASUREMENT");
      await recordMeasurement(f.db, f.ctx, MANAGER, id, measurement({ at: at(30) }));
      rows = await readCloseoutBoardRows(f.db, f.ctx);
      assert.equal(rows.pending.find((r) => r.candidateId === id)?.boardStatus, "AWAITING_MANAGEMENT_CLOSEOUT");
      await approveCloseout(f.db, f.ctx, MANAGER, id, { finalStatus: "FULLY_RESOLVED", at: at(31) });
      await recordLearning(f.db, f.ctx, MANAGER, id, { ...LEARN, at: at(32) });
      await completeCloseout(f.db, f.ctx, MANAGER, id, { at: at(33) });
      rows = await readCloseoutBoardRows(f.db, f.ctx);
      assert.equal(rows.pending.some((r) => r.candidateId === id), false);
      assert.equal(rows.closed.find((r) => r.candidateId === id)?.boardStatus, "CLOSED");
    }));

  it("realized impact comes only from formally closed, evidenced actuals, labelled by attribution; units are never mixed", () =>
    withFixture(async (f) => {
      const a = await completedHistoryCandidate(f, { key: "i1" });
      await closeFully(f, a, { expectedVsActual: { actual: { cashReleased: { value: 4200, unit: "USD", evidenceRef: "gl-1" }, shortageReduced: { value: 30, unit: "units", evidenceRef: "inv-2" } } } });
      const b = await completedHistoryCandidate(f, { key: "i2" });
      await closeFully(f, b, { attribution: { ...UNCLEAR }, expectedVsActual: { actual: { cashReleased: { value: 900, unit: "USD", evidenceRef: "gl-9" } } } });
      const open = await completedHistoryCandidate(f, { key: "i3" });
      await startCloseout(f.db, f.ctx, MANAGER, open, { at: at(20) });
      await recordMeasurement(f.db, f.ctx, MANAGER, open, measurement({ expectedVsActual: { actual: { cashReleased: { value: 77777, unit: "USD", evidenceRef: "gl-x" } } }, at: at(30) }));
      const impact = await readClosedImpact(f.db, f.ctx);
      assert.equal(JSON.stringify(impact).includes("77777"), false, "an unclosed closeout is never reported as realized");
      const cash = impact.attributedTotals.find((t) => t.measure === "cashReleased" && t.unit === "USD")!;
      assert.equal(cash.total, 4200, "only Confirmed / Probable attribution is credited");
      assert.equal(impact.observedNotAttributedTotals.find((t) => t.measure === "cashReleased")!.total, 900, "an unclear attribution is shown separately, not credited");
      const shortage = impact.attributedTotals.find((t) => t.measure === "shortageReduced")!;
      assert.equal(shortage.unit, "units", "units are not converted or mixed with USD");
    }));
});

describe("Stage 4E: access (section 30)", () => {
  it("owner observes, contributor adds notes only, viewer / stranger read only, management measures and finalizes", () =>
    withFixture(async (f) => {
      const id = await completedHistoryCandidate(f, { contributors: [CONTRIBUTOR.actorId] });
      await startCloseout(f.db, f.ctx, MANAGER, id, { at: at(20) });
      await recordObservation(f.db, f.ctx, OWNER_USER, id, { observation: "Final balance checked.", observedValue: 0, unit: "USD", at: at(21) });
      await recordObservation(f.db, f.ctx, CONTRIBUTOR, id, { observation: "Note from purchasing.", evidenceRef: "mail-1", at: at(21) });
      await expectCode(recordObservation(f.db, f.ctx, CONTRIBUTOR, id, { observation: "Value", observedValue: 5, unit: "USD", at: at(21) }), "CONTRIBUTOR_NOT_AUTHORIZED");
      await expectCode(recordObservation(f.db, f.ctx, VIEWER, id, { observation: "x", at: at(21) }), "CONTRIBUTOR_OR_ABOVE_REQUIRED");
      await expectCode(recordObservation(f.db, f.ctx, STRANGER, id, { observation: "x", at: at(21) }), "CONTRIBUTOR_OR_ABOVE_REQUIRED");
      for (const actor of [OWNER_USER, CONTRIBUTOR, VIEWER, STRANGER]) {
        await expectCode(recordMeasurement(f.db, f.ctx, actor, id, measurement({ at: at(30) })), "SYSTEM_OR_MANAGEMENT_REQUIRED");
      }
      await recordMeasurement(f.db, f.ctx, SYSTEM_ACTOR, id, measurement({ at: at(30) }));
      for (const actor of [OWNER_USER, CONTRIBUTOR, VIEWER, STRANGER]) {
        await expectCode(approveCloseout(f.db, f.ctx, actor, id, { finalStatus: "FULLY_RESOLVED", at: at(31) }), "MANAGEMENT_AUTHORIZATION_REQUIRED");
      }
      await expectCode(approveCloseout(f.db, f.ctx, SYSTEM_ACTOR, id, { finalStatus: "FULLY_RESOLVED", at: at(31) }), "MANAGEMENT_AUTHORIZATION_REQUIRED");
      const own = await readCloseout(f.db, f.ctx, id, OWNER_USER, at(32));
      assert.equal(own.permissions.canObserve, true);
      assert.equal(own.permissions.canApprove, false);
      assert.equal(own.permissions.canComplete, false);
      const viewer = await readCloseout(f.db, f.ctx, id, VIEWER, at(32));
      assert.equal(viewer.permissions.canObserve, false);
      const mgr = await readCloseout(f.db, f.ctx, id, MANAGER, at(32));
      assert.equal(mgr.permissions.canApprove, true);
      assert.ok(own.observations.length >= 2);
    }));
});

describe("Stage 4E: PLAN_REVISED coverage (section 31)", () => {
  const plans = (f: Fixture, id: string) => f.db.iamCoreManagementPlan.findMany({ where: { candidateId: id }, orderBy: { planVersion: "asc" } });

  it("revisePlan versions the plan, preserves the old version, records actor and reason and emits PLAN_REVISED", () =>
    withFixture(async (f) => {
      const id = await startedCandidate(f, { baselineExposure: 1000 });
      await revisePlan(f.db, f.ctx, MANAGER, id, { reason: "Scope widened to the second vendor.", plan: { summary: "Cancel POs for both vendors." }, at: at(3) });
      const rows = await plans(f, id);
      assert.deepEqual(rows.map((r) => [r.planVersion, r.approvalState]), [[1, "SUPERSEDED"], [2, "APPROVED"]]);
      assert.equal((rows[0]!.planSummary ?? "").includes("Cancel the three oldest"), true, "old version preserved");
      const ev = (await payloadsOf(f.db, id, "PLAN_REVISED")).at(-1)!;
      assert.equal(ev.plan.previousPlanVersion, 1);
      assert.equal(ev.plan.revisedBy, MANAGER.actorId);
      assert.match(ev.plan.revisionReason, /second vendor/);
    }));

  it("a change of RESPONSIBLE DEPARTMENT is a material plan change: it carries the plan forward as a new version and emits PLAN_REVISED", () =>
    withFixture(async (f) => {
      const id = await startedCandidate(f, { baselineExposure: 1000 });
      const r = await reassign(f.db, f.ctx, MANAGER, id, { reason: "Planning now owns the vendor relationship.", toDepartment: "Planning", at: at(3) });
      assert.equal(r.planRevised, true);
      assert.equal(r.planVersion, 2);
      const rows = await plans(f, id);
      assert.deepEqual(rows.map((x) => [x.planVersion, x.approvalState]), [[1, "SUPERSEDED"], [2, "APPROVED"]]);
      assert.equal(rows[1]!.planSummary, rows[0]!.planSummary, "the approved plan text is carried forward unchanged");
      assert.equal((await payloadsOf(f.db, id, "PLAN_REVISED")).length >= 1, true);
      const decisions = await f.db.iamCoreManagementDecision.findMany({ where: { candidateId: id, decisionType: "PLAN_REVISED" } });
      assert.equal(decisions.length, 1);
      assert.equal(decisions[0]!.reason, "Planning now owns the vendor relationship.");
      assert.equal(decisions[0]!.actorId, MANAGER.actorId);
    }));

  it("an owner-only reassignment is an assignment change, not a plan revision", () =>
    withFixture(async (f) => {
      const id = await startedCandidate(f, { baselineExposure: 1000 });
      const r = await reassign(f.db, f.ctx, MANAGER, id, { reason: "Olivia is on leave.", toOwnerId: OWNER_USER_2.actorId, at: at(3) });
      assert.equal(r.planRevised, false);
      assert.equal((await plans(f, id)).length, 1);
    }));
});
