/**
 * @deprecated Phase 2 — use `@/lib/iam/adapters/keystroke`.
 * Staging no longer uses Core mapping aliases; adapter owns Keystroke field rules.
 */
export {
  KeystrokeAdapterError,
  getKeystrokeUploadStatus,
  stageKeystrokeUpload,
} from "@/lib/iam/adapters/keystroke/stage-upload";
