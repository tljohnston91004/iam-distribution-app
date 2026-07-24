# IAM Version 1.5 — Phase Authorization Register

| Field | Value |
|-------|--------|
| **Purpose** | Official authorization record for IAM Version 1.5 implementation |
| **Rule** | **No implementation phase may begin until it has been explicitly authorized by the Project Owner.** |
| **Plan** | [`IAM_V1_5_Implementation_Plan.md`](./IAM_V1_5_Implementation_Plan.md) |
| **Dashboard** | [`IAM_V1_5_Implementation_Dashboard.md`](./IAM_V1_5_Implementation_Dashboard.md) |
| **Integration ADR** | [`architecture/ADR-IAM-001-Canonical-Inbound-Port-and-Replaceable-Source-Adapter-Architecture.md`](./architecture/ADR-IAM-001-Canonical-Inbound-Port-and-Replaceable-Source-Adapter-Architecture.md) |
| **Status values (this register only)** | `Waiting for Authorization` · `Authorized` · `In Progress` · `Ready for Review` · `Approved` · `Closed` |

---

## Authorization table

| Phase | Scope | Status | Authorized By | Authorization Date | Review Required Before Next Phase | Completion Approved | Completion Date | Notes |
|-------|--------|--------|---------------|--------------------|-----------------------------------|---------------------|-----------------|-------|
| 0 | Foundations and control plane (logs, SD register, doc errata start, ADR acknowledgment) | Approved | Project Owner | 2026-07-21 | Yes | Yes — Project Owner | 2026-07-21 | Completion approved 2026-07-21. SD-17 resolved. Phase 1 not authorized. |
| 1 | Domain model and Inbound Port (canonical Evidence/Recommendation contracts, provenance, migration plan) | Approved | Project Owner | 2026-07-21 | Yes | Yes — Project Owner | 2026-07-21 | Completion approved 2026-07-21. Architecture Validation accepted. Phase 2 cutover required for Keystroke→Port. |
| 2 | Keystroke Adapter → Evidence Packages only | Approved | Project Owner | 2026-07-21 | Yes | Yes — Project Owner | 2026-07-21 | Completion approved 2026-07-21. Compliance Addendum A accepted. ADR-IAM-001 inbound/adapter/contracts frozen for remainder of V1.5. |
| 3 | Lifecycle, governance, and workflow engine (LS-01–LS-11; Defer/Reject as governance outcomes) | Approved | Project Owner | 2026-07-21 | Yes | Yes — Project Owner | 2026-07-21 | Completion approved 2026-07-21. Decision Flow Report + Addendum A accepted. Closure DF-01/02/03 resolved; DF-04 = TD-012. Phase 4 authorized separately. |
| 4 | Scoring and presentation separation (rank all; Top 2 / Emergency / Holdover / Backlog) | Approved | Project Owner | 2026-07-21 | Yes | Yes — Project Owner | 2026-07-21 | Completion approved 2026-07-21. Scoring Validation + Addendum B accepted. Deferred Presentation Rule approved. Interim scoring complete for V1.5. Phase 5 authorized separately. |
| 5 | Decision Board and role UX | Ready for Review | Project Owner | 2026-07-21 | Yes | No | — | Implementation complete 2026-07-21. Experience Review filed. **EEP Authorized** 2026-07-21 (experience enhancement; Phase 6 not authorized). |
| 5A / EEP | Executive Experience Enhancement (Blueprint v1.0) | Ready for Review | Project Owner | 2026-07-21 | Yes | No | — | EEP implementation complete 2026-07-21. Completion package filed. **Awaiting PO acceptance.** Phase 6 not authorized. |
| 6 | Security, RBAC, authentication | Waiting for Authorization | — | — | Yes | No | — | SD-7 may constrain final matrix |
| 7 | Module Recommendation connectors + APIs (IAM-008/009) | Waiting for Authorization | — | — | Yes | No | — | RSE/PRE contracts may gate completeness |
| 8 | Reporting, analytics, explainability hardening | Waiting for Authorization | — | — | Yes | No | — | Depends on Phases 3–7 |
| 9 | Testing, traceability, production readiness, freeze | Waiting for Authorization | — | — | Yes (release) | No | — | Final freeze / readiness |

---

## Mandatory governance rules

1. **Cursor may not begin any implementation work for a phase** until that phase has been marked **Authorized** by the Project Owner in this register.

2. **Cursor may not begin the next phase** until all of the following are true for the current phase:
   - All planned deliverables for the current phase exist  
   - Required tests have passed  
   - Traceability has been updated  
   - ADR conformance has been verified  
   - The Implementation Dashboard has been updated  
   - The Project Owner has approved completion (this register: Completion Approved = Yes, Status → Approved then Closed as appropriate)

3. **If implementation reveals an architectural change**, implementation must **stop** until:
   - The affected ADR has been updated  
   - The reason has been documented  
   - The revised architecture has been approved  

4. **If a new Specification Decision is discovered** that materially affects implementation, implementation **pauses** until the decision is documented and approved (Dashboard Specification Decision Register + this register Notes as needed).

5. **The Phase Authorization Register, Implementation Dashboard, ADRs, and Implementation Plan must always remain synchronized.**

---

## Status transition guide

| From | To | Who / when |
|------|-----|------------|
| Waiting for Authorization | Authorized | Project Owner explicitly authorizes the phase |
| Authorized | In Progress | Implementation work for that phase begins |
| In Progress | Ready for Review | Deliverables and tests ready for Project Owner review |
| Ready for Review | Approved | Project Owner approves phase completion |
| Approved | Closed | Phase formally closed; next phase may be Authorized only after this |

Unauthorized phases must remain **Waiting for Authorization**. Do not set a phase to In Progress, Ready for Review, Approved, or Closed without the prior authorization and completion gates above.

---

## Phase Completion Report requirement

At the **completion of every phase**, produce a **Phase Completion Report** (recommended path: `docs/phase-reports/IAM_V1_5_Phase_<N>_Completion_Report.md`) containing at least:

| Section | Content |
|---------|---------|
| Deliverables completed | List against the Implementation Plan for that phase |
| Tests executed | Suites / cases run |
| Tests passed | Actual pass counts / IDs |
| Outstanding defects | Open defects with severity |
| Architecture conformance | ADR-IAM-001 (and others) — result; any ADR updates made first |
| Specification conformance | Specs / clarifications covered; open SDs |
| Dashboard updates | Confirmation the Implementation Dashboard was updated |
| Risks | Residual risks carried forward |
| Recommendation whether to authorize the next phase | Yes / No / Conditional — with rationale |

The Project Owner uses the Phase Completion Report plus the Dashboard before setting **Completion Approved** and authorizing the next phase in this register.

---

## Synchronization checklist (every authorization or completion event)

- [ ] This register updated (Status, Authorized By / dates, Completion Approved)  
- [ ] [`IAM_V1_5_Implementation_Dashboard.md`](./IAM_V1_5_Implementation_Dashboard.md) updated (phase status, blockers, tests, exit review, overall summary)  
- [ ] Implementation Plan still accurate (or amended with reason)  
- [ ] ADR-IAM-001 current; any architecture change recorded in the ADR **before** related implementation  
- [ ] Specification Decision Register updated if a new or resolved SD applies  
- [ ] Phase Completion Report filed when completing a phase  

---

## Current authorization summary

| Item | Value |
|------|--------|
| **Phases authorized** | Phase 0–4 **Approved**; Phase 5 **Ready for Review** (Authorized 2026-07-21) |
| **Phases in progress** | Phase 5 (awaiting Completion Approved) |
| **Phases Approved / Closed** | Phase 0, Phase 1, Phase 2, Phase 3, Phase 4 |
| **Phase 4 Completion Report** | [`phase-reports/IAM_V1_5_Phase_4_Completion_Report.md`](./phase-reports/IAM_V1_5_Phase_4_Completion_Report.md) — accepted 2026-07-21 |
| **Scoring Validation** | [Report](./phase-reports/IAM_V1_5_Scoring_Validation_Report.md) + Addendum B — accepted; interim scoring complete for V1.5 |
| **Phase 5 Completion Report** | [`phase-reports/IAM_V1_5_Phase_5_Completion_Report.md`](./phase-reports/IAM_V1_5_Phase_5_Completion_Report.md) |
| **Decision Board Experience Review** | [`phase-reports/IAM_V1_5_Decision_Board_Experience_Review.md`](./phase-reports/IAM_V1_5_Decision_Board_Experience_Review.md) |
| **Next action for Project Owner** | Review Phase 5 Completion Report + Experience Review; set Completion Approved; separately authorize Phase 6 if desired |
| **Register initialized** | 2026-07-21 |
| **Phase 4 completion** | 2026-07-21 — Project Owner; Deferred Presentation Rule approved |
| **Phase 5 authorization** | 2026-07-21 — Project Owner; Phase 6+ not authorized |
| **Phase 5 implementation complete** | 2026-07-21 — Ready for Review |
