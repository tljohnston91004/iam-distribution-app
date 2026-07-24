# IAM Version 1.5 — Canonical Architecture Compliance Report  
## Addendum A: Phase 2 Architecture Closure

| Field | Value |
|-------|--------|
| **Parent report** | [`IAM_V1_5_Canonical_Architecture_Compliance_Report.md`](./IAM_V1_5_Canonical_Architecture_Compliance_Report.md) |
| **Addendum date** | 2026-07-21 |
| **Trigger** | Project Owner Architecture Closure Direction (post-acceptance of parent report) |
| **Scope** | Limited Phase 2 corrective work only — **Phase 3 not authorized** |
| **Application code** | Modified as required for closure (see Phase 2 Completion Report §15) |

---

## 1. Purpose

The parent Compliance Report rated overall architecture at **88%**, with five **Partially Compliant** checklist items driven by:

1. Generic `/upload` bypassing the Canonical Inbound Port  
2. V1 calculate expanding legacy `Action` / `ActionCandidate` instead of interim Recommendations  
3. Related provenance / dual-path / ADR Decision residuals  

This addendum re-rates those items after Architecture Closure.

---

## 2. Corrective actions executed

| Correction | Result |
|------------|--------|
| Generic upload → Evidence Package → `upsertEvidenceBatch` only | **Done** — `src/lib/iam/intake.ts` |
| Calculate → interim Recommendations via Port + SD-17; no new Actions | **Done** — `src/lib/iam/engine/calculate-pipeline.ts` |
| SD-17 enrich preserves module impact fields when already set | **Done** — `src/lib/iam/inbound/port.ts` |
| Runtime `evidence_source` product setting | **Deferred** — **TD-009** (target Phase 7 / 9); not a Phase 2 blocker; `sourceSystem` provenance preserved |

---

## 3. Revised checklist ratings (previously partial items)

| # | Area | Prior rating | **Revised rating** | Rationale |
|---|------|--------------|--------------------|-----------|
| 1 | Canonical Inbound Port | Partially Compliant | **Compliant** | Keystroke + generic upload + validation seed evidence persist only through Port. |
| 5 | Recommendation Architecture | Partially Compliant | **Compliant** | Evidence-generated results are `interim_evidence` Recommendations; SD-17 applied before presentation fields; no new legacy Actions. |
| 7 | Provenance | Partially Compliant | **Compliant** | Generic + Keystroke batches carry source system/file/key/row/QOH basis; interim Recommendations carry `evidenceRefs`. |
| 9 | Legacy Path Review | Partially Compliant | **Compliant** | Architectural bypasses for evidence entry and evidence-generated recommendations removed. Deprecated Keystroke re-exports remain shims only (no direct writes). Historical Holdover `Action` rows retained for compatibility; not expanded by new calculate. |
| 10 | ADR-IAM-001 Conformance | Partially Compliant | **Compliant** | Decision §1, §7, §10 residuals closed for Phase 2 scope. Core product engines (LS/Board/RBAC/reporting) remain later phases **within** ADR boundaries — not non-conformance. |

### Items that remain Compliant (unchanged)

§2 Replaceable Adapter · §3 Core Independence · §4 Canonical Contracts · §6 Idempotency · §8 Hub Readiness — **Compliant**.

---

## 4. Revised overall assessment

| Metric | Prior | **After Architecture Closure** |
|--------|-------|--------------------------------|
| Overall Architecture Compliance Rating | 88% | **100%** (checklist items 1–10 all Compliant for Phase 2 architectural scope) |
| Non-Compliant items | 0 | **0** |
| Architectural bypasses around Inbound Port / Recommendation architecture | Two (generic upload; calculate→Action) | **None remaining** |

### Outstanding architectural risks (residual, non-bypass)

| ID | Risk | Severity | Notes |
|----|------|----------|-------|
| AR-03 | No runtime `evidence_source` mutex UI/setting | Low | **TD-009**; provenance still records source |
| AR-04 | Adapter eligibility/QOH errors can skew scores | Medium | ADR-accepted |
| AR-05 | Live module Recommendation dictionaries incomplete | Medium | Phase 7 |

### Architectural technical debt disposition

| Debt | Disposition | Target |
|------|-------------|--------|
| Generic upload outside Port | **Resolved** (closure) | — |
| Calculate → Action dual path | **Resolved** for new processing (closure); historical Actions retained | Phase 3–5 UI/Board consume Recommendations |
| Runtime `evidence_source` config | **TD-009 Open** | Phase 7 (Hub) / Phase 9 |
| Deprecated `src/lib/iam/keystroke/*` re-exports | Open (safe shims) | Cleanup after Phase 2 Approved |

---

## 5. Validation evidence

| Suite | Result |
|-------|--------|
| `npm run test:phase2-closure` | **9/9 PASS** (Port-only upload, idempotency, interim Recs, no new Actions, SD-17, module authority, provenance) |
| `npm run test:phase1-inbound` | **8/8 PASS** |
| `npm run test:phase2-keystroke` | **16/16 PASS** |

---

## 6. Closure statements (required)

| Question | Answer |
|----------|--------|
| Have all architectural bypasses around the Canonical Inbound Port and Recommendation architecture been removed? | **Yes**, for evidence entry (Keystroke + generic upload + harness seed) and for evidence-generated recommendation creation. |
| Can ADR-IAM-001 be frozen for the remainder of Version 1.5? | **Yes** — freeze the inbound/adapter/contract architecture. Later phases implement Core product behavior inside these boundaries; any architecture change still requires ADR update first. |
| Is Phase 2 now ready for completion approval? | **Yes.** |
| Is Phase 3 recommended for authorization? | **Yes**, after Project Owner sets Phase 2 **Completion Approved**. |
| Was Phase 3 begun? | **No.** |

---

## 7. Explicit stop

Phase 2 Architecture Closure complete.  
Compliance addendum filed.  
**Stopped.** Awaiting Project Owner review (Phase 2 Completion Approved / Phase 3 Authorization).
