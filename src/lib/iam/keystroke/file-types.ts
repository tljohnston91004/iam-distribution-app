/**
 * @deprecated Phase 2 — Keystroke logic lives in `@/lib/iam/adapters/keystroke`.
 * This path re-exports the adapter for transitional imports only.
 */
export {
  buildChecklist,
  detectDemandVariant,
  resolveKeystrokeFileType,
  type DemandVariant,
  type IamKeystrokeFileType,
  type ChecklistSlot,
} from "@/lib/iam/adapters/keystroke/file-types";
