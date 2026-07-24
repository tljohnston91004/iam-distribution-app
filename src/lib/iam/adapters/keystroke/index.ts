/**
 * Keystroke Source Adapter (replaceable).
 *
 * Boundary: all Keystroke parsing, filenames, aliases, Matrix/Standard rules,
 * STK#0 exclusion, and QOH basis selection live here — not in IAM Core.
 *
 * Entry to IAM Core: exclusively via Canonical Inbound Port (upsertEvidenceBatch).
 * A future Data Hub adapter can replace this module without changing Core or Port contracts.
 */

export {
  KS_AVAILABLE_QOH_ALIASES,
  KS_COST_ALIASES,
  KS_DESC_ALIASES,
  KS_LAST_RECV_ALIASES,
  KS_LAST_SOLD_ALIASES,
  KS_ON_HAND_ALIASES,
  KS_OPEN_ORDER_ALIASES,
  KS_SALES_DOLLARS_ALIASES,
  KS_SKU_ALIASES,
  KS_UNITS_SOLD_ALIASES,
  KS_VALUE_ALIASES,
  isExcludedSummarySku,
} from "./aliases";
export {
  buildChecklist,
  resolveKeystrokeFileType,
  type DemandVariant,
  type IamKeystrokeFileType,
} from "./file-types";
export {
  buildExcludedParentSkus,
  inferParentTemplateSkus,
  sharedParentSchemeSkus,
} from "./matrix-parents";
export {
  KeystrokeAdapterError,
  getKeystrokeUploadStatus,
  loadEffectiveUploadBatches,
  stageKeystrokeUpload,
} from "./stage-upload";
export {
  mergeKeystrokeViaInboundPort,
  type MergeViaPortResult,
} from "./merge-via-port";
