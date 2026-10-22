/**
 * Stage 4D-R: provisional curve diagnostics for Product Owner review (pure, read-only).
 *
 * It explains how each of the three RSE-fed components got its score under the CURRENT PROVISIONAL curves: raw metric, score,
 * effective weight, contribution to the composite, drivers, and where the metric sits on the curve (including saturation or
 * compression). It never changes a curve, a weight or a label; it only reports.
 */
import { HEALTH_CONFIG, HEALTH_CURVE_STATUS, healthConfigHash, type ComponentKey, type HealthConfig } from "./config";
import type { ComponentResult } from "./composite";

export type CurveFlag = "SATURATED_AT_100" | "FLOORED_AT_0" | "COMPRESSED_NEAR_TOP" | "COMPRESSED_NEAR_BOTTOM" | "UNAVAILABLE";

export interface CurveBreakpoint {
  forScore: number;
  rawMetric: number;
  unit: string;
}

export interface ComponentCurveDiagnostic {
  key: ComponentKey;
  label: string;
  curveStatus: typeof HEALTH_CURVE_STATUS;
  available: boolean;
  unavailableReason: string | null;
  score: number | null;
  nominalWeight: number;
  effectiveWeight: number | null;
  /** Points this component adds to the composite (score x effective weight / 100). */
  contributionPoints: number | null;
  rawMetric: { name: string; value: number | null; unit: string } | null;
  curve: string;
  /** The raw metric at which this curve would give 90 / 75 / 60 / 0, so the Product Owner can judge the shape. */
  breakpoints: CurveBreakpoint[];
  headroomToFullScore: string | null;
  flags: CurveFlag[];
  drivers: Array<{ code: string; text: string }>;
  /** A single company has a single observation: the distribution of one point is the point itself. */
  observations: number;
  distributionNote: string;
}

const r2 = (n: number) => Math.round(n * 100) / 100;

function flagsFor(score: number | null): CurveFlag[] {
  if (score === null) return ["UNAVAILABLE"];
  const f: CurveFlag[] = [];
  if (score >= 100) f.push("SATURATED_AT_100");
  else if (score >= 95) f.push("COMPRESSED_NEAR_TOP");
  if (score <= 0) f.push("FLOORED_AT_0");
  else if (score <= 5) f.push("COMPRESSED_NEAR_BOTTOM");
  return f;
}

const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);

export function curveDiagnostics(components: ComponentResult[], cfg: HealthConfig = HEALTH_CONFIG): { healthVersion: string; curveStatus: typeof HEALTH_CURVE_STATUS; configHash: string; components: ComponentCurveDiagnostic[]; note: string } {
  const out: ComponentCurveDiagnostic[] = [];
  for (const key of ["POSITION_BALANCE", "EFFICIENCY", "SLOW_NONMOVING"] as const) {
    const c = components.find((x) => x.key === key);
    if (!c) continue;
    const d = c.detail as Record<string, unknown>;
    let rawMetric: ComponentCurveDiagnostic["rawMetric"] = null;
    let curve = "";
    let breakpoints: CurveBreakpoint[] = [];
    let headroom: string | null = null;
    if (key === "POSITION_BALANCE") {
      const zero = cfg.curves.positionBalance.outOfBalanceSharePctForZero;
      rawMetric = { name: "Out-of-balance share of inventory book value", value: num(d.outOfBalanceSharePct), unit: "%" };
      curve = `Linear: 100 at 0% out of balance, 0 at ${zero}% (below-Min + above-Max exposure as a share of inventory value).`;
      breakpoints = [90, 75, 60, 0].map((s) => ({ forScore: s, rawMetric: r2(zero * (1 - s / 100)), unit: "%" }));
      if (rawMetric.value !== null) headroom = `${r2(rawMetric.value)}% out of balance; each 1 point of share costs ${r2(100 / zero)} score points.`;
    } else if (key === "SLOW_NONMOVING") {
      const zero = cfg.curves.slowNonmoving.residualSharePctForZero;
      rawMetric = { name: "Residual slow / nonmoving share of inventory book value", value: num(d.residualSharePct), unit: "%" };
      curve = `Linear: 100 at 0% residual exposure, 0 at ${zero}% (after overlap and natural sell-through protection, ${cfg.curves.slowNonmoving.sellThroughHorizonDays}-day horizon).`;
      breakpoints = [90, 75, 60, 0].map((s) => ({ forScore: s, rawMetric: r2(zero * (1 - s / 100)), unit: "%" }));
      if (rawMetric.value !== null) headroom = `${r2(rawMetric.value)}% residual; each 1 point of share costs ${r2(100 / zero)} score points.`;
    } else {
      const e = cfg.curves.efficiency;
      const measures = Array.isArray(d.measures) ? (d.measures as Array<Record<string, unknown>>) : [];
      const m = measures[0];
      rawMetric = { name: "Inventory turns versus the company's governed target", value: m ? num(m.ratio) : null, unit: "x target" };
      curve = `Linear: 100 at ${e.fullCreditRatio}x the company target, 0 at ${e.zeroCreditRatio}x.`;
      breakpoints = [90, 75, 60, 0].map((s) => ({ forScore: s, rawMetric: r2(e.zeroCreditRatio + (s / 100) * (e.fullCreditRatio - e.zeroCreditRatio)), unit: "x target" }));
      if (rawMetric.value !== null) headroom = `${r2(rawMetric.value)}x target; full credit at ${e.fullCreditRatio}x.`;
      if (!c.available) rawMetric = { name: "Implied inventory turns (RSE)", value: num(d.inventoryTurns), unit: "turns" };
    }
    out.push({
      key,
      label: c.label,
      curveStatus: HEALTH_CURVE_STATUS,
      available: c.available,
      unavailableReason: c.unavailableReason,
      score: c.score,
      nominalWeight: c.nominalWeight,
      effectiveWeight: c.effectiveWeight,
      contributionPoints: c.score !== null && c.effectiveWeight !== null ? r2((c.score * c.effectiveWeight) / 100) : null,
      rawMetric,
      curve,
      breakpoints,
      headroomToFullScore: headroom,
      flags: flagsFor(c.score),
      drivers: c.drivers.map((x) => ({ code: x.code, text: x.text })),
      observations: c.available ? 1 : 0,
      distributionNote: "One company, one governed result: there is no cross-company distribution to compare. The breakpoints show where this curve would place other values.",
    });
  }
  return {
    healthVersion: cfg.version,
    curveStatus: HEALTH_CURVE_STATUS,
    configHash: healthConfigHash(cfg),
    components: out,
    note: "The curves are PROVISIONAL and unchanged by this stage; this report only explains them for Product Owner review.",
  };
}
