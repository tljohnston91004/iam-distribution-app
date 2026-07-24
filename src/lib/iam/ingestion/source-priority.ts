/**
 * Unified multi-source evidence ingestion (V1.5 product-completeness).
 * ADR-IAM-001: adapters submit Evidence Packages only; Core reconciles + gates analysis.
 */

export type EvidenceSourceChannel =
  | "CustomerUpload"
  | "Keystroke"
  | "RSE"
  | "DataHub"
  | "Other";

/** Higher number = higher priority when sources conflict on the same SKU/domain. */
export const SOURCE_CHANNEL_PRIORITY: Record<EvidenceSourceChannel, number> = {
  DataHub: 400,
  RSE: 300,
  Keystroke: 200,
  CustomerUpload: 100,
  Other: 50,
};

/**
 * Documented source-priority rules (V1.5):
 * 1. Data Hub mapped/validated evidence wins over RSE and uploads when Hub is active.
 * 2. RSE evidence wins over Keystroke / customer upload when RSE evidence is active.
 * 3. Keystroke (adapter) and CustomerUpload share the standalone upload family;
 *    Keystroke outranks generic spreadsheet CustomerUpload.
 * 4. Within the same channel, the newest accepted EvidenceBatch for that report type wins
 *    (Port idempotent key / last upsert).
 * 5. Conflicts are retained for audit; losers are not selected for analysis.
 */
export const SOURCE_PRIORITY_RULE_ID = "iam_v15_source_priority_v1";

export function normalizeSourceChannel(sourceSystem: string): EvidenceSourceChannel {
  const s = sourceSystem.trim().toLowerCase();
  if (s.includes("datahub") || s.includes("data_hub") || s.includes("data-hub") || s === "hub") {
    return "DataHub";
  }
  if (s === "rse" || s.startsWith("rse")) return "RSE";
  if (s.includes("keystroke")) return "Keystroke";
  if (
    s.includes("customer") ||
    s.includes("upload") ||
    s === "spreadsheet" ||
    s === "generic" ||
    s === "validationharness"
  ) {
    return "CustomerUpload";
  }
  return "Other";
}

export function channelPriority(channel: EvidenceSourceChannel): number {
  return SOURCE_CHANNEL_PRIORITY[channel] ?? 0;
}
