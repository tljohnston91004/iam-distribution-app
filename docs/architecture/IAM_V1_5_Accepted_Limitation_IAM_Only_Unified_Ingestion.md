# IAM V1.5 — Accepted Architecture Limitation: IAM-Only Unified Ingestion

| Field | Value |
|-------|--------|
| **Date** | 2026-07-23 |
| **Status** | **Accepted** by Project Owner |
| **Scope** | IAM Version 1.5 Internal Validation |

---

## Limitation (accepted)

Unified multi-source evidence ingestion (standalone upload / Keystroke / RSE / Data Hub / combinations) is implemented **inside IAM only** (`src/lib/iam/ingestion/` and IAM adapters).

It is **not** a reusable Decision Priority platform Orchestrator shared by IFM, IPM, PDM, VPM, CPM, or other Decision Modules.

## Why accepted

- Satisfies IAM V1.5 product-completeness for Internal Validation  
- Avoids delaying IV for a separate platform architecture project  
- Future shared platform is documented as a **consideration only** — see [`Future_Decision_Priority_Unified_Ingestion_Platform.md`](./Future_Decision_Priority_Unified_Ingestion_Platform.md)

## What remains in scope for IV

IAM configurations: standalone; IAM+RSE; IAM+Data Hub; approved combinations — one IAM ingestion path, mapping, validation, reconciliation, approval, then IAM analytical model.
