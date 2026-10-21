/**
 * CONTROLLED FIXTURE EVENTS for proving the Results Return producer path (Stage 4A).
 *
 * These are synthetic events (no customer data, no scoring). They exist only to prove that IAM can persist, transmit
 * and reconcile `IAM_RESULTS_RETURN_V1` events end to end. They are refused in a PRODUCTION environment class so a
 * fixture can never be mistaken for a real recommendation.
 */
import type { DposIntegrationConfig } from "./config";
import type { IamEventType } from "./contract/iam-results-return";
import { DposError } from "./errors";
import type { EnqueueInput } from "./outbox";

export const FIXTURE_EVENT_TYPES = ["CANDIDATE_CREATED", "ACTION_STATUS_CHANGED", "CLOSEOUT_COMPLETED"] as const satisfies readonly IamEventType[];
export type FixtureEventType = (typeof FIXTURE_EVENT_TYPES)[number];

export function assertFixturesAllowed(config: Pick<DposIntegrationConfig, "environmentClass">): void {
  if (config.environmentClass === "PRODUCTION") {
    throw new DposError("FIXTURES_NOT_ALLOWED_IN_PRODUCTION", "Controlled fixture events are not permitted in a PRODUCTION environment.", 403);
  }
}

export function fixtureEvent(eventType: FixtureEventType, candidateId: string, at: Date = new Date()): EnqueueInput {
  const iso = (offsetMinutes: number) => new Date(at.getTime() + offsetMinutes * 60_000).toISOString();
  switch (eventType) {
    case "CANDIDATE_CREATED":
      return {
        eventType,
        candidateId,
        at,
        sections: {
          subject: { domainKey: "FIXTURE_DOMAIN", candidateKind: "GROUPED", title: "FIXTURE candidate (controlled test event)" },
          source: { iamSourceRunId: "fixture-run-1", iamSourceVersion: "iam-4a-fixture", evidenceRefs: ["fixture:evidence-1"] },
          recommendation: {
            title: "FIXTURE recommendation (controlled test event)",
            recommendedAction: "No real action: fixture only",
            domainScore: 50,
            domainRank: 1,
          },
        },
      };
    case "ACTION_STATUS_CHANGED":
      return { eventType, candidateId, at, sections: { progress: { actionStatus: "ON_TRACK" } } };
    case "CLOSEOUT_COMPLETED":
      return {
        eventType,
        candidateId,
        at,
        sections: { closeout: { closeoutAt: iso(1), finalResolutionStatus: "FULLY_RESOLVED" } },
      };
  }
}
