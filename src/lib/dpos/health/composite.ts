/**
 * Stage 4D composite arithmetic (pure, integer hundredths so the result is exact and deterministic).
 *
 *   composite = sum(component_i x nominalWeight_i) / sum(nominalWeight_i of the AVAILABLE components)
 *
 * An unavailable component is never scored as zero: it is left out and the remaining nominal weights are renormalized to 100%.
 * With no available component there is no score and no label.
 */
import { COMPONENT_KEYS, COMPONENT_LABELS, HEALTH_CONFIG, HEALTH_LABEL_TEXT, type ComponentKey, type HealthConfig, type HealthLabel } from "./config";

export interface Driver {
  code: string;
  text: string;
  value?: number | string | null;
}

export interface ComponentResult {
  key: ComponentKey;
  label: string;
  available: boolean;
  unavailableReason: string | null;
  /** 0..10000, exact. Null when unavailable. */
  scoreHundredths: number | null;
  /** 0..100 with two decimals. Null when unavailable. */
  score: number | null;
  nominalWeight: number;
  /** The renormalized weight (percent, four decimals) the component actually carried. Null when unavailable. */
  effectiveWeight: number | null;
  drivers: Driver[];
  /** Identifiers of the governed evidence / source records the value came from. */
  evidenceRefs: string[];
  /** Component-specific computed facts (inputs, intermediate values) kept for explainability and drill-through. */
  detail: Record<string, unknown>;
}

export interface CompositeResult {
  status: "CALCULATED" | "NO_COMPONENT_AVAILABLE";
  scoreHundredths: number | null;
  score: number | null;
  label: HealthLabel | null;
  labelText: string | null;
  availableComponents: number;
  /** Components in the fixed order, with effective weights filled in. */
  components: ComponentResult[];
}

export const clampHundredths = (n: number): number => Math.max(0, Math.min(10000, Math.round(n)));

/** Round half up for non-negative values at an integer boundary. */
const roundHalfUp = (num: number, den: number): number => Math.floor((2 * num + den) / (2 * den));

export function labelFor(scoreHundredths: number, cfg: HealthConfig = HEALTH_CONFIG): HealthLabel {
  for (const f of cfg.labelFloors) if (scoreHundredths >= f.minHundredths) return f.label;
  return "NEEDS_ATTENTION";
}

export function unavailable(key: ComponentKey, reason: string, cfg: HealthConfig = HEALTH_CONFIG, detail: Record<string, unknown> = {}): ComponentResult {
  return {
    key,
    label: COMPONENT_LABELS[key],
    available: false,
    unavailableReason: reason,
    scoreHundredths: null,
    score: null,
    nominalWeight: cfg.weights[key],
    effectiveWeight: null,
    drivers: [{ code: "UNAVAILABLE", text: reason }],
    evidenceRefs: [],
    detail,
  };
}

export function available(key: ComponentKey, scoreHundredths: number, parts: { drivers: Driver[]; evidenceRefs: string[]; detail: Record<string, unknown> }, cfg: HealthConfig = HEALTH_CONFIG): ComponentResult {
  const h = clampHundredths(scoreHundredths);
  return {
    key,
    label: COMPONENT_LABELS[key],
    available: true,
    unavailableReason: null,
    scoreHundredths: h,
    score: h / 100,
    nominalWeight: cfg.weights[key],
    effectiveWeight: null,
    drivers: parts.drivers,
    evidenceRefs: parts.evidenceRefs,
    detail: parts.detail,
  };
}

/** Combine the five component results (any order) into the composite with renormalized weights. */
export function composeHealth(input: ComponentResult[], cfg: HealthConfig = HEALTH_CONFIG): CompositeResult {
  const byKey = new Map(input.map((c) => [c.key, c]));
  const ordered = COMPONENT_KEYS.map((k) => {
    const c = byKey.get(k);
    if (!c) throw new Error(`Missing health component ${k}`);
    return c;
  });
  const avail = ordered.filter((c) => c.available && c.scoreHundredths !== null);
  const den = avail.reduce((a, c) => a + c.nominalWeight, 0);
  const components = ordered.map((c) => ({ ...c, effectiveWeight: c.available && den > 0 ? Math.round((c.nominalWeight / den) * 1_000_000) / 10_000 : null }));
  if (avail.length === 0 || den === 0) {
    return { status: "NO_COMPONENT_AVAILABLE", scoreHundredths: null, score: null, label: null, labelText: null, availableComponents: 0, components };
  }
  const num = avail.reduce((a, c) => a + (c.scoreHundredths as number) * c.nominalWeight, 0);
  const scoreHundredths = roundHalfUp(num, den);
  const label = labelFor(scoreHundredths, cfg);
  return { status: "CALCULATED", scoreHundredths, score: scoreHundredths / 100, label, labelText: HEALTH_LABEL_TEXT[label], availableComponents: avail.length, components };
}
