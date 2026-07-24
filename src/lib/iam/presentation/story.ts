/**
 * Trust Pyramid plain-English fields — derived from existing Recommendation facts only.
 * When a Prescribed Action Plan is present, expected result / what lean on that plan.
 * Does not invent business outcomes beyond score/evidence/plan already on the record.
 */
import { usd } from "@/lib/format";
import type { PrescribedActionPlan } from "@/lib/iam/actions";

type StorySource = {
  title: string;
  recommendationType: string;
  skuOrItemId: string | null;
  confidence: string;
  estimatedCashImpact: number | null;
  estimatedFinancialImpact: number | null;
  costOfInaction: number | null;
  sourceModule: string;
  generationPath: string;
  priorityScore: number | null;
  explainabilityJson?: string | null;
};

export type TrustStory = {
  storyWhat: string;
  storyWhy: string;
  storyWhyNow: string;
  storyExpectedResult: string;
  confidenceNarrative: string;
};

function extractPlan(json: string | null | undefined): PrescribedActionPlan | null {
  if (!json) return null;
  try {
    const ex = JSON.parse(json) as {
      prescribedActionPlan?: PrescribedActionPlan;
      detail?: { prescribedActionPlan?: PrescribedActionPlan };
    };
    return ex.prescribedActionPlan ?? ex.detail?.prescribedActionPlan ?? null;
  } catch {
    return null;
  }
}

export function buildTrustStory(rec: StorySource): TrustStory {
  const cash = rec.estimatedCashImpact ?? rec.estimatedFinancialImpact;
  const item = rec.skuOrItemId ? ` for ${rec.skuOrItemId}` : "";
  const cashLabel = cash != null ? usd(cash) : "an estimated cash impact that is not yet quantified";
  const plan = extractPlan(rec.explainabilityJson);

  const storyWhat = plan
    ? `${plan.recommendedManagementAction}`
    : `Review ${rec.recommendationType}${item}: ${rec.title}.`;

  const storyWhy = plan
    ? plan.reasonSelected
    : cash != null
      ? `Evidence from ${rec.sourceModule} indicates approximately ${cashLabel} of cash or financial exposure tied to this opportunity.`
      : `Evidence from ${rec.sourceModule} flags this ${rec.recommendationType} for management attention; quantified cash impact is not yet available.`;

  const coi =
    rec.costOfInaction != null
      ? ` Cost of inaction is estimated at ${usd(rec.costOfInaction)}.`
      : "";
  const scoreBit =
    rec.priorityScore != null
      ? ` It ranks at priority score ${rec.priorityScore.toFixed(1)} under the interim cash-led profile.`
      : "";
  const storyWhyNow = plan
    ? `Target period: ${plan.targetCompletionPeriod}. Owner role: ${plan.ownerRole}.${scoreBit}${coi}`
    : `This item is among the highest-ranked actionable opportunities that fit current execution capacity.${scoreBit}${coi}`;

  const storyExpectedResult = plan
    ? `${plan.expectedFinancialResult} ${plan.expectedOperationalResult}`
    : cash != null
      ? `If management acts, the intended outcome is to release or protect approximately ${cashLabel} while reducing the operational exposure described in the evidence.`
      : `If management acts, the intended outcome is to resolve the ${rec.recommendationType} exposure using the linked evidence package.`;

  const pathNote =
    rec.generationPath === "interim_evidence"
      ? " Confidence is based on interim Keystroke-derived evidence pending module enrichment."
      : " Confidence is based on module-submitted evidence.";
  const planConf = plan ? ` Plan data confidence: ${plan.dataConfidence}.` : "";
  const confidenceNarrative = `${rec.confidence}.${pathNote}${planConf} Limitations: interim scoring profile interim_v1_cash_led; final formulas remain under SD-1.`;

  return { storyWhat, storyWhy, storyWhyNow, storyExpectedResult, confidenceNarrative };
}
