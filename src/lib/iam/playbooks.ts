/** Playbook routing (doc 09) — maps action types to recovery playbooks. */

export type PlaybookId =
  | "stop_replenishment"
  | "controlled_runoff"
  | "vendor_return_credit"
  | "markdown_discount"
  | "rse_correction"
  | "follow_up_measurement";

export interface PlaybookRecommendation {
  playbookId: PlaybookId;
  playbookName: string;
  whyChosen: string;
  followUpRequired: boolean;
}

export function recommendPlaybook(input: {
  actionType: string;
  detail?: Record<string, unknown>;
  serviceOperationalRisk?: boolean;
}): PlaybookRecommendation {
  const reason = String(input.detail?.reason ?? "");
  const hasRse = Boolean(
    input.detail?.rse && typeof input.detail.rse === "object"
  );

  if (input.actionType === "Stock Risk Review") {
    return {
      playbookId: "stop_replenishment",
      playbookName: "Stop Replenishment",
      whyChosen: "Stock risk case — pause additional replenishment pressure while resolving availability.",
      followUpRequired: true,
    };
  }

  if (input.actionType.includes("Replenishment") || reason.includes("rse")) {
    return {
      playbookId: "rse_correction",
      playbookName: "Replenishment Setting Correction (via RSE)",
      whyChosen: "Replenishment pressure or RSE signal suggests root-cause correction before stronger recovery.",
      followUpRequired: true,
    };
  }

  if (reason === "excess_weeks_of_supply" || reason === "weak_demand_or_rse_signal") {
    const weeks = Number(input.detail?.weeksOfSupply ?? 0);
    if (weeks >= 52 && !input.serviceOperationalRisk) {
      return {
        playbookId: "controlled_runoff",
        playbookName: "Normal Sell-Through / Controlled Runoff",
        whyChosen:
          "Demand remains credible — prefer margin-preserving runoff before markdown or liquidation.",
        followUpRequired: true,
      };
    }
    return {
      playbookId: "stop_replenishment",
      playbookName: "Stop Replenishment",
      whyChosen: "Trapped cash with weak movement — stop additional cash flowing into this position.",
      followUpRequired: true,
    };
  }

  return {
    playbookId: "follow_up_measurement",
    playbookName: "Follow-Up Measurement",
    whyChosen: "Monitor whether the selected action reduced inventory burden and released cash.",
    followUpRequired: true,
  };
}

export const PLAYBOOK_OUTCOMES = [
  "Successful",
  "Partially Successful",
  "Unsuccessful",
  "Escalated",
  "Converted to Different Playbook",
  "Monitoring Continues",
] as const;
