# IAM Version 1.5 — Phase 5A Implementation Plan

| Field | Value |
|-------|--------|
| **Document** | Phase 5A Implementation Plan (planning only) |
| **Authority to implement** | **Granted** 2026-07-21 — Project Owner authorized EEP; implementation complete → Ready for Review |
| **Blueprint** | IAM Executive Experience Blueprint v1.0 |
| **Acceptance checklist** | IAM Executive Experience Phase 5A Acceptance Checklist v1.0 |
| **Policy decisions locked** | PO 2026-07-21: Paused does **not** consume OEC; aging is **advisory only** |
| **Date** | 2026-07-21 |
| **Code modified** | Yes — Waves A–E (see EEP Completion Report) |

---

## 1. Goal

Move IAM from a **facilitated pilot console** to a **calm recurring management tool** that meets Blueprint acceptance criteria — **without** changing ADR-IAM-001, scoring-profile authority, or lifecycle/governance semantics (except where PO explicitly approves presentation/OEC rules).

---

## 2. Preconditions (before any EEP / Phase 5A code)

| # | Precondition | Status |
|---|--------------|--------|
| 1 | Project Owner accepts Blueprint Review documents | **Approved** 2026-07-21 |
| 2 | PO decides **Paused → OEC consumption** | **Resolved** — Paused does **not** consume OEC |
| 3 | PO confirms **aging** = reassessment prompts only | **Resolved** — advisory only; no automatic Recommendation mutation |
| 4 | Phase Authorization Register (or equivalent) marks **EEP / Phase 5A Authorized** | **Done** 2026-07-21 → now Ready for Review |
| 5 | Phase 5 Completion may remain Pending/Approved independently; EEP is a **corrective experience phase**, not Phase 6 | Noted |

### Locked OEC consumption map (PO-approved)

| State / lane | Consumes OEC? |
|--------------|---------------|
| Active (incl. committed Holdover / open execution per Blueprint) | **Yes** |
| Holdover (committed work) | **Yes** |
| **Paused** | **No** |
| Deferred | **No** |
| Waiting for Activation | **No** |
| Completed / Archived / completed_presentation | **No** |

---

## 3. Logical implementation waves

### Wave A — Foundation (config + promotion engine)

| Work item | Type | Maps to Blueprint / Checklist |
|-----------|------|-------------------------------|
| Company/tenant OEC setting + audit trail | Config / schema | OEC Configuration |
| Consumption rules: Active + Holdover consume; **Paused does not** | Presentation rules | OEC Enforcement (PO 2026-07-21) |
| Replace fixed Top 2 promotion with Active Priorities + Waiting queue | Presentation service | Active Priorities; Waiting |
| Preserve Deferred rule (no activation competition) | Regression | Deferred |
| Deterministic, auditable promotion | Tests | Technical validation |

**Effort:** ~3–5 engineering days  

**Dependencies:** Policy locked (Paused/OEC)  

**Risk:** Breaking Phase 4/5 tests that assert `top_2` count=2 — update tests intentionally.

---

### Wave B — Board information hierarchy (UI shell)

| Work item | Type | Maps to |
|-----------|------|---------|
| Reorder Board to §9.1 | UI | Hierarchy; Cognitive Load |
| Weekly Business Summary panel | UI + derived content | Weekly Business Summary |
| Business Momentum panel | UI + derived content | Business Momentum |
| Zones: Immediate / Monitor / Informational | UI | Attention zones |
| Collapse Waiting/Deferred/Completed by default (Executive) | UI | Cognitive Load |
| Soften Emergency empty copy | UI | Calm principle |
| Remove/de-emphasize demo chrome for Executive default | UI | First impression |

**Effort:** ~4–6 engineering days  

**Dependencies:** Wave A promotion outputs (Active vs Waiting lists)

---

### Wave C — Trust & decision coaching (card + drill-down)

| Work item | Type | Maps to |
|-----------|------|---------|
| Trust Pyramid fields on Active cards (what / why / why now / expected result) | UI + presentation content | Explainability; Customer Trust |
| Confidence narrative (basis + limitations) | UI + content | Confidence |
| One primary CTA; secondary overflow | UI | Primary Prompt |
| Replace `prompt()` with inline forms | UI | Decision Support; TD-015 |
| Decisions Requiring Management strip | UI | Stage 4 |
| Advisor tone copy pass | Content | §7 / §10 |

**Effort:** ~4–6 engineering days  

**Dependencies:** Existing explainability/score fields; avoid inventing business facts

---

### Wave D — WIP accountability & completed strip

| Work item | Type | Maps to |
|-----------|------|---------|
| Progress / blocker / last update / expected completion (additive fields or structured notes) | Data + UI | Progress; Holdover |
| Recently Completed strip (expected vs actual where available) | UI | Recently Completed; Outcome Validation |
| Aging flag + **advisory** reassessment prompts only (never auto-mutate Recommendation) | Presentation | Recommendation Aging (PO 2026-07-21) |
| Owner waiting-acceptance badge | UI | Role Experience |

**Effort:** ~3–5 engineering days  

**Dependencies:** Wave B shell; aging policy locked (advisory only)

---

### Wave E — Onboarding, a11y baseline, evidence pack

| Work item | Type | Maps to |
|-----------|------|---------|
| First-five-minutes guided intro (dismissible) | UI | Onboarding |
| Keyboard/focus/contrast baseline | UI | Accessibility |
| Update Customer Walkthrough + screenshots/fixtures | Docs / QA | Completion evidence |
| Phase 5A Completion Report + Dashboard/Register updates | Governance | Checklist §1 |
| Blueprint traceability matrix | Docs | Checklist §1 |

**Effort:** ~2–4 engineering days  

**Dependencies:** Waves A–D functionally complete

---

## 4. Recommended implementation order

```
Policy locked (Paused≠OEC; aging advisory) ✓
    → EEP / Phase 5A Authorized (awaiting PO)
    → Wave A (OEC + promotion)
    → Wave B (Board hierarchy + Summary/Momentum)
    → Wave C (Trust + primary CTA + forms)
    → Wave D (WIP progress + Completed + advisory aging prompts)
    → Wave E (onboarding, a11y baseline, reports)
    → Stop for PO Phase 5A / EEP acceptance (Checklist)
```

Do **not** start Phase 6 inside Phase 5A.

---

## 5. Effort summary

| Wave | Estimate |
|------|----------|
| A | 3–5 days |
| B | 4–6 days |
| C | 4–6 days |
| D | 3–5 days |
| E | 2–4 days |
| **Total** | **~16–26 engineering days** (one implementer; excludes PO review lag) |

Calendar time depends on PO decision turnaround and UAT scheduling.

---

## 6. Dependencies

| Dependency | Owner |
|------------|-------|
| Paused OEC rule | Project Owner | **Locked** — does not consume |
| Aging boundary | Project Owner | **Locked** — advisory prompts only |
| EEP / Phase 5A authorization in Register | Project Owner | **Awaiting** |
| Interim scoring remains A-005 | Already approved | — |
| Lifecycle APIs unchanged | Engineering constraint | — |
| Content templates for Summary/Momentum/Why | Product + engineering; PO copy approval if material | — |

---

## 7. Implementation risks

| Risk | Mitigation |
|------|------------|
| Scope creep into scoring/lifecycle redesign | Enforce Blueprint §13.2 checklist in PR review |
| Invented Weekly Summary claims | Templates from measurable run facts only |
| Test suite still encodes Top 2=2 | Rewrite Phase 4/5 presentation assertions for OEC |
| Dual language (Top 2 vs Active Priorities) in docs | Update Dashboard/customer docs in Wave E |
| Progress fields unused by owners | Default prompts on Accept/Active |
| Treating soft viewAs as RBAC | Explicit non-claim in Completion Report |

---

## 8. Out of scope for Phase 5A (defer)

| Item | Target |
|------|--------|
| Full organizational learning analytics (§8.6) | V1.6 / Phase 8 |
| Automatic OEC tuning recommendations (§8.7) beyond simple advisory banner | V1.6 |
| SD-2 Emergency auto-assignment | After SD-2 |
| Real RBAC / IdP | Phase 6 |
| Platform Executive Experience Standard publication | Separate authorization |
| Commercial-grade a11y audit suite | V1.6 or hardening sprint |
| Changing interim scoring weights | Requires SD-1 |

---

## 9. Regression testing requirements

| Suite | Requirement |
|-------|-------------|
| `test:phase1-inbound` | Must pass |
| `test:phase2-closure` | Must pass |
| `test:phase3-lifecycle` / `test:phase3-closure` | Must pass |
| `test:phase4-scoring` | Update for OEC/Active Priorities; Deferred + no confidence suppress must still pass |
| `test:phase5-board` | Update lane/section expectations |
| **New `test:phase5a-experience`** | OEC config; promotion ≤ OEC; Paused excluded from consumption; Waiting ordered; Deferred excluded; Summary/Momentum present; primary CTA; aging advisory only (no auto-mutation) |
| Manual | Phase 5A Acceptance Checklist (all rows) + Customer Walkthrough questions §4 |
| ADR guard | No Keystroke Core governance; no Port bypass; no raw transition API |

---

## 10. Acceptance criteria (Phase 5A done when)

Mapped to Checklist v1.0 — all must be **Pass** or **Accepted exception** with PO sign-off:

1. Weekly Business Summary understandable &lt;30s  
2. Business Momentum direction + reason  
3. OEC visible, configurable, auditable  
4. Active work does not exceed OEC (unless approved exception — none in V1.5 unless PO defines)  
5. Active Priorities = highest actionable fit to capacity  
6. Waiting queue visible and ordered  
7. Deferred behavior preserved  
8. Holdover visible and consumes OEC  
9. Explainability Trust Pyramid on active items  
10. One primary prompt  
11. Confidence explained  
12. Cognitive load / decision count clear  
13. Aging prompts without automatic Recommendation mutation (advisory only)  
14. Progress/blockers visible for WIP  
15. Outcome validation comparable where measurable  
16. Recently Completed visible without clutter  
17. Role views appropriate (soft viewAs OK; RBAC not claimed)  
18. Accessibility baseline met or debt logged  
19. Five-minute review demonstrated in timed walkthrough  
20. First-time executive can explain Active Priorities without developer translation  
21. Technical governance checks (Checklist §3) all Pass  
22. OEC consumption excludes Paused (PO rule)  
23. Phase 5A / EEP Completion Report + Dashboard/Register + traceability filed  

---

## 11. Completion evidence package (when implementing)

- Phase 5A Completion Report  
- Updated Dashboard + Authorization Register  
- Blueprint requirement traceability matrix  
- Automated + manual results  
- Board fixtures/screenshots per primary state  
- Updated customer walkthrough (distributor scenario)  
- ADR-IAM-001 conformance statement  
- Open TD / SD / questions list  

---

## 12. Explicit stop

EEP implementation is **complete** and filed for Project Owner acceptance.  

**Do not close EEP until PO accepts the Completion Report / Checklist.**  
**Do not begin Phase 6.**
