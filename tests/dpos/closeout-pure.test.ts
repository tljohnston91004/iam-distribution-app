/** Stage 4E: the pure closeout rules (measurement, guidance, statuses, attribution, residual, expected vs actual). No database. */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  ATTRIBUTION_CATEGORIES,
  RESOLUTION_STATUSES,
  assessWindow,
  buildExpectedVsActual,
  capOutcomeConfidence,
  contentHash,
  measureCondition,
  normalizeResidual,
  resolutionGuidance,
  validateAssertedStatus,
  validateAttribution,
  actualImpacts,
} from "../../src/lib/dpos/closeout";

const ok = (start: string, end: string, through: string, completed = "2026-11-05") =>
  assessWindow({ actionCompletedAt: new Date(`${completed}T12:00:00Z`), measurementStart: new Date(`${start}T00:00:00Z`), measurementEnd: new Date(`${end}T00:00:00Z`), evidenceCurrentThrough: new Date(`${through}T00:00:00Z`) });
const ADEQ = ok("2026-11-08", "2026-11-20", "2026-11-21");
const OPEN = ok("2026-11-08", "2026-11-20", "2026-11-12");

async function throwsCode(fn: () => unknown, code: string) {
  try {
    fn();
  } catch (e) {
    assert.equal((e as { code?: string }).code, code, (e as Error).message);
    return;
  }
  assert.fail(`expected ${code}`);
}

describe("Stage 4E pure: condition reduction (4E section 5)", () => {
  it("100 -> 80 is +20%, 100 -> 100 is 0%, 100 -> 120 is -20% (unclamped)", () => {
    assert.equal(measureCondition(100, 80, "USD").pct, 20);
    assert.equal(measureCondition(100, 100, "USD").pct, 0);
    const worse = measureCondition(100, 120, "USD");
    assert.equal(worse.pct, -20);
    assert.equal(worse.worseThanBaseline, true);
    assert.equal(measureCondition(100, 400, "USD").pct, -300, "never clamped");
  });
  it("a zero or missing baseline, or a missing final value, produces NO fabricated percentage", () => {
    for (const m of [measureCondition(0, 50, "USD"), measureCondition(null, 50, "USD"), measureCondition(undefined, 50, "USD"), measureCondition(100, null, "USD"), measureCondition(100, undefined, "USD")]) {
      assert.equal(m.state, "NOT_MEASURABLE");
      assert.equal(m.pct, null);
    }
  });
});

describe("Stage 4E pure: measurement window (section 11)", () => {
  it("is adequate only when evidence is current through the period end", () => {
    assert.equal(ADEQ.adequate, true);
    assert.equal(OPEN.adequate, false);
    assert.equal(assessWindow({ actionCompletedAt: null, measurementStart: null, measurementEnd: null, evidenceCurrentThrough: null }).adequate, false);
  });
  it("refuses a period that ends before it starts or starts before the action was completed", async () => {
    await throwsCode(() => ok("2026-11-20", "2026-11-10", "2026-11-21"), "MEASUREMENT_WINDOW_INVALID");
    await throwsCode(() => ok("2026-11-01", "2026-11-20", "2026-11-21"), "MEASUREMENT_WINDOW_BEFORE_COMPLETION");
  });
});

describe("Stage 4E pure: resolution guidance and the nine statuses (sections 3-4)", () => {
  it("there are exactly nine resolution statuses", () => {
    assert.deepEqual([...RESOLUTION_STATUSES].sort(), ["CONTROLLED_BUT_CONTINUING", "FULLY_RESOLVED", "IMPROVING", "NOT_YET_MEASURED", "NO_LONGER_APPLICABLE", "ON_TARGET", "PARTIALLY_RESOLVED", "SUBSTANTIALLY_RESOLVED", "UNSUCCESSFUL"].sort());
  });
  it("is deterministic only where the data supports it, and invents no percentage thresholds", () => {
    assert.equal(resolutionGuidance(measureCondition(100, null, "USD"), ADEQ).recommendedStatus, "NOT_YET_MEASURED");
    assert.equal(resolutionGuidance(measureCondition(100, 60, "USD"), OPEN).recommendedStatus, "IMPROVING");
    assert.equal(resolutionGuidance(measureCondition(100, 100, "USD"), OPEN).recommendedStatus, "NOT_YET_MEASURED");
    assert.equal(resolutionGuidance(measureCondition(100, 0, "USD"), ADEQ).recommendedStatus, "FULLY_RESOLVED");
    assert.equal(resolutionGuidance(measureCondition(100, 100, "USD"), ADEQ).recommendedStatus, "UNSUCCESSFUL");
    assert.equal(resolutionGuidance(measureCondition(100, 130, "USD"), ADEQ).recommendedStatus, "UNSUCCESSFUL");
    for (const final of [1, 10, 50, 90, 99]) {
      const g = resolutionGuidance(measureCondition(100, final, "USD"), ADEQ);
      assert.equal(g.recommendedStatus, null, `reduction ${100 - final}% has no defined threshold`);
      assert.equal(g.judgementRequired, true);
    }
  });
  it("every one of the nine statuses can be asserted where the facts allow it, with a rationale where required", () => {
    const partial = measureCondition(100, 40, "USD");
    const gPartial = resolutionGuidance(partial, ADEQ);
    for (const s of ["SUBSTANTIALLY_RESOLVED", "PARTIALLY_RESOLVED", "CONTROLLED_BUT_CONTINUING", "NO_LONGER_APPLICABLE", "ON_TARGET", "IMPROVING"]) {
      assert.equal(validateAssertedStatus(s, { measurement: partial, guidance: gPartial, rationale: "Management judgement.", evidenceRefs: ["e"], field: "assessedStatus" }), s);
    }
    const none = measureCondition(100, 0, "USD");
    assert.equal(validateAssertedStatus("FULLY_RESOLVED", { measurement: none, guidance: resolutionGuidance(none, ADEQ), rationale: null, evidenceRefs: ["e"], field: "s" }), "FULLY_RESOLVED");
    const unmeasured = measureCondition(100, null, "USD");
    assert.equal(validateAssertedStatus("NOT_YET_MEASURED", { measurement: unmeasured, guidance: resolutionGuidance(unmeasured, ADEQ), rationale: null, evidenceRefs: [], field: "s" }), "NOT_YET_MEASURED");
    const worse = measureCondition(100, 130, "USD");
    assert.equal(validateAssertedStatus("UNSUCCESSFUL", { measurement: worse, guidance: resolutionGuidance(worse, ADEQ), rationale: null, evidenceRefs: ["e"], field: "s" }), "UNSUCCESSFUL");
  });
  it("refuses contradictions and a missing rationale", async () => {
    const worse = measureCondition(100, 130, "USD");
    const g = resolutionGuidance(worse, ADEQ);
    for (const s of ["FULLY_RESOLVED", "SUBSTANTIALLY_RESOLVED", "PARTIALLY_RESOLVED"]) {
      await throwsCode(() => validateAssertedStatus(s, { measurement: worse, guidance: g, rationale: "r", evidenceRefs: ["e"], field: "s" }), "STATUS_CONTRADICTS_MEASUREMENT");
    }
    const partial = measureCondition(100, 40, "USD");
    await throwsCode(() => validateAssertedStatus("PARTIALLY_RESOLVED", { measurement: partial, guidance: resolutionGuidance(partial, ADEQ), rationale: null, evidenceRefs: ["e"], field: "s" }), "RATIONALE_REQUIRED");
    await throwsCode(() => validateAssertedStatus("NOT_YET_MEASURED", { measurement: partial, guidance: resolutionGuidance(partial, ADEQ), rationale: "r", evidenceRefs: ["e"], field: "s" }), "STATUS_CONTRADICTS_MEASUREMENT");
    await throwsCode(() => validateAssertedStatus("MOSTLY_DONE", { measurement: partial, guidance: resolutionGuidance(partial, ADEQ), rationale: "r", evidenceRefs: ["e"], field: "s" }), "VOCABULARY_VIOLATION");
    const none = measureCondition(100, 20, "USD");
    await throwsCode(() => validateAssertedStatus("FULLY_RESOLVED", { measurement: none, guidance: resolutionGuidance(none, ADEQ), rationale: null, evidenceRefs: ["e"], field: "s" }), "RATIONALE_REQUIRED");
  });
});

describe("Stage 4E pure: outcome confidence (section 10)", () => {
  it("an unmeasured or unevidenced outcome is Insufficient; an open window caps at Low; Low and Insufficient are kept", () => {
    assert.equal(capOutcomeConfidence("HIGH", { measured: false, evidenceRefs: ["e"], windowAdequate: true }).confidence, "INSUFFICIENT");
    assert.equal(capOutcomeConfidence("HIGH", { measured: true, evidenceRefs: [], windowAdequate: true }).confidence, "INSUFFICIENT");
    assert.equal(capOutcomeConfidence("HIGH", { measured: true, evidenceRefs: ["e"], windowAdequate: false }).confidence, "LOW");
    assert.equal(capOutcomeConfidence("HIGH", { measured: true, evidenceRefs: ["e"], windowAdequate: true }).confidence, "HIGH");
    assert.equal(capOutcomeConfidence("LOW", { measured: true, evidenceRefs: ["e"], windowAdequate: true }).confidence, "LOW");
    assert.equal(capOutcomeConfidence(null, { measured: true, evidenceRefs: ["e"], windowAdequate: true }).confidence, "MEDIUM");
  });
});

describe("Stage 4E pure: attribution (sections 8-9)", () => {
  const good = measureCondition(100, 20, "USD");
  const worse = measureCondition(100, 130, "USD");
  const unmeasured = measureCondition(100, null, "USD");
  const V = (input: Parameters<typeof validateAttribution>[0], m = good, c: "HIGH" | "MEDIUM" | "LOW" | "INSUFFICIENT" = "MEDIUM") => validateAttribution(input, { measurement: m, outcomeConfidence: c });

  it("there are exactly six attribution categories", () => {
    assert.equal(ATTRIBUTION_CATEGORIES.length, 6);
  });
  it("Confirmed Contribution needs a mechanism, alternatives considered and strong confidence", async () => {
    const full = { category: "CONFIRMED_CONTRIBUTION", rationale: "Direct evidence.", evidence: [{ kind: "MECHANISM", ref: "m1" }], alternatives: ["Seasonality"] };
    assert.equal(V(full).category, "CONFIRMED_CONTRIBUTION");
    await throwsCode(() => V({ ...full, evidence: [{ kind: "TREND", note: "down" }] }), "ATTRIBUTION_NEEDS_MECHANISM");
    await throwsCode(() => V({ ...full, alternatives: [] }), "ATTRIBUTION_NEEDS_ALTERNATIVES");
    await throwsCode(() => V({ ...full, confidence: "LOW" }), "ATTRIBUTION_CONFIDENCE_INCONSISTENT");
  });
  it("Probable Contribution is refused when it rests on timing / completion / Health / scoring movement alone", async () => {
    assert.equal(V({ category: "PROBABLE_CONTRIBUTION", rationale: "r", evidence: [{ kind: "TREND", note: "steady fall" }] }).category, "PROBABLE_CONTRIBUTION");
    for (const kind of ["TIMING", "ACTION_COMPLETION", "HEALTH_HISTORY", "SCORING_HISTORY"]) {
      await throwsCode(() => V({ category: "PROBABLE_CONTRIBUTION", rationale: "r", evidence: [{ kind, note: "after the action" }] }), "TEMPORAL_SEQUENCE_ONLY");
    }
    await throwsCode(() => V({ category: "PROBABLE_CONTRIBUTION", rationale: "r", evidence: [] }), "TEMPORAL_SEQUENCE_ONLY");
  });
  it("credit cannot be claimed for an unmeasured, unchanged or worse outcome, or Insufficient confidence", async () => {
    const e = [{ kind: "EVIDENCE", ref: "e1" }];
    await throwsCode(() => V({ category: "PROBABLE_CONTRIBUTION", rationale: "r", evidence: e }, unmeasured), "ATTRIBUTION_NEEDS_MEASUREMENT");
    await throwsCode(() => V({ category: "PROBABLE_CONTRIBUTION", rationale: "r", evidence: e }, worse), "ATTRIBUTION_CONTRADICTS_MEASUREMENT");
    await throwsCode(() => V({ category: "PROBABLE_CONTRIBUTION", rationale: "r", evidence: e }, good, "INSUFFICIENT"), "ATTRIBUTION_NEEDS_CONFIDENCE");
  });
  it("Possible Contribution needs some evidence or an alternative", async () => {
    assert.equal(V({ category: "POSSIBLE_CONTRIBUTION", rationale: "r", evidence: [{ kind: "TIMING" }] }).confidence, "LOW");
    assert.equal(V({ category: "POSSIBLE_CONTRIBUTION", rationale: "r", alternatives: ["Other"] }).category, "POSSIBLE_CONTRIBUTION");
    await throwsCode(() => V({ category: "POSSIBLE_CONTRIBUTION", rationale: "r" }), "ATTRIBUTION_NEEDS_EVIDENCE");
  });
  it("Unclear / Insufficient Evidence is always allowed (even unmeasured) but cannot claim strong confidence", async () => {
    assert.equal(V({ category: "UNCLEAR_INSUFFICIENT_EVIDENCE", rationale: "Cannot separate." }, unmeasured, "INSUFFICIENT").confidence, "NOT_MEASURABLE");
    await throwsCode(() => V({ category: "UNCLEAR_INSUFFICIENT_EVIDENCE", rationale: "r", confidence: "HIGH" }), "ATTRIBUTION_CONFIDENCE_INCONSISTENT");
  });
  it("Unrelated / External Cause needs the external change or the alternative that explains it", async () => {
    assert.equal(V({ category: "UNRELATED_EXTERNAL_CAUSE", rationale: "r", evidence: [{ kind: "EXTERNAL_CHANGE", note: "Customer cancelled the programme" }] }).category, "UNRELATED_EXTERNAL_CAUSE");
    await throwsCode(() => V({ category: "UNRELATED_EXTERNAL_CAUSE", rationale: "r", evidence: [{ kind: "TIMING" }] }), "ATTRIBUTION_NEEDS_EXTERNAL_EVIDENCE");
  });
  it("Negative / Counterproductive Effect is supported by a measured deterioration", async () => {
    assert.equal(V({ category: "NEGATIVE_COUNTERPRODUCTIVE_EFFECT", rationale: "The deferral made the exposure worse." }, worse).category, "NEGATIVE_COUNTERPRODUCTIVE_EFFECT");
    await throwsCode(() => V({ category: "NEGATIVE_COUNTERPRODUCTIVE_EFFECT", rationale: "r" }, good), "ATTRIBUTION_NEEDS_EVIDENCE");
  });
  it("requires a category from the vocabulary and a rationale", async () => {
    await throwsCode(() => V(null), "ATTRIBUTION_REQUIRED");
    await throwsCode(() => V({ category: "CAUSED_IT", rationale: "r" }), "VOCABULARY_VIOLATION");
    await throwsCode(() => V({ category: "UNCLEAR_INSUFFICIENT_EVIDENCE", rationale: "  " }), "ATTRIBUTION_RATIONALE_REQUIRED");
  });
});

describe("Stage 4E pure: residual exposure units (section 6)", () => {
  it("preserves units and never sums incompatible types", () => {
    const r = normalizeResidual([
      { type: "OPEN_PO_VALUE", value: 1200, unit: "USD" },
      { type: "UNITS_ON_HAND", value: 40, unit: "each" },
    ])!;
    assert.equal(r.items.length, 2);
    assert.equal(r.single, null, "the single contract number is sent only when exactly one exposure exists");
    assert.match(r.note, /never summed/);
    assert.equal(normalizeResidual([{ type: "X", value: 5, unit: "USD" }])!.single!.value, 5);
  });
  it("refuses a missing unit, a negative value or a duplicate; null when nothing is known", async () => {
    await throwsCode(() => normalizeResidual([{ type: "X", value: 5, unit: " " }]), "UNIT_REQUIRED");
    await throwsCode(() => normalizeResidual([{ type: "X", value: -1, unit: "USD" }]), "OUT_OF_RANGE");
    await throwsCode(() => normalizeResidual([{ type: "X", value: 1, unit: "USD" }, { type: "x", value: 2, unit: "usd" }]), "RESIDUAL_DUPLICATE");
    assert.equal(normalizeResidual(null), null);
    assert.equal(normalizeResidual([], { value: null, unit: null }), null);
  });
});

describe("Stage 4E pure: expected vs actual (section 7)", () => {
  it("never fabricates an actual: everything is null without evidence", () => {
    const eva = buildExpectedVsActual(null);
    assert.equal(eva.rows.length, 4);
    assert.ok(eva.rows.every((r) => r.expected === null && r.actual === null && r.variance === null));
    assert.equal(eva.timeframe.varianceDays, null);
    assert.deepEqual(actualImpacts(eva), []);
  });
  it("an actual needs an evidence reference and a unit", async () => {
    await throwsCode(() => buildExpectedVsActual({ actual: { cashReleased: { value: 100, unit: "USD", evidenceRef: " " } } }), "ACTUAL_REQUIRES_EVIDENCE");
    await throwsCode(() => buildExpectedVsActual({ actual: { cashReleased: { value: 100, unit: "", evidenceRef: "e" } } }), "UNIT_REQUIRED");
    await throwsCode(() => buildExpectedVsActual({ actualResolvedDate: "2026-11-20" }), "ACTUAL_REQUIRES_EVIDENCE");
  });
  it("computes a variance only for the same unit, and a timeframe variance when both dates exist", () => {
    const eva = buildExpectedVsActual({
      expected: { cash: { value: 5000, unit: "USD" }, inventoryReduction: { value: 100, unit: "units" } },
      actual: { cashReleased: { value: 4200, unit: "$", evidenceRef: "gl-1" }, inventoryDollarsReduced: { value: 900, unit: "USD", evidenceRef: "gl-2" } },
      expectedTargetDate: "2026-11-30",
      actualResolvedDate: "2026-12-05",
      actualResolvedEvidenceRef: "ev",
    });
    const cash = eva.rows.find((r) => r.key === "cash")!;
    assert.equal(cash.variance, -800);
    assert.equal(cash.actual!.unit, "USD");
    assert.equal(eva.rows.find((r) => r.key === "inventoryReduction")!.variance, null, "different units: no variance, no conversion");
    assert.equal(eva.timeframe.varianceDays, 5);
    assert.equal(actualImpacts(eva).length, 2);
  });
});

describe("Stage 4E pure: content hash", () => {
  it("is deterministic and key-order independent", () => {
    assert.equal(contentHash({ a: 1, b: { c: 2, d: [1, 2] } }), contentHash({ b: { d: [1, 2], c: 2 }, a: 1 }));
    assert.notEqual(contentHash({ a: 1 }), contentHash({ a: 2 }));
  });
});
