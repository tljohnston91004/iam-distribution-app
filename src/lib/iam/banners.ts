export interface RunBanner {
  level: "warn" | "info";
  message: string;
}

export function buildRunBanners(input: {
  readinessStatus: string;
  holdoverCount: number;
  dataGapCount: number;
  awaitingAcceptanceCount: number;
  lowConfidenceFeaturedCount: number;
}): RunBanner[] {
  const banners: RunBanner[] = [];

  if (input.lowConfidenceFeaturedCount > 0) {
    banners.push({
      level: "warn",
      message: `${input.lowConfidenceFeaturedCount} featured issue(s) have limited confidence — review cautiously.`,
    });
  }

  if (input.readinessStatus === "Not Ready" || input.readinessStatus === "Partial") {
    banners.push({
      level: "warn",
      message: "Normal confident surfacing is limited because required support is missing or partial.",
    });
  }

  if (input.holdoverCount >= 3) {
    banners.push({
      level: "warn",
      message: "Growing holdover count may require management review and reprioritization.",
    });
  }

  if (input.awaitingAcceptanceCount > 0) {
    banners.push({
      level: "info",
      message: `${input.awaitingAcceptanceCount} action(s) awaiting acceptance — follow up with assignees.`,
    });
  }

  if (input.dataGapCount > 0) {
    banners.push({
      level: "info",
      message: `${input.dataGapCount} data gap(s) may affect decision quality this cycle.`,
    });
  }

  return banners;
}

export function nextBestAction(input: {
  featuredCount: number;
  holdoverCount: number;
  activeCount: number;
}): string {
  if (input.featuredCount > 0) {
    return "Review top featured priorities and approve, reject, or assign in this cycle.";
  }
  if (input.activeCount > 0) {
    return "Follow up on active assigned actions and confirm progress.";
  }
  if (input.holdoverCount > 0) {
    return "Review holdovers separately from new priorities.";
  }
  return "Load data and calculate to surface this week's featured priorities.";
}
