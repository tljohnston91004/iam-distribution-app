/**
 * Infer matrix parent/template Stock #s (Keystroke adapter — outside IAM Core).
 * Case-break Parent/Child multipliers remain RSE-owned (SD-16) — not implemented here.
 */

export function inferParentTemplateSkus(skuIds: Iterable<string>): Set<string> {
  const unique = [...new Set([...skuIds].map((s) => String(s).trim()).filter(Boolean))];
  const skuSet = new Set(unique);
  const parents = new Set<string>();

  for (const sku of unique) {
    if (!sku || sku.includes(".")) continue;
    const prefix = `${sku}.`;
    for (const other of skuSet) {
      if (other !== sku && other.startsWith(prefix)) {
        parents.add(sku);
        break;
      }
    }
  }

  return parents;
}

/** SKUs on both Matrix and Standard replenishment = shared matrix parent schemes. */
export function sharedParentSchemeSkus(
  matrixSkus: Iterable<string>,
  standardSkus: Iterable<string>
): Set<string> {
  const standard = new Set([...standardSkus].map((s) => String(s).trim()));
  const shared = new Set<string>();
  for (const sku of matrixSkus) {
    const id = String(sku).trim();
    if (id && standard.has(id)) shared.add(id);
  }
  return shared;
}

export function buildExcludedParentSkus(opts: {
  matrixSkus: Iterable<string>;
  standardSkus: Iterable<string>;
  allDemandSkus: Iterable<string>;
  inventorySkus: Iterable<string>;
}): {
  excludedParents: Set<string>;
  sharedParents: Set<string>;
  inferredParents: Set<string>;
} {
  const sharedParents = sharedParentSchemeSkus(opts.matrixSkus, opts.standardSkus);
  const inferredParents = inferParentTemplateSkus([
    ...opts.allDemandSkus,
    ...opts.inventorySkus,
  ]);
  return {
    sharedParents,
    inferredParents,
    excludedParents: new Set([...sharedParents, ...inferredParents]),
  };
}
