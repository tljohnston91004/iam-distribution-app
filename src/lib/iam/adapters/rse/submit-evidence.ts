/**
 * RSE evidence adapter (V1.5) — produces Evidence Packages only.
 * Does not score, place on Board, or mutate lifecycle (ADR-IAM-001).
 */
import { submitEvidenceThroughUnifiedIngestion } from "@/lib/iam/ingestion";
import type { EvidencePackageInput } from "@/lib/iam/inbound";

export async function submitRseEvidencePackage(
  pkg: Omit<EvidencePackageInput, "sourceSystem"> & { sourceSystem?: string }
) {
  return submitEvidenceThroughUnifiedIngestion({
    ...pkg,
    sourceSystem: pkg.sourceSystem ?? "RSE",
  });
}
