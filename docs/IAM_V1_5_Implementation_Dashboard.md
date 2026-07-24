# IAM Version 1.5 — Implementation Dashboard

| Field | Value |
|-------|--------|
| **Purpose** | Running status of IAM Version 1.5 implementation against the approved plan |
| **Plan** | [`IAM_V1_5_Implementation_Plan.md`](./IAM_V1_5_Implementation_Plan.md) |
| **Phase Authorization Register** | [`IAM_V1_5_Phase_Authorization_Register.md`](./IAM_V1_5_Phase_Authorization_Register.md) — no phase work until Project Owner marks the phase **Authorized** |
| **Integration ADR** | [`architecture/ADR-IAM-001-Canonical-Inbound-Port-and-Replaceable-Source-Adapter-Architecture.md`](./architecture/ADR-IAM-001-Canonical-Inbound-Port-and-Replaceable-Source-Adapter-Architecture.md) |
| **Maintenance rule** | Update at the **end of every work session** and at every **phase checkpoint** |
| **Completion rule** | A phase is **Complete** only when deliverables exist, required tests pass, traceability is updated, ADR conformance is confirmed, required review is done, **and** the phase is **explicitly approved**. Do **not** mark Complete solely because code was written. |
| **Status values (phase table only)** | `Not Started` · `In Progress` · `Blocked` · `Ready for Review` · `Approved` · `Complete` |

---

## Phase status

| Phase | Scope | Status | % Complete | Current Blockers | Specification Decisions | ADR Impact | Tests Passed | Tests Failed | Key Deliverables | Last Updated |
|-------|--------|--------|------------|------------------|-------------------------|------------|--------------|--------------|------------------|--------------|
| 0 | Foundations and control plane (logs, SD register, doc errata start, ADR acknowledgment) | Complete | 100% | — | SD-17 resolved 2026-07-21 | ADR-IAM-001 confirmed; no ADR change | 2 (doc checklists) | 0 | Control logs; ADR index; errata; SD gates; Phase 0 Completion Report | 2026-07-21 |
| 1 | Domain model and Inbound Port (canonical Evidence/Recommendation contracts, provenance, migration plan) | Approved | 100% | — | SD-13 interim (A-004); SD-12/15/17 implemented | Inbound Port live; ADR conforming; no Keystroke in core | 8 | 0 | Schema + port + APIs + migration plan + Phase 1 Completion Report | 2026-07-21 |
| 2 | Keystroke Adapter → Evidence Packages only | Approved | 100% | — | SD-15/16/17 | Keystroke + generic upload via Port; interim Recs; R-P2-01 resolved; Addendum A 100% | 25 | 0 | Adapter → port; upload/calculate closure; Phase 2 Completion Report §15; Compliance Addendum A | 2026-07-21 |
| 3 | Lifecycle, governance, and workflow engine (LS-01–LS-11; Defer/Reject as governance outcomes) | Approved | 100% | — | SD-3/8/9 happy paths stubbed | Core lifecycle; Closure DF-01/02/03; DF-04→TD-012 | 21 | 0 | LS engine; Closure; Completion Report + Decision Flow Addendum A accepted | 2026-07-21 |
| 4 | Scoring and presentation separation (rank all; Top 2 / Emergency / Holdover / Backlog) | Approved | 100% | — | SD-1 interim approved for V1.5; SD-2 Emergency deferred; Deferred Presentation Rule | Scores from Recommendations; ADR freeze held | 14 | 0 | Scoring + presentation; Deferred rule; Completion + Scoring Validation accepted | 2026-07-21 |
| 5 | Decision Board and role UX | Ready for Review | 100% | Awaiting Project Owner completion approval | Soft viewAs UX only; SD-2 Emergency placeholder | Board consumes Core APIs only; ADR freeze held | 8 | 0 | Decision Board; Owner queue; Archive; notes; Completion + Experience Review | 2026-07-21 |
| 5A / EEP | Executive Experience Enhancement (Blueprint v1.0) | Ready for Review | 100% | Awaiting PO EEP acceptance | Paused≠OEC; aging advisory; OEC Active Priorities | Presentation/OEC only; ADR freeze held | 9 (+ prior suites) | 0 | OEC; Active Priorities; Board hierarchy; Trust Pyramid; EEP Completion package | 2026-07-21 |
| 6 | Security, RBAC, authentication | Not Started | 0% | Phases 0–5 design parallel OK; hard gate before prod | SD-7 | AuthZ on port and core APIs; adapters remain non-governing | 0 | 0 | IdP/auth; roles incl. Reviewer/Validator + Auditor; server-side matrix; authz audit | 2026-07-21 |
| 7 | Module Recommendation connectors + APIs (IAM-008/009) | Not Started | 0% | RSE/PRE contracts; Phases 1, 6 | RSE/PRE field dictionaries | Recommendation Package idempotency `(source_module, source_recommendation_id)` | 0 | 0 | Upsert Recommendations; status hooks; versioned REST; health; fixtures until live contracts | 2026-07-21 |
| 8 | Reporting, analytics, explainability hardening | Not Started | 0% | Phases 3–7 | SD-1 (COI in reports) | Reports from IAM-owned governed data only | 0 | 0 | IAM-010 reports/exports; actuals + Outcome Validation UI; learning/override; rule-version stamps | 2026-07-21 |
| 9 | Testing, traceability, production readiness, freeze | Not Started | 0% | All prior phases; SD-11 ops depth | Remaining open SDs waived or closed | Replaceability regression; ADR conformance audit | 0 | 0 | V1.5 harness; full test categories; readiness/hypercare/runbook; freeze vs IAM-014/015 | 2026-07-21 |

---

## Active Blockers

| Blocker ID | Description | Affected phase | Owner | Required decision or action | Date opened | Status |
|------------|-------------|----------------|-------|-----------------------------|-------------|--------|
| B-001 | Phase 0 Completion Approved pending Project Owner | 0 (exit) / 1 (entry) | Project Owner | Approve Phase 0 completion in Authorization Register; then authorize Phase 1 separately if desired | 2026-07-21 | **Resolved** 2026-07-21 |
| B-002 | Phase 1 not yet Authorized | 1 | Project Owner | Mark Phase 1 **Authorized** in Phase Authorization Register when ready | 2026-07-21 | **Resolved** 2026-07-21 |
| B-003 | Phase 1 Completion Approved pending Project Owner | 1 (exit) / 2 (entry) | Project Owner | Approve Phase 1; separately authorize Phase 2 | 2026-07-21 | **Resolved** 2026-07-21 |
| B-004 | Phase 2 Completion Approved pending Project Owner | 2 (exit) / 3 (entry) | Project Owner | Approve Phase 2 (incl. Architecture Closure / Addendum A); separately authorize Phase 3 | 2026-07-21 | **Resolved** 2026-07-21 |
| B-005 | Phase 3 Completion Approved pending Project Owner | 3 (exit) / 4 (entry) | Project Owner | Approve Phase 3; separately authorize Phase 4 | 2026-07-21 | **Resolved** 2026-07-21 |
| B-006 | Phase 4 Completion Approved pending Project Owner | 4 (exit) / 5 (entry) | Project Owner | Approve Phase 4; separately authorize Phase 5 | 2026-07-21 | **Resolved** 2026-07-21 |
| B-007 | Phase 5 Completion Approved pending Project Owner | 5 (exit) / 6 (entry) | Project Owner | Approve Phase 5; separately authorize Phase 6 | 2026-07-21 | Open |
| B-008 | EEP / Phase 5A Acceptance pending Project Owner | 5A (exit) | Project Owner | Accept EEP Completion Report + Checklist rerun before closing EEP; Phase 6 still separate | 2026-07-21 | Open |
| B-009 | Prescribed Action Plan — PO review before IV resumes | IV / product completeness | Project Owner | Accept, revise, or reject PAP; lift IV pause only on Accept | 2026-07-23 | Open |
| B-010 | Revised scoring C-1: Top 2≥70 vs OEC Active Priorities | Scoring / presentation | Project Owner | Reconcile Instruction §18 with EEP OEC before changing Board promotion | 2026-07-24 | Open |
| B-011 | Company denominators + net scoreable cash required for authoritative revised scores | Scoring | Project Owner / Ops | Enter trailing revenue, GP, total inventory BV; capture net 13-week cash (not book value) | 2026-07-24 | Open |

*When a blocker opens, set Status to `Open`. Do not leave stale rows; resolve or supersede with a new ID.*

---

## Specification Decision Register

| Decision ID | Question | Current resolution | Status | Affected phases | Governing document | Date resolved |
|-------------|----------|-------------------|--------|-----------------|--------------------|---------------|
| SD-1 | Scoring formulas, weights, thresholds, COI calculation? | Unresolved — **interim profile `interim_v1_cash_led` shipped under A-005** (Phase 4) | Open | 4, 8, 9 | IAM-006/006A; Gap Analysis | — |
| SD-2 | Emergency Priority criteria; may it displace Top 2? | Unresolved | Open | 4, 5 | IAM-001/004; clarifications | — |
| SD-3 | Defer return-to-review eligibility/timing? | **Partial** — V1.5 Board presentation/reactivation defined (Q-014); auto-expiry timing still Open | Open | 3, 5 | IAM-005/005A; clarification | — |
| SD-4 | Keystroke file intake in V1.5 baseline? | **Yes** — replaceable Evidence adapter | Resolved | 2, 7 | Integration Assessment; ADR-IAM-001 | 2026-07-21 |
| SD-7 | Final RBAC matrix cells (Executive assign, Owner escalate, Defer, Reviewer/Auditor)? | Unresolved — clarifications require distinct Reviewer vs Auditor | Open | 5, 6 | IAM-011/011A; clarifications | — |
| SD-8 | Outcome Validation failure / rework path? | Unresolved | Open | 3, 8 | IAM-007B | — |
| SD-9 | Owner “request discussion” path? | Unresolved | Open | 3, 5 | IAM-001 | — |
| SD-10 | Grouped actions in V1.5? | Unresolved — not implied by Keystroke matrix rules | Open | 1, 5 | Gap Analysis; Integration Assessment | — |
| SD-11 | Deployment topology (SQLite vs shared DB)? | Unresolved | Open | 9 | IAM-013C; Gap Analysis | — |
| SD-12 | Recommendation/evidence idempotency keys? | **Recommendations:** `(source_module, source_recommendation_id)`; evidence per Assessment/ADR | Resolved | 1, 2, 7 | ADR-IAM-001; Integration Assessment | 2026-07-21 |
| SD-13 | Presentation category persistence model? | Unresolved — interim schema allowed if documented | Open | 1, 4, 5 | Clarifications; Gap Analysis | — |
| SD-14 | Capacity/actionability vs base priority? | Provisional clarification: capacity ≠ base priority; engine must align | Open | 4 | Provisional clarification; Gap Analysis | — |
| SD-15 | On-Hand vs Available QOH? | **Available QOH preferred; On-Hand fallback; retain both + basis** | Resolved | 1, 2, 4 | ADR-IAM-001 | 2026-07-21 |
| SD-16 | Case-break Parent/Child handling? | Outside IAM core; adapter/RSE/Hub when fields exist | Resolved (ownership) | 2 | ADR-IAM-001; Integration Assessment | 2026-07-21 |
| RSE/PRE | Live Recommendation Package field dictionary + transport? | Not received — fixtures only until contracts arrive | Open | 7, 9 | IAM-008; ADR-IAM-001 | — |
| SD-17 | Precedence when module Recommendations and interim evidence-generated candidates coexist? | **Resolved:** Decision Module Recommendation is authoritative for the same underlying business opportunity; evidence-generated candidate must not create a duplicate Recommendation; raw evidence may enrich confidence, explainability, impacts, audit, and analysis; evidence-generated Recommendations are interim only where no authoritative Decision Module Recommendation exists; duplicate detection/consolidation before ranking and Decision Board presentation; applies to **all** Decision Modules (not only RSE). No ADR update required unless implementation conflicts with ADR-IAM-001. | Resolved | 1, 2, 4, 7 | Project Owner decision 2026-07-21; ADR-IAM-001 | 2026-07-21 |

---

## Architecture Conformance

| Applicable ADR | Conformance status | Any proposed deviation | Whether the ADR was updated before implementation | Review result |
|----------------|--------------------|------------------------|-----------------------------------------------------|---------------|
| ADR-IAM-001 — Canonical Inbound Port and Replaceable Source Adapter Architecture | **Frozen + Conforming (Phase 5 + EEP)** — Decision Board / OEC presentation only; no adapter governance; no inbound redesign | None | N/A — no ADR amendment | Pass — EEP Completion Report |

**Rule:** No implementation phase may change the approved architecture without first updating the ADR and documenting the reason. Phase exit requires confirmed ADR conformance.

---

## Testing Summary

| Test category | Planned | Passed | Failed | Blocked | Coverage or traceability reference |
|---------------|---------|--------|--------|---------|--------------------------------------|
| Phase 0 document completeness | 1 | 1 | 0 | — | Phase 0 Completion Report §1–2 |
| Phase 0 governance sync | 1 | 1 | 0 | — | Register / Dashboard / Plan / ADR links |
| Phase 1 inbound port (`test:phase1-inbound`) | 8 | 8 | 0 | — | scripts/run-phase1-inbound-tests.ts |
| Phase 2 Keystroke adapter (`test:phase2-keystroke`) | 16 | 16 | 0 | — | scripts/run-phase2-keystroke-adapter-tests.ts |
| Phase 2 Architecture Closure (`test:phase2-closure`) | 9 | 9 | 0 | — | scripts/run-phase2-architecture-closure-tests.ts |
| Phase 3 lifecycle (`test:phase3-lifecycle`) | 14 | 14 | 0 | — | scripts/run-phase3-lifecycle-tests.ts |
| Phase 3 Closure (`test:phase3-closure`) | 7 | 7 | 0 | — | scripts/run-phase3-closure-tests.ts (DF-01/02/03) |
| Phase 4 scoring (`test:phase4-scoring`) | 14 | 14 | 0 | — | scripts/run-phase4-scoring-tests.ts (incl. Deferred Presentation Rule) |
| Phase 5 Decision Board (`test:phase5-board`) | 8 | 8 | 0 | — | scripts/run-phase5-board-tests.ts |
| Workflow / lifecycle | 21 | 21 | 0 | — | IAM-007B happy paths + Closure atomicity/audit |
| Security / RBAC | TBD | 0 | 0 | Phase 6 | IAM-011/011A |
| Performance | TBD | 0 | 0 | Phase 9 | IAM-012 |
| API / contract | Partial | 8 | 0 | Phase 7 full IAM-009 | Phase 1 inbound APIs covered by port tests |
| Adapter replaceability | 1 | 1 | 0 | — | P2-HUB DataHub smoke via same Inbound Port |
| UAT | TBD | 0 | 0 | Phase 9 | IAM-012 / 012A (non-colliding IDs) |
| Regression (V1.0 paths during migration) | Partial | 8 | 0 | — | Phase 1 suite re-run after Phase 2 |

*Counts must reflect actual automated/manual results in the repository. Do not inflate Passed when suites are not run or not yet V1.5-scoped.*

---

## Phase Exit Reviews

| Phase | Exit criteria met | Architecture review result | Data model review result | API contract review result | Migration impact review result | Authorization to proceed |
|-------|-------------------|----------------------------|--------------------------|----------------------------|--------------------------------|--------------------------|
| 0 | **Yes** | **Pass** (ADR-IAM-001 unchanged) | N/A | N/A | N/A | Phase 0 **Approved** by Project Owner 2026-07-21. |
| 1 | **Yes** | **Pass** (Inbound Port; ADR conforming) | **Pass** (additive schema + migration plan) | **Pass** (inbound evidence/recommendations/status) | **Pass** (legacy Action retained; dual-model documented) | Phase 1 **Approved** by Project Owner 2026-07-21. |
| 2 | **Yes** | **Pass** (Architecture Closure; Addendum A 100%) | **Pass** | **Pass** (upload + merge + inbound) | **Pass** (bypasses removed; TD-009 deferred) | Phase 2 **Approved** by Project Owner 2026-07-21. ADR inbound/adapter frozen. |
| 3 | **Yes** | **Pass** (LS-01–LS-11; Closure Addendum A; ADR frozen) | **Pass** | **Pass** | **Pass** | Phase 3 **Approved** 2026-07-21. |
| 4 | **Yes** | **Pass** (scoring/presentation; Deferred rule; Scoring Validation accepted) | **Pass** | **Pass** | **Pass** | Phase 4 **Approved** 2026-07-21. |
| 5 | **Yes** (pending PO Complete mark) | **Pass** (Board Core-only; ADR frozen) | **Pass** (`RecommendationNote`) | **Pass** (notes API; Board uses transition APIs) | **Pass** (Action UI retained as legacy; Rec Board authoritative) | Phase 5 **Ready for Review**. Phase 6 **not** authorized. |
| 6 | No | Pending | N/A | Pending | N/A | **Not authorized** |
| 7 | No | Pending | Pending | Pending | Pending | **Not authorized** |
| 8 | No | Pending | Pending | Pending | N/A | **Not authorized** |
| 9 | No | Pending | Pending | Pending | Pending | **Not authorized** |

---

## Overall Project Summary

| Metric | Value |
|--------|--------|
| **Overall completion percentage** | **~60%** (Phases 0–4 Approved; Phase 5 Ready for Review; 6–9 at 0%) |
| **Current phase** | Phase 5 — **Ready for Review** |
| **Next authorized phase** | **None.** Phase 6 remains Waiting for Authorization. |
| **Critical unresolved decisions** | SD-1 (final formulas); SD-2 (Emergency); SD-3 timing; SD-7 (RBAC); RSE/PRE contracts |
| **Critical blockers** | **B-007** — Phase 5 completion approval pending Project Owner |
| **Latest approved checkpoint** | Phase 4 **Approved** 2026-07-21. Phase 5 Completion + Experience Review filed. |
| **Phase 4 Completion Report** | [`phase-reports/IAM_V1_5_Phase_4_Completion_Report.md`](./phase-reports/IAM_V1_5_Phase_4_Completion_Report.md) |
| **Scoring Validation** | [`phase-reports/IAM_V1_5_Scoring_Validation_Report.md`](./phase-reports/IAM_V1_5_Scoring_Validation_Report.md) |
| **Phase 5 Completion Report** | [`phase-reports/IAM_V1_5_Phase_5_Completion_Report.md`](./phase-reports/IAM_V1_5_Phase_5_Completion_Report.md) |
| **Decision Board Experience Review** | [`phase-reports/IAM_V1_5_Decision_Board_Experience_Review.md`](./phase-reports/IAM_V1_5_Decision_Board_Experience_Review.md) |

---

## Maintenance checklist (end of session / checkpoint)

- [ ] Phase table statuses, %, blockers, tests, deliverables, and Last Updated reflect reality  
- [ ] Active Blockers accurate  
- [ ] Specification Decision Register updated if any SD moved  
- [ ] Architecture Conformance updated if code/schema touched  
- [ ] Testing Summary matches latest test runs  
- [ ] Phase Exit Reviews updated if a checkpoint occurred  
- [ ] Overall Project Summary recalculated  
- [ ] No phase marked **Complete** without deliverables + tests + traceability + ADR conformance + review + **explicit approval**
