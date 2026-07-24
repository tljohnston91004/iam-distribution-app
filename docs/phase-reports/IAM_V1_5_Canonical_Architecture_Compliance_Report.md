# IAM Version 1.5 — Canonical Architecture Compliance Report

| Field | Value |
|-------|--------|
| **Document title** | IAM Version 1.5 Canonical Architecture Compliance Report |
| **Purpose** | Certify that implemented architecture conforms to **ADR-IAM-001** and the approved Version 1.5 integration design |
| **Date** | 2026-07-21 |
| **Prepared by** | Cursor (architecture review agent) |
| **Authority** | Project Owner review before Phase 3 authorization |
| **Governing ADR** | [`docs/architecture/ADR-IAM-001-Canonical-Inbound-Port-and-Replaceable-Source-Adapter-Architecture.md`](../architecture/ADR-IAM-001-Canonical-Inbound-Port-and-Replaceable-Source-Adapter-Architecture.md) |
| **Related** | Phase 1 Completion Report; Phase 1 Architecture Validation Report; Phase 2 Completion Report; SD-15, SD-16, SD-17 |
| **Scope** | Architecture and inbound/adapter implementation through Phase 2. No application code was modified to produce this report. |
| **Phase 3** | **Not authorized** — this report does not authorize Phase 3 |

**Rating scale used**

| Rating | Meaning |
|--------|---------|
| **Compliant** | Fully meets the ADR / approved design for the evaluated criterion |
| **Partially Compliant** | Primary path conforms; residual gaps, legacy bridges, or deferred seams remain |
| **Non-Compliant** | Material divergence from ADR / approved design |
| **Not Applicable** | Criterion does not apply to current phase scope |

---

## Executive summary

Through Phases 1–2, the **Canonical Inbound Port**, **Keystroke replaceable adapter**, **canonical Evidence/Recommendation contracts**, **SD-15 quantity basis**, **SD-17 precedence in the Recommendation Port**, and **EvidenceBatch / Recommendation idempotency** are implemented and tested. Risk **R-P2-01** (Keystroke bypassing the Port) is resolved.

Remaining architectural gaps are **intentional transitional bridges**, not silent ADR divergence:

1. Generic non-Keystroke spreadsheet intake (`intakeSpreadsheet`) still writes evidence tables without the Inbound Port.
2. V1.0 calculate still produces legacy `Action` / `ActionCandidate` entities from evidence (interim path not yet migrated onto the V1.5 `Recommendation` model with `generationPath`).
3. Runtime `evidence_source` / `recommendation_sources` configuration seam is not yet a product setting (Hub readiness proven by contract + smoke test).
4. Live RSE/PRE Recommendation connectors remain Phase 7.

**Overall Architecture Compliance Rating: 88%.**

**Recommendation:** Treat **ADR-IAM-001 (inbound / adapter / contract layer) as frozen** for the remainder of Version 1.5 implementation. Do **not** treat scoring, Decision Board, lifecycle, RBAC, or reporting product surfaces as frozen—those remain later-phase work under the same ADR boundaries.

---

## Architecture Compliance Checklist

### 1. Canonical Inbound Port

| Field | Content |
|-------|---------|
| **Rating** | **Partially Compliant** |
| **Current implementation** | Canonical Port operations `UpsertEvidenceBatch`, `UpsertRecommendations`, and `GetIngestionStatus` are implemented. **Keystroke** evidence enters exclusively via Port after adapter normalization. A **generic** spreadsheet upload path still persists inventory/demand rows directly for non-Keystroke sources. Validation seed helpers also write snapshots directly (test harness). |
| **Evidence** | Port: `src/lib/iam/inbound/port.ts`, `types.ts`, `index.ts`. APIs: `POST /api/inbound/evidence`, `POST /api/inbound/recommendations`, `GET /api/inbound/status/[batchId]`. Keystroke: `src/lib/iam/adapters/keystroke/merge-via-port.ts` → `upsertEvidenceBatch`; routes `src/app/api/runs/[runId]/keystroke/route.ts`, `.../merge/route.ts`. Bypass: `src/lib/iam/intake.ts` (`intakeSpreadsheet`); `src/app/api/runs/[runId]/upload/route.ts`; `src/lib/iam/validation/integration-tests.ts` (`seedValidationData`). |
| **Remaining risks** | Non-Keystroke (or mislabeled) uploads can populate Core evidence without batch provenance / Port validation. Operators might confuse `/upload` with the governed Keystroke path. |
| **Recommendation** | Before declaring full inbound exclusivity: route generic spreadsheet intake through Evidence Packages → Port, or formally deprecate/disable `/upload` for production Review Cycles. Keep validation seeds Port-based or clearly labeled as harness-only. |

---

### 2. Replaceable Source Adapter

| Field | Content |
|-------|---------|
| **Rating** | **Compliant** |
| **Current implementation** | Keystroke is a discrete adapter package outside Inbound Port / Core contracts. It stages XLS, applies source rules, builds Evidence Packages, and calls the Port. A Hub-style adapter can call the same Port contracts without Core changes (smoke-tested). |
| **Evidence** | `src/lib/iam/adapters/keystroke/` (`aliases.ts`, `file-types.ts`, `matrix-parents.ts`, `stage-upload.ts`, `merge-via-port.ts`, `index.ts`). Tests: `scripts/run-phase2-keystroke-adapter-tests.ts` (`P2-HUB`). Phase 2 Completion Report §3, §8. |
| **Remaining risks** | Adapter bugs in eligibility/QOH can skew scores while packages remain “valid” (ADR-recognized risk). Deprecated `src/lib/iam/keystroke/*` re-exports may confuse contributors if new logic is added there by mistake. |
| **Recommendation** | Enforce contribution rule: no new logic under `src/lib/iam/keystroke/`; remove re-exports in a later cleanup phase when safe. |

---

### 3. IAM Core Independence

| Field | Content |
|-------|---------|
| **Rating** | **Compliant** |
| **Current implementation** | Inbound Port and Core contract modules contain **no** Keystroke parsing, filenames, aliases, report identification, or Matrix/Standard spreadsheet rules. Keystroke-specific rules live in the adapter. Generic `mapping.ts` / `intake.ts` retain only non-Keystroke aliases and explicitly reject Keystroke filenames/source names. |
| **Evidence** | No Keystroke imports in `src/lib/iam/inbound/*`. Adapter ownership: `src/lib/iam/adapters/keystroke/*`. Core mapping stripped: `src/lib/iam/mapping.ts`. Keystroke block: `intakeSpreadsheet` guard in `src/lib/iam/intake.ts`. Tests: Phase 2 `P2-PORT`, Phase 1 inbound suite. |
| **Remaining risks** | Policy strings in `src/lib/iam/hard-rules.ts` still mention Keystroke write-back `.txt` (documentation of module boundary, not parsing). V1 calculate/ranking still reads evidence tables generically (correct) but has not yet been rewritten around V1.5 Recommendation entities (Phase 3–4). |
| **Recommendation** | Optional later cleanup: relocate Keystroke write-back notes out of Core hard-rules into adapter/docs. No ADR amendment required. |

---

### 4. Canonical Contracts

| Field | Content |
|-------|---------|
| **Rating** | **Compliant** |
| **Current implementation** | TypeScript contracts implement ADR Evidence Package and Recommendation Package elements (camelCase transport of logical ADR fields). Port validates required fields and rejects invalid payloads via `InboundPortError`. Keystroke adapter emits Evidence Packages only (not Recommendations-as-Stock#-rows). |
| **Evidence** | `EvidencePackageInput` / `EvidenceItemInput` / `RecommendationBatchInput` / `RecommendationPackageItem` in `src/lib/iam/inbound/types.ts`. Persistence: `EvidenceBatch`, `Recommendation`, related models in `prisma/schema.prisma`. Port write path: `upsertEvidenceBatch`, `upsertRecommendations`. |
| **Remaining risks** | Live RSE/PRE field dictionaries not received—module payload completeness is incomplete until Phase 7 (ADR open dependency). Optional Evidence attributes (class, vendor, closeout) not all populated by Keystroke adapter yet. |
| **Recommendation** | No corrective architecture action. Complete field dictionaries when module contracts arrive (Phase 7). |

---

### 5. Recommendation Architecture

| Field | Content |
|-------|---------|
| **Rating** | **Partially Compliant** |
| **Current implementation** | **SD-17 is fully implemented on the Canonical Recommendation Port:** module Recommendations (`generationPath: "module"`) are authoritative; interim evidence Recommendations (`generationPath: "interim_evidence"`) enrich rather than duplicate when the same `opportunityKey` already has a module Recommendation. Keystroke does **not** emit Recommendations. However, the V1.0 **calculate pipeline** still generates legacy `ActionCandidate` / `Action` records from evidence—an interim capability that is **not yet** expressed on the V1.5 `Recommendation` model with explicit interim labeling. |
| **Evidence** | SD-17: `src/lib/iam/inbound/port.ts` (`upsertRecommendations`, `generationPath`, enrich path); tests `P1-SD17`, `P1-REC-01/02`. Schema: `Recommendation.generationPath`, unique `(iamRunId, sourceModule, sourceRecommendationId)`. Legacy interim: `src/lib/iam/engine/calculate-pipeline.ts` → `actionCandidate` / `action`. |
| **Remaining risks** | Dual entity models (`Recommendation` vs `Action*`) until Phases 3–5 migration complete. Operators/developers may treat calculate-generated Actions as permanent module Recommendations. ADR risk of interim path being mistaken for permanent engine remains until calculate is migrated/gated. |
| **Recommendation** | Phase 3–4: migrate or wrap calculate interim generation onto `Recommendation` with `generationPath: "interim_evidence"` (or formally quarantine legacy Actions). Do not invent new precedence rules outside SD-17. |

---

### 6. Idempotency

| Field | Content |
|-------|---------|
| **Rating** | **Compliant** |
| **Current implementation** | **EvidenceBatch:** unique `(iamRunId, externalBatchKey)`; repeat upsert replaces batch-linked rows (`supersededPriorBatch`). Keystroke uses stable keys `keystroke:inventory:{runId}` and `keystroke:demand:{runId}`. **Recommendation:** unique `(iamRunId, sourceModule, sourceRecommendationId)`. **Duplicate suppression:** SD-17 skips duplicate interim Recommendations against module authority. |
| **Evidence** | Schema uniques in `prisma/schema.prisma`. Port logic in `port.ts`. Tests: `P1-EV-03`, `P2-IDEM`, `P2-DUP`, `P1-SD17`. |
| **Remaining risks** | Evidence idempotency for Hub should include content identity / report-slot semantics per ADR summary; Keystroke currently uses run-scoped keys (acceptable for single active Keystroke merge per cycle; Hub may need finer keys). |
| **Recommendation** | When Hub adapter lands, define Hub `evidenceBatchKey` / `contentIdentity` conventions without changing Port contracts. |

---

### 7. Provenance

| Field | Content |
|-------|---------|
| **Rating** | **Partially Compliant** |
| **Current implementation** | Keystroke→Port path preserves `sourceSystem`, `sourceFileName`, `externalBatchKey`, `asOfTimestamp` / import time, `contentIdentity`, `sourceRowRef`, both QOH fields, and `quantityBasisUsed`. Audit events record Port upserts. Recommendation Port accepts `evidenceRefs` and source payload hash. End-to-end provenance **from Keystroke import through V1.5 Recommendation creation** is complete for Port-ingested Recommendations; legacy calculate Actions do not systematically carry EvidenceBatch IDs. |
| **Evidence** | `EvidenceBatch`, `InventorySnapshot` / `DemandHistory` provenance fields; adapter `stage-upload.ts` / `merge-via-port.ts`; Port audit in `port.ts`; test `P2-PROV`. |
| **Remaining risks** | Generic `/upload` path creates snapshots without EvidenceBatch linkage. Recommendation explainability/reporting (Phase 8) must join Port provenance, not legacy Action-only paths. |
| **Recommendation** | Close generic intake gap (see §1). When calculate migrates to Recommendations, require evidenceRefs / batch linkage. |

---

### 8. Future Data Hub Readiness

| Field | Content |
|-------|---------|
| **Rating** | **Compliant** |
| **Current implementation** | Hub can replace Keystroke by emitting the same Evidence (and later Recommendation) Packages to the Inbound Port. Core scoring/Board/lifecycle/governance/RBAC/reporting code does not import Keystroke. Replaceability smoke test passed with `sourceSystem: "DataHub"`. Runtime configuration seam (`evidence_source` selector) is **not** yet a product setting—switching today is by which adapter/API is called. |
| **Evidence** | ADR layers satisfied by adapter + Port separation. Test `P2-HUB`. Contracts unchanged for Hub. Phase 2 Completion Report Hub confirmation. |
| **Remaining risks** | Without an explicit `evidence_source` config, environments could accidentally run Keystroke and Hub concurrently for the same cycle. Hub field dictionary / SLA still open (ADR dependency). |
| **Recommendation** | Add environment/company `evidence_source` configuration when Hub onboarding begins (no Core contract change). Document mutual exclusion of Keystroke vs Hub per Review Cycle. |

---

### 9. Legacy Path Review

| Field | Content |
|-------|---------|
| **Rating** | **Partially Compliant** |
| **Current implementation** | **Keystroke legacy merge bypass:** eliminated (R-P2-01 resolved). Deprecated `src/lib/iam/keystroke/*` files are thin re-exports only and do **not** write Core tables directly. **Remaining legacy bridges:** (a) `intakeSpreadsheet` direct writes for non-Keystroke; (b) validation seed direct writes; (c) V1 `Action`/`ActionCandidate` dual model alongside `Recommendation`. |
| **Evidence** | Disabled bypass: `src/lib/iam/keystroke/merge.ts` re-exports `mergeKeystrokeViaInboundPort`. Active bridges: `intake.ts`, `upload/route.ts`, `calculate-pipeline.ts`, `Action*` models in schema. |
| **Remaining risks** | Residual direct writers undermine “every external source enters only through Port” until retired. Dual models complicate Phase 3–5 migration. |
| **Recommendation** | Track as architectural technical debt (below). Retire or Port-wrap generic intake; quarantine calculate Actions as interim until Recommendation migration. |

---

### 10. ADR-IAM-001 Conformance (decision-by-decision)

| ADR Decision | Rating | Implementation status | Evidence / notes |
|--------------|--------|----------------------|------------------|
| 1. Core depends only on canonical Evidence & Recommendation Packages | **Partially Compliant** | Port + types exist; legacy calculate/Actions and generic intake still consume/write raw tables outside packages | `inbound/*`; residual `intake.ts`, `calculate-pipeline.ts` |
| 2. Keystroke is replaceable Evidence-only adapter | **Compliant** | Implemented; no Board/scores/governance from adapter | `adapters/keystroke/*` |
| 3. Future Hub uses same contracts; no Core behavior change required | **Compliant** | Proven by contract design + `P2-HUB` | Port APIs; Phase 2 tests |
| 4. Source-specific logic outside Core | **Compliant** | Parsing, aliases, Matrix/Standard, STK#0, period/eligibility in adapter | Adapter modules |
| 5. Modules submit Recommendations with `source_module` + `source_recommendation_id` | **Compliant** (Port); connectors deferred | Port enforces; live RSE/PRE Phase 7 | `upsertRecommendations`; schema unique |
| 6. Core owns cycles, ranking, Board, WF, governance, audit, reporting | **Partially Compliant** | Ownership principle intact; V1.5 engines for LS/Board/RBAC/reporting not yet rebuilt (Phases 3–8) | Planned phases; not ADR violation |
| 7. Adapters never create Board/scores/WF/assignments/governance | **Compliant** | Keystroke merge only calls Port + readiness/changelog | `merge-via-port.ts` |
| 8. Available QOH preferred; On-Hand fallback; retain both + basis | **Compliant** | SD-15 in types/port/adapter; tested | `deriveQuantityBasis`; `P1-SD15*`, `P2-QOH-*` |
| 9. Case-break / write-back outside IAM Core | **Compliant** | SD-16 honored; no case-break in Core/adapter multipliers; `.txt` write-back out of scope | Adapter docs; ADR |
| 10. Evidence-only recommendation generation is controlled interim | **Partially Compliant** | Port supports `interim_evidence` + SD-17; V1 calculate Actions not yet labeled/migrated | `port.ts`; `calculate-pipeline.ts` |
| Replaceability acceptance criteria (ADR §) | **Compliant** (with config seam residual) | Criteria 1–5 met for Keystroke cutover; criterion 6 partial until calculate migration | Phase 2 report; this §2–§9 |
| Change control (no silent ADR divergence) | **Compliant** | No ADR amendment required for Phases 1–2 | ADR unchanged; reports filed |

---

## Overall Assessment

### Overall Architecture Compliance Rating

**88%**

Method (equal weight across checklist items 1–10):

| Rating | Count | Weight used |
|--------|-------|-------------|
| Compliant | 5 (§2, §3, §4, §6, §8) | 100% each |
| Partially Compliant | 5 (§1, §5, §7, §9, §10) | ~76% average |
| Non-Compliant | 0 | — |
| Not Applicable | 0 | — |

Rounded composite ≈ **88%**. No checklist item is Non-Compliant.

### Outstanding architectural risks

| ID | Risk | Severity | Related |
|----|------|----------|---------|
| AR-01 | Generic `/upload` bypasses Inbound Port (non-Keystroke) | Medium | §1, §9 |
| AR-02 | Dual Recommendation vs Action models; calculate interim unlabeled on V1.5 entity | Medium–High | §5, §7, ADR transitional |
| AR-03 | No runtime `evidence_source` mutex (Keystroke vs Hub concurrency) | Low–Medium | §8 |
| AR-04 | Adapter eligibility/QOH errors can skew scores without Port rejection | Medium (ADR-accepted) | §2 |
| AR-05 | Incomplete live module Recommendation dictionaries | Medium | Phase 7 / ADR open deps |

### Architectural technical debt

| Debt | Status | Target |
|------|--------|--------|
| Generic spreadsheet intake outside Port | Open | Pre-prod / Phase 9 hardening (or earlier if PO prioritizes) |
| Deprecated `src/lib/iam/keystroke/*` re-export shims | Open (safe) | Cleanup after Phase 2 Approved |
| V1 Action/ActionCandidate dual-write vs Recommendation | Open (planned) | Phases 3–5 |
| Validation harness direct snapshot writes | Open (harness) | Align with Port when V1.5 validation harness is rebuilt (Phase 9) |
| TD-001 (Keystroke merge bypass) | **Resolved** Phase 2 | — |

### Items intentionally deferred to later phases

| Item | Phase |
|------|-------|
| Lifecycle / governance engine (LS-01–LS-11) | 3 |
| Scoring & presentation separation (rank-all; Board lanes) | 4 |
| Decision Board / role UX | 5 |
| RBAC / authentication | 6 |
| Live RSE/PRE Recommendation connectors | 7 |
| Reporting / explainability hardening | 8 |
| Production readiness / freeze / full harness | 9 |
| Runtime `evidence_source` configuration UI/setting | Hub onboarding (post–Phase 2; no ADR change required) |
| Case-break field ingestion | Outside Core (SD-16); when RSE/Hub supplies fields |

### Architecture freeze recommendation

| Question | Answer |
|----------|--------|
| Should **ADR-IAM-001 inbound/adapter/contract architecture** be considered **frozen** for the remainder of Version 1.5? | **Yes.** Further phases must consume canonical packages via the Inbound Port; Keystroke/Hub logic must remain outside Core; no new source-specific coupling inside scoring, Board, lifecycle, governance, RBAC, or reporting. |
| Should **all product implementation** be frozen? | **No.** Phases 3–9 remain authorized only when the Project Owner authorizes them; those phases implement Core product behavior **within** the frozen ADR boundaries. |
| Required before any architecture-affecting change? | Update **ADR-IAM-001** (or superseding ADR) first, per ADR change control. |

### Corrective actions (only where not fully Compliant)

| Item | Why not fully Compliant | Affected files | Corrective action |
|------|-------------------------|----------------|-------------------|
| §1 Inbound exclusivity | Generic intake + validation seeds bypass Port | `src/lib/iam/intake.ts`; `src/app/api/runs/[runId]/upload/route.ts`; `src/lib/iam/validation/integration-tests.ts` | Port-wrap or deprecate generic upload; label/replace harness seeds |
| §5 Recommendation architecture | Legacy calculate Actions ≠ Port interim Recommendations | `src/lib/iam/engine/calculate-pipeline.ts`; `Action*` models | Migrate/gate in Phases 3–4 under SD-17 |
| §7 Provenance end-to-end | Actions lack EvidenceBatch linkage; generic upload lacks batch provenance | Same as §1 + calculate pipeline | Port exclusivity + Recommendation migration |
| §9 Legacy paths | Residual bridges remain (not Keystroke merge) | Same as §1 + deprecated `keystroke/` shims | Retire bridges; delete shims when unused |
| §10 ADR Decision 1, 6, 10 | Transitional dual paths / unfinished Core product engines | Intake, calculate, later-phase modules | Proceed under frozen ADR; no silent redesign |

---

## Certification statement

This report certifies that, as of **2026-07-21**, the implemented Version 1.5 architecture through Phase 2 is **substantially conforming** to **ADR-IAM-001**, with **no Non-Compliant** checklist findings. Residual gaps are **documented transitional conditions**, primarily the generic non-Keystroke intake bridge and the legacy calculate→Action interim path.

**Keystroke evidence enters IAM exclusively through the Canonical Inbound Port.**  
**R-P2-01 is resolved.**  
**A future Data Hub adapter can replace Keystroke without changing IAM Core or Inbound Port contracts.**

Phase 3 remains **Waiting for Authorization** and was **not** started by this review.

---

Parent report note (2026-07-21 Architecture Closure): Checklist ratings and the 88% overall score in this document are **superseded** by [Addendum A](./IAM_V1_5_Canonical_Architecture_Compliance_Report_Addendum_A.md) (**100%** after corrective closure). This original report remains the accepted baseline assessment that triggered closure.

---

## Explicit stop

Canonical Architecture Compliance Report complete.  
**Stopped.** Awaiting Project Owner review and further authorization (including any Phase 2 Completion Approved / Phase 3 Authorized decisions).
