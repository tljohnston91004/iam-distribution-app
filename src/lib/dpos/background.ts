/**
 * Background workers (Stage 4A): the Sunday refresh scheduler and the Results Return outbox flusher.
 * Started once per Node process from `src/instrumentation.ts`, only in DPOS_INTEGRATED mode and only when
 * IAM_SCHEDULER_ENABLED=true. A failure in a tick is logged and the loop continues (nothing is ever dropped: attempts
 * and outbox rows are persisted before and after every step).
 */
import { prisma } from "@/lib/db";
import { flushOutbox } from "./outbox";
import { integratedConfig, operationalServices } from "./runtime";
import { IAM_SERVICE_CAPABILITIES } from "./service-identity";
import { schedulerTick, startScheduler, type RunningScheduler } from "./scheduler";

const g = globalThis as unknown as { __iamDposWorkers?: { scheduler: RunningScheduler; outbox: NodeJS.Timeout } };

function log(level: "info" | "warn" | "error", message: string, extra?: Record<string, unknown>) {
  console[level === "info" ? "log" : level](JSON.stringify({ at: new Date().toISOString(), component: "iam-dpos", level, message, ...(extra ?? {}) }));
}

export function startBackgroundWorkers(): void {
  if (g.__iamDposWorkers) return;
  let config;
  try {
    config = integratedConfig();
  } catch (e) {
    log("error", "DPOS integration configuration is invalid; background workers not started", { error: e instanceof Error ? e.message : String(e) });
    return;
  }
  if (!config || !config.refresh.schedulerEnabled) return;

  const scheduler = startScheduler(
    async () => {
      const { client, context, config: cfg } = await operationalServices(IAM_SERVICE_CAPABILITIES.GOVERNED_INPUT_READ);
      return { db: prisma, config: cfg, context, client };
    },
    config.refresh.pollSeconds,
    (r) => {
      if (r.action === "ERROR") log("error", "scheduler tick failed", { error: r.message });
      else if (r.action === "RAN" || r.action === "TIME_ZONE_FAILURE" || r.action === "GAVE_UP") log(r.action === "RAN" ? "info" : "warn", `scheduler ${r.action}`, { result: r });
    },
  );
  const outbox = setInterval(async () => {
    try {
      const { client, context, config: cfg } = await operationalServices(IAM_SERVICE_CAPABILITIES.RESULTS_RETURN_WRITE);
      const res = await flushOutbox({ db: prisma, config: cfg, context, client });
      if (res.attempted.length) log("info", "outbox flushed", { attempted: res.attempted.length });
    } catch (e) {
      log("warn", "outbox flush skipped", { error: e instanceof Error ? e.message : String(e) });
    }
  }, config.refresh.pollSeconds * 1000);
  outbox.unref?.();
  g.__iamDposWorkers = { scheduler, outbox };
  log("info", "background workers started", { pollSeconds: config.refresh.pollSeconds });
}

// Re-exported so tests can drive a single tick without timers.
export { schedulerTick };
