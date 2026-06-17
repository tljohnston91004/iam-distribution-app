/**
 * Locked hard rules — IAM V1.0 validation build.
 * Used for acceptance checks and developer guardrails. See STAGE-1-FOUNDATION.md.
 */

export const IAM_HARD_RULES = [
  "IAM is the inventory action engine; it does not replace RSE, IFM, or Decision OS.",
  "One company per workspace/environment in V1.",
  "Priority weights are fixed in V1 — not user-adjustable.",
  "Cash impact leads ranking; service/operational risk overrides only when clearly more dangerous.",
  "New priorities and holdovers rank separately.",
  "Top 2 remain the core weekly surfaced priorities.",
  "Rejected top priorities do not auto-replace with lower-ranked items in the same cycle.",
  "A weekly cycle may end with zero approved top priorities.",
  "Management may elevate items; material out-of-cycle events may create a 3rd top priority.",
  "Grouped actions: one business case, one owner, one action type — inside Action Detail View only.",
  "Completed and archived actions never reopen; similar issues get new action IDs.",
  "Management-only notes must not appear in ordinary views or ordinary exports.",
  "Do not block build waiting for perfect Keystroke/AIMS mapping.",
  "Keystroke import-ready files must be tab-delimited .txt.",
] as const;

export const IAM_NOT_IN_SCOPE_V1 = [
  "Multi-company shared live workspace",
  "User-adjustable ranking weights",
  "Separate grouped-action screen",
  "Heavy admin/configuration layer",
  "RSE-style settings write-back",
  "Enterprise-polished production UI",
] as const;

export const DIVISION_OF_RESPONSIBILITY = {
  rse: "Replenishment settings and classification signals — outside IAM execution",
  ifm: "Funding priority and capital discipline — outside IAM execution",
  iam: "Action priority, approval workflow, ownership, holdover, completion, archive",
  posErp: "Operational item/PO changes — outside IAM in V1",
} as const;

export type HardRuleId = (typeof IAM_HARD_RULES)[number];
