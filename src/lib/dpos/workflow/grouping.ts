/**
 * Stage 4B grouped-candidate rule (pure; no I/O).
 *
 * A candidate is a MANAGEMENT-LEVEL inventory condition, not a SKU row. Detailed evidence is grouped into ONE candidate when
 *   - the underlying condition is coherent,
 *   - the intended management response (action path) is coherent,
 *   - the responsible department is materially the same, and
 *   - the business objective is materially the same.
 * Evidence whose action path, department or objective differs becomes a SEPARATE candidate. SKU / vendor / category / PO /
 * backorder detail is never a grouping dimension: it stays drill-down evidence attached to the candidate.
 *
 * Who decides what the "underlying condition" is (and what response, department and objective apply to it) is the later
 * detection / recommendation stage: 4B receives those four facets with each evidence item and applies the grouping and
 * duplicate-control rules deterministically. It never invents a facet.
 */
import { DposError } from "../errors";
import type { EvidenceKind } from "./vocab";
import { EVIDENCE_KINDS } from "./vocab";

export interface GroupFacets {
  /** Identity of the coherent underlying condition (for example one vendor's excess open-PO exposure). */
  conditionKey: string;
  /** The intended management response (action path). */
  actionPath: string;
  responsibleDepartment: string;
  businessObjective: string;
}

export interface EvidenceItem extends GroupFacets {
  /** Stable reference to the governed evidence (Data Hub record / source-run line reference). References only. */
  evidenceRef: string;
  kind?: EvidenceKind;
  sku?: string;
  vendor?: string;
  category?: string;
  poRef?: string;
  backorderRef?: string;
  sourceRunId?: string;
  /** Small, optional drill-down attributes (identifiers/labels, not the governed dataset). */
  detail?: Record<string, string | number | boolean | null>;
}

export interface EvidenceGroup {
  groupedConditionKey: string;
  facets: GroupFacets;
  items: EvidenceItem[];
}

const MAX_REF = 500;
const MAX_ITEMS = 5000;

export function normalizeFacet(value: string): string {
  return value.trim().replace(/\s+/g, " ").toUpperCase();
}

/** The grouped-condition identity: coherent condition + action path + department + objective. */
export function deriveGroupedConditionKey(facets: GroupFacets): string {
  return [facets.conditionKey, facets.actionPath, facets.responsibleDepartment, facets.businessObjective].map(normalizeFacet).join("|");
}

function requireFacet(value: unknown, field: string, ref: string): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new DposError("GROUPING_FACET_REQUIRED", `Evidence ${ref}: ${field} is required to group evidence into a candidate (it is never assumed).`, 400, { evidenceRef: ref, field });
  }
  return value.trim();
}

export function validateEvidenceItem(item: EvidenceItem): EvidenceItem {
  const ref = typeof item.evidenceRef === "string" ? item.evidenceRef.trim() : "";
  if (!ref) throw new DposError("EVIDENCE_REF_REQUIRED", "Every evidence item needs a stable evidenceRef.", 400);
  if (ref.length > MAX_REF) throw new DposError("EVIDENCE_REF_TOO_LONG", `evidenceRef exceeds ${MAX_REF} characters.`, 400, { evidenceRef: ref.slice(0, 40) });
  if (item.kind !== undefined && !(EVIDENCE_KINDS as readonly string[]).includes(item.kind)) {
    throw new DposError("VOCABULARY_VIOLATION", `kind must be one of ${EVIDENCE_KINDS.join(", ")}`, 400, { evidenceRef: ref });
  }
  return {
    ...item,
    evidenceRef: ref,
    conditionKey: requireFacet(item.conditionKey, "conditionKey", ref),
    actionPath: requireFacet(item.actionPath, "actionPath", ref),
    responsibleDepartment: requireFacet(item.responsibleDepartment, "responsibleDepartment", ref),
    businessObjective: requireFacet(item.businessObjective, "businessObjective", ref),
  };
}

/** Partition evidence into coherent groups. Deterministic: groups sorted by key, items by evidenceRef. */
export function groupEvidence(items: readonly EvidenceItem[]): EvidenceGroup[] {
  if (!items.length) throw new DposError("EVIDENCE_REQUIRED", "At least one governed evidence item is required.", 400);
  if (items.length > MAX_ITEMS) throw new DposError("EVIDENCE_TOO_MANY", `At most ${MAX_ITEMS} evidence items per call.`, 400);
  const groups = new Map<string, EvidenceGroup>();
  const seen = new Map<string, string>();
  for (const raw of items) {
    const item = validateEvidenceItem(raw);
    const key = deriveGroupedConditionKey(item);
    const priorKey = seen.get(item.evidenceRef);
    if (priorKey !== undefined && priorKey !== key) {
      throw new DposError("EVIDENCE_REF_CONFLICT", `Evidence ${item.evidenceRef} is supplied with two different condition/action/department/objective facets; one evidence item belongs to exactly one candidate.`, 409, { evidenceRef: item.evidenceRef });
    }
    seen.set(item.evidenceRef, key);
    let group = groups.get(key);
    if (!group) {
      group = {
        groupedConditionKey: key,
        facets: { conditionKey: item.conditionKey, actionPath: item.actionPath, responsibleDepartment: item.responsibleDepartment, businessObjective: item.businessObjective },
        items: [],
      };
      groups.set(key, group);
    }
    if (!group.items.some((i) => i.evidenceRef === item.evidenceRef)) group.items.push(item);
  }
  return [...groups.values()]
    .map((g) => ({ ...g, items: [...g.items].sort((a, b) => a.evidenceRef.localeCompare(b.evidenceRef)) }))
    .sort((a, b) => a.groupedConditionKey.localeCompare(b.groupedConditionKey));
}
