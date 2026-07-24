# IAM Version 1.5 — Phase 1 Architecture Validation Report

| Field | Value |
|-------|--------|
| **Document ID** | IAM-V15-P1-ARCH-VALIDATION |
| **Date** | 2026-07-21 |
| **Scope** | Validate Phase 1 against ADR-IAM-001 before Phase 2 authorization |
| **Code changes** | None (report only) |
| **Governing ADR** | [ADR-IAM-001](../architecture/ADR-IAM-001-Canonical-Inbound-Port-and-Replaceable-Source-Adapter-Architecture.md) |
| **Phase 1 Completion Report** | [IAM_V1_5_Phase_1_Completion_Report.md](./IAM_V1_5_Phase_1_Completion_Report.md) |

---

## 1. Validation checklist

| # | Criterion | Result | Evidence |
|---|-----------|--------|----------|
| 1 | **IAM Core contains no Keystroke-specific logic** (Inbound Port / canonical domain services introduced in Phase 1) | **Pass** | `src/lib/iam/inbound/**` has **zero** Keystroke imports. Port operates only on Evidence Package and Recommendation Package contracts. |
| 2 | **All external sources enter only through the Canonical Inbound Port** | **Partial — Pass for new path; Gap until Phase 2** | New module/test traffic uses `/api/inbound/*`. **Existing** Keystroke stage/merge (`src/lib/iam/keystroke/*`, run merge API) and simple spreadsheet intake still write evidence tables **directly**. Closing this gap is the primary Phase 2 objective. |
| 3 | **Future Decision Module Recommendations use the same contract as current inbound Recommendations** | **Pass** | Single `RecommendationBatchInput` / `RecommendationPackageItem` shape (`sourceModule`, `sourceRecommendationId`, impacts, evidence refs, etc.). RSE/PRE/Hub adapters emit the same package; no module-specific core branches. |
| 4 | **Keystroke adapter can be removed and replaced by a Data Hub adapter without modifying IAM Core** | **Pass (architecture); contingent on Phase 2 cutover** | Core depends on package contracts + Inbound Port only. Replaceability holds once Keystroke is an adapter that **only** calls the port (Phase 2). Until then, dual write paths remain (see risks). |
| 5 | **EvidenceBatch idempotency conforms to ADR-IAM-001** | **Pass** | Upsert key = `(reviewCycleId, evidenceBatchKey)`. Re-upload with the same key replaces batch row contents in place and rewrites linked inventory/demand/supply; status via `getIngestionStatus`. Proven by `P1-EV-03`. |
| 6 | **SD-15 fully implemented** (Available QOH preferred; On-Hand fallback; both + basis retained) | **Pass** | `deriveQuantityBasis` + persisted `availableQoh`, `quantityOnHand`, `quantityBasisUsed`. Proven by `P1-SD15` / `P1-SD15b` / `P1-EV-01`. |
| 7 | **SD-17 fully implemented** (module authoritative; no duplicate interim; evidence may enrich; all modules) | **Pass** | Interim path enriches existing `generationPath=module` row by `opportunityKey` and does not create a second Recommendation. Proven by `P1-SD17` / `P1-REC-02`. |

**Automated confirmation:** `npm run test:phase1-inbound` — **8/8 passed** (Phase 1 completion).

---

## 2. Architectural posture entering Phase 2

```text
[Future Hub Adapter] ──┐
[Keystroke Adapter]* ──┼──► Inbound Port ──► Evidence / Recommendation stores ──► Core
[Module connectors] ───┘
* Today: Keystroke still also writes tables directly (pre-Phase 2).
```

Phase 1 delivered the **stable core seam**. Phase 2 must make Keystroke a **replaceable adapter** in practice, not only in design.

---

## 3. Remaining architectural risks entering Phase 2

| Risk ID | Risk | Severity | Mitigation in Phase 2+ |
|---------|------|----------|-------------------------|
| R-P2-01 | Dual evidence paths (Keystroke merge vs Inbound Port) until adapter cutover | **High** | Route checklist/merge through Evidence Package → port; remove direct table writes from adapter boundary |
| R-P2-02 | Legacy `Action` / `ActionCandidate` coexist with `Recommendation` | Medium | Dual-model until Phases 3–5; migration plan already documented |
| R-P2-03 | Opportunity-key default (`sku\|type`) may over/under-match “same business opportunity” | Medium | Refine when RSE/PRE contracts define opportunity identity; keep SD-17 behavior |
| R-P2-04 | Presentation categories stored interim (SD-13 open) | Low | Board presentation service in Phase 4–5; A-004 |
| R-P2-05 | Inbound APIs still unauthenticated (Phase 6 RBAC) | High (security), deferred | Do not treat port as production-exposed without Phase 6 |

**No ADR-IAM-001 conflict identified.** No ADR update required for Phase 2 kickoff.

---

## 4. Verdict

| Question | Answer |
|----------|--------|
| Is Phase 1 architecture valid to proceed to Phase 2 authorization? | **Yes**, with explicit acceptance that **R-P2-01** (Keystroke still bypasses the port) is the Phase 2 job—not a Phase 1 failure. |
| Recommend Phase 2 authorization? | **Yes**, to complete Hub-replaceable Keystroke adapter cutover. |

---

## 5. Stop

Report complete. **No application code modified.**  
**Waiting for Project Owner Phase 2 authorization** (and Phase 1 completion approval if not already recorded).
