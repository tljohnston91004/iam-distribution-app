/**
 * Stage 4D: the board's operations, as one tested dispatcher.
 *
 * Every button on the Decision Board / Plan page calls exactly one of these. Each is the existing Stage 4B workflow operation (so
 * permissions, state rules, audit, history and outbox events are the workflow's own - the board adds none of its own rules):
 * management actions need a management role; task-owner actions need the assigned owner or an authorized manager; contributors
 * are limited. A refused action returns the workflow's own error code and message so the screen can show exactly why.
 */
import type { PrismaClient } from "@prisma/client";
import { DposError } from "../errors";
import {
  acceptOwnership,
  approveCandidate,
  completeAction,
  decidePause,
  escalateCandidate,
  presentCandidate,
  raiseBlocker,
  rejectCandidate,
  requestPause,
  returnForReview,
  revisePlan,
  riskAcceptCandidate,
  startAction,
  updateConditionReduction,
  updateProgress,
  type WorkflowActor,
} from "../workflow";

export const BOARD_ACTIONS = [
  "present",
  "approve",
  "reject",
  "riskAccept",
  "escalate",
  "returnForReview",
  "revisePlan",
  "decidePause",
  "requestPause",
  "acceptOwnership",
  "startAction",
  "updateProgress",
  "updateConditionReduction",
  "raiseBlocker",
  "completeAction",
] as const;
export type BoardAction = (typeof BOARD_ACTIONS)[number];

export const BOARD_ACTION_LABELS: Record<BoardAction, string> = {
  present: "Present for decision",
  approve: "Approve with plan",
  reject: "Reject",
  riskAccept: "Accept the risk",
  escalate: "Escalate",
  returnForReview: "Return for review",
  revisePlan: "Revise plan",
  decidePause: "Decide pause request",
  requestPause: "Request pause",
  acceptOwnership: "Accept ownership",
  startAction: "Start action",
  updateProgress: "Update progress",
  updateConditionReduction: "Record exposure",
  raiseBlocker: "Raise blocker",
  completeAction: "Mark complete",
};

type Body = Record<string, unknown>;
type Ctx = { dposCompanyId: string };

const text = (b: Body, k: string): string | undefined => {
  const v = b[k];
  if (v === undefined || v === null) return undefined;
  if (typeof v !== "string") throw new DposError("INVALID_FIELD", `${k} must be text.`, 400, { field: k });
  const t = v.trim();
  return t ? t : undefined;
};
const need = (b: Body, k: string, label: string): string => {
  const v = text(b, k);
  if (!v) throw new DposError("REASON_REQUIRED", `${label} is required.`, 400, { field: k });
  return v;
};
const numberOf = (b: Body, k: string): number | undefined => {
  const v = b[k];
  if (v === undefined || v === null || v === "") return undefined;
  const n = typeof v === "number" ? v : Number(v);
  if (!Number.isFinite(n)) throw new DposError("INVALID_FIELD", `${k} must be a number.`, 400, { field: k });
  return n;
};
const flag = (b: Body, k: string): boolean | undefined => (b[k] === undefined ? undefined : b[k] === true || b[k] === "true" || b[k] === "on");

export interface BoardActionResult {
  action: BoardAction;
  label: string;
  candidateId: string;
  ok: true;
  message: string;
  result: unknown;
}

export async function performBoardAction(db: PrismaClient, ctx: Ctx, actor: WorkflowActor, candidateId: string, action: string, body: Body, at?: Date): Promise<BoardActionResult> {
  if (!(BOARD_ACTIONS as readonly string[]).includes(action)) throw new DposError("UNKNOWN_ACTION", `Unknown action "${action}".`, 400);
  const a = action as BoardAction;
  const label = BOARD_ACTION_LABELS[a];
  let result: unknown;
  switch (a) {
    case "present":
      result = await presentCandidate(db, ctx, actor, candidateId, { at });
      break;
    case "approve": {
      const department = need(body, "responsibleDepartment", "A responsible department");
      const planSummary = need(body, "planSummary", "A plan summary");
      const ownerId = text(body, "taskOwnerId");
      const deviates = flag(body, "deviatesFromRecommendation");
      result = await approveCandidate(db, ctx, actor, candidateId, {
        reason: text(body, "reason"),
        plan: { summary: planSummary, actionDirection: text(body, "actionDirection"), deviatesFromRecommendation: deviates, deviationReason: text(body, "deviationReason") },
        assignment: { responsibleDepartment: department, taskOwnerId: ownerId, taskOwnerName: text(body, "taskOwnerName") },
        targetStart: text(body, "targetStart"),
        targetResolution: text(body, "targetResolution"),
        baselineExposure: numberOf(body, "baselineExposure"),
        exposureUnit: text(body, "exposureUnit"),
        at,
      });
      break;
    }
    case "reject":
      result = await rejectCandidate(db, ctx, actor, candidateId, { reason: need(body, "reason", "A rejection reason"), conditionStillQualifies: flag(body, "conditionStillQualifies"), at });
      break;
    case "riskAccept":
      result = await riskAcceptCandidate(db, ctx, actor, candidateId, { reason: need(body, "reason", "A risk-acceptance reason"), at });
      break;
    case "escalate":
      result = await escalateCandidate(db, ctx, actor, candidateId, { escalatedTo: need(body, "escalatedTo", "The person or group to escalate to"), reason: need(body, "reason", "An escalation reason"), at });
      break;
    case "returnForReview":
      result = await returnForReview(db, ctx, actor, candidateId, { reason: need(body, "reason", "A review note"), at });
      break;
    case "revisePlan": {
      const summary = need(body, "planSummary", "A plan summary");
      result = await revisePlan(db, ctx, actor, candidateId, {
        reason: need(body, "reason", "A reason for the revision"),
        plan: { summary, actionDirection: text(body, "actionDirection"), deviatesFromRecommendation: flag(body, "deviatesFromRecommendation"), deviationReason: text(body, "deviationReason") },
        at,
      });
      break;
    }
    case "decidePause": {
      const decision = text(body, "decision")?.toUpperCase();
      if (decision !== "APPROVE" && decision !== "DENY") throw new DposError("VOCABULARY_VIOLATION", "decision must be APPROVE or DENY.", 400, { field: "decision" });
      result = await decidePause(db, ctx, actor, candidateId, { decision, reason: need(body, "reason", "A decision reason"), at });
      break;
    }
    case "requestPause":
      result = await requestPause(db, ctx, actor, candidateId, { reason: need(body, "reason", "A pause reason"), expectedDurationDays: numberOf(body, "expectedDurationDays"), reactivationCondition: text(body, "reactivationCondition"), at });
      break;
    case "acceptOwnership":
      result = await acceptOwnership(db, ctx, actor, candidateId, { note: text(body, "note"), at });
      break;
    case "startAction":
      result = await startAction(db, ctx, actor, candidateId, { note: text(body, "note"), at });
      break;
    case "updateProgress":
      result = await updateProgress(db, ctx, actor, candidateId, { actionCompletionPct: numberOf(body, "actionCompletionPct"), nextMilestone: text(body, "nextMilestone") ?? null, nextMilestoneDue: text(body, "nextMilestoneDue") ?? null, note: text(body, "note"), at });
      break;
    case "updateConditionReduction":
      result = await updateConditionReduction(db, ctx, actor, candidateId, { baselineExposure: numberOf(body, "baselineExposure"), currentExposure: numberOf(body, "currentExposure"), exposureUnit: text(body, "exposureUnit"), note: text(body, "note"), at });
      break;
    case "raiseBlocker":
      result = await raiseBlocker(db, ctx, actor, candidateId, { reason: need(body, "reason", "A blocker description"), dependency: text(body, "dependency"), material: flag(body, "material"), at });
      break;
    case "completeAction":
      result = await completeAction(db, ctx, actor, candidateId, { note: text(body, "note"), at });
      break;
  }
  return { action: a, label, candidateId, ok: true, message: `${label}: done.`, result };
}
