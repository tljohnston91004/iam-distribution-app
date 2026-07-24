# Future Consideration — Decision Priority Unified Ingestion Platform

| Field | Value |
|-------|--------|
| **Document type** | Future architecture consideration only |
| **Date** | 2026-07-23 |
| **Status** | **Not authorized for implementation** |
| **Authority** | Project Owner — recorded after IAM V1.5 unified ingestion acceptance |

---

## Decision recorded

The **IAM Version 1.5 unified ingestion** implementation is approved as an **IAM-specific** product-completeness correction.

It is **acceptable** that the current work is **not** a reusable Decision Priority platform component.

**No shared cross-module ingestion platform implementation is authorized at this time.** Expanding into a shared platform would be a **separate platform architecture project** and must **not** delay IAM Internal Validation.

---

## Future consideration (when authorized later)

When Decision Priority later designs a shared ingestion orchestrator, the **IAM implementation may be used as a reference**, consisting conceptually of:

1. A shared ingestion and reconciliation framework  
2. Common source-lineage and audit contracts  
3. Common Data Confidence standards  
4. Shared source-adapter patterns  
5. Module-specific mapping, validation, approval, and transformation plug-ins  

Target consumers (illustrative): IFM, IPM, PDM, VPM, CPM, IAM, and future Decision Modules — with **only** module-specific mapping and validation rules differing.

---

## Explicit non-authorization

| Item | Status |
|------|--------|
| Shared platform code / packages | **Not authorized** |
| Cross-module orchestrator build | **Not authorized** |
| Refactor of IAM ingestion into platform now | **Not authorized** |
| Delay of IAM Internal Validation for platform work | **Not permitted** |

IAM Internal Validation proceeds under the approved **IAM-only** unified ingestion scope.
