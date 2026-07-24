/**
 * Decision Priority Data Hub evidence adapter (V1.5) — Evidence Packages only.
 * Does not score, place on Board, or mutate lifecycle (ADR-IAM-001).
 */
import { submitEvidenceThroughUnifiedIngestion } from "@/lib/iam/ingestion";
import type { EvidencePackageInput } from "@/lib/iam/inbound";

export async function submitDataHubEvidencePackage(
  pkg: Omit<EvidencePackageInput, "sourceSystem"> & { sourceSystem?: string }
) {
  return submitEvidenceThroughUnifiedIngestion({
    ...pkg,
    sourceSystem: pkg.sourceSystem ?? "DataHub",
  });
}
