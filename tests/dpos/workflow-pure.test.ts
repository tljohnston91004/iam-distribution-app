/**
 * Stage 4B pure-logic tests: grouping, condition-reduction formula, aging/status evaluation, vocabulary mappings and the
 * capability boundary. No database.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { ACTION_WORKFLOW_STATES } from "../../src/lib/iam/enums";
import { LIFECYCLE_STATES } from "../../src/lib/iam/lifecycle/states";
import { IAM_ACTION_STATUSES, IAM_LIFECYCLE_STATES } from "../../src/lib/dpos/contract/iam-results-return";
import {
  ACTION_STATUSES,
  ACTION_STATUS_TO_CONTRACT,
  ACTION_STATUS_TRANSITIONS,
  LEGACY_LIFECYCLE_STATE_MAP,
  LEGACY_WORKFLOW_STATE_MAP,
  WORKFLOW_STATES,
  WORKFLOW_TO_CONTRACT_LIFECYCLE,
  computeConditionReduction,
  deriveGroupedConditionKey,
  evaluateActionStatus,
  groupEvidence,
  isValidStatusTransition,
  relationOf,
  requireManagement,
  requireOfficialWriter,
  requireOwnerOrManager,
  requireSenior,
  expectedProgressPct,
  assertActor,
  type AgingInput,
} from "../../src/lib/dpos/workflow";
import { ADMIN, CONTRIBUTOR, MANAGER, OWNER_USER, STRANGER, VIEWER, at, evidence } from "./workflow-helpers";

describe("grouping rule", () => {
  it("groups coherent evidence into ONE candidate and keeps SKU/vendor/category as drill-down evidence", () => {
    const groups = groupEvidence([evidence("1"), evidence("2"), evidence("3", { sku: undefined, poRef: "PO-77", kind: "PURCHASE_ORDER" })]);
    assert.equal(groups.length, 1);
    assert.equal(groups[0]!.items.length, 3);
    assert.deepEqual(groups[0]!.items.map((i) => i.evidenceRef), ["ev-1", "ev-2", "ev-3"]);
  });

  it("separates evidence whose action path, department or objective materially differs", () => {
    const groups = groupEvidence([
      evidence("1"),
      evidence("2", { actionPath: "Expedite vendor shipments" }),
      evidence("3", { responsibleDepartment: "Sales" }),
      evidence("4", { businessObjective: "Protect service level" }),
      evidence("5", { conditionKey: "Excess open purchase orders - Vendor B" }),
    ]);
    assert.equal(groups.length, 5);
  });

  it("is not sensitive to case or spacing, and never groups by SKU", () => {
    const a = deriveGroupedConditionKey(evidence("1"));
    const b = deriveGroupedConditionKey(evidence("2", { conditionKey: "  EXCESS open  purchase orders - vendor a " }));
    assert.equal(a, b);
    assert.equal(groupEvidence(["1", "2", "3", "4"].map((x) => evidence(x))).length, 1, "four SKUs are still one candidate");
  });

  it("de-duplicates the same evidence reference, and refuses one reference in two groups", () => {
    assert.equal(groupEvidence([evidence("1"), evidence("1")])[0]!.items.length, 1);
    assert.throws(() => groupEvidence([evidence("1"), evidence("1", { actionPath: "Something else" })]), /one candidate/);
  });

  it("never assumes a facet", () => {
    assert.throws(() => groupEvidence([evidence("1", { responsibleDepartment: " " })]), /responsibleDepartment is required/);
    assert.throws(() => groupEvidence([]), /At least one/);
  });
});

describe("condition reduction formula", () => {
  it("computes (baseline - current) / baseline x 100", () => {
    const r = computeConditionReduction(1000, 250);
    assert.equal(r.status, "MEASURED");
    assert.equal(r.pct, 75);
    assert.equal(computeConditionReduction(1000, 0).pct, 100);
    assert.equal(computeConditionReduction(1000, 1000).pct, 0);
    assert.equal(computeConditionReduction(3, 2).pct, 33.33);
  });

  it("keeps a negative value when the condition got worse and never clamps it to zero (4C-D7)", () => {
    const r = computeConditionReduction(1000, 1200);
    assert.equal(r.status, "MEASURED");
    assert.equal(r.pct, -20);
    assert.equal(r.contractPct, -20, "the contract copy carries the same signed value");
    assert.equal(r.worseThanBaseline, true);
  });

  it("matches the approved examples: 100 -> 80 = +20%, 100 -> 120 = -20%, no change = 0%", () => {
    assert.equal(computeConditionReduction(100, 80).pct, 20);
    assert.equal(computeConditionReduction(100, 120).pct, -20);
    assert.equal(computeConditionReduction(100, 120).contractPct, -20);
    const same = computeConditionReduction(100, 100);
    assert.equal(same.status, "MEASURED");
    assert.equal(same.pct, 0);
    assert.equal(same.worseThanBaseline, false);
  });

  it("a zero or missing baseline is non-measurable: no percentage is fabricated", () => {
    for (const b of [0, null, undefined]) {
      const r = computeConditionReduction(b as never, 50);
      assert.equal(r.status, "NOT_YET_MEASURED");
      assert.equal(r.pct, null);
      assert.equal(r.contractPct, null);
    }
  });

  it("is Not Yet Measured - and invents NO percentage - without a valid quantitative baseline", () => {
    for (const [b, c] of [[null, 100], [undefined, 100], [0, 0], [-5, 1], [Number.NaN, 1], [100, null], [100, undefined], [100, -1], [100, Number.POSITIVE_INFINITY]] as const) {
      const r = computeConditionReduction(b as never, c as never);
      assert.equal(r.status, "NOT_YET_MEASURED", `baseline=${String(b)} current=${String(c)}`);
      assert.equal(r.pct, null);
      assert.equal(r.contractPct, null);
    }
  });
});

describe("status model", () => {
  it("has exactly the eight required statuses", () => {
    assert.deepEqual([...ACTION_STATUSES], ["NOT_STARTED", "ON_TRACK", "ATTENTION", "AT_RISK", "OVERDUE", "PAUSED", "BLOCKED", "COMPLETED"]);
  });

  it("maps every status explicitly to the shared contract vocabulary; Not Started is first-class (4B-D3)", () => {
    for (const s of ACTION_STATUSES) assert.ok(s in ACTION_STATUS_TO_CONTRACT);
    assert.equal(ACTION_STATUS_TO_CONTRACT.NOT_STARTED, "NOT_STARTED", "4B-D3: NOT_STARTED is a first-class contract status, never null or merged");
    for (const s of IAM_ACTION_STATUSES) assert.equal(ACTION_STATUS_TO_CONTRACT[s], s);
    for (const s of WORKFLOW_STATES) assert.ok((IAM_LIFECYCLE_STATES as readonly string[]).includes(WORKFLOW_TO_CONTRACT_LIFECYCLE[s]), s);
  });

  it("COMPLETED is terminal; PAUSED exits only by reactivation; NOT_STARTED is valid only before the start", () => {
    assert.deepEqual(ACTION_STATUS_TRANSITIONS.COMPLETED, []);
    for (const s of ACTION_STATUSES) if (s !== "COMPLETED") assert.equal(isValidStatusTransition("COMPLETED", s), false);
    assert.equal(isValidStatusTransition("PAUSED", "COMPLETED"), false, "a paused action cannot complete without reactivation");
    assert.equal(isValidStatusTransition("ON_TRACK", "NOT_STARTED", true), false);
    assert.equal(isValidStatusTransition("PAUSED", "NOT_STARTED", false), true);
    assert.equal(isValidStatusTransition("NOT_STARTED", "ON_TRACK"), true);
    assert.equal(isValidStatusTransition("ON_TRACK", "AT_RISK"), true);
    assert.equal(isValidStatusTransition("AT_RISK", "OVERDUE"), true);
    assert.equal(isValidStatusTransition("BLOCKED", "ON_TRACK"), true);
  });

  it("documents every legacy V1.5 action workflow state and lifecycle state; Holdover is not a Stage 4B state", () => {
    for (const s of ACTION_WORKFLOW_STATES) assert.ok(s in LEGACY_WORKFLOW_STATE_MAP, `legacy workflow state ${s} is unmapped`);
    for (const s of LIFECYCLE_STATES) assert.ok(s in LEGACY_LIFECYCLE_STATE_MAP, `legacy lifecycle state ${s} is unmapped`);
    assert.ok(!(WORKFLOW_STATES as readonly string[]).some((s) => /holdover/i.test(s)));
    assert.match(LEGACY_WORKFLOW_STATE_MAP.Holdover!.note, /not a lifecycle state/i);
    for (const v of Object.values(LEGACY_WORKFLOW_STATE_MAP)) assert.ok(v.workflowState === null || (WORKFLOW_STATES as readonly string[]).includes(v.workflowState));
  });

  it("the approved lifecycle path is intact", () => {
    assert.deepEqual(
      WORKFLOW_STATES.slice(0, 7),
      ["NEW_CANDIDATE", "PRESENTED", "APPROVED_ASSIGNED", "PENDING_OWNER_ACCEPTANCE", "ACTIVE_ACTION", "COMPLETED_VALIDATED", "COMPLETED_HISTORY"],
    );
  });
});

describe("aging and escalation foundation (deterministic status evaluation)", () => {
  const base = (over: Partial<AgingInput> = {}): AgingInput => ({
    now: at(10),
    started: true,
    completed: false,
    paused: false,
    blocked: false,
    targetStart: at(0),
    targetResolution: at(19), // a 20-day plan: day 10 is exactly half-way
    actionCompletionPct: 50,
    conditionReductionPct: null,
    latestOwnerUpdateAt: at(9),
    startedAt: at(0),
    nextMilestoneDue: null,
    pendingManagementDecisions: 0,
    ...over,
  });

  it("expected progress is linear between the planned start and the end of the target day", () => {
    assert.equal(expectedProgressPct(at(10), at(0), at(19)), 50);
    assert.equal(expectedProgressPct(at(-5), at(0), at(19)), 0);
    assert.equal(expectedProgressPct(at(40), at(0), at(19)), 100);
    assert.equal(expectedProgressPct(at(1), null, at(19)), null);
  });

  it("ON TRACK when completion matches the expectation", () => {
    const r = evaluateActionStatus(base());
    assert.equal(r.status, "ON_TRACK");
    assert.equal(r.requiresManagementDecision, false);
  });

  it("ATTENTION: completion behind by the attention gap, stale owner update, past-due milestone, pending management decision, late start", () => {
    assert.equal(evaluateActionStatus(base({ actionCompletionPct: 38 })).status, "ATTENTION");
    assert.ok(evaluateActionStatus(base({ latestOwnerUpdateAt: at(-10) })).reasons.includes("OWNER_UPDATE_STALE"));
    assert.equal(evaluateActionStatus(base({ latestOwnerUpdateAt: at(-10) })).status, "ATTENTION");
    assert.equal(evaluateActionStatus(base({ nextMilestoneDue: at(5) })).status, "ATTENTION");
    assert.equal(evaluateActionStatus(base({ pendingManagementDecisions: 1 })).status, "ATTENTION");
    assert.equal(evaluateActionStatus(base({ started: false, startedAt: null, actionCompletionPct: null, now: at(3), targetStart: at(1) })).status, "ATTENTION");
  });

  it("condition reduction behind expectation also drives the status", () => {
    assert.equal(evaluateActionStatus(base({ conditionReductionPct: 36 })).status, "ATTENTION");
    assert.equal(evaluateActionStatus(base({ conditionReductionPct: 20 })).status, "AT_RISK");
    assert.equal(evaluateActionStatus(base({ conditionReductionPct: 50 })).status, "ON_TRACK");
  });

  it("AT RISK: far behind the expectation, or close to the target with low completion; requires a management decision", () => {
    const far = evaluateActionStatus(base({ actionCompletionPct: 20 }));
    assert.equal(far.status, "AT_RISK");
    assert.equal(far.requiresManagementDecision, true);
    assert.ok(far.reasons.includes("COMPLETION_FAR_BEHIND_EXPECTED"));
    const near = evaluateActionStatus(base({ now: at(15), actionCompletionPct: 70 }));
    assert.equal(near.status, "AT_RISK");
    assert.ok(near.reasons.includes("NEAR_TARGET_WITH_LOW_COMPLETION"));
  });

  it("OVERDUE the day after the target date; the target day itself is still open", () => {
    assert.notEqual(evaluateActionStatus(base({ now: at(19, 20), actionCompletionPct: 95 })).status, "OVERDUE");
    const r = evaluateActionStatus(base({ now: at(20), actionCompletionPct: 95 }));
    assert.equal(r.status, "OVERDUE");
    assert.equal(r.requiresManagementDecision, true);
  });

  it("BLOCKED, PAUSED and COMPLETED take precedence in that order", () => {
    const blocked = evaluateActionStatus(base({ blocked: true, now: at(30) }));
    assert.equal(blocked.status, "BLOCKED");
    assert.equal(blocked.requiresManagementDecision, true);
    assert.equal(evaluateActionStatus(base({ paused: true, blocked: true, now: at(30) })).status, "PAUSED");
    assert.equal(evaluateActionStatus(base({ completed: true, paused: true, blocked: true })).status, "COMPLETED");
  });

  it("NOT_STARTED until the work starts; deterministic for identical input", () => {
    const input = base({ started: false, startedAt: null, actionCompletionPct: null, now: at(-1), targetStart: at(1) });
    assert.equal(evaluateActionStatus(input).status, "NOT_STARTED");
    assert.deepEqual(evaluateActionStatus(input), evaluateActionStatus({ ...input }));
  });

  it("thresholds are parameters, not hidden constants", () => {
    assert.equal(evaluateActionStatus(base({ actionCompletionPct: 38 }), { attentionGapPoints: 15 }).status, "ON_TRACK");
  });
});

describe("capability boundary", () => {
  it("management decisions need a management role; senior review needs OWNER/ADMINISTRATOR", () => {
    requireManagement(MANAGER, "x");
    assert.throws(() => requireManagement(OWNER_USER, "x"), /management-level/);
    assert.throws(() => requireManagement(VIEWER, "x"), /management-level/);
    assert.throws(() => requireSenior(MANAGER, "x", "why"), /senior/);
    requireSenior(ADMIN, "x", "why");
  });

  it("a service identity or an unnamed actor is never a workflow actor", () => {
    assert.throws(() => assertActor({ actorId: "iam-svc-1", role: "MANAGER" }), /service identity/i);
    assert.throws(() => assertActor({ actorId: "", role: "MANAGER" }), /actor is required/i);
    assert.throws(() => assertActor({ actorId: "iam-system", role: "OPERATOR" }), /reserved/);
    assert.throws(() => assertActor({ actorId: "someone", role: "SYSTEM" }), /system actor/i);
  });

  it("owner, contributor and official-writer rules", () => {
    const facts = { taskOwnerId: OWNER_USER.actorId, contributorIds: [CONTRIBUTOR.actorId], authorizedOfficialWriterIds: [] as string[] };
    assert.equal(relationOf(OWNER_USER, facts), "PRIMARY_OWNER");
    assert.equal(relationOf(CONTRIBUTOR, facts), "CONTRIBUTOR");
    assert.equal(relationOf(MANAGER, facts), "MANAGER");
    assert.equal(relationOf(STRANGER, facts), "NONE");
    assert.equal(requireOwnerOrManager(MANAGER, facts, "x").onBehalf, true);
    assert.equal(requireOwnerOrManager(OWNER_USER, facts, "x").onBehalf, false);
    assert.throws(() => requireOwnerOrManager(STRANGER, facts, "x"), /assigned task owner/);
    assert.throws(() => requireOfficialWriter(CONTRIBUTOR, facts, "x"), /contributors may add notes/);
    assert.equal(requireOfficialWriter(CONTRIBUTOR, { ...facts, authorizedOfficialWriterIds: [CONTRIBUTOR.actorId] }, "x").viaAuthorization, true);
    assert.throws(() => requireOfficialWriter(VIEWER, facts, "x"));
  });
});
