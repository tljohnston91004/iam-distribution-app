# IAM Version 1.5 — Questions and Clarifications Log

| Field | Value |
|-------|--------|
| **Document ID** | IAM-V15-QUESTIONS |
| **Governing** | IAM-000 §8; Implementation Plan Phase 0 |
| **Rule** | Unresolved business behavior must be recorded here (and/or as an SD). Do not invent answers in code. |

| Question ID | Question | Context | Linked SD | Status | Resolution | Date opened | Date resolved |
|-------------|----------|---------|-----------|--------|------------|-------------|----------------|
| Q-001 | What are the exact scoring formulas, weights, thresholds, and Cost of Inaction calculation? | IAM-006/006A hierarchy only | SD-1 | Open | — | 2026-07-21 | — |
| Q-002 | What criteria define Emergency Priority, and may it displace Top 2? | IAM-001/004 | SD-2 | Open | — | 2026-07-21 | — |
| Q-003 | When and how does a Deferred recommendation re-enter review? | Defer clarification; IAM-005A EXC-002 | SD-3 | **Partial** | **Board presentation (V1.5, 2026-07-21):** Deferred remains visible in `deferred` lane with score/evidence/audit retained; does not compete for Top 2 while Defer active; management `reactivate_defer` restores ranking eligibility without recalculation unless data changed. **SD-3 still open** for automatic expiry / return-to-review timing (not invented). | 2026-07-21 | 2026-07-21 (presentation only) |
| Q-015 | Do Paused Recommendations consume Organizational Execution Capability (OEC)? | Blueprint §5.2 | — | **Resolved** | **No.** Paused Recommendations do not consume OEC (Project Owner 2026-07-21). Active and Holdover do. | 2026-07-21 | 2026-07-21 |
| Q-016 | May Recommendation aging automatically change priority or lifecycle? | Blueprint §5.6 | — | **Resolved** | **No.** Aging is advisory only — reassessment prompts permitted; never auto-reprioritize, delete, pause, defer, or otherwise change a Recommendation without management action (Project Owner 2026-07-21). | 2026-07-21 | 2026-07-21 |
| Q-004 | Final RBAC cells: Executive Assign? Owner Escalate? Defer permissions? Reviewer vs Auditor matrix rows? | IAM-011A incomplete vs clarifications | SD-7 | Open | — | 2026-07-21 | — |
| Q-005 | What happens if Outcome Validation fails (rework path)? | IAM-007B happy path only | SD-8 | Open | Phase 3 implements OV pass → Archive only; failure/rework not invented. | 2026-07-21 | — |
| Q-006 | How is owner “request discussion” modeled (IAM-001)? | No LS/API in 007B | SD-9 | Open | Phase 3 does not implement discussion path. | 2026-07-21 | — |
| Q-007 | Are Grouped actions in V1.5 scope? | V1 had GroupedActionItem; V1.5 entity list silent | SD-10 | Open | — | 2026-07-21 | — |
| Q-008 | Production deployment topology (SQLite single-node vs shared DB)? | Ops readiness depth | SD-11 | Open | — | 2026-07-21 | — |
| Q-009 | How are Decision Board presentation categories persisted? | Clarification categories vs 007C gap | SD-13 | Open | — | 2026-07-21 | — |
| Q-010 | Confirm capacity/dependencies never change base business priority (remove actionability-from-score)? | Provisional clarification vs current engine | SD-14 | Open | — | 2026-07-21 | — |
| Q-011 | What is the RSE→IAM and PRE→IAM Recommendation Package field dictionary and transport? | IAM-008; ADR-IAM-001 | RSE/PRE | Open | — | 2026-07-21 | — |
| Q-012 | Precedence when both module Recommendations and interim evidence-generated candidates exist for the same SKU/cycle? | ADR transitional considerations | SD-17 | **Resolved** | Decision Module Recommendation is authoritative for the same underlying business opportunity. Evidence-generated candidate must not create a duplicate Recommendation. Raw evidence may enrich confidence, explainability, financial/cash impact, audit history, and supporting analysis. Evidence-generated recommendations are interim only where no authoritative Decision Module Recommendation exists. Duplicate detection and consolidation occur before ranking and Decision Board presentation. Applies to all Decision Modules, not only RSE. No ADR update unless implementation conflicts with ADR-IAM-001. | 2026-07-21 | 2026-07-21 |
| Q-013 | Remap IAM-012A FR IDs so they do not collide with IAM-003? | Consistency Report (documentation) | — | Open (doc) | — | 2026-07-21 | — |
