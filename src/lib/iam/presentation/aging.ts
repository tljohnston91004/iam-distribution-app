/**
 * Recommendation aging — advisory prompts only (PO Q-016 / 2026-07-21).
 * Never auto-reprioritize, pause, defer, delete, or change Recommendation state.
 */

export type AgingAdvisory = {
  recommendationId: string;
  agingDays: number;
  thresholdDays: number;
  advisory: true;
  message: string;
};

export function evaluateAgingAdvisory(input: {
  recommendationId: string;
  updatedAt: Date;
  thresholdDays: number;
  now?: Date;
}): AgingAdvisory | null {
  const now = input.now ?? new Date();
  const ms = now.getTime() - input.updatedAt.getTime();
  const agingDays = Math.floor(ms / (24 * 60 * 60 * 1000));
  if (agingDays < input.thresholdDays) return null;
  return {
    recommendationId: input.recommendationId,
    agingDays,
    thresholdDays: input.thresholdDays,
    advisory: true,
    message: `This recommendation has been open for ${agingDays} days (advisory threshold ${input.thresholdDays}). Reassess whether it should remain an Active Priority, move to Waiting, or be Deferred — no automatic change will be made.`,
  };
}
