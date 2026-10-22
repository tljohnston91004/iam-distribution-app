/**
 * Refresh foundation (Stage 4A): scheduled Sunday refresh job and the manual "Refresh from Data Hub" backend operation.
 *
 * A refresh asks Data Hub for the latest GOVERNED input state (availability, source run identity, freshness) and records
 * what happened. It does NOT score, rank, recommend or change any candidate — the job is a controlled placeholder that
 * proves scheduling and Data Hub connectivity (the real compute step arrives in a later stage).
 *
 * Time rules (shared contract, company-local): Sunday 02:00 in the company's IANA time zone; spring-forward gap runs at
 * the first instant after the gap; fall-back overlap runs at the first occurrence; a missing or invalid time zone is an
 * EXPLICIT failure — there is never a silent UTC fallback.
 */
import { Prisma } from "@prisma/client";
import type { DposIntegrationConfig } from "./config";
import type { DposCompanyContext } from "./company-context";
import {
  IAM_REFRESH_DEFAULT_LOCAL_HOUR,
  iamOperatingPeriodFor,
  isValidIanaTimeZone,
  nextIamAuthoritativeRefreshAfter,
  resolveIamRefreshSchedule,
  type IamRefreshSchedule,
} from "./contract/iam-results-return";
import { DataHubClientError, type DataHubClient, type InputStatusResponse } from "./data-hub-client";
import { DposError, type Db } from "./errors";
import { writeAudit } from "./audit";

import { runHealthPipeline, type HealthRefreshDeps } from "./health/pipeline";

export type RefreshTrigger = "SCHEDULED_WEEKLY" | "MANUAL_REFRESH";
const STALE_STARTED_MS = 15 * 60_000;

export type ScheduleResolution =
  | { ok: true; schedule: IamRefreshSchedule }
  | { ok: false; status: "MISSING" | "INVALID" | "UNAVAILABLE"; reason: string };

/** Resolve the company's refresh schedule from the governed context. Never defaults to UTC. */
export function resolveCompanySchedule(context: Pick<DposCompanyContext, "companyTimeZone">, hourLocal: number = IAM_REFRESH_DEFAULT_LOCAL_HOUR): ScheduleResolution {
  const tz = context.companyTimeZone;
  return resolveIamRefreshSchedule({
    timeZoneStatus: tz === null || tz === undefined || tz === "" ? "MISSING" : "OK",
    timeZone: tz,
    hourLocal,
  });
}

/** Next scheduled refresh strictly after `from`, or an explicit failure. */
export function computeNextScheduledRefresh(
  context: Pick<DposCompanyContext, "companyTimeZone">,
  hourLocal: number,
  from: Date,
): { ok: true; at: Date; timeZone: string } | { ok: false; status: string; reason: string } {
  const r = resolveCompanySchedule(context, hourLocal);
  if (!r.ok) return r;
  return { ok: true, at: nextIamAuthoritativeRefreshAfter(from, r.schedule.timeZone, r.schedule.refreshHourLocal), timeZone: r.schedule.timeZone };
}

export interface RefreshDeps {
  db: Db;
  config: DposIntegrationConfig;
  context: DposCompanyContext;
  client: Pick<DataHubClient, "getInputStatus" | "getSyncStatus">;
  /**
   * Health ingestion (4DR-C4): when present, every refresh (manual AND scheduled - one shared pipeline) also reads the governed RSE
   * Health inputs, updates the Health evidence and recalculates the Health Score. It never runs candidate scoring.
   */
  health?: HealthRefreshDeps | null;
  now?: () => Date;
}

export interface RefreshRequest {
  trigger: RefreshTrigger;
  requestedBy: string;
  /** Scheduled occurrence ISO instant (+ optional "#n" retry suffix) — required for SCHEDULED_WEEKLY. */
  scheduledFor?: string;
  catchUp?: boolean;
}

export interface RefreshResult {
  ok: boolean;
  attemptId: string;
  trigger: RefreshTrigger;
  status: "SUCCEEDED" | "FAILED";
  startedAt: string;
  completedAt: string;
  failureCategory: string | null;
  failureCode: string | null;
  failureReason: string | null;
  dataCurrentThrough: string | null;
  lastIamRefreshAt: string | null;
  nextScheduledRefreshAt: string | null;
  scheduleStatus: string;
  scheduleReason: string | null;
  warnings: string[];
  /** Outcome of the Health pipeline run by this refresh (null when no Health providers were wired). */
  health: HealthRefreshOutcome | null;
}

export interface HealthRefreshOutcome {
  rseInputRead: "SUCCEEDED" | "FAILED";
  rseInputFailureCode: string | null;
  evidenceStatuses: Array<{ kind: string; status: string }>;
  calculation: string;
  calculationFailureCode: string | null;
  healthScoreId: string | null;
  score: number | null;
  dataHubReadAt: string;
  healthCalculatedAt: string;
}

interface SourceSummary {
  family: string;
  availability: string;
  importBatchId: string | null;
  sourceRunAt: string | null;
  freshnessStatus: string | null;
  referenceTimestamp: string | null;
}

export function summarizeSources(status: InputStatusResponse): SourceSummary[] {
  return status.sources.map((s) => ({
    family: s.objectFamily,
    availability: s.availability,
    importBatchId: s.latestSuccessfulRun?.importBatchId ?? null,
    sourceRunAt: (s.latestSuccessfulRun?.sourceRunAt as string | null | undefined) ?? null,
    freshnessStatus: s.freshness?.status ?? null,
    referenceTimestamp: (s.freshness?.referenceTimestamp as string | undefined) ?? null,
  }));
}

/** "Data current through": the OLDEST reference time among the sources that are available. Null when none are. */
export function computeDataCurrentThrough(summary: SourceSummary[]): Date | null {
  const times = summary
    .filter((s) => s.availability === "AVAILABLE")
    .map((s) => s.referenceTimestamp ?? s.sourceRunAt)
    .filter((v): v is string => !!v)
    .map((v) => new Date(v))
    .filter((d) => !Number.isNaN(d.getTime()));
  if (!times.length) return null;
  return new Date(Math.min(...times.map((d) => d.getTime())));
}

async function upsertState(
  db: Db,
  companyId: string,
  data: Prisma.DposRefreshStateUncheckedUpdateInput,
): Promise<void> {
  await db.dposRefreshState.upsert({
    where: { dposCompanyId: companyId },
    create: { ...(data as Prisma.DposRefreshStateUncheckedCreateInput), dposCompanyId: companyId },
    update: data,
  });
}

/** Run one refresh attempt. Records the attempt and the retained refresh state; never scores anything. */
export async function runRefresh(deps: RefreshDeps, req: RefreshRequest): Promise<RefreshResult> {
  const now = deps.now ?? (() => new Date());
  const { db, config, context } = deps;
  const companyId = context.dposCompanyId;
  const startedAt = now();

  if (req.trigger === "SCHEDULED_WEEKLY" && !req.scheduledFor) {
    throw new DposError("SCHEDULED_FOR_REQUIRED", "A scheduled refresh must name the occurrence it serves.", 400);
  }

  // In-progress guard (a stale STARTED row left by a crashed process is closed explicitly, never ignored).
  const open = await db.dposRefreshAttempt.findMany({ where: { dposCompanyId: companyId, status: "STARTED" } });
  for (const o of open) {
    if (startedAt.getTime() - o.startedAt.getTime() > STALE_STARTED_MS) {
      await db.dposRefreshAttempt.update({
        where: { id: o.id },
        data: { status: "FAILED", completedAt: startedAt, failureCategory: "TEMPORARY_TECHNICAL", failureCode: "ABANDONED", failureReason: "The refresh did not complete (process stopped); closed as abandoned." },
      });
    } else {
      throw new DposError("REFRESH_IN_PROGRESS", "A refresh is already in progress.", 409);
    }
  }

  let attempt;
  try {
    attempt = await db.dposRefreshAttempt.create({
      data: {
        dposCompanyId: companyId,
        trigger: req.trigger,
        requestedBy: req.requestedBy,
        scheduledFor: req.scheduledFor ?? null,
        catchUp: req.catchUp ?? false,
        startedAt,
        status: "STARTED",
      },
    });
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
      throw new DposError("REFRESH_OCCURRENCE_ALREADY_RUN", "This scheduled occurrence has already been run.", 409);
    }
    throw e;
  }

  const warnings: string[] = [];
  const schedule = resolveCompanySchedule(context, config.refresh.hourLocal);
  const finish = async (
    status: "SUCCEEDED" | "FAILED",
    extra: {
      failureCategory?: string;
      failureCode?: string;
      failureReason?: string;
      summary?: SourceSummary[];
      dataCurrentThrough?: Date | null;
      hubCorrelation?: string | null;
      health?: HealthRefreshOutcome | null;
    },
  ): Promise<RefreshResult> => {
    const completedAt = now();
    let operatingPeriodStart: string | null = null;
    let operatingPeriodEnd: string | null = null;
    let next: Date | null = null;
    if (schedule.ok) {
      const p = iamOperatingPeriodFor(startedAt, schedule.schedule.timeZone);
      operatingPeriodStart = p.start;
      operatingPeriodEnd = p.end;
      const base = req.scheduledFor ? new Date(Math.max(completedAt.getTime(), Date.parse(req.scheduledFor.split("#")[0]!) || 0)) : completedAt;
      next = nextIamAuthoritativeRefreshAfter(base, schedule.schedule.timeZone, schedule.schedule.refreshHourLocal);
    }
    await db.dposRefreshAttempt.update({
      where: { id: attempt.id },
      data: {
        status,
        completedAt,
        failureCategory: extra.failureCategory ?? null,
        failureCode: extra.failureCode ?? null,
        failureReason: extra.failureReason ?? null,
        dataCurrentThrough: extra.dataCurrentThrough ?? null,
        operatingPeriodStart,
        operatingPeriodEnd,
        inputSummaryJson: extra.summary ? JSON.stringify({ sources: extra.summary, warnings, health: extra.health ?? null }) : warnings.length ? JSON.stringify({ warnings, health: extra.health ?? null }) : null,
        hubCorrelationId: extra.hubCorrelation ?? null,
      },
    });
    const previous = await db.dposRefreshState.findUnique({ where: { dposCompanyId: companyId } });
    const stateUpdate: Prisma.DposRefreshStateUncheckedUpdateInput = {
      lastAttemptAt: completedAt,
      lastAttemptStatus: status,
      nextScheduledRefreshAt: next,
      scheduleStatus: schedule.ok ? "OK" : schedule.status,
      scheduleReason: schedule.ok ? null : schedule.reason,
    };
    if (status === "SUCCEEDED") {
      stateUpdate.lastSuccessAt = completedAt;
      stateUpdate.lastIamRefreshAt = completedAt;
      // Retain the previous data-current-through when this run could not establish a newer one.
      stateUpdate.dataCurrentThrough = extra.dataCurrentThrough ?? previous?.dataCurrentThrough ?? null;
    }
    await upsertState(db, companyId, stateUpdate);
    await writeAudit(db, {
      category: "REFRESH",
      action: req.trigger,
      outcome: status === "SUCCEEDED" ? "SUCCESS" : "FAILURE",
      actor: req.requestedBy,
      dposCompanyId: companyId,
      subjectType: "DposRefreshAttempt",
      subjectId: attempt.id,
      detail: { failureCode: extra.failureCode ?? null, scheduledFor: req.scheduledFor ?? null, catchUp: req.catchUp ?? false },
    });
    const finalState = await db.dposRefreshState.findUnique({ where: { dposCompanyId: companyId } });
    return {
      ok: status === "SUCCEEDED",
      attemptId: attempt.id,
      trigger: req.trigger,
      status,
      startedAt: startedAt.toISOString(),
      completedAt: completedAt.toISOString(),
      failureCategory: extra.failureCategory ?? null,
      failureCode: extra.failureCode ?? null,
      failureReason: extra.failureReason ?? null,
      dataCurrentThrough: finalState?.dataCurrentThrough?.toISOString() ?? null,
      lastIamRefreshAt: finalState?.lastIamRefreshAt?.toISOString() ?? null,
      nextScheduledRefreshAt: next ? next.toISOString() : null,
      scheduleStatus: schedule.ok ? "OK" : schedule.status,
      scheduleReason: schedule.ok ? null : schedule.reason,
      warnings,
      health: extra.health ?? null,
    };
  };

  // Scheduled refresh with no usable time zone is an explicit, recorded failure (the occurrence cannot be located).
  if (req.trigger === "SCHEDULED_WEEKLY" && !schedule.ok) {
    return finish("FAILED", {
      failureCategory: "CONFIGURATION_SYSTEM",
      failureCode: `TIME_ZONE_${schedule.status}`,
      failureReason: schedule.reason,
    });
  }
  if (!schedule.ok) warnings.push(`SCHEDULE_${schedule.status}: ${schedule.reason}`);

  let status: InputStatusResponse;
  try {
    status = await deps.client.getInputStatus();
  } catch (e) {
    if (e instanceof DataHubClientError) {
      return finish("FAILED", { failureCategory: e.category, failureCode: e.code, failureReason: e.message });
    }
    return finish("FAILED", { failureCategory: "TEMPORARY_TECHNICAL", failureCode: "UNEXPECTED_ERROR", failureReason: (e as Error).message });
  }

  // Cross-check the company time zone against Data Hub's schedule (informational; never changes our schedule).
  try {
    const sync = await deps.client.getSyncStatus();
    const hubTz = sync.refresh?.schedule?.timeZone;
    if (hubTz && schedule.ok && hubTz !== schedule.schedule.timeZone) {
      warnings.push(`TIME_ZONE_DISAGREES_WITH_DATA_HUB: IAM=${schedule.schedule.timeZone} DataHub=${hubTz}`);
    } else if (!hubTz) {
      warnings.push("DATA_HUB_TIME_ZONE_NOT_REPORTED");
    }
  } catch (e) {
    warnings.push(`DATA_HUB_SYNC_STATUS_UNAVAILABLE: ${e instanceof DataHubClientError ? e.code : "UNEXPECTED"}`);
  }

  const summary = summarizeSources(status);
  const through = computeDataCurrentThrough(summary);
  if (summary.every((s) => s.availability !== "AVAILABLE")) warnings.push("NO_GOVERNED_INPUT_AVAILABLE");
  // Health ingestion (shared by manual and scheduled refresh). A Health problem is recorded and surfaced; it never turns a successful
  // Data Hub refresh into a failure, and it never runs Stage 4C scoring.
  let health: HealthRefreshOutcome | null = null;
  if (deps.health) {
    try {
      const h = await runHealthPipeline(db as never, context, deps.health, { at: now() });
      health = {
        rseInputRead: h.rseInputs.ok ? "SUCCEEDED" : "FAILED",
        rseInputFailureCode: h.rseInputs.failure?.code ?? null,
        evidenceStatuses: h.rseInputs.components.map((c) => ({ kind: c.kind, status: c.status })),
        calculation: h.calculation.status,
        calculationFailureCode: h.calculation.status === "FAILED" ? h.calculation.code : null,
        healthScoreId: h.calculation.status === "FAILED" ? null : h.calculation.healthScoreId,
        score: h.calculation.status === "FAILED" ? null : h.calculation.score,
        dataHubReadAt: h.dataHubReadAt,
        healthCalculatedAt: h.calculation.calculatedAt,
      };
      if (!h.rseInputs.ok) warnings.push(`HEALTH_INPUT_READ_FAILED: ${h.rseInputs.failure?.code ?? "UNKNOWN"} (previous Health evidence retained; it ages by its source time)`);
      if (h.calculation.status === "FAILED") warnings.push(`HEALTH_CALCULATION_FAILED: ${h.calculation.code}`);
    } catch (e) {
      warnings.push(`HEALTH_PIPELINE_ERROR: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
  return finish("SUCCEEDED", { summary, dataCurrentThrough: through, health });
}

/** Retained refresh state with the live-computed next scheduled refresh (so it is correct before any attempt). */
export async function getRefreshStatus(deps: Omit<RefreshDeps, "client">) {
  const now = (deps.now ?? (() => new Date()))();
  const state = await deps.db.dposRefreshState.findUnique({ where: { dposCompanyId: deps.context.dposCompanyId } });
  const next = computeNextScheduledRefresh(deps.context, deps.config.refresh.hourLocal, now);
  const recent = await deps.db.dposRefreshAttempt.findMany({
    where: { dposCompanyId: deps.context.dposCompanyId },
    orderBy: { startedAt: "desc" },
    take: 10,
  });
  return {
    companyTimeZone: deps.context.companyTimeZone,
    timeZoneValid: deps.context.companyTimeZone ? isValidIanaTimeZone(deps.context.companyTimeZone) : false,
    scheduleStatus: next.ok ? "OK" : (next.status as string),
    scheduleReason: next.ok ? null : next.reason,
    nextScheduledRefreshAt: next.ok ? next.at.toISOString() : null,
    lastAttemptAt: state?.lastAttemptAt?.toISOString() ?? null,
    lastAttemptStatus: state?.lastAttemptStatus ?? null,
    lastSuccessAt: state?.lastSuccessAt?.toISOString() ?? null,
    lastIamRefreshAt: state?.lastIamRefreshAt?.toISOString() ?? null,
    dataCurrentThrough: state?.dataCurrentThrough?.toISOString() ?? null,
    recentAttempts: recent.map((a) => ({
      id: a.id,
      trigger: a.trigger,
      status: a.status,
      scheduledFor: a.scheduledFor,
      catchUp: a.catchUp,
      startedAt: a.startedAt.toISOString(),
      completedAt: a.completedAt?.toISOString() ?? null,
      failureCategory: a.failureCategory,
      failureCode: a.failureCode,
      failureReason: a.failureReason,
    })),
  };
}
