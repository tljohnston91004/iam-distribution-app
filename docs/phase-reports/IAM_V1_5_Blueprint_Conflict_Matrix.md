# IAM Version 1.5 — Blueprint Conflict Matrix

| Field | Value |
|-------|--------|
| **Document** | Specification & Architecture Conflict Matrix |
| **Blueprint** | IAM Executive Experience Blueprint v1.0 |
| **Date** | 2026-07-21 |
| **Code modified** | **None** |

**Status key:** Aligned · Partial · UI-only · Workflow · Spec clarification · Architectural (blocked)

**Change class key:** Aligns with current implementation · UI only · Workflow/presentation rules · Spec clarification · Cannot implement without architectural change

---

## Matrix

| ID | Blueprint requirement | Existing source | Status | Change class | Description | Severity | Recommendation | Proposed resolution |
|----|----------------------|-----------------|--------|--------------|-------------|----------|----------------|---------------------|
| C-01 | §3.1 No fixed Top 2; OEC-based concurrent Active Priorities | Phase 4/5 `FEATURED_PRIORITY_COUNT=2`, `presentationCategory=top_2`; Customer Walkthrough | **Conflict (product rule)** | Workflow/presentation rules | Current Board promotes exactly two items; Blueprint forbids universal Top 2. | **High** | Treat as intentional Phase 5A experience change authorized by Blueprint. | Replace Top 2 promotion with OEC-aware Active Priorities; keep ranking from interim scoring; update tests/docs language from “Top 2” to “Active Priorities.” |
| C-02 | §5.2 OEC company-profile setting | No OEC field; Company model exists | **Missing** | Workflow/presentation + config | OEC not implemented. | **High** | Implement as Core tenant/company config with audit. | Add auditable company OEC integer; default via onboarding; no scoring change. |
| C-03 | Active Assignments + Holdover consume OEC | Holdover lane + Active LS exist; no consumption accounting | **Partial** | Workflow/presentation rules | Capacity accounting missing. | **High** | Define consumption map from existing LS/lanes. | Count **Active + Holdover** against OEC; **Paused, Deferred, and Waiting do not consume** (PO 2026-07-21). |
| C-04 | Paused may consume OEC — rule must be explicit | Blueprint §5.2; lifecycle Paused exists | **Resolved (PO 2026-07-21)** | Aligns (policy closed) | Governing rule confirmed. | — | Implement as approved. | **Paused Recommendations do not consume OEC.** |
| C-05 | Waiting for Activation queue | `managed_backlog` mixes concepts | **Partial** | Workflow/presentation rules | Need explicit waiting lane/section. | **Medium** | Separate presentation category or Board section driven by promotion engine. | Add `waiting_activation` (or section rule) for ranked-not-promoted items; preserve Deferred separately. |
| C-06 | Weekly Business Summary (<30s) | Business Health tiles only | **Missing** | UI + derived presentation | No narrative weekly summary. | **Medium** | Presentation-only content from existing run signals. | Template Summary from readiness, gaps, lane counts, cash totals — PO review copy; no new scoring. |
| C-07 | Business Momentum | Not implemented | **Missing** | UI + derived presentation | No improving/holding/declining statement. | **Medium** | Same as C-06. | Derive directional statement from cycle-over-cycle deltas where data exists; else “Holding — limited trend data” honesty. |
| C-08 | Trust Pyramid plain-English story | `explainabilityJson` breakdown; weak card narrative | **Partial** | UI + presentation fields | Technical explainability ≠ executive story. | **High** (CX) | Presentation layer. | Add/display what/why/why-now/expected-result; generate from existing fields + templates; drill-down keeps technical detail. |
| C-09 | One primary management prompt | Multi-button cards + `prompt()` (TD-015) | **Partial** | UI only | Cognitive load / meeting friction. | **High** (CX) | UI redesign within existing actions. | Primary CTA by lifecycle; secondary in overflow; inline forms. |
| C-10 | Decisions Requiring Management zone | Actions scattered on cards | **Partial** | UI only | No dedicated “decide now” zone. | **Medium** | Layout. | Surface Approvals/Assign/Escalations needing attention in zone §4.2 stage 4. |
| C-11 | Work Already Underway (Holdover + blockers + progress) | Holdover lane; no progress/blocker fields | **Partial** | UI + data additive | Visibility OK; progress narrative missing. | **Medium** | Additive fields or structured notes. | Add progress/blocker/lastUpdate/expectedCompletion on assignment or recommendation; display on WIP. |
| C-12 | Recently Completed Improvements on Board | Archive page; OV/FinancialImpact exist | **Partial** | UI only | Completed not on main agenda. | **Medium** | UI. | “Completed since last review” strip from completed_presentation/Archived + OV results. |
| C-13 | Deferred visible; no activation competition; reactivate w/o rescoring | Deferred Presentation Rule; `reactivate_defer` | **Aligned** | Aligns | Already matches Blueprint §4.2/§5.2 Deferred. | — | Preserve. | Regression-test; keep Q-014 behavior. |
| C-14 | Low confidence does not suppress | Phase 4 no confidence suppress | **Aligned** | Aligns | Matches §3.9. | — | Preserve. | Keep ranking inclusion; improve confidence narrative (C-08). |
| C-15 | Financial impact leads; ops risk may override | Interim profile + service override ratio | **Aligned** | Aligns | Matches scoring behavior. | — | Do not retune SD-1 in 5A. | Display override honestly in story when applied. |
| C-16 | Closed-loop lifecycle through OV + learning | Lifecycle engine LS-01–11; learning analytics absent | **Partial** | UI for OV; defer learning | Lifecycle OK; org learning §8.6–8.7 not built. | **Low–Med** | Split scope. | Phase 5A: show OV/expected vs actual. **V1.6:** learning analytics / OEC auto-recommend. |
| C-17 | Recommendation aging / stale reassessment | Not implemented; §13.2 forbids independent lifecycle change | **Resolved (PO 2026-07-21)** | Workflow/presentation rules (advisory) | Policy closed: advisory only. | — | Implement prompts only. | **Aging is advisory only.** Generate reassessment prompts; **never** automatically reprioritize, delete, pause, defer, or otherwise change a Recommendation without management action. |
| C-18 | Management override recording | Defer/Reject/Approve exist; tone/guidance weaker | **Partial** | UI only | Override possible; advisor tone incomplete. | **Low** | Copy + UI. | Respectful rationale capture on override actions. |
| C-19 | Soft viewAs vs real authority | Soft viewAs; Phase 6 RBAC open | **Partial** | Spec clarification (phase boundary) | Blueprint roles OK for experience; not security. | **Medium** | Keep Phase 6 separate. | Phase 5A: improve role *views*; do not claim RBAC complete (Acceptance Checklist §3). |
| C-20 | Emergency calm / elevated only when real | Empty Emergency + SD-2 defer | **Aligned (intentional gap)** | Aligns | Compatible with calm principle. | Low | Keep SD-2 deferred. | Customer language “None elevated this week.” |
| C-21 | Accessibility & responsiveness | Not evidenced | **Missing** | UI polish | Acceptance criterion. | **Medium** | Minimum in 5A; depth later. | Keyboard + contrast baseline in 5A; full a11y suite → debt/V1.6. |
| C-22 | Five-minute executive review | CX Walkthrough 20–30 min | **Partial / aspirational** | UI + C-01–C-10 | Achievable after packaging, not today. | Medium | Phase 5A goal. | Acceptance via timed walkthrough after 5A. |
| C-23 | No Keystroke in Core / Port only | ADR-IAM-001; Phase 2 closure | **Aligned** | Aligns | Blueprint §13 compatible. | — | Guardrail. | Phase 5A regression: no adapter governance. |
| C-24 | Scoring authority unchanged | interim_v1_cash_led approved | **Aligned** | Aligns | Blueprint forbids independent scoring change. | — | Gate. | Any score formula change requires SD — out of 5A. |
| C-25 | Platform extraction of reusable principles | Blueprint §14 | **N/A (future)** | Spec clarification | Not an IAM conflict. | Low | Separate doc later. | See Platform Extraction Review; do not implement platform standard now. |

---

## Summary counts

| Change class | Count (approx.) |
|--------------|-----------------|
| Aligns with current implementation | 6 |
| UI only | 5 |
| Workflow / presentation rules | 5 (+ advisory aging as presentation) |
| Spec clarification required (open) | **0** |
| Resolved by PO policy (2026-07-21) | **2** (C-04 Paused/OEC; C-17 aging) |
| Architectural change required | **0** for Phase 5A / EEP scope |

### Approved policy decisions (Project Owner 2026-07-21)

| Topic | Decision |
|-------|----------|
| Paused and OEC | Paused Recommendations **do not** consume Organizational Execution Capability. |
| Recommendation aging | **Advisory only** — reassessment prompts; no automatic Recommendation mutation without management action. |

---

## Architectural blockers

**None identified** for implementing the Blueprint as Core experience/presentation + company OEC configuration, provided:

- Scoring formulas remain under A-005 / SD-1.  
- Lifecycle transitions remain the existing named engine.  
- Aging remains **advisory only** (PO-approved 2026-07-21).  
- Paused does **not** consume OEC (PO-approved 2026-07-21); Active and Holdover do.  
- Adapters remain non-governing.

---

## Explicit stop

Conflict Matrix updated with approved policy decisions. No application code modified. EEP not begun — awaiting authorization.
