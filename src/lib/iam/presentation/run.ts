/**
 * Score then present — Phase 4 orchestration (Core only).
 */
import { scoreReviewCycle } from "@/lib/iam/scoring";
import { assignPresentation, type PresentationLaneSummary } from "./assign";

export async function scoreAndPresentReviewCycle(iamRunId: string): Promise<{
  scoredCount: number;
  scoringProfileId: string;
  lanes: PresentationLaneSummary;
  oec: { capacity: number; holdoverConsumed: number; promoted: number };
}> {
  const scored = await scoreReviewCycle(iamRunId);
  const presented = await assignPresentation(iamRunId);
  return {
    scoredCount: scored.scoredCount,
    scoringProfileId: scored.scoringProfileId,
    lanes: presented.lanes,
    oec: presented.oec,
  };
}
