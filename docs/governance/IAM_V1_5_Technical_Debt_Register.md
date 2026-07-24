# IAM Version 1.5 — Technical Debt Register

| Field | Value |
|-------|--------|
| **Document ID** | IAM-V15-TECH-DEBT |
| **Governing** | IAM-000 §8 |
| **Rule** | Track intentional shortcuts and deferred hardening. Do not use this register to smuggle V2 product scope (see IAM-014 backlog). |

| Debt ID | Description | Origin | Impact | Target phase to resolve | Severity | Status | Date logged |
|---------|-------------|--------|--------|-------------------------|----------|--------|-------------|
| TD-001 | V1.0 Keystroke merge still coupled to run tables (pre-Inbound Port) | Existing repo | Blocks Hub replaceability until Phase 2 routes through port | 2 | High | **Resolved** 2026-07-21 — adapter → Inbound Port; legacy bypass disabled | 2026-07-21 |
| TD-002 | Soft `viewAs` / no real auth | Existing repo | Security gap vs IAM-011 | 6 | Critical | Open | 2026-07-21 |
| TD-003 | Workflow states diverge from LS-01–LS-11 | Existing repo | Governance/Board conflicts | 3 | Critical | **Resolved** 2026-07-21 — Recommendation lifecycle engine (IAM-007B LS-01–LS-11); Defer/Reject as governance outcomes | 2026-07-21 |
| TD-004 | Confidence used as score multiplier + suppress path | Existing repo | Conflicts with non-suppression clarification | 4 | High | **Resolved (Recommendation path)** 2026-07-21 — Phase 4 scoring ranks all; no confidence-only suppress. Legacy `rankNewPriorityCandidates` still filters for V1 fixtures | 2026-07-21 |
| TD-005 | Actionability inside composite priority score | Existing repo | Conflicts with capacity≠priority clarification | 4 | Medium | **Resolved (interim profile)** 2026-07-21 — actionability sequencing-only until SD-14 closes | 2026-07-21 |
| TD-006 | V1.0 validation FR/checklist IDs not V1.5 traceability | Existing repo | Traceability gap | 9 | High | Open | 2026-07-21 |
| TD-007 | IAM-012A FR ID collision with IAM-003 (documentation) | Spec package | Traceability join broken | 0 (errata) / 9 | Medium | Open | 2026-07-21 |
| TD-008 | Classification detection heuristic may mis-handle files with units | Integration Assessment | Wrong period demand | 2 | Medium | **Resolved** 2026-07-21 — filename Classification vs Replenishment in adapter `file-types.ts` | 2026-07-21 |
| TD-009 | Runtime product setting for `evidence_source` / `recommendation_sources` (Keystroke vs Hub mutex) not implemented | ADR-IAM-001 configuration seam; Compliance Report AR-03 | Environments could theoretically invoke multiple evidence adapters for one cycle without a product-level switch | 7 (Hub connectors) / 9 (hardening) | Low | Open — **not a Phase 2 closure blocker**; EvidenceBatch.`sourceSystem` provenance already preserved | 2026-07-21 |
| TD-010 | V1 UI / Decision Board still primarily bound to legacy Action entities while calculate emits Recommendations | Phase 2 Architecture Closure | Board UX may not show interim Recommendations until Phase 5 wiring | 5 | Medium | **Partially resolved** 2026-07-21 — Decision Board is Recommendation-centric; legacy Action pages retained for compatibility | 2026-07-21 |
| TD-011 | Legacy `transitionAction` / `closeWeeklyCycle` remain callable alongside V1.5 Recommendation lifecycle | Phase 3 dual-path compatibility | Risk of operators using V1 Action workflow as source of truth | 5 | Medium | Open — retire or bridge when Board UX moves to Recommendations | 2026-07-21 |
| TD-012 | `UnlockCycle` / reopen locked Review Cycle not implemented | Phase 3 Closure DF-04 (intentional defer) | Locked/Closed cycles cannot be unlocked via engine; operational reopen deferred | 5 or later | Low | Open — intentionally deferred outside Phase 3; lock/close only | 2026-07-21 |
| TD-013 | Emergency Priority lane auto-assignment not implemented | Phase 4 / SD-2 open | Emergency Board lane never auto-filled until SD-2 criteria decided | 5 (after SD-2) | Medium | Open — `EMERGENCY_ASSIGNMENT_ENABLED=false` | 2026-07-21 |
| TD-014 | Soft `viewAs` is UX convenience only; Board/transition APIs lack server-side RBAC | Phase 5 | Anyone who can hit APIs can perform governance actions | 6 | Critical | Open — Phase 6 / SD-7 | 2026-07-21 |
| TD-015 | Board uses browser `prompt()` for Defer/Reject/Pause/Assign reasons | Phase 5 interim UX | Weak customer-validation UX | 5 polish / 6 | Low | Open — replace with inline forms before broad customer demos | 2026-07-21 |
