# IAM V1.5 — Unified Source Priority Rules

**Rule ID:** `iam_v15_source_priority_v1`  
**Status:** Product-completeness (Version 1.5 correction)  
**Scope:** Evidence selection for Calculate / analytical model only. Does **not** change scoring formulas, Recommendation logic, governance, lifecycle, OEC, or Executive Experience.

## Configurations

| Configuration | Standalone upload | RSE evidence | Data Hub |
|---|---|---|---|
| IAM standalone | On (default) | Off | Off |
| IAM + RSE | On | On | Off |
| IAM + Data Hub | On | Off | On |
| Any approved combination | Per company flags | Per company flags | Per company flags |

IAM remains fully functional with only standalone upload enabled.

## One ingestion path

All approved sources submit **Evidence Packages** through the Canonical Inbound Port, then:

1. Channel enablement check (company flags)
2. Port upsert (lineage: EvidenceBatch + row refs + Data Confidence)
3. Cross-source **reconcile** (duplicates / conflicts)
4. **Approve evidence** gate
5. Calculate / Recommendation generation (selected winners only)

Adapters: Keystroke, customer/generic upload, RSE, Data Hub — **not** three separate ingestion systems.

## Priority (highest wins)

When more than one source provides the same SKU/domain:

1. **DataHub** (400)
2. **RSE** (300)
3. **Keystroke** (200)
4. **CustomerUpload** (100)
5. **Other** (50)

Within the same channel, the newest accepted EvidenceBatch for that report type wins (Port idempotent key).

Losers remain stored for audit; only `selectedForAnalysis = true` rows feed Calculate. Conflicts are recorded in `EvidenceConflict` with this rule id.

## Lineage & Data Confidence

- Every inventory/demand/supply row retains `evidenceBatchId`, `sourceRowRef`, and `dataConfidence`.
- EvidenceBatch stores `sourceSystem`, `sourceChannel`, `sourceFileName`, `contentIdentity`.
