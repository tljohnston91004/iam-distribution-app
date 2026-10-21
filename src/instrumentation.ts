/**
 * Next.js instrumentation hook. In DPOS_INTEGRATED mode with IAM_SCHEDULER_ENABLED=true it starts the Sunday refresh
 * scheduler and the Results Return outbox flusher. In STANDALONE_LEGACY mode (the default) it does nothing, so the V1.5
 * launcher and behaviour are unchanged.
 *
 * The Node-only import sits inside the positive NEXT_RUNTIME check (the form Next.js documents) so the Edge
 * instrumentation bundle never tries to resolve Node built-ins.
 */
export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    if ((process.env.IAM_DEPLOYMENT_MODE ?? "").trim() === "DPOS_INTEGRATED") {
      const { startBackgroundWorkers } = await import("./lib/dpos/background");
      startBackgroundWorkers();
    }
  }
}
