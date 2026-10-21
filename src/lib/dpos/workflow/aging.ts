/**
 * Stage 4B aging / escalation foundation (pure, deterministic; `now` is always an input).
 *
 * This is the status EVALUATION foundation, not the final action recommendation or scoring engine. It derives the
 * operational action status from facts the workflow already holds:
 *   target dates, expected-vs-actual action completion, expected-vs-actual condition reduction, open dependencies and
 *   blockers, milestone dates, the age of the last owner update, pending management decisions, and an approved pause.
 * Every threshold is a named parameter (AGING_POLICY) and every result carries machine-readable reasons.
 *
 * Precedence: COMPLETED > PAUSED > BLOCKED > OVERDUE > AT_RISK > ATTENTION > ON_TRACK (> NOT_STARTED when not begun).
 */
import { AGING_POLICY, ESCALATING_STATUSES, type ActionStatus, type AgingPolicy } from "./vocab";

const DAY_MS = 24 * 60 * 60 * 1000;

export interface AgingInput {
  now: Date;
  started: boolean;
  completed: boolean;
  /** An APPROVED pause is in force. */
  paused: boolean;
  /** An open blocker exists (a cleared blocker no longer counts). */
  blocked: boolean;
  /** Target dates are stored as calendar dates (midnight UTC); the target day is inclusive. */
  targetStart: Date | null;
  targetResolution: Date | null;
  actionCompletionPct: number | null;
  /** The RAW condition reduction; null when it is Not Yet Measured. */
  conditionReductionPct: number | null;
  latestOwnerUpdateAt: Date | null;
  startedAt: Date | null;
  nextMilestoneDue: Date | null;
  /** Open management decisions that are not themselves caused by the status (discussion, dependency, plan deviation...). */
  pendingManagementDecisions: number;
}

export interface AgingResult {
  status: ActionStatus;
  reasons: string[];
  expectedCompletionPct: number | null;
  expectedReductionPct: number | null;
  /** True when this status requires a Management Decision Required flag, a What-Changed marker and a Results Return event. */
  requiresManagementDecision: boolean;
}

/** Linear expectation between the planned start and the end of the target day; null when it cannot be known. */
export function expectedProgressPct(now: Date, start: Date | null, targetResolution: Date | null): number | null {
  if (!start || !targetResolution) return null;
  const from = start.getTime();
  const to = targetResolution.getTime() + DAY_MS;
  if (to <= from) return null;
  const f = (now.getTime() - from) / (to - from);
  return Math.round(Math.min(1, Math.max(0, f)) * 10000) / 100;
}

export function evaluateActionStatus(input: AgingInput, policyOverride: Partial<AgingPolicy> = {}): AgingResult {
  const policy: AgingPolicy = { ...AGING_POLICY, ...policyOverride };
  const reasons: string[] = [];
  const result = (status: ActionStatus, expC: number | null, expR: number | null): AgingResult => ({
    status,
    reasons,
    expectedCompletionPct: expC,
    expectedReductionPct: expR,
    requiresManagementDecision: ESCALATING_STATUSES.includes(status),
  });

  if (input.completed) {
    reasons.push("ACTION_COMPLETED");
    return result("COMPLETED", 100, null);
  }
  if (input.paused) {
    reasons.push("APPROVED_PAUSE_IN_FORCE");
    return result("PAUSED", null, null);
  }

  const start = input.targetStart ?? input.startedAt;
  const expC = expectedProgressPct(input.now, start, input.targetResolution);
  const expR = expC;

  if (input.blocked) {
    reasons.push("OPEN_BLOCKER");
    return result("BLOCKED", expC, expR);
  }

  const completion = input.actionCompletionPct ?? 0;
  const target = input.targetResolution;
  if (target && input.now.getTime() >= target.getTime() + DAY_MS) {
    reasons.push("PAST_TARGET_RESOLUTION_DATE");
    return result("OVERDUE", expC, expR);
  }

  // AT_RISK
  let atRisk = false;
  if (target) {
    const daysLeft = (target.getTime() + DAY_MS - input.now.getTime()) / DAY_MS;
    if (daysLeft <= policy.atRiskDaysToTarget && completion < policy.atRiskCompletionPct) {
      atRisk = true;
      reasons.push("NEAR_TARGET_WITH_LOW_COMPLETION");
    }
  }
  if (input.started && expC !== null && expC - completion >= policy.atRiskGapPoints) {
    atRisk = true;
    reasons.push("COMPLETION_FAR_BEHIND_EXPECTED");
  }
  if (input.started && expR !== null && input.conditionReductionPct !== null && expR - input.conditionReductionPct >= policy.atRiskGapPoints) {
    atRisk = true;
    reasons.push("CONDITION_REDUCTION_FAR_BEHIND_EXPECTED");
  }
  if (atRisk) return result("AT_RISK", expC, expR);

  // ATTENTION
  let attention = false;
  if (input.started && expC !== null && expC - completion >= policy.attentionGapPoints) {
    attention = true;
    reasons.push("COMPLETION_BEHIND_EXPECTED");
  }
  if (input.started && expR !== null && input.conditionReductionPct !== null && expR - input.conditionReductionPct >= policy.attentionGapPoints) {
    attention = true;
    reasons.push("CONDITION_REDUCTION_BEHIND_EXPECTED");
  }
  if (input.started) {
    const last = input.latestOwnerUpdateAt ?? input.startedAt;
    if (last && (input.now.getTime() - last.getTime()) / DAY_MS >= policy.staleUpdateDays) {
      attention = true;
      reasons.push("OWNER_UPDATE_STALE");
    }
  }
  if (input.nextMilestoneDue && input.now.getTime() >= input.nextMilestoneDue.getTime() + DAY_MS) {
    attention = true;
    reasons.push("MILESTONE_PAST_DUE");
  }
  if (input.pendingManagementDecisions > 0) {
    attention = true;
    reasons.push("PENDING_MANAGEMENT_DECISION");
  }
  if (!input.started && input.targetStart && input.now.getTime() >= input.targetStart.getTime() + DAY_MS) {
    attention = true;
    reasons.push("LATE_START");
  }
  if (attention) return result("ATTENTION", expC, expR);

  if (!input.started) {
    reasons.push("NOT_STARTED");
    return result("NOT_STARTED", expC, expR);
  }
  reasons.push("WITHIN_EXPECTED_RANGE");
  return result("ON_TRACK", expC, expR);
}
