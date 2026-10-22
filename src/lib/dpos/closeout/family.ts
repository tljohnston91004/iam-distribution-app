/**
 * Stage 4E governed condition-family vocabulary (Product Owner decision 4E-C4).
 *
 * A candidate has TWO separate things:
 *   A. a governed CONDITION FAMILY: a stable code from this vocabulary. It is the analytical grouping key for learning records,
 *      effectiveness segmentation and recurrence analytics.
 *   B. candidate-specific CONDITION DETAIL: the free-form condition description (the grouped condition's conditionKey). It is kept for
 *      people and for the existing grouped-condition identity; it is NEVER an analytical grouping key.
 *
 * The vocabulary is versioned and extensible through governed vocabulary changes (add a code and bump the version). Historical records keep
 * the code AND the vocabulary version they were written under, so a later change never rewrites or re-labels the past: a code that is no
 * longer in the current vocabulary is still displayed from its stored code.
 */
import { DposError } from "../errors";
import { toJson, type Ctx, type Tx } from "../workflow/internal";

export const CONDITION_FAMILY_VOCABULARY_VERSION = "IAM_CONDITION_FAMILY_V1" as const;

export interface ConditionFamilyDefinition {
  code: string;
  label: string;
}

/** The initial approved families (4E-C4). Order is the display order. */
export const CONDITION_FAMILIES: readonly ConditionFamilyDefinition[] = [
  { code: "EXCESS_OVER_INVENTORY", label: "Excess / Over-Inventory" },
  { code: "SLOW_NONMOVING_INVENTORY", label: "Slow / Nonmoving Inventory" },
  { code: "SHORTAGE_BACKORDER", label: "Shortage / Backorder" },
  { code: "INVENTORY_POSITION_REPLENISHMENT_IMBALANCE", label: "Inventory Position / Replenishment Imbalance" },
  { code: "DEMAND_MOVEMENT_DETERIORATION", label: "Demand / Movement Deterioration" },
  { code: "VENDOR_SUPPLY_CONSTRAINT", label: "Vendor / Supply Constraint" },
  { code: "INVENTORY_PROFITABILITY_MARGIN_EXPOSURE", label: "Inventory Profitability / Margin Exposure" },
  { code: "DATA_EVIDENCE_INVESTIGATION", label: "Data / Evidence Investigation" },
  { code: "OTHER_GOVERNED_CONDITION", label: "Other Governed Condition" },
] as const;

export const CONDITION_FAMILY_CODES: readonly string[] = CONDITION_FAMILIES.map((f) => f.code);
export const FALLBACK_CONDITION_FAMILY = "OTHER_GOVERNED_CONDITION" as const;

/** Where a family came from: the producer of the candidate, a manager, or the stored default when nothing governed was supplied. */
export type ConditionFamilySource = "PRODUCER" | "MANAGEMENT" | "DEFAULT_UNCLASSIFIED";

export const isConditionFamily = (code: unknown): code is string => typeof code === "string" && CONDITION_FAMILY_CODES.includes(code);

/** Display label for a stored code (a historical code outside the current vocabulary is shown as its stored code). */
export function conditionFamilyLabel(code: string | null | undefined): string {
  if (!code) return "Unclassified";
  return CONDITION_FAMILIES.find((f) => f.code === code)?.label ?? code;
}

/** Validate a code supplied by a producer or a manager; free text is never accepted or mapped. */
export function requireConditionFamily(value: unknown, field = "conditionFamily"): string {
  if (!isConditionFamily(value)) {
    throw new DposError("VOCABULARY_VIOLATION", `${field} must be one of the governed condition families: ${CONDITION_FAMILY_CODES.join(", ")}.`, 400, { field });
  }
  return value;
}

export interface ConditionClassification {
  familyCode: string;
  vocabularyVersion: string;
  source: ConditionFamilySource;
  classifiedBy: string;
  classifiedAt: Date;
}

/** The immutable family classification of a candidate, if one was recorded. */
export async function readClassification(db: Pick<Tx, "iamCoreConditionClassification">, candidateId: string): Promise<ConditionClassification | null> {
  const row = await db.iamCoreConditionClassification.findUnique({ where: { candidateId } });
  return row ? { familyCode: row.familyCode, vocabularyVersion: row.vocabularyVersion, source: row.source as ConditionFamilySource, classifiedBy: row.classifiedBy, classifiedAt: row.classifiedAt } : null;
}

/**
 * Record the candidate's family. Immutable: a second, different family is refused (the first record stands); the same family is a no-op.
 * Never changes the candidate, its grouped-condition key or its recurrence identity.
 */
export async function classifyCandidate(
  tx: Tx,
  ctx: Ctx,
  input: { candidateId: string; familyCode: string; source: Exclude<ConditionFamilySource, "DEFAULT_UNCLASSIFIED">; classifiedBy: string; at: Date },
): Promise<ConditionClassification> {
  const familyCode = requireConditionFamily(input.familyCode);
  const existing = await readClassification(tx, input.candidateId);
  if (existing) {
    if (existing.familyCode !== familyCode) {
      throw new DposError("CONDITION_FAMILY_CONFLICT", `This candidate is already classified as ${existing.familyCode}; a classification is never changed.`, 409, { existing: existing.familyCode, requested: familyCode });
    }
    return existing;
  }
  await tx.iamCoreConditionClassification.create({
    data: {
      candidateId: input.candidateId,
      dposCompanyId: ctx.dposCompanyId,
      familyCode,
      vocabularyVersion: CONDITION_FAMILY_VOCABULARY_VERSION,
      source: input.source,
      classifiedBy: input.classifiedBy,
      classifiedAt: input.at,
      detailJson: toJson({ note: "Governed condition family; the candidate-specific condition detail is stored separately." }),
    },
  });
  return { familyCode, vocabularyVersion: CONDITION_FAMILY_VOCABULARY_VERSION, source: input.source, classifiedBy: input.classifiedBy, classifiedAt: input.at };
}
