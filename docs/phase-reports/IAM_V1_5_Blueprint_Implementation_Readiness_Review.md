# IAM Version 1.5 — Blueprint Implementation Readiness Review

| Field | Value |
|-------|--------|
| **Document** | Implementation Readiness Review |
| **Blueprint** | IAM Executive Experience Blueprint v1.0 (Approved 2026-07-21) |
| **Date** | 2026-07-21 |
| **Code modified** | **None** |
| **ADR change required for Phase 5A?** | **No** (if OEC/promotion remain Core presentation + configuration; no adapter governance; no Port redesign) |

---

## 1. Internal consistency

| Area | Assessment |
|------|------------|
| Vision ↔ hierarchy ↔ Monday flow | **Consistent** — Summary → Momentum → Active Priorities → Decisions → WIP → Completed → Waiting → Deferred matches attention zones. |
| OEC ↔ Active Priorities ↔ Waiting queue | **Consistent** — Active = need + capacity; Waiting = ranked but not promoted; Deferred excluded from OEC. |
| Trust Pyramid ↔ progressive disclosure | **Consistent** — Board shows Levels 1–3/5; evidence deeper on drill-down. |
| “Shall not change scoring/lifecycle” ↔ new OEC/aging | **Consistent** — OEC is experience/capacity governance, not scoring formula. **Aging is advisory only** (PO 2026-07-21): reassessment prompts; no automatic Recommendation mutation. |
| Five-minute objective ↔ closed-loop accountability | **Tension, not contradiction** — Board stays light; accountability lives in WIP/Completed/drill-down. |
| Paused work vs OEC | **Resolved (PO 2026-07-21)** — **Paused Recommendations do not consume OEC.** |

**Verdict:** Internally consistent as an experience standard. Policy defaults for **Paused→OEC** and **aging** are **approved**; remaining work is implementation under separate EEP authorization.

---

## 2. Completeness (vs Phase 5A Acceptance Checklist)

| Checklist area | Blueprint coverage | Current V1.5 support | Readiness |
|----------------|--------------------|----------------------|-----------|
| Weekly Business Summary | Fully specified | Missing | **Not ready** — new presentation + derived content |
| Business Momentum | Fully specified | Missing | **Not ready** |
| OEC configuration | Fully specified | Missing | **Not ready** — needs company/tenant setting + audit |
| OEC enforcement / promotion | Fully specified | Fixed Top 2 only | **Partial concept** — ranking exists; capacity gate does not |
| Active Priorities | Fully specified | `top_2` fixed count=2 | **Partial** — wrong product rule vs Blueprint §3.1 |
| Waiting for Activation | Fully specified | Roughly `managed_backlog` | **Partial** — not OEC-aware queue |
| Deferred | Fully specified | **Implemented** (Deferred Presentation Rule) | **Aligned** |
| Holdover consumes OEC | Fully specified | Holdover lane exists; no OEC | **Partial** |
| Explainability / Trust Pyramid | Fully specified | Score JSON + fields; weak plain English | **Partial** |
| Primary prompt | Fully specified | Many equal buttons + prompts | **Partial / UI** |
| Confidence explanation | Specified | Label + multiplier; weak narrative | **Partial** |
| Cognitive load / attention zones | Specified | Dense header chrome | **Partial / UI** |
| Recommendation aging | Specified; **PO rule: advisory prompts only** | Missing in code | **Ready to implement** (prompts only; no auto-mutation) |
| Progress / blockers | Specified | Lifecycle only; no narrative progress | **Not ready** — data + UI |
| Outcome validation display | Lifecycle exists | Board weak; FinancialImpact exists | **Partial** |
| Recently Completed on Board | Specified | Archive page only | **Partial / UI** |
| Role experience | Specified | Soft viewAs | **Partial** — OK for pilot; Phase 6 for real RBAC |
| Accessibility | Acceptance criterion | Not evidenced | **Defer polish** / track debt |
| Five-minute review | Target | CX walkthrough ~20–30 min facilitated | **Aspirational** until Phase 5A packaging |

---

## 3. Conflicts with existing IAM V1.5 specifications

| Spec / decision | Relationship |
|-----------------|--------------|
| **IAM-004 Decision Board** | Blueprint **extends and disciplines** Board experience; does not contradict Top-2 *intent*, but **replaces fixed Top 2 count** with OEC-aware Active Priorities — treat as experience evolution authorized by Blueprint authority clause. |
| **IAM-006 / SD-1 / A-005 interim scoring** | Blueprint keeps scoring authority frozen; financial-leads language **aligns** with `interim_v1_cash_led`. |
| **SD-14 actionability** | Blueprint “actionable enough to begin” as **promotion gate** is compatible if it does **not** re-enter composite score. |
| **SD-2 Emergency** | Blueprint calm/urgency language supports empty Emergency; **no conflict** keeping SD-2 deferred. |
| **Deferred Presentation Rule (Q-014)** | **Strong alignment** — visible, score retained, no Top 2/activation competition, reactivate without rescoring. |
| **IAM-007B lifecycle** | Closed-loop story **aligns**. Blueprint must not invent new LS states. |
| **Phase 5 Customer Walkthrough** | Blueprint is the **remediation spec** for walkthrough findings — complementary, not conflicting. |

---

## 4. Conflicts with ADR-IAM-001

| ADR rule | Blueprint impact |
|----------|------------------|
| Core owns governance / Board presentation | **Compatible** — experience changes belong in Core UI + Core presentation services. |
| Adapters do not write Board/scores/workflow | **Compatible** — do not put OEC or explanations in Keystroke adapter. |
| Canonical Inbound Port | **Compatible** — no Port redesign required for Phase 5A. |
| Recommendation primary entity | **Compatible** — Active Priorities remain Recommendations. |

**Conclusion:** Phase 5A can proceed **without ADR amendment** if OEC is Core configuration + presentation promotion, not a new inbound concern.

---

## 5. Conflicts with lifecycle, scoring, governance, Recommendation architecture

| Layer | Feasible without redesign? | Notes |
|-------|----------------------------|-------|
| **Scoring** | **Yes** | Continue interim profile; do not change weights for OEC. |
| **Presentation** | **Yes, major change** | Replace fixed `top_2` promotion with OEC-aware Active Priorities + Waiting queue. |
| **Lifecycle engine** | **Yes, largely untouched** | Keep named transitions; UI primary prompt maps to existing actions. |
| **Governance (Defer/Reject/etc.)** | **Yes** | Aligns; Deferred rule already shipped. |
| **Recommendation model** | **Additive fields likely** | Explanation narrative, progress/blocker, expected result labels, aging timestamps — presentation support, not new Recommendation semantics. |
| **Company/tenant config** | **Additive** | OEC setting + audit. |

---

## 6. Technical feasibility

### Already supported by domain/APIs (reuse)

- Recommendation lanes, scores, confidence, cash/financial, generationPath, sourceModule  
- Lifecycle transition API (approve, assign, accept, defer, reactivate_defer, pause, escalate, complete, OV…)  
- Deferred presentation rule + reactivate without rescoring  
- FinancialImpact expected/actual (for Completed / OV display)  
- Soft viewAs Executive / Operations / Owner  

### Additional data / derived presentation needed

| Need | Nature |
|------|--------|
| Company `organizationalExecutionCapability` (int) + audit | Configuration |
| Derived Active vs Waiting promotion from score rank + OEC − consumed slots | Presentation service |
| Weekly Business Summary / Momentum text or structured summary | Derived presentation (rules/templates from run readiness, gaps, lane counts, impacts) — **no new scoring formula** |
| Trust Pyramid fields (why / why now / expected result narrative) | Presentation content — generate from existing explainability + typed templates where possible; escalate if invention required |
| Progress narrative, blocker, last update, expected completion | Assignment/Recommendation additive fields or notes conventions |
| Aging threshold + reassessment prompts | Config + presentation/governance prompt (not silent delete) |

### Soft viewAs vs Blueprint roles

- **Supports** Executive / Operations / Owner review of experience.  
- **Does not** satisfy acceptance language that implies authority enforcement — Phase 6 / SD-7 remains required for real RBAC (Acceptance Checklist §3).

### Can OEC be tenant-configured with current patterns?

- **Yes**, via Company (or company settings) + AuditEvent/ChangeLog — consistent with existing Prisma/company model. No ADR change.

---

## 7. UI/UX implementation considerations

1. **Reorder Board** to Blueprint §9.1; make Active Priorities visually dominant.  
2. **One primary CTA** per card; secondary actions in overflow/menu.  
3. **Replace `prompt()`** with inline forms (already high-priority CX debt TD-015).  
4. **Plain-English labels** over raw `top_2` / lifecycle chip codes.  
5. **Collapse** Waiting / Deferred / Completed by default in Executive view.  
6. **Onboarding overlay** for first five minutes (§11) — content, not architecture.  
7. Accessibility: track as debt; meet minimum contrast/keyboard for Phase 5A; full a11y suite may be V1.6.

---

## 8. Risks and ambiguities

| Risk / ambiguity | Severity | Mitigation |
|------------------|----------|----------|
| Fixed Top 2 deeply embedded in tests/docs/constants | Medium | Explicit Phase 5A migration of presentation tests + customer language |
| Inventing Weekly Summary/Momentum content without business rules | Medium | Template from existing signals only; PO review copy |
| Paused OEC consumption | **Resolved** | **Paused does not consume OEC** (PO 2026-07-21) |
| Aging auto-mutation | **Resolved** | **Advisory prompts only**; never auto-reprioritize/delete/pause/defer/change without management action (PO 2026-07-21) |
| Over-scoping organizational learning (§8.6–8.7) | Medium | Defer analytics to V1.6; keep simple Completed strip in 5A |
| Treating Blueprint as license to change scoring | High | Enforce §13.2 in Phase 5A plan gates |

---

## 9. Overall readiness rating

| Rating | Meaning |
|--------|---------|
| **Ready for EEP / Phase 5A authorization** | Blueprint is clear and architecture-compatible; **Paused/OEC and aging policies are approved** (2026-07-21). Implementation awaits separate Project Owner authorization of the Executive Experience Enhancement Project (EEP). |

**EEP / Phase 5A can proceed without an ADR change** once authorized.

### Approved policy decisions (Project Owner 2026-07-21)

| Topic | Decision |
|-------|----------|
| Paused and OEC | Paused Recommendations **do not** consume Organizational Execution Capability. |
| Recommendation aging | **Advisory only** — reassessment prompts permitted; **no** automatic reprioritize, delete, pause, defer, or other Recommendation change without management action. |

---

## Explicit stop

Readiness review updated with approved policy decisions. No application code modified. EEP / Phase 5A not begun — awaiting authorization.
