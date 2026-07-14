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
  executionQueueCount?: number;
}): RunBanner[] {
  const banners: RunBanner[] = [];

  if (input.lowConfidenceFeaturedCount > 0) {
    banners.push({
      level: "warn",
      message: `${input.lowConfidenceFeaturedCount} featured work package(s) have limited confidence — review cautiously.`,
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

  if ((input.executionQueueCount ?? 0) > 0) {
    banners.push({
      level: "info",
      message: `${input.executionQueueCount} ranked work package(s) sit in the execution queue — release them to owners without waiting on featured slots.`,
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
  executionQueueCount?: number;
}): string {
  if (input.featuredCount > 0) {
    return "Review featured work packages, then release additional packages from the execution queue as capacity allows.";
  }
  if ((input.executionQueueCount ?? 0) > 0) {
    return "Featured focus is clear — release ranked packages from the execution queue to owners.";
  }
  if (input.activeCount > 0) {
    return "Follow up on active assigned work packages and confirm progress.";
  }
  if (input.holdoverCount > 0) {
    return "Review holdovers separately from new priority packages.";
  }
  return "Load data and calculate to surface this week's work packages.";
}
