/**
 * Sunday 02:00 company-local scheduler foundation (Stage 4A).
 *
 * The scheduler is a polling loop with an injectable clock, so every rule is testable without waiting a week:
 *   - occurrences come from the shared contract (IANA zone, DST gap/overlap rules, Sunday 02:00 by default);
 *   - one occurrence runs once (database unique key); a missed occurrence (IAM was down) is run once as catch-up;
 *   - a failed occurrence is retried after `retryMinutes`, up to `maxAttempts`, then left visibly failed;
 *   - a missing / invalid / unreadable time zone is an EXPLICIT recorded failure (at most one per UTC day) —
 *     there is never a silent UTC fallback.
 */
import { nextIamAuthoritativeRefreshAfter } from "./contract/iam-results-return";
import type { DposIntegrationConfig } from "./config";
import type { DposCompanyContext } from "./company-context";
import type { Db } from "./errors";
import { isDposError } from "./errors";
import { resolveCompanySchedule, runRefresh, type RefreshResult } from "./refresh";
import type { DataHubClient } from "./data-hub-client";
import type { HealthRefreshDeps } from "./health/pipeline";

const DAY = 86_400_000;
const CATCH_UP_AFTER_MS = 10 * 60_000;

/** Most recent scheduled occurrence at or before `now` (null if none within 14 days, which cannot happen for a valid zone). */
export function latestOccurrenceAtOrBefore(now: Date, timeZone: string, hourLocal: number): Date | null {
  let o = nextIamAuthoritativeRefreshAfter(new Date(now.getTime() - 14 * DAY), timeZone, hourLocal);
  let last: Date | null = null;
  while (o.getTime() <= now.getTime()) {
    last = o;
    o = nextIamAuthoritativeRefreshAfter(o, timeZone, hourLocal);
  }
  return last;
}

export type TickResult =
  | { action: "NOT_DUE"; occurrence: string | null }
  | { action: "ALREADY_COMPLETE"; occurrence: string }
  | { action: "IN_PROGRESS"; occurrence: string }
  | { action: "RETRY_WAIT"; occurrence: string; retryAt: string }
  | { action: "GAVE_UP"; occurrence: string; attempts: number }
  | { action: "RAN"; occurrence: string; catchUp: boolean; result: RefreshResult }
  | { action: "TIME_ZONE_FAILURE"; code: string; reason: string; recorded: boolean };

export interface SchedulerDeps {
  db: Db;
  config: DposIntegrationConfig;
  context: DposCompanyContext;
  client: Pick<DataHubClient, "getInputStatus" | "getSyncStatus">;
  /** Same Health pipeline as the manual refresh (one shared implementation inside runRefresh). */
  health?: HealthRefreshDeps | null;
  now?: () => Date;
}

export async function schedulerTick(deps: SchedulerDeps): Promise<TickResult> {
  const now = (deps.now ?? (() => new Date()))();
  const { db, config, context } = deps;
  const companyId = context.dposCompanyId;

  const schedule = resolveCompanySchedule(context, config.refresh.hourLocal);
  if (!schedule.ok) {
    // Explicit failure, deduplicated per UTC day so a fixed-up zone is picked up and the log is not flooded.
    const key = `UNRESOLVED:${now.toISOString().slice(0, 10)}`;
    const existing = await db.dposRefreshAttempt.findFirst({ where: { dposCompanyId: companyId, trigger: "SCHEDULED_WEEKLY", scheduledFor: key } });
    if (existing) return { action: "TIME_ZONE_FAILURE", code: `TIME_ZONE_${schedule.status}`, reason: schedule.reason, recorded: false };
    try {
      await runRefresh(deps as Parameters<typeof runRefresh>[0], { trigger: "SCHEDULED_WEEKLY", requestedBy: "iam-scheduler", scheduledFor: key });
    } catch (e) {
      if (!isDposError(e)) throw e;
    }
    return { action: "TIME_ZONE_FAILURE", code: `TIME_ZONE_${schedule.status}`, reason: schedule.reason, recorded: true };
  }

  const occurrence = latestOccurrenceAtOrBefore(now, schedule.schedule.timeZone, schedule.schedule.refreshHourLocal);
  if (!occurrence) return { action: "NOT_DUE", occurrence: null };
  const iso = occurrence.toISOString();

  const attempts = await db.dposRefreshAttempt.findMany({
    where: { dposCompanyId: companyId, trigger: "SCHEDULED_WEEKLY", scheduledFor: { startsWith: iso } },
    orderBy: { startedAt: "asc" },
  });
  if (attempts.some((a) => a.status === "SUCCEEDED")) return { action: "ALREADY_COMPLETE", occurrence: iso };
  if (attempts.some((a) => a.status === "STARTED" && now.getTime() - a.startedAt.getTime() < 15 * 60_000)) {
    return { action: "IN_PROGRESS", occurrence: iso };
  }
  const failed = attempts.filter((a) => a.status === "FAILED" || a.status === "STARTED");
  if (failed.length >= config.refresh.maxAttempts) return { action: "GAVE_UP", occurrence: iso, attempts: failed.length };
  const lastFailure = failed[failed.length - 1];
  if (lastFailure) {
    const retryAt = new Date((lastFailure.completedAt ?? lastFailure.startedAt).getTime() + config.refresh.retryMinutes * 60_000);
    if (retryAt.getTime() > now.getTime()) return { action: "RETRY_WAIT", occurrence: iso, retryAt: retryAt.toISOString() };
  }
  const key = failed.length === 0 ? iso : `${iso}#${failed.length + 1}`;
  const catchUp = now.getTime() - occurrence.getTime() > CATCH_UP_AFTER_MS;
  try {
    const result = await runRefresh(deps as Parameters<typeof runRefresh>[0], {
      trigger: "SCHEDULED_WEEKLY",
      requestedBy: "iam-scheduler",
      scheduledFor: key,
      catchUp,
    });
    return { action: "RAN", occurrence: iso, catchUp, result };
  } catch (e) {
    if (isDposError(e) && (e.code === "REFRESH_IN_PROGRESS" || e.code === "REFRESH_OCCURRENCE_ALREADY_RUN")) {
      return { action: "IN_PROGRESS", occurrence: iso };
    }
    throw e;
  }
}

export interface RunningScheduler {
  stop(): void;
  /** Resolves after the current tick (used by tests and graceful shutdown). */
  idle(): Promise<void>;
}

/** Start the polling loop. The timer is unref'd so it never keeps a process alive on its own. */
export function startScheduler(
  getDeps: () => Promise<SchedulerDeps>,
  pollSeconds: number,
  onTick?: (r: TickResult | { action: "ERROR"; message: string }) => void,
): RunningScheduler {
  let running: Promise<void> = Promise.resolve();
  let stopped = false;
  const tick = () => {
    if (stopped) return;
    running = running.then(async () => {
      try {
        const deps = await getDeps();
        onTick?.(await schedulerTick(deps));
      } catch (e) {
        onTick?.({ action: "ERROR", message: e instanceof Error ? e.message : String(e) });
      }
    });
  };
  const timer = setInterval(tick, pollSeconds * 1000);
  timer.unref?.();
  tick();
  return {
    stop() {
      stopped = true;
      clearInterval(timer);
    },
    idle: () => running,
  };
}
