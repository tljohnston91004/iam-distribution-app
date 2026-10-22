/**
 * Stage 4D freshness / sync states for the board.
 *
 * Derived (never stored) from the existing Stage 4A refresh state. The board shows every applicable state; the "primary" state is the
 * most severe one. A missing, invalid or unavailable company schedule is shown AS SUCH - it is never replaced by a UTC schedule.
 *
 * PROVISIONAL (PO decision 4D-P2): the day thresholds that separate current / aging / stale. They are data, shown on the board.
 */
export const FRESHNESS_POLICY = { currentMaxDays: 8, agingMaxDays: 14, provisional: true } as const;

export const FRESHNESS_STATES = ["CURRENT", "AGING", "STALE", "NEVER_REFRESHED", "REFRESH_FAILED", "SCHEDULE_UNAVAILABLE", "MISSING_TIME_ZONE", "INVALID_TIME_ZONE"] as const;
export type FreshnessState = (typeof FRESHNESS_STATES)[number];

export const FRESHNESS_LABELS: Record<FreshnessState, string> = {
  CURRENT: "Current",
  AGING: "Aging",
  STALE: "Stale",
  NEVER_REFRESHED: "Never refreshed",
  REFRESH_FAILED: "Refresh failed",
  SCHEDULE_UNAVAILABLE: "Schedule unavailable",
  MISSING_TIME_ZONE: "Company time zone missing",
  INVALID_TIME_ZONE: "Company time zone invalid",
};

/** Most severe first. */
const SEVERITY: FreshnessState[] = ["INVALID_TIME_ZONE", "MISSING_TIME_ZONE", "SCHEDULE_UNAVAILABLE", "REFRESH_FAILED", "STALE", "NEVER_REFRESHED", "AGING", "CURRENT"];

/** The subset of `getRefreshStatus` the board needs (kept structural so tests can supply it directly). */
export interface RefreshStatusLike {
  companyTimeZone: string | null;
  timeZoneValid: boolean;
  scheduleStatus: string;
  scheduleReason: string | null;
  nextScheduledRefreshAt: string | null;
  lastAttemptAt: string | null;
  lastAttemptStatus: string | null;
  lastSuccessAt: string | null;
  lastIamRefreshAt: string | null;
  dataCurrentThrough: string | null;
  recentAttempts: Array<{ status: string; failureCode: string | null; failureReason: string | null; startedAt: string; trigger: string }>;
}

export interface FreshnessView {
  primary: FreshnessState;
  primaryLabel: string;
  states: FreshnessState[];
  messages: string[];
  dataCurrentThrough: string | null;
  dataAgeDays: number | null;
  lastIamRefreshAt: string | null;
  lastAttemptAt: string | null;
  lastAttemptStatus: string | null;
  nextScheduledRefreshAt: string | null;
  companyTimeZone: string | null;
  scheduleStatus: string;
  policy: typeof FRESHNESS_POLICY;
}

export function deriveFreshness(status: RefreshStatusLike, now: Date, healthEvidenceThrough: string | null = null): FreshnessView {
  const states = new Set<FreshnessState>();
  const messages: string[] = [];
  const schedule = status.scheduleStatus;
  if (schedule === "MISSING") {
    states.add("MISSING_TIME_ZONE");
    messages.push(status.scheduleReason ?? "The company time zone is not configured, so no refresh schedule can be computed. No UTC schedule is assumed.");
  } else if (schedule === "INVALID") {
    states.add("INVALID_TIME_ZONE");
    messages.push(status.scheduleReason ?? "The company time zone is not a valid IANA zone, so no refresh schedule can be computed. No UTC schedule is assumed.");
  } else if (schedule !== "OK") {
    states.add("SCHEDULE_UNAVAILABLE");
    messages.push(status.scheduleReason ?? "The refresh schedule is unavailable.");
  }
  const latest = status.recentAttempts[0];
  if (status.lastAttemptStatus === "FAILED" || latest?.status === "FAILED") {
    states.add("REFRESH_FAILED");
    messages.push(`The latest refresh attempt failed${latest?.failureCode ? ` (${latest.failureCode})` : ""}${latest?.failureReason ? `: ${latest.failureReason}` : ""}. The board is showing the last successful data.`);
  }
  let ageDays: number | null = null;
  if (!status.dataCurrentThrough) {
    states.add("NEVER_REFRESHED");
    messages.push(healthEvidenceThrough ? "No Data Hub input refresh has been recorded by IAM yet. Health evidence from a governed source is present (see Evidence Current Through); its age follows the source time, not the read time." : "No governed data has been refreshed into IAM yet.");
  } else {
    const t = Date.parse(status.dataCurrentThrough);
    if (Number.isNaN(t)) {
      states.add("STALE");
      messages.push("The recorded data-current-through time is not readable.");
    } else {
      ageDays = Math.max(0, Math.floor((now.getTime() - t) / (24 * 3600 * 1000)));
      if (ageDays <= FRESHNESS_POLICY.currentMaxDays) states.add("CURRENT");
      else if (ageDays <= FRESHNESS_POLICY.agingMaxDays) {
        states.add("AGING");
        messages.push(`The data is ${ageDays} days old.`);
      } else {
        states.add("STALE");
        messages.push(`The data is ${ageDays} days old, beyond the ${FRESHNESS_POLICY.agingMaxDays}-day limit.`);
      }
    }
  }
  const ordered = SEVERITY.filter((s) => states.has(s));
  const primary = ordered[0] ?? "CURRENT";
  return {
    primary,
    primaryLabel: FRESHNESS_LABELS[primary],
    states: ordered,
    messages,
    dataCurrentThrough: status.dataCurrentThrough,
    dataAgeDays: ageDays,
    lastIamRefreshAt: status.lastIamRefreshAt,
    lastAttemptAt: status.lastAttemptAt,
    lastAttemptStatus: status.lastAttemptStatus,
    nextScheduledRefreshAt: status.nextScheduledRefreshAt,
    companyTimeZone: status.companyTimeZone,
    scheduleStatus: schedule,
    policy: FRESHNESS_POLICY,
  };
}
