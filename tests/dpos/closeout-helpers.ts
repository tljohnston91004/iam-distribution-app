/** Stage 4E test fixtures: drive a candidate to Completed History and build closeout inputs. */
import {
  archiveToHistory,
  completeAction,
  updateConditionReduction,
  validateCompletion,
  type GroupDescription,
} from "../../src/lib/dpos/workflow";
import type { RecordMeasurementInput } from "../../src/lib/dpos/closeout";
import { MANAGER, OWNER_USER, at, dateStr, startedCandidate, type Fixture } from "./workflow-helpers";

/** Started on day 1, current exposure recorded on day 8, completed day 10, validated day 11, Completed History day 12. */
export async function completedHistoryCandidate(f: Fixture, opts: { key?: string; baseline?: number | undefined; current?: number; contributors?: string[]; describe?: Partial<GroupDescription> } = {}): Promise<string> {
  const baseline = "baseline" in opts ? opts.baseline : 1000;
  const id = await startedCandidate(f, { baselineExposure: baseline, key: opts.key, contributors: opts.contributors, ...(opts.describe ? { describe: opts.describe } : {}) });
  if (baseline !== undefined) await updateConditionReduction(f.db, f.ctx, OWNER_USER, id, { currentExposure: opts.current ?? 100, at: at(8) });
  await completeAction(f.db, f.ctx, OWNER_USER, id, { note: "All POs actioned.", at: at(10) });
  await validateCompletion(f.db, f.ctx, MANAGER, id, { finalResolutionStatus: "SUBSTANTIALLY_RESOLVED", at: at(11) });
  await archiveToHistory(f.db, f.ctx, MANAGER, id, { at: at(12) });
  return id;
}

export const ADEQUATE_WINDOW = { measurementStart: dateStr(13), measurementEnd: dateStr(27), evidenceCurrentThrough: dateStr(28) } as const;

export const PROBABLE = {
  category: "PROBABLE_CONTRIBUTION",
  rationale: "The cancelled and deferred purchase orders account for the reduction in open PO exposure.",
  evidence: [
    { kind: "EVIDENCE", ref: "po-cancel-confirmation-1", note: "Vendor cancellation confirmation" },
    { kind: "TIMING", note: "Reduction followed completion" },
  ],
  alternatives: ["Seasonal demand lifted sell-through"],
} as const;

export const UNCLEAR = { category: "UNCLEAR_INSUFFICIENT_EVIDENCE", rationale: "The evidence cannot separate the action from other changes." } as const;

/** A measurement input with an adequate window and a fully evidenced attribution. */
export function measurement(over: Partial<RecordMeasurementInput> = {}): RecordMeasurementInput {
  return {
    finalExposure: 0,
    ...ADEQUATE_WINDOW,
    evidenceRefs: ["ev-final-balance-1"],
    attribution: { ...PROBABLE, evidence: [...PROBABLE.evidence], alternatives: [...PROBABLE.alternatives] },
    at: at(30),
    ...over,
  };
}
