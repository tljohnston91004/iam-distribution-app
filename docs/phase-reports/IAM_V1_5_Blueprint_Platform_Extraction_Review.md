# IAM Version 1.5 — Blueprint Platform Extraction Review

| Field | Value |
|-------|--------|
| **Document** | Platform Extraction Review |
| **Source** | IAM Executive Experience Blueprint v1.0 §14 |
| **Date** | 2026-07-21 |
| **Code / platform standard created?** | **No** — classification and recommendation only |

---

## 1. Purpose

Identify which Blueprint content is **IAM-specific** versus candidate material for a future **Decision Priority Executive Experience Standard**, and how to separate them later without diluting IAM Version 1.5 rules.

---

## 2. Classification by Blueprint section

| Section | Classification | Rationale |
|---------|----------------|-----------|
| 1 Purpose / Authority / Scope | **Mixed** | Authority pattern is platform-wide; IAM V1.5 binding is IAM-specific. |
| 2 Executive Experience Vision | **Platform-wide** | Advisor-prepared agenda; five-minute objective; experience promise. |
| 3 Core Experience Principles | **Mostly platform-wide** | Decisions-before-data, plain English, progressive disclosure, calm urgency, one next step, cognitive load. |
| 3.1 / 5 OEC & Active Priorities | **Mixed** | OEC *concept* is platform-wide; inventory Holdover/Deferred consumption mapping is IAM-specific. |
| 3.5 Financial impact leads | **Mixed** | Principle platform-wide; cash/WOS/service-risk semantics IAM-specific. |
| 3.9 No hidden recommendations | **Platform-wide** | Confidence must not silently suppress. |
| 4 Monday Morning flow | **Platform-wide structure** | Stage names reusable; inventory content IAM-specific. |
| 5 Active Priority + OEC details | **Mixed** | OEC definition reusable; IAM lifecycle consumption table IAM-specific. |
| 6 Trust Pyramid | **Platform-wide** | Explainability standard for all Decision Modules. |
| 7 Decision Coaching | **Platform-wide** | Advisor tone and four-part coaching model. |
| 8 Accountability / learning | **Mixed** | Closed-loop pattern platform-wide; IAM LS names, Holdover, OV IAM-specific. |
| 9 Information hierarchy | **Platform-wide** | Attention zones and “Board ≠ dashboard.” |
| 10 Communication standards | **Platform-wide** | Voice, plain English, uncertainty, positive leadership language. |
| 11 First-time onboarding | **Platform-wide** | First five minutes / guided introduction pattern. |
| 12 Acceptance criteria | **Mixed** | Criteria reusable; IAM pilot thresholds IAM-applied. |
| 13 Cursor implementation guidance | **Platform-wide process** | May/shall-not/stop rules for experience work. |
| 14 Future Platform Standard | **Platform-wide** | Extraction charter. |
| 15 Management philosophy | **Platform-wide** | Decision Priority philosophy statement. |

---

## 3. Must remain IAM-specific (do not generalize)

| Topic | Why it must stay IAM-module-level |
|-------|-----------------------------------|
| IAM-007B lifecycle state names and legal transitions | Module workflow ontology |
| Holdover as Board lane consuming OEC (not LS state) | IAM clarification / Phase 3–4 |
| Deferred Presentation Rule (visible; no Top 2/activation; reactivate without rescoring) | IAM V1.5 product rule Q-014 |
| Interim scoring profile `interim_v1_cash_led` / SD-1 | IAM scoring |
| Inventory evidence semantics (QOH, WOS, trapped cash, stock risk) | IAM domain |
| Keystroke Evidence adapter / Inbound Port boundaries (ADR-IAM-001) | IAM integration |
| Recommendation vs interim_evidence generationPath / SD-17 | IAM |
| Pause/Escalate/Outcome Validation specifics | IAM governance |
| IAM OEC consumption map | Module-specific: Active + Holdover consume; **Paused does not** (PO 2026-07-21); Deferred/Waiting do not |

---

## 4. Promote to Decision Priority Executive Experience Standard

Recommended platform TOC (future document — **not authored or implemented now**):

1. Purpose and authority of Executive Experience Standards  
2. Vision: advisor-prepared management agenda  
3. Core principles (decisions before data; plain English; progressive disclosure; calm urgency; one next step; cognitive load; no silent suppression)  
4. Recurring management flow (Summary → Momentum → Active Priorities → Decisions → WIP → Completed → Waiting → Deferred)  
5. Organizational Execution Capability (definition, configuration, consumption patterns — **module plugs in state mapping**)  
6. Trust Pyramid and confidence communication  
7. Decision coaching model and advisor tone  
8. Attention-based information hierarchy (Board ≠ dashboard)  
9. Closed-loop accountability pattern (module supplies lifecycle)  
10. Onboarding / first-five-minutes standard  
11. Acceptance criteria and customer validation thresholds  
12. Implementation constraints (experience may not silently change module scoring/lifecycle/ADR)

---

## 5. Separation method (when authorized)

1. Keep **Blueprint v1.0** as IAM V1.5 binding experience spec.  
2. Extract platform standard by **copying principles + flow + Trust Pyramid + OEC concept**, replacing IAM nouns with “Decision Module.”  
3. Maintain an **IAM Experience Profile** annex: Holdover/Deferred/OEC consumption table, inventory language examples, ADR-IAM-001 constraints.  
4. Do **not** move scoring formulas, LS catalogs, or adapter rules into the platform standard.

---

## 6. Recommendation

| Action | Timing |
|--------|--------|
| Use Blueprint as IAM Phase 5A / EEP authority | Now — Review approved; policies locked |
| Draft platform standard | **After** EEP stabilizes experience in IAM (or parallel doc-only if PO authorizes) |
| Implement platform standard in code | **Not now** |

### IAM OEC annex note (PO-approved 2026-07-21)

When extracting the platform standard, keep as **IAM Experience Profile** (not generalized without review):

- Active / Holdover consume OEC  
- **Paused does not consume OEC**  
- Deferred and Waiting do not consume OEC  
- Aging is **advisory only** (module may adopt; must not auto-mutate without management action)

---

## Explicit stop

Platform Extraction Review updated with approved policy decisions. No platform standard implemented. No application code modified. EEP not begun.
