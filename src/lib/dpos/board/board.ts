/**
 * Stage 4D Decision Board V4 assembly: every section, in the specified order, from stored records only.
 *
 *  1 Top Health Row  2 What Changed  3 Position / Classification / Efficiency context  4 Top Inventory Management Priorities
 *  5 Active Action Portfolio  6 Management Decisions Required  7 Results & Business Impact  8 What's Working Well
 *  9 Active Action Capacity (informational)  10 Filters  11 Freshness / sync states
 *
 * Reading the board never writes, never scores and never refreshes: scoring runs, health calculation and the Data Hub refresh are
 * separate, explicit operations.
 */
import type { Db } from "../errors";
import { isValidIanaTimeZone } from "../contract/iam-results-return";
import { COMPONENT_LABELS, HEALTH_CURVE_STATUS, HEALTH_VERSION, type ComponentKey } from "../health/config";
import type { ComponentResult } from "../health/composite";
import { componentSources } from "../health/component-source";
import { lastRseInputRead } from "../health/rse-input";
import { compareHealth, toStoredHealth, type HealthChange, type StoredHealth } from "../health/service";
import { computeCapacity } from "../workflow/read";
import type { WorkflowActor } from "../workflow/permissions";
import { isManagementActor } from "./actor";
import { pendingRecurrenceReviews, readClosedImpact, readCloseoutBoardRows, type CloseoutBoardRow, type PendingRecurrenceReview } from "../closeout";
import { loadCandidateFacts, titleOf } from "./facts";
import { deriveFreshness, type FreshnessView, type RefreshStatusLike } from "./freshness";
import { boardPending, pendingByCandidate, type BoardPending } from "./pending";
import { activePortfolio, capacityView, decisionsRequired, resultsAndImpact, topPriorities, workingWell, type CapacityView, type DecisionItem, type PortfolioRow, type PriorityItem, type ResultsView, type WorkingWellItem } from "./sections";
import { operatingWeekFor } from "./time";
import { whatChangedSinceLastReview, type WhatChanged } from "./what-changed";

export interface BoardOptions {
  now?: Date;
  refreshStatus: RefreshStatusLike;
  /** Location filter (applies to the location-tagged Customer Backorder aggregates only). */
  location?: string | null;
  /** Analysis Period: the Sunday (YYYY-MM-DD) of a stored review cycle. */
  period?: string | null;
}

export interface HealthComponentView {
  key: ComponentKey;
  label: string;
  available: boolean;
  score: number | null;
  nominalWeight: number;
  effectiveWeight: number | null;
  unavailableReason: string | null;
  drivers: Array<{ code: string; text: string }>;
  change: number | null;
  href: string;
  /** 4D-R: freshness of the governed evidence behind the component (RSE-fed components only; null for the others). */
  evidence: { state: "CURRENT" | "AGING" | "STALE" | "UNAVAILABLE"; label: string; ageDays: number | null; asOf: string | null; sourceRunId: string | null } | null;
  /** The component's curve is PROVISIONAL until the Product Owner approves it. */
  provisional: boolean;
  /** Efficiency only: actual implied turns always visible, with the target state (never the smoke/test target as a company target). */
  efficiency: { inventoryTurns: number | null; targetState: "CONFIGURED" | "NOT_CONFIGURED" | "INVALID" | null; targetValue: number | null; statusText: string; gmroiStatus: string | null } | null;
}

/** The separate timestamps (4DR-C6): never conflated. Evidence Current Through is SOURCE time; the others are IAM / Data Hub operations. */
export interface HealthTimestamps {
  evidenceCurrentThrough: string | null;
  evidenceBasis: string;
  dataHubReadAt: string | null;
  healthCalculatedAt: string | null;
  lastIamRefreshAt: string | null;
  nextScheduledRefreshAt: string | null;
}

export interface BoardView {
  generatedAt: string;
  actor: { actorId: string; role: string; isManagement: boolean };
  company: { dposCompanyId: string; companyTimeZone: string | null; timeZoneValid: boolean };
  filters: {
    location: { selected: string | null; available: string[]; note: string; selectedShortage: { lines: number; value: number; weightedValue: number } | null };
    period: { selected: string | null; showing: "LATEST" | "SELECTED_CYCLE" | "SELECTED_CYCLE_NOT_FOUND"; available: Array<{ weekStart: string; calculatedAt: string; score: number | null; label: string | null }> };
  };
  freshness: FreshnessView;
  healthTimestamps: HealthTimestamps;
  pending: BoardPending;
  health: {
    current: StoredHealth | null;
    prior: StoredHealth | null;
    change: HealthChange | null;
    version: string;
    curveStatus: string;
    curveNotice: string | null;
    basedOn: string | null;
    components: HealthComponentView[];
    label: string | null;
    score: number | null;
    notCalculated: boolean;
  };
  whatChanged: WhatChanged;
  context: {
    position: ComponentResult | null;
    classification: ComponentResult | null;
    efficiency: ComponentResult | null;
    shortage: ComponentResult | null;
    note: string;
  };
  topPriorities: { items: PriorityItem[]; note: string };
  portfolio: { rows: PortfolioRow[]; holdoverBasis: string; note: string };
  decisions: { items: DecisionItem[]; count: number };
  /** Stage 4E: Completed History distinguishes Execution Complete from Closeout Complete (never in Top Priorities or the Active Portfolio). */
  closeout: { pending: CloseoutBoardRow[]; closed: CloseoutBoardRow[]; recurrenceReviews: PendingRecurrenceReview[]; note: string; learningHref: string };
  results: ResultsView;
  workingWell: { items: WorkingWellItem[]; note: string | null };
  capacity: CapacityView;
}

async function resolveTimeZone(db: Db, ctx: { dposCompanyId: string; companyTimeZone?: string | null }): Promise<string | null> {
  const tz = ctx.companyTimeZone ?? (await db.dposCompanyBinding.findUnique({ where: { dposCompanyId: ctx.dposCompanyId }, select: { companyTimeZone: true } }))?.companyTimeZone ?? null;
  return tz && isValidIanaTimeZone(tz) ? tz : null;
}

export async function buildBoard(db: Db, ctx: { dposCompanyId: string; companyTimeZone?: string | null }, actor: WorkflowActor, opts: BoardOptions): Promise<BoardView> {
  const now = opts.now ?? new Date();
  const co = ctx.dposCompanyId;
  const tz = await resolveTimeZone(db, ctx);
  const facts = await loadCandidateFacts(db, co);
  const titleById = new Map(facts.map((f) => [f.row.candidateId, titleOf(f)]));
  const missingTitles = await db.iamCoreWorkflowState.findMany({ where: { dposCompanyId: co }, select: { candidateId: true, title: true, groupedConditionKey: true } });
  for (const w of missingTitles) if (!titleById.has(w.candidateId)) titleById.set(w.candidateId, w.title ?? w.groupedConditionKey);
  const titleOfCandidate = (id: string) => titleById.get(id) ?? "A candidate";

  // Health: selected cycle or latest, with the change against the calculation just before it.
  const healthRows = await db.iamCoreHealthScore.findMany({ where: { dposCompanyId: co, calculatedAt: { lte: now } }, orderBy: [{ calculatedAt: "desc" }, { createdAt: "desc" }], take: 200 });
  const byWeek = new Map<string, (typeof healthRows)[number]>();
  for (const r of healthRows) if (!byWeek.has(r.operatingWeekStart)) byWeek.set(r.operatingWeekStart, r);
  const periods = [...byWeek.values()].map((r) => ({ weekStart: r.operatingWeekStart, calculatedAt: r.calculatedAt.toISOString(), score: r.score, label: r.label }));
  const selectedPeriod = opts.period && /^\d{4}-\d{2}-\d{2}$/.test(opts.period) ? opts.period : null;
  const chosen = selectedPeriod ? byWeek.get(selectedPeriod) ?? null : healthRows[0] ?? null;
  const showing: BoardView["filters"]["period"]["showing"] = selectedPeriod ? (chosen ? "SELECTED_CYCLE" : "SELECTED_CYCLE_NOT_FOUND") : "LATEST";
  const current = chosen ? toStoredHealth(chosen) : null;
  const chosenIdx = chosen ? healthRows.findIndex((r) => r.healthScoreId === chosen.healthScoreId) : -1;
  const priorRow = chosenIdx >= 0 ? healthRows[chosenIdx + 1] ?? null : null;
  const prior = priorRow ? toStoredHealth(priorRow) : null;
  const change = current && prior ? compareHealth(current, prior) : null;

  const changeByKey = new Map((change?.components ?? []).map((c) => [c.key, c.change]));
  const sources = await componentSources(db, current?.components ?? [], now);
  const efficiencyView = (c: ComponentResult): HealthComponentView["efficiency"] => {
    if (c.key !== "EFFICIENCY") return null;
    const d = (c.detail ?? {}) as { inventoryTurns?: number; targetState?: "CONFIGURED" | "NOT_CONFIGURED" | "INVALID"; gmroiStatus?: string; measures?: Array<{ name: string; target: number }> };
    const target = d.measures?.find((m) => m.name === "inventory turns")?.target ?? null;
    const state = d.targetState ?? null;
    return {
      inventoryTurns: d.inventoryTurns ?? null,
      targetState: state,
      targetValue: target,
      gmroiStatus: d.gmroiStatus ?? null,
      statusText: state === "CONFIGURED" ? "Scored against the configured company turns target" : state === "INVALID" ? "Unavailable — invalid target" : "Unavailable — target not configured",
    };
  };
  const components: HealthComponentView[] = (current?.components ?? []).map((c) => ({
    efficiency: efficiencyView(c),
    evidence: sources[c.key]
      ? { state: sources[c.key]!.freshness.state, label: sources[c.key]!.freshness.label, ageDays: sources[c.key]!.freshness.ageDays, asOf: sources[c.key]!.asOf, sourceRunId: ((sources[c.key]!.context?.source as { sourceRunId?: string | null } | undefined)?.sourceRunId ?? null) }
      : null,
    provisional: (current?.curveStatus ?? HEALTH_CURVE_STATUS) !== "APPROVED",
    key: c.key,
    label: COMPONENT_LABELS[c.key],
    available: c.available,
    score: c.score,
    nominalWeight: c.nominalWeight,
    effectiveWeight: c.effectiveWeight,
    unavailableReason: c.unavailableReason,
    drivers: c.drivers.map((d) => ({ code: d.code, text: d.text })),
    change: changeByKey.get(c.key) ?? null,
    href: `/board/health/${c.key}`,
  }));
  const compOf = (k: ComponentKey): ComponentResult | null => current?.components.find((c) => c.key === k) ?? null;

  const shortageDetail = compOf("SHORTAGE_BACKORDER")?.detail as { byLocation?: Record<string, { lines: number; value: number; weightedValue: number }> } | undefined;
  const locations = Object.keys(shortageDetail?.byLocation ?? {}).sort();
  const selectedLocation = opts.location && opts.location.trim() ? opts.location : null;

  const evidenceTimes = Object.values(sources).map((s) => (s?.asOf ? Date.parse(s.asOf) : NaN)).filter((n) => !Number.isNaN(n));
  const evidenceThrough = evidenceTimes.length ? new Date(Math.min(...evidenceTimes)).toISOString() : null;
  const lastRead = await lastRseInputRead(db as never, co);
  const freshness = deriveFreshness(opts.refreshStatus, now, evidenceThrough);
  const healthTimestamps: HealthTimestamps = {
    evidenceCurrentThrough: evidenceThrough,
    evidenceBasis: "Business time of the governed evidence (RSE snapshot producer time; inventory as-of; sales period end) - never the Data Hub read time.",
    dataHubReadAt: lastRead && Date.parse(lastRead.at) <= now.getTime() ? lastRead.at : null,
    healthCalculatedAt: current?.calculatedAt ?? null,
    lastIamRefreshAt: opts.refreshStatus.lastIamRefreshAt,
    nextScheduledRefreshAt: opts.refreshStatus.nextScheduledRefreshAt,
  };
  const pendingMap = await pendingByCandidate(db, co, facts.map((f) => f.row.candidateId));
  const pending = await boardPending(db, co, opts.refreshStatus.lastIamRefreshAt, pendingMap.values());

  const week = tz ? operatingWeekFor(now, tz) : null;
  const whatChanged = await whatChangedSinceLastReview(db, ctx, tz, now, titleOfCandidate);
  const top = topPriorities(facts, pendingMap);
  const portfolioRows = activePortfolio(facts, week?.startsAt ?? new Date(0) /* no week known: nothing is classed Holdover */);
  const forcedReviews = await db.iamCoreForcedReview.findMany({ where: { dposCompanyId: co, status: "OPEN" }, select: { reviewId: true, candidateId: true, reasonCode: true, detail: true } });
  const emergencies = await db.iamCoreEmergencyReview.findMany({ where: { dposCompanyId: co, status: "CANDIDATE" }, select: { candidateId: true, additionalEmergency: true } });
  const recurrences = await db.iamCoreCandidate.findMany({ where: { dposCompanyId: co, closedAt: null, recurrenceOfCandidateId: { not: null }, recurrenceOf: { lifecycleState: "RISK_ACCEPTED" } }, select: { candidateId: true, recurrenceOfCandidateId: true } });
  const decisions = decisionsRequired(facts, { forcedReviews, emergencyCandidates: emergencies, riskAcceptedRecurrences: recurrences.map((r) => ({ candidateId: r.candidateId, previousCandidateId: r.recurrenceOfCandidateId! })) });
  const formal = await readClosedImpact(db, { dposCompanyId: co });
  const closeoutRows = await readCloseoutBoardRows(db, { dposCompanyId: co });
  const recurrenceReviews = await pendingRecurrenceReviews(db, { dposCompanyId: co });
  const results = resultsAndImpact(facts, now, 90, formal);
  const well = workingWell(facts, current, change ? { scoreChange: change.scoreChange, material: change.material } : null, now, formal);
  const capacity = capacityView(await computeCapacity(db as never, { dposCompanyId: co }, now));

  const curveNotice = current && current.curveStatus !== "APPROVED" ? `The component curves behind this score are ${current.curveStatus}: they await Product Owner approval, so treat the score as provisional.` : null;
  return {
    generatedAt: now.toISOString(),
    actor: { actorId: actor.actorId, role: actor.role, isManagement: isManagementActor(actor) },
    company: { dposCompanyId: co, companyTimeZone: opts.refreshStatus.companyTimeZone, timeZoneValid: tz !== null },
    filters: {
      location: {
        selected: selectedLocation,
        available: locations,
        note: "The Location filter applies to the location-tagged Customer Backorder figures only. Health, candidates and actions are company-wide and are labelled as such.",
        selectedShortage: selectedLocation ? shortageDetail?.byLocation?.[selectedLocation] ?? null : null,
      },
      period: { selected: selectedPeriod, showing, available: periods },
    },
    freshness,
    healthTimestamps,
    pending,
    health: {
      current,
      prior,
      change,
      version: current?.healthVersion ?? HEALTH_VERSION,
      curveStatus: current?.curveStatus ?? HEALTH_CURVE_STATUS,
      curveNotice,
      basedOn: current ? `Based on ${current.availableComponents} of 5 components${current.availableComponents < 5 ? "; unavailable components are left out and the weights renormalized, never scored as zero" : ""}.` : null,
      components,
      label: current?.labelText ?? null,
      score: current?.score ?? null,
      notCalculated: !current,
    },
    whatChanged,
    context: {
      position: compOf("POSITION_BALANCE"),
      classification: compOf("SLOW_NONMOVING"),
      efficiency: compOf("EFFICIENCY"),
      shortage: compOf("SHORTAGE_BACKORDER"),
      note: "Company-wide figures from governed data. RSE remains authoritative for Min/Max and classification; IAM displays what it governs.",
    },
    topPriorities: top,
    portfolio: {
      rows: portfolioRows,
      holdoverBasis: week ? `Holdover = approved before the current operating week (${week.start} to ${week.end}) and not yet completed.` : "Holdover cannot be determined: the company time zone is missing or invalid, and no UTC week is assumed.",
      note: "Action completion % and condition reduction % are different measures and are never combined.",
    },
    decisions: { items: decisions, count: decisions.length },
    closeout: {
      pending: closeoutRows.pending,
      closed: closeoutRows.closed,
      recurrenceReviews,
      note: "Execution Complete is not Closeout Complete: a candidate leaves the active actions when its work is done, but it is permanently closed only after management approves a measured outcome. A returning condition becomes a new, linked candidate.",
      learningHref: "/board/learning",
    },
    results,
    workingWell: well,
    capacity,
  };
}
