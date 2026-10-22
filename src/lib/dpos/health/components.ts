/**
 * Stage 4D component calculators (pure). Each takes governed facts and returns a ComponentResult: either an available value
 * (0-100 in exact hundredths) with its drivers and evidence references, or UNAVAILABLE with the reason. Nothing here recreates
 * RSE/PRE logic: A-C consume governed RSE results, D consumes governed Customer Backorder lines, E consumes IAM's own
 * canonical action tracking.
 *
 * Every curve comes from HEALTH_CONFIG and is PROVISIONAL until the Product Owner approves it.
 */
import { HEALTH_CONFIG, type HealthConfig } from "./config";
import { available, clampHundredths, unavailable, type ComponentResult, type Driver } from "./composite";
import type { CompanyFactsEvidence, EfficiencyEvidence, PositionBalanceEvidence, SlowNonmovingEvidence } from "./evidence";
import { residualAfterNaturalSellThrough } from "./sell-through";

const DAY_MS = 24 * 3600 * 1000;
const r2 = (n: number) => Math.round(n * 100) / 100;
const pct = (n: number) => `${r2(n)}%`;

/** Share (percent) to a 0..10000 value: 0% -> 10000, `zeroAtPct`% or more -> 0 (linear). */
const fromShare = (sharePct: number, zeroAtPct: number): number => clampHundredths(10000 * (1 - sharePct / zeroAtPct));

// ---- A. Position & Balance ----------------------------------------------------------------------------------------------------

export function calcPositionBalance(ev: PositionBalanceEvidence | null, refs: string[], cfg: HealthConfig = HEALTH_CONFIG): ComponentResult {
  if (!ev) return unavailable("POSITION_BALANCE", "No governed Min/Max position result has been supplied (RSE remains authoritative; IAM does not recreate Min/Max).", cfg);
  const out = ev.belowMinExposureValue + ev.aboveMaxExcessValue;
  const share = (out / ev.totalInventoryBookValue) * 100;
  const h = fromShare(share, cfg.curves.positionBalance.outOfBalanceSharePctForZero);
  const drivers: Driver[] = [
    { code: "OUT_OF_BALANCE_SHARE", text: `${pct(share)} of inventory book value is out of Min/Max balance.`, value: r2(share) },
    { code: "BELOW_MIN", text: `Below-Min shortfall exposure: ${r2(ev.belowMinExposureValue)}.`, value: r2(ev.belowMinExposureValue) },
    { code: "ABOVE_MAX", text: `Above-Max excess: ${r2(ev.aboveMaxExcessValue)}.`, value: r2(ev.aboveMaxExcessValue) },
  ];
  return available("POSITION_BALANCE", h, { drivers, evidenceRefs: refs, detail: { totalInventoryBookValue: ev.totalInventoryBookValue, belowMinExposureValue: ev.belowMinExposureValue, aboveMaxExcessValue: ev.aboveMaxExcessValue, skusEvaluated: ev.skusEvaluated, skusBelowMin: ev.skusBelowMin, skusAboveMax: ev.skusAboveMax, outOfBalanceValue: r2(out), outOfBalanceSharePct: r2(share), zeroAtSharePct: cfg.curves.positionBalance.outOfBalanceSharePctForZero } }, cfg);
}

// ---- B. Efficiency ------------------------------------------------------------------------------------------------------------

export type TurnsTargetState = "CONFIGURED" | "NOT_CONFIGURED" | "INVALID";

/** The company turns target is governed company configuration: there is NO default business value. */
export function turnsTargetState(facts: CompanyFactsEvidence | null | undefined): { state: TurnsTargetState; message: string } {
  const t = (facts as { turnsTarget?: unknown } | null | undefined)?.turnsTarget;
  if (t === undefined || t === null) return { state: "NOT_CONFIGURED", message: "No inventory turns target has been configured for this company." };
  if (typeof t !== "number" || !Number.isFinite(t) || t <= 0) return { state: "INVALID", message: "The configured inventory turns target is not a finite number greater than zero." };
  return { state: "CONFIGURED", message: "A governed inventory turns target is configured." };
}

export type GmroiAvailability = "NOT_AVAILABLE_NOT_CONFIGURED" | "NOT_AVAILABLE_NO_GOVERNED_INPUT" | "SCORED";

/** GMROI needs a governed target AND a governed gross-profit / inventory input; otherwise it is explicitly not available. */
export function gmroiAvailability(ev: EfficiencyEvidence | null | undefined, facts: CompanyFactsEvidence | null | undefined): GmroiAvailability {
  if (facts?.gmroiTarget === undefined) return "NOT_AVAILABLE_NOT_CONFIGURED";
  if (ev?.gmroi === undefined) return "NOT_AVAILABLE_NO_GOVERNED_INPUT";
  return "SCORED";
}

export function calcEfficiency(ev: EfficiencyEvidence | null, facts: CompanyFactsEvidence | null, refs: string[], cfg: HealthConfig = HEALTH_CONFIG): ComponentResult {
  if (!ev) return unavailable("EFFICIENCY", "No governed efficiency result (inventory turns) has been supplied.", cfg);
  const c = cfg.curves.efficiency;
  const ratioToValue = (ratio: number): number => {
    if (ratio >= c.fullCreditRatio) return 10000;
    if (ratio <= c.zeroCreditRatio) return 0;
    return clampHundredths((10000 * (ratio - c.zeroCreditRatio)) / (c.fullCreditRatio - c.zeroCreditRatio));
  };
  const parts: Array<{ name: string; actual: number; target: number; ratio: number; value: number }> = [];
  const targetState = turnsTargetState(facts);
  const gmroiStatus = gmroiAvailability(ev, facts);
  if (targetState.state === "CONFIGURED" && facts?.turnsTarget !== undefined) {
    const ratio = ev.inventoryTurns / facts.turnsTarget;
    parts.push({ name: "inventory turns", actual: ev.inventoryTurns, target: facts.turnsTarget, ratio, value: ratioToValue(ratio) });
  }
  if (ev.gmroi !== undefined && facts?.gmroiTarget !== undefined) {
    const ratio = ev.gmroi / facts.gmroiTarget;
    parts.push({ name: "GMROI", actual: ev.gmroi, target: facts.gmroiTarget, ratio, value: ratioToValue(ratio) });
  }
  if (!parts.length) {
    return unavailable("EFFICIENCY", targetState.state === "INVALID" ? `Unavailable — invalid target: ${targetState.message}` : "Unavailable — target not configured: the company has not governed an inventory turns target, so efficiency cannot be judged (no benchmark is invented).", cfg, { inventoryTurns: ev.inventoryTurns, targetState: targetState.state, targetMessage: targetState.message, gmroiStatus });
  }
  const h = Math.round(parts.reduce((a, p) => a + p.value, 0) / parts.length);
  const drivers: Driver[] = parts.map((p) => ({ code: "VERSUS_COMPANY_TARGET", text: `${p.name}: ${r2(p.actual)} against the company target of ${r2(p.target)} (${pct(p.ratio * 100)} of target).`, value: r2(p.ratio * 100) }));
  return available("EFFICIENCY", h, { drivers, evidenceRefs: refs, detail: { inventoryTurns: ev.inventoryTurns, targetState: targetState.state, gmroiStatus, measures: parts.map((p) => ({ ...p, ratio: r2(p.ratio), value: p.value / 100 })), fullCreditRatio: c.fullCreditRatio, zeroCreditRatio: c.zeroCreditRatio } }, cfg);
}

// ---- C. Slow / Nonmoving ------------------------------------------------------------------------------------------------------

export function calcSlowNonmoving(ev: SlowNonmovingEvidence | null, refs: string[], cfg: HealthConfig = HEALTH_CONFIG): ComponentResult {
  if (!ev) return unavailable("SLOW_NONMOVING", "No governed slow-moving / nonmoving classification result has been supplied (RSE remains authoritative).", cfg);
  const gross = ev.slowMovingValue + ev.nonMovingValue;
  const overlap = Math.min(ev.overlapWithAboveMaxValue ?? 0, gross);
  const afterOverlap = gross - overlap;
  const st = residualAfterNaturalSellThrough(afterOverlap, ev.naturalSellThrough, cfg.curves.slowNonmoving.sellThroughHorizonDays);
  const share = (st.residual / ev.totalInventoryBookValue) * 100;
  const h = fromShare(share, cfg.curves.slowNonmoving.residualSharePctForZero);
  const drivers: Driver[] = [
    { code: "RESIDUAL_SHARE", text: `${pct(share)} of inventory book value is residual slow / nonmoving exposure.`, value: r2(share) },
    { code: "GROSS_EXPOSURE", text: `Slow-moving ${r2(ev.slowMovingValue)} plus nonmoving ${r2(ev.nonMovingValue)} = ${r2(gross)} before protection.`, value: r2(gross) },
  ];
  if (overlap > 0) drivers.push({ code: "OVERLAP_NOT_DOUBLE_COUNTED", text: `${r2(overlap)} is already counted as above-Max excess in Position & Balance and is not counted again.`, value: r2(overlap) });
  const nstLabel = ev.naturalSellThrough?.confidence === "REDUCED" ? " Includes lower-confidence fallback evidence (recent cost of sales) where governed RSE demand was absent." : "";
  drivers.push({ code: "NATURAL_SELL_THROUGH", text: st.reason + nstLabel, value: r2(st.protectedApplied) });
  return available("SLOW_NONMOVING", h, {
    drivers,
    evidenceRefs: [...refs, ...(st.applied && ev.naturalSellThrough ? [ev.naturalSellThrough.evidenceRef] : [])],
    detail: { grossExposure: r2(gross), overlapExcluded: r2(overlap), protectedByNaturalSellThrough: r2(st.protectedApplied), naturalSellThroughApplied: st.applied, naturalSellThroughSource: ev.naturalSellThrough?.source ?? (ev.naturalSellThrough ? "UNLABELLED" : "NONE"), naturalSellThroughConfidence: ev.naturalSellThrough?.confidence ?? null, governedRseProtectedValue: ev.naturalSellThrough?.governedRseProtectedValue ?? null, fallbackProtectedValue: ev.naturalSellThrough?.fallbackProtectedValue ?? null, requiresVerification: !st.applied && ev.slowMovingValue > 0 && !ev.naturalSellThrough, residualExposure: r2(st.residual), residualSharePct: r2(share), totalInventoryBookValue: ev.totalInventoryBookValue, zeroAtSharePct: cfg.curves.slowNonmoving.residualSharePctForZero },
  }, cfg);
}

// ---- D. Customer Shortage / Backorder -----------------------------------------------------------------------------------------

/** One governed customer backorder line. parentSku is Stck#, childPartOrVariant is Class: always distinct, never merged. */
export interface BackorderLine {
  orderRef: string | null;
  parentSku: string;
  childPartOrVariant: string | null;
  locationRef: string | null;
  quantity: number;
  /** Priced backorder value (extended value, or quantity x selling price). Null when the line is not priced. */
  value: number | null;
  originalOrderDate: string | null;
  promisedDate: string | null;
}

export interface ShortageInput {
  lines: BackorderLine[];
  asOf: Date;
  sourceRefs: string[];
}

export interface ShortageContributor {
  parentSku: string;
  childPartOrVariant: string | null;
  lines: number;
  openOrders: number;
  quantity: number;
  value: number;
  weightedValue: number;
  oldestAgeDays: number | null;
  recurrenceMultiplier: number;
}

export const partKey = (parentSku: string, child: string | null) => `${parentSku}\u0000${child ?? ""}`;

function bandMultiplier(days: number | null, bands: HealthConfig["curves"]["shortage"]["ageBands"]): number {
  if (days === null) return 1; // an undated line takes the neutral multiplier (disclosed in the drivers)
  for (const b of bands) if (b.maxDays === null || days <= b.maxDays) return b.multiplier;
  return bands[bands.length - 1]!.multiplier;
}

export function revenueBasisOf(facts: CompanyFactsEvidence | null): { weekly: number; basis: string } | null {
  if (!facts) return null;
  if (facts.averageWeeklyRevenue !== undefined) return { weekly: facts.averageWeeklyRevenue, basis: "average weekly revenue" };
  if (facts.annualRevenue !== undefined) return { weekly: facts.annualRevenue / 52, basis: "annual revenue / 52" };
  return null;
}

export function calcShortage(input: ShortageInput | null, facts: CompanyFactsEvidence | null, unavailableReason: string | null, cfg: HealthConfig = HEALTH_CONFIG): ComponentResult {
  if (!input) return unavailable("SHORTAGE_BACKORDER", unavailableReason ?? "No governed Customer Backorder feed is available.", cfg);
  const c = cfg.curves.shortage;
  const lines = input.lines;
  if (lines.length === 0) {
    return available("SHORTAGE_BACKORDER", 10000, {
      drivers: [{ code: "NO_OPEN_BACKORDERS", text: "The governed Customer Backorder feed is current and shows no open backordered lines." }],
      evidenceRefs: input.sourceRefs,
      detail: { lineCount: 0, totalValue: 0, weightedValue: 0, topContributors: [], byLocation: {}, asOf: input.asOf.toISOString() },
    }, cfg);
  }
  const unpriced = lines.filter((l) => l.value === null).length;
  if (unpriced / lines.length > c.maxUnpricedLineShare) {
    return unavailable("SHORTAGE_BACKORDER", `${unpriced} of ${lines.length} open backorder lines have no priced value, so the severity cannot be measured; the component is unavailable rather than scored.`, cfg, { lineCount: lines.length, unpricedLines: unpriced });
  }
  const basis = revenueBasisOf(facts);
  if (!basis) return unavailable("SHORTAGE_BACKORDER", "The company has not governed a revenue basis (average weekly or annual revenue), so backorder severity cannot be normalized.", cfg, { lineCount: lines.length });

  // recurrence: distinct open orders backordered for the same parentSku + childPartOrVariant
  const ordersByPart = new Map<string, Set<string>>();
  lines.forEach((l, i) => {
    const k = partKey(l.parentSku, l.childPartOrVariant);
    const set = ordersByPart.get(k) ?? new Set<string>();
    set.add(l.orderRef ?? `__line_${i}`);
    ordersByPart.set(k, set);
  });
  const recurrenceOf = (orders: number): number => {
    let m = 1;
    for (const b of c.recurrenceBands) if (orders >= b.minOrders) m = b.multiplier;
    return m;
  };

  const contributors = new Map<string, ShortageContributor>();
  const byLocation: Record<string, { lines: number; value: number; weightedValue: number }> = {};
  let totalValue = 0;
  let weighted = 0;
  let undated = 0;
  for (const l of lines) {
    if (l.value === null) continue;
    const orderedAt = l.originalOrderDate ? Date.parse(l.originalOrderDate) : NaN;
    const ageDays = Number.isFinite(orderedAt) ? Math.max(0, Math.floor((input.asOf.getTime() - orderedAt) / DAY_MS)) : null;
    if (ageDays === null) undated++;
    const k = partKey(l.parentSku, l.childPartOrVariant);
    const orders = ordersByPart.get(k)!.size;
    const recurrence = recurrenceOf(orders);
    const w = l.value * bandMultiplier(ageDays, c.ageBands) * recurrence;
    totalValue += l.value;
    weighted += w;
    const cur = contributors.get(k) ?? { parentSku: l.parentSku, childPartOrVariant: l.childPartOrVariant, lines: 0, openOrders: orders, quantity: 0, value: 0, weightedValue: 0, oldestAgeDays: null, recurrenceMultiplier: recurrence };
    cur.lines += 1;
    cur.quantity += l.quantity;
    cur.value += l.value;
    cur.weightedValue += w;
    if (ageDays !== null) cur.oldestAgeDays = cur.oldestAgeDays === null ? ageDays : Math.max(cur.oldestAgeDays, ageDays);
    contributors.set(k, cur);
    const locKey = l.locationRef ?? "(no location supplied)";
    const loc = byLocation[locKey] ?? { lines: 0, value: 0, weightedValue: 0 };
    loc.lines += 1;
    loc.value += l.value;
    loc.weightedValue += w;
    byLocation[locKey] = loc;
  }
  const share = (weighted / basis.weekly) * 100;
  const h = fromShare(share, c.weightedShareOfWeeklyRevenuePctForZero);
  const top = [...contributors.values()].sort((a, b) => b.weightedValue - a.weightedValue || a.parentSku.localeCompare(b.parentSku) || (a.childPartOrVariant ?? "").localeCompare(b.childPartOrVariant ?? "")).slice(0, 5);
  const drivers: Driver[] = [
    { code: "SEVERITY_SHARE", text: `Severity-weighted open backorders equal ${pct(share)} of ${basis.basis} (${r2(weighted)} weighted from ${r2(totalValue)} of backordered value).`, value: r2(share) },
    { code: "OPEN_LINES", text: `${lines.length} open backorder line(s) across ${contributors.size} parent / child part combination(s).`, value: lines.length },
  ];
  for (const t of top.slice(0, 3)) {
    drivers.push({ code: "TOP_CONTRIBUTOR", text: `Parent SKU ${t.parentSku}${t.childPartOrVariant ? ` / child part ${t.childPartOrVariant}` : ""}: ${t.lines} line(s), value ${r2(t.value)}${t.oldestAgeDays !== null ? `, oldest ${t.oldestAgeDays} days` : ""}${t.openOrders > 1 ? `, ${t.openOrders} open orders (recurring)` : ""}.`, value: r2(t.weightedValue) });
  }
  if (unpriced) drivers.push({ code: "UNPRICED_LINES", text: `${unpriced} line(s) had no priced value and are not in the severity (within the ${Math.round(c.maxUnpricedLineShare * 100)}% tolerance).`, value: unpriced });
  if (undated) drivers.push({ code: "UNDATED_LINES", text: `${undated} line(s) have no order date; they carry the neutral age multiplier.`, value: undated });
  return available("SHORTAGE_BACKORDER", h, {
    drivers,
    evidenceRefs: input.sourceRefs,
    detail: {
      lineCount: lines.length,
      unpricedLines: unpriced,
      undatedLines: undated,
      totalValue: r2(totalValue),
      weightedValue: r2(weighted),
      severitySharePct: r2(share),
      revenueBasis: basis.basis,
      weeklyRevenue: r2(basis.weekly),
      zeroAtSharePct: c.weightedShareOfWeeklyRevenuePctForZero,
      asOf: input.asOf.toISOString(),
      topContributors: top.map((t) => ({ ...t, value: r2(t.value), weightedValue: r2(t.weightedValue) })),
      byLocation: Object.fromEntries(Object.entries(byLocation).map(([k, v]) => [k, { lines: v.lines, value: r2(v.value), weightedValue: r2(v.weightedValue) }])),
      recurrenceBasis: "Distinct open orders for the same parent SKU + child part in the current governed snapshot (history is not available).",
    },
  }, cfg);
}

// ---- E. Action Resolution -----------------------------------------------------------------------------------------------------

export interface ActionFact {
  candidateId: string;
  groupedConditionKey: string;
  actionStatus: string;
  completedAt: Date | null;
  targetResolution: Date | null;
  /** Action completion (execution). Shown, but NEVER the basis of credit. */
  actionCompletionPct: number | null;
  /** Condition reduction (outcome). Signed; null = not measured. */
  conditionReductionPct: number | null;
  conditionReductionStatus: string;
}

const PROBLEM_STATUSES = new Set(["AT_RISK", "OVERDUE", "BLOCKED"]);

export function calcActionResolution(actions: ActionFact[], asOf: Date, cfg: HealthConfig = HEALTH_CONFIG): ComponentResult {
  const c = cfg.curves.actionResolution;
  const since = asOf.getTime() - c.lookbackDays * DAY_MS;
  const completed = actions.filter((a) => a.actionStatus === "COMPLETED" && a.completedAt && a.completedAt.getTime() >= since && a.completedAt.getTime() <= asOf.getTime());
  const problems = actions.filter((a) => PROBLEM_STATUSES.has(a.actionStatus));
  const completionsByCondition = new Map<string, number>();
  for (const a of completed) completionsByCondition.set(a.groupedConditionKey, (completionsByCondition.get(a.groupedConditionKey) ?? 0) + 1);

  const credits: Array<{ candidateId: string; credit: number; basis: string }> = [];
  const awaitingMeasurement: string[] = [];
  for (const a of completed) {
    if (a.conditionReductionStatus !== "MEASURED" || a.conditionReductionPct === null) {
      awaitingMeasurement.push(a.candidateId);
      continue;
    }
    let credit = Math.max(0, Math.min(1, a.conditionReductionPct / 100));
    const notes: string[] = [`condition reduction ${r2(a.conditionReductionPct)}%`];
    if (a.targetResolution && a.completedAt && a.completedAt.getTime() > a.targetResolution.getTime()) {
      credit *= c.lateCompletionFactor;
      notes.push("completed after its target date");
    }
    if ((completionsByCondition.get(a.groupedConditionKey) ?? 0) > 1) {
      credit *= c.recurrenceFactor;
      notes.push("the same condition recurred");
    }
    credits.push({ candidateId: a.candidateId, credit, basis: notes.join("; ") });
  }
  for (const a of problems) credits.push({ candidateId: a.candidateId, credit: 0, basis: `status ${a.actionStatus}` });

  if (credits.length === 0) {
    return unavailable("ACTION_RESOLUTION", awaitingMeasurement.length
      ? `${awaitingMeasurement.length} completed action(s) are awaiting condition-reduction measurement; completion alone earns no credit, so the component is unavailable.`
      : "No measured completed action and no problem action is in the review window.", cfg, { awaitingMeasurement: awaitingMeasurement.length });
  }
  const mean = credits.reduce((a, x) => a + x.credit, 0) / credits.length;
  const h = clampHundredths(mean * 10000);
  const measured = credits.length - problems.length;
  const avgCompletionPct = completed.length ? completed.reduce((a, x) => a + (x.actionCompletionPct ?? 100), 0) / completed.length : null;
  const drivers: Driver[] = [
    { code: "MEASURED_RESOLUTION", text: `${measured} completed action(s) with measured condition reduction; credit follows condition reduction, not completion.`, value: measured },
  ];
  if (problems.length) drivers.push({ code: "PROBLEM_ACTIONS", text: `${problems.length} active action(s) are At Risk, Overdue or Blocked and earn no credit.`, value: problems.length });
  if (awaitingMeasurement.length) drivers.push({ code: "AWAITING_MEASUREMENT", text: `${awaitingMeasurement.length} completed action(s) are awaiting condition-reduction measurement and earn no credit yet.`, value: awaitingMeasurement.length });
  return available("ACTION_RESOLUTION", h, {
    drivers,
    evidenceRefs: credits.map((x) => x.candidateId),
    detail: {
      lookbackDays: c.lookbackDays,
      measuredCompletions: measured,
      problemActions: problems.length,
      awaitingMeasurement: awaitingMeasurement.length,
      awaitingMeasurementCandidateIds: awaitingMeasurement,
      averageActionCompletionPctOfCompleted: avgCompletionPct === null ? null : r2(avgCompletionPct),
      credits: credits.map((x) => ({ candidateId: x.candidateId, credit: r2(x.credit), basis: x.basis })),
    },
  }, cfg);
}
