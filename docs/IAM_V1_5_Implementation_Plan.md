# IAM Version 1.5 — Implementation Plan

| Field | Value |
|-------|--------|
| **Status** | Ready for execution authorization |
| **Phase Authorization Register** | [`IAM_V1_5_Phase_Authorization_Register.md`](./IAM_V1_5_Phase_Authorization_Register.md) — Project Owner must mark a phase **Authorized** before work begins |
| **Dashboard** | [`IAM_V1_5_Implementation_Dashboard.md`](./IAM_V1_5_Implementation_Dashboard.md) — maintain every session and phase checkpoint |
| **Product** | Inventory Action Manager (IAM) Version 1.5 |
| **Based on** | IAM-000–015 (+ 005A, 006A, 007A–C, 011A, 012A, 013A–C); retained clarifications; Specification Consistency Report; Comprehensive Gap Analysis; Integration Reference Assessment; **ADR-IAM-001** |
| **Out of scope for this plan** | Writing application code (begins only when explicitly authorized); inventing unresolved scoring formulas; building Data Hub; RSE Min/Max write-back |

---

## 1. Objective

Upgrade the existing V1.0 validation-stage IAM into an IAM Version 1.5 product that:

- Preserves approved business intent (execution and accountability; not RSE/PRE/IFM/etc.).
- Implements Decision Board, lifecycle/governance, RBAC, APIs, reporting, and audit per V1.5 specs and clarifications.
- Introduces the **Canonical Inbound Port** and **Keystroke Adapter** per **ADR-IAM-001**, with Hub replaceability.
- Remains free of unapproved Version 2 backlog items (IAM-014 content / IAM-015 freeze).

---

## 2. Governing hierarchy (conflict resolution)

1. Approved product-owner decisions and formal corrections  
2. Retained clarifications (Holdover lane; Reviewer vs Auditor; Defer; provisional architecture clarifications as accepted)  
3. **ADR-IAM-001** (integration architecture)  
4. IAM-000 authority order for numbered specs (content over filename/numbering quirks)  
5. Specification Consistency Report (documentation issues vs true requirements)  
6. Gap Analysis classifications  
7. Integration Reference Assessment (Keystroke/RSE source facts)  
8. Existing repository — **reference and reuse only**, not the source of V1.5 requirements  

**Duplicate FR IDs:** Treat underlying requirements as authoritative; fix traceability IDs as documentation work (not product invention).

### 2.1 Architecture change control (mandatory)

**No implementation phase may change the approved architecture without first updating the Architecture Decision Record and documenting the reason.**

- ADR-IAM-001 (or a superseding/amending ADR) must be updated **before** any code, schema, or adapter change that alters layering, canonical contracts, ownership boundaries, idempotency keys, quantity-basis rules, or Hub replaceability.
- Phase exit reviews must confirm the implementation still matches the current ADR text.
- If an approved design cannot be followed, **stop**, amend the ADR with rationale and approval, then resume—do not silently diverge.

### 2.2 Phase authorization control (mandatory)

**No implementation phase may begin until it has been explicitly authorized by the Project Owner** in [`IAM_V1_5_Phase_Authorization_Register.md`](./IAM_V1_5_Phase_Authorization_Register.md).

- Cursor must not start phase work while Status is `Waiting for Authorization`.
- The next phase must not begin until the current phase’s deliverables, tests, traceability, ADR conformance, Dashboard update, and Project Owner completion approval are done.
- Material new Specification Decisions pause work until documented and approved.
- The Authorization Register, Dashboard, ADRs, and this Plan must stay synchronized.
- Every phase completion requires a Phase Completion Report (see the Authorization Register).

---

## 3. Locked decisions already accepted

| Topic | Decision |
|-------|----------|
| Holdover | Decision Board / management lane — not a mandatory lifecycle state |
| Deferred / Rejected | Governance outcomes — not long-term lifecycle states |
| Defer | First-class governed management action |
| Reviewer/Validator vs Auditor | Distinct permission profiles |
| Recommendation | Primary entity; “Action” = user-facing language unless redefined |
| Contributors | One Primary Owner; zero or more Contributors |
| Top 2 | Rank all → Board applies presentation rules (+ Emergency when applicable) |
| Confidence | Does not alone suppress recommendations |
| Capacity / dependencies | Sequencing/assignment only — not base business priority |
| Keystroke | In V1.5 baseline as **replaceable Evidence adapter** (ADR-IAM-001 / SD-4) |
| QOH | Available QOH preferred; On-Hand fallback; retain both + basis (ADR-IAM-001 / SD-15) |
| Case-break / write-back | Outside IAM core (ADR-IAM-001 / SD-16) |
| Evidence-only candidate generation | Controlled **interim/legacy** path — not permanent module replacement |

---

## 4. Specification decisions still blocking full closure

Do **not** invent solutions. Gate related work or implement behind explicit “interim” labels until decided.

| ID | Decision needed | Blocks |
|----|-----------------|--------|
| **SD-1** | Scoring formulas, weights, thresholds, COI calculation | Final scoring engine and scoring tests |
| **SD-2** | Emergency Priority criteria; displace Top 2 or not | Emergency lane rules |
| **SD-3** | Defer return-to-review eligibility/timing | Defer completion behavior |
| **SD-7** | Final RBAC cells (Executive assign; Owner escalate; Defer; Reviewer/Auditor matrix) | Permission matrix implementation |
| **SD-8** | Outcome Validation failure / rework path | Validation unhappy path |
| **SD-9** | Owner “request discussion” path | Acceptance alternatives |
| **SD-10** | Grouped actions in V1.5? | Keep/retire GroupedActionItem |
| **SD-11** | Deployment topology (SQLite vs shared DB) | Ops/production readiness depth |
| **SD-13** | Presentation category persistence model | Board placement storage |
| **SD-14** | Remove/rehome actionability-in-score vs clarification #4 | Scoring redesign |
| **RSE/PRE contracts** | Recommendation Package field dictionary + transport | Full IAM-008 module intake |
| **SD-16** | Case-break field availability | Adapter enrichment only (not core) |

**Documentation-only (parallel, non-blocking for coding start):** FR ID remap in IAM-012A; IAM-000 014/015 map errata; IAM-001 Defer list; IAM-005 Holdover wording; IAM-002 role split; expand IAM-007C.

---

## 5. Reuse strategy (from gap analysis)

| Retain / evolve | Redesign | Net-new |
|-----------------|----------|---------|
| Next.js/TS/Prisma patterns; Review-cycle-like `IamRun` | Workflow → LS-01–LS-11 + governance outcomes | Auth/IdP + full RBAC |
| Evidence tables; ChangeLog pattern | Action → Recommendation model | Inbound Port; canonical packages |
| Keystroke checklist/stage/merge **ideas** → Adapter | Featured-as-state → presentation | Decision Board sections; Defer; Escalate; Outcome Validation |
| Cash-led ranking intent; Top 2; no same-cycle reject backfill | Confidence multiplier/suppress; capacity-in-score | COI; explainability store; Learning Record |
| Notes visibility concept; CSV export base; validation harness | Soft `viewAs` | IAM-009 APIs; Excel/PDF reports; ops runbooks |
| ModuleSignal storage pattern | Manual-only signals | Recommendation Package upsert |

**Preliminary effort mix:** ~35–45% reuse as-is, ~30–40% redesign, ~20–30% net-new (adjust after SD-1 and RSE contract).

---

## 6. Target architecture (implementation view)

Per **ADR-IAM-001**:

```text
Keystroke Adapter (V1.5) ──Evidence Package──┐
Manual / seed ────────────────────────────────┤► Inbound Port ► Evidence store
RSE/PRE/… connectors ──Recommendation Package─┤              ► Recommendation store
Future Hub Adapter ──Evidence + Recommendations┘
                                                    ▼
                         Scoring → Presentation (Top 2 / Emergency / Holdover / Backlog)
                                                    ▼
                         Governance / Lifecycle / Assignments / Contributors / Audit
                                                    ▼
                         Decision Board UI · Reporting · APIs
```

**Interim path:** Evidence → (flagged) interim candidate generation → same Recommendation store shape where possible, marked `generation_path = interim_evidence | module`.

---

## 7. Phased delivery plan

Phases follow IAM-013 intent, adjusted for V1.5 gaps and ADR-IAM-001. **Do not start a phase until its entry criteria and open SDs for that phase are resolved or explicitly waived as interim.**

### Phase 0 — Foundations and control plane  
**Goal:** Spec control files, ADR adoption, decision log, doc errata start.  
**Primary docs:** IAM-000, Consistency Report, ADR-IAM-001, IAM-014/015.  
**Deliverables:**

- Assumptions Log, Questions Log, ADR index, Defect/Tech-debt registers (IAM-000 §8)
- Doc errata for FR collision, 014/015 map, Defer/Holdover/role wording (documentation-only)
- Confirm SD waivers vs blockers for Phase 1–2  

**Exit:** Product owner acknowledges open SD list; ADR-IAM-001 filed in-repo.

---

### Phase 1 — Domain model and Inbound Port  
**Goal:** Canonical data model + port without Keystroke specifics in core.  
**Primary docs:** IAM-007/007A/007B/007C, ADR-IAM-001, Integration Assessment.  
**Deliverables:**

- Recommendation-centric schema (map/migrate from Action/ActionCandidate)
- Review Cycle (evolve `IamRun`)
- Governance Decision, Workflow Event, Audit Event (or strict evolution of ChangeLog with clear types)
- Assignment + Contributors
- Financial Impact (+ revision strategy)
- Presentation category fields (pending SD-13; interim schema allowed if documented)
- **Inbound Port** APIs/services: `UpsertEvidenceBatch`, `UpsertRecommendations`, ingestion status
- Provenance: `source_system`, batch IDs, `quantity_on_hand`, `available_qoh`, `quantity_basis_used`
- Migration plan from existing SQLite data (pilot)  

**Exit:** Port accepts fixture Evidence + Recommendation packages; core has no Keystroke imports.

**Depends on:** Phase 0. **SD-13** interim OK with recorded assumption.

---

### Phase 2 — Keystroke Adapter (Evidence only)  
**Goal:** Move existing Keystroke behavior behind ADR boundary.  
**Primary docs:** ADR-IAM-001, Integration Assessment, KEYSTROKE checklist.  
**Deliverables:**

- Adapter: detect reports, map columns, STK# `0` drop, Matrix/Standard + inferred parent → `entity_eligibility`
- Classification optional / non-W13
- Available QOH preferred; On-Hand fallback; persist both + basis
- UI checklist calls adapter → port (not direct table writes from UI beyond port)
- Warn when INVENTORYPOSITION used with Matrix demand  

**Exit:** Same or better merge outcomes via Evidence Package; replaceability smoke test (mock second adapter emitting packages).

**Depends on:** Phase 1.

---

### Phase 3 — Lifecycle, governance, and workflow engine  
**Goal:** LS-01–LS-11 + governance outcomes; remove conflicting V1 states.  
**Primary docs:** IAM-005/005A, IAM-007B, clarifications.  
**Deliverables:**

- State machine LS-01–LS-11 only
- Deferred/Rejected as Governance Decisions (not LS states)
- Defer, Pause (reason + approval), Escalate (LS-08), Outcome Validation (LS-10) before Archive
- Approve → assign → acceptance → Active gates
- Holdover **not** a state; Active (and related open work) appears in Holdover **lane**
- Contributors; assignment history
- close/lock Review Cycle semantics (define vs `closeWeeklyCycle` legacy)
- Audit on every governed transition  

**Exit:** Workflow tests match IAM-007B; invalid transitions rejected.

**Blocked / interim:** SD-3, SD-8, SD-9 — implement happy paths; stub or Questions Log for unhappy/discussion paths.

---

### Phase 4 — Scoring and presentation separation  
**Goal:** Rank all; Board presents Top 2 (+ Emergency); no confidence-only suppress; capacity ≠ priority.  
**Primary docs:** IAM-006/006A, clarifications, ADR interim path.  
**Deliverables:**

- Scoring service reads canonical evidence + recommendations only
- Remove/rehome actionability-in-composite per SD-14 (default: sequencing only until SD-14 closed)
- Persist score breakdown + explainability narrative inputs
- Presentation service: Top 2, Holdover lane, Managed Backlog, Emergency (rules per SD-2)
- Interim evidence-generated candidates clearly flagged
- Prefer module Recommendations when present (precedence recorded)  

**Exit:** Deterministic tests with fixtures; Board categories independent of lifecycle state.

**Blocked:** Full COI/weights until **SD-1**; ship interim weights only with explicit “interim scoring profile” label and product waiver.

---

### Phase 5 — Decision Board and role UX  
**Goal:** IAM-004 management experience.  
**Primary docs:** IAM-002, IAM-004, clarifications.  
**Deliverables:**

- Executive Decision Board: Top 2, Holdover, Emergency, Business Health, Alerts
- Cards: financial, cash, COI (when available), confidence, owner, source, required action
- Actions: Approve, Assign, Reject, Defer, Pause approval, Escalate, drill-down
- Owner queue; contributor notes; archive/history views
- Retire soft `viewAs` as security boundary (may remain as UX convenience only after RBAC)  

**Exit:** UAT scripts for weekly management + owner paths.

**Depends on:** Phases 3–4.

---

### Phase 6 — Security, RBAC, authentication  
**Goal:** IAM-011 / 011A (+ clarifications).  
**Primary docs:** IAM-011, IAM-011A, IAM-008 IdP.  
**Deliverables:**

- Authentication (IdP where available; unique actor on governed events)
- Roles: Executive, Manager, Primary Owner, Contributor, Administrator, **Executive Reviewer/Validator**, **Auditor**
- Defer and other governed permissions per SD-7 (or interim matrix stamped in Assumptions Log)
- Server-side enforcement on UI and APIs
- Audit of authz failures and privilege changes  

**Exit:** Permission tests per role; no open anonymous write APIs.

**Blocked:** Final matrix cells on **SD-7**.

---

### Phase 7 — Module Recommendation connectors + APIs  
**Goal:** IAM-008 / IAM-009 alignment.  
**Primary docs:** IAM-008, IAM-009, ADR-IAM-001.  
**Deliverables:**

- Recommendation Package upsert (idempotent on source_module + source_recommendation_id)
- Execution status output hooks toward modules (as contract allows)
- Versioned REST surface toward IAM-009 (recommendations, assignments, workflow-events, health)
- Standard response envelope + request IDs
- Keep Keystroke on Evidence path only  

**Exit:** Contract tests with fixture module payloads; health endpoint live.

**Blocked:** Full RSE/PRE field dictionaries — use fixtures until contracts arrive; do not invent business fields.

---

### Phase 8 — Reporting, analytics, explainability hardening  
**Goal:** IAM-010 + EXP/LRN rules.  
**Primary docs:** IAM-010, IAM-000 explainability standard.  
**Deliverables:**

- Standard reports; filters; CSV + Excel (+ PDF if in scope for V1.5 schedule)
- Expected vs actual impact entry and Outcome Validation UI
- Learning / override retention
- Rule/config version stamps on decisions where CFG applies  

**Exit:** Report accuracy tests against governed data; export permission checks.

---

### Phase 9 — Testing, traceability, production readiness  
**Goal:** IAM-012/012A, IAM-013A–C, IAM-015.  
**Deliverables:**

- Retarget validation harness to V1.5 requirements/rules (new trace IDs — no FR collision)
- Unit, integration, workflow, security, performance, UAT
- Production readiness, hypercare, ops runbook artifacts (depth per SD-11)
- Freeze confirmation: no IAM-014 V2 items embedded  

**Exit:** Exit criteria in IAM-012/015 met or formally waived.

---

## 8. Cross-cutting workstreams

| Workstream | Cadence |
|------------|---------|
| Documentation errata & traceability ID cleanup | Phase 0 ongoing |
| Architecture Decision Records | Each material technical choice |
| Questions Log for open SDs | Before inventing behavior |
| Security review | End of Phases 6 and 7 |
| Adapter replaceability test | End of Phase 2; regression in Phase 7–9 |
| No V2 scope creep | Continuous vs IAM-014/015 |

---

## 9. Mapping: gap analysis → phase

| Gap theme | Phase |
|-----------|-------|
| Inbound Port / Hub replaceability / Keystroke isolation | 1–2 |
| Lifecycle conflicts (Holdover/Featured/Reject-as-state) | 3 |
| Defer / Escalate / Outcome Validation / Contributors | 3, 5 |
| Scoring vs presentation; confidence suppress; capacity | 4 |
| Decision Board UX | 5 |
| Auth / RBAC / Reviewer / Auditor | 6 |
| Module contracts / IAM-009 APIs | 7 |
| Reports / actuals / analytics | 8 |
| Tests / ops / freeze | 9 |
| SD-1 formulas | Gate Phase 4 finalization |
| RSE/PRE live contract | Gate Phase 7 completeness |

---

## 10. Quality gates (every phase)

1. Specs + ADR + clarifications consulted; Questions Log updated for any invention risk.  
2. **Architecture conformance:** implementation matches current ADR-IAM-001 (or superseding ADR); any architectural delta was ADR-updated with documented reason **before** coding.  
3. Automated tests for the phase’s acceptance criteria.  
4. No adapter writes to Board/scores/workflow/governance.  
5. Audit events for new governed behaviors.  
6. Traceability rows added (non-colliding IDs).  
7. Phase demo on Decision Board / owner path as applicable.  
8. Explicit list of interim waivers (SDs) carried forward.

---

## 11. Explicit non-goals (V1.5)

- Decision Priority Platform Core Framework / full Data Hub build  
- Autonomous ML prioritization (IAM-014 V2-008)  
- Automatic business execution (PO, price, liquidation, Keystroke Min/Max write-back)  
- IAM as permanent replacement for RSE/PRE recommendation engines  
- Unapproved V2 backlog items  

---

## 12. Suggested execution order (summary)

```text
Phase 0  Foundations & SD register
Phase 1  Domain model + Inbound Port
Phase 2  Keystroke Adapter → Evidence Packages
Phase 3  Lifecycle & governance engine
Phase 4  Scoring + presentation (interim profile if SD-1 open)
Phase 5  Decision Board & role UX
Phase 6  AuthN/Z & RBAC
Phase 7  Recommendation connectors + API contracts
Phase 8  Reporting & outcome validation UX
Phase 9  Full validation, ops, freeze
```

Parallelism: Doc errata || Phase 1; RBAC design (SD-7) || Phases 3–5; RSE contract negotiation || Phases 4–6.

---

## 13. Success definition

IAM Version 1.5 implementation is complete when:

- ADR-IAM-001 replaceability acceptance criteria are met.  
- IAM-001 success criteria and IAM-015 freeze statement are satisfied.  
- Critical gaps from the Gap Analysis are Closed or formally waived.  
- Open SDs are either resolved or documented as accepted interim behavior with owner sign-off.  
- No unapproved V2 functionality is present.

---

## 14. Next authorization

This plan is the roadmap only. **Application code and phase implementation start only when the Project Owner marks the phase Authorized** in [`IAM_V1_5_Phase_Authorization_Register.md`](./IAM_V1_5_Phase_Authorization_Register.md).

**Recommended first authorization:** Phase 0 only (foundations), then authorize Phase 1 after Phase 0 completion approval—unless the Project Owner records a combined authorization in the register.
