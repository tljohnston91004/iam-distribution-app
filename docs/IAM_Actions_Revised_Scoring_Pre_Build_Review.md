# IAM Actions Revised Scoring and Ranking — Pre-Build Code Review

| Field | Value |
| --- | --- |
| **Date** | 2026-07-24 |
| **Controlling instruction** | IAM Actions Revised Scoring and Ranking Cursor Implementation Instruction v1.0 |
| **Product** | Inventory Action Manager (existing `iam-distribution-app`) — **not** a separate IAM 2 app |
| **Status** | Pre-build complete → staged implementation of clear items |

---

## 5.1 Existing Architecture Summary

### Technology and layers

| Layer | Current |
| --- | --- |
| App | Next.js 15 (App Router) + React 19 + TypeScript |
| DB | SQLite via Prisma (`IamRun` = Review Cycle) |
| Ingestion | Unified Evidence Package → Inbound Port → reconcile → Approve → Calculate (ADR-IAM-001) |
| Discovery | `engine/ranking.ts`, `engine/segments.ts`, Prescribed Action Plan (`actions/playbook.ts`) |
| Scoring | Phase 4 interim profile `interim_v1_cash_led` (`scoring/score.ts`, `scoring/profile.ts`) |
| Presentation | OEC Active Priorities / Waiting / Holdover / Deferred (`presentation/assign.ts`) |
| Lifecycle | IAM-007B LS + governance Defer/Reject (`lifecycle/engine.ts`) |
| Board UX | `DecisionBoard`, `RecommendationCard`, Trust Pyramid, PAP detail |

### Workflow / data relationships (simplified)

Company → IamRun (Review Cycle) → EvidenceBatch / InventorySnapshot / DemandHistory → Recommendation (primary) → Assignment / Contributors / GovernanceDecision / WorkflowEvent / FinancialImpact.

Legacy `Action` / `ActionCandidate` retained; Board is Recommendation-centric.

### Current scoring / ranking behavior

1. **Discovery composite** (candidate identification): V1 weights cash 0.45 / service 0.35 / inventory 0.12 / actionability 0.08 (`constants.ts`, `ranking.ts`, `segments.ts`). Cash dollars mapped via continuous `cashImpactScore()` (0–100), not ratio bands.
2. **Authoritative Board score**: interim profile — cash/service/inventory renormalized; **actionability sequencing-only**; confidence soft narrative; no suppress-by-confidence.
3. **Presentation**: promote up to **OEC** slots by cash then priorityScore — **not** “Top 2 with Final Score ≥ 70”.
4. **Emergency**: stubbed (SD-2); lane exists, auto-assignment off.

### Permissions / audit

Soft `viewAs` personas (executive / operations / owner). No full RBAC matrix (Phase 6). Append-only workflow/governance/audit events. Cycle lock blocks governed transitions.

---

## 5.2 Requirement → code mapping (major items)

| Requirement | Existing component | Current behavior | Required change | Migration | Testing |
| --- | --- | --- | --- | --- | --- |
| 7-factor / 100-pt model | `scoring/profile.ts`, `score.ts` | 3-factor interim composite | **Create** versioned revised config + calculator; stamp profile id on Recommendations | Additive; retain interim id for history | Boundary tests §37 |
| Cash Impact ratio bands | `impact-score.ts` | Continuous $→0–100 | **Replace** authoritative cash factor with ratio bands; store gross/net/method | Company AWR field; backfill cautious | Exact threshold tests |
| Profitability / Exposure | — | Missing | **Create** factors + denominators | Company GP + total inventory BV | Ratio band tests |
| Risk / Customer / Time / Actionability points | partial service risk 0–100 | Different scale | **Modify** scoring inputs to discrete tables | Map discovery signals → levels | Level mapping tests |
| Confidence multipliers 1.00/0.95/0.85 | soft narrative | Different | **Modify** apply multiplier to base | Map Insufficient → not normally rankable | Medium/Low/Insufficient |
| Modifiers / penalties ±15 caps | — | Missing | **Create** (defaults 0 until evidence) | Additive JSON on score | Cap tests |
| Sequence §14 + bands §15 | — | Single priorityScore | **Extend** explainability + band | Additive fields/JSON | Band boundaries |
| Tie-breakers §16 | cash then score | Partial | **Create** ordered tie-break recorder | Snapshot in explainability | Cash + 13w cash ties |
| Emergency tests A–E | SD-2 stub | None auto | **Create** evaluation; **do not** auto-confirm | Emergency Review candidate flag | A–E unit tests |
| Top 2 ≥ 70 | OEC Active Priorities | OEC N, no 70 floor | **Conflict** — see §5.3 | Do not silently drop OEC | Workflow A gated |
| Duplicate / 80% overlap attach | opportunityKey / SD-17 | Key-based, not 80% scope | **Create** overlap matcher (later stage) | — | Workflow E |
| Eligibility outcomes | soft readiness | Incomplete set | **Extend** eligibility module | Additive status | Eligibility matrix |
| Rank lock / suppression / override ranges | Defer/Reject only | Partial governance | **Extend** governance (later) | Additive tables | §37 governance |
| Assignment Accept / Request Discussion | Accept only | No Request Discussion | **Extend** lifecycle action | Additive | Workflow A |
| Holdover as lane not LS | presentation `holdover` | Aligned with approved reconciliation | **Retain** | — | EEP tests |
| Config version control §32 | profile id string | No version table | **Create** ScoringConfigVersion | Additive | Immutability |
| Explainability from structured values | Trust Pyramid + PAP | Partial factor breakdown | **Extend** structured explanation builder | — | Explanation accuracy |
| No auto-execution | current | Aligned | **Retain** | — | — |
| Prescribed Action Plan | `actions/playbook.ts` | Required content | **Retain** (Appendix A notes deeper playbooks later) | — | PAP tests |

---

## 5.3 Conflict report

### C-1 — Top 2 (≥70) vs OEC Active Priorities (EEP)

| | |
| --- | --- |
| **A** | Instruction §18: Top 2; Final Score ≥ 70; do not auto-fill below 70 |
| **B** | Approved EEP: OEC concurrent Active Priorities (often 2, configurable); cash-led promotion without 70 floor |
| **Current** | OEC presentation |
| **Consequence** | Changing silently breaks EEP Board capacity model |
| **Controlling interpretation (recommended)** | Keep OEC presentation until PO reconciles; implement revised **scores/bands** now; add **optional** ≥70 filter as config flag default **off** pending PO |
| **Treatment** | Report; do not change OEC in this stage |

### C-2 — Inventory book value as cash impact

| | |
| --- | --- |
| **A** | §8: inventory book value is **not** automatically recoverable cash; store gross/net/method |
| **B** | Current discovery uses inventory $ as `estimatedCashImpact` |
| **Recommended** | Treat current $ as **gross exposure**; net scoreable cash requires estimation method; apply Benefit Uncertainty when net unknown |
| **Treatment** | Revised scorer records method; does not invent recovery % |

### C-3 — Missing company denominators

| | |
| --- | --- |
| **A** | Ratios need AWR, T12M GP, total inventory BV |
| **B** | Company model lacks these fields |
| **Recommended** | Additive Company fields; if missing → **calculation exception** (no fabricated score) |
| **Treatment** | Migration + seed/admin; interim fallback stamped as transitional gap |

### C-4 — Owner Request Discussion

| | |
| --- | --- |
| **A** | Owner Accept or Request Discussion; cannot decline |
| **B** | Accept exists; Request Discussion missing; decline not present (OK) |
| **Treatment** | Gap — implement in governance stage; not invented here |

### C-5 — Duplicate 80% inventory-scope overlap

| | |
| --- | --- |
| **A** | Configurable 80% overlap → attach to active action |
| **B** | SD-17 opportunity key / source identity only |
| **Treatment** | Gap — create matcher in later stage; report |

### Already-approved reconciliations (not reopened)

Top 2 wording vs singular; Emergency separate; Holdover lane; Rejected/Deferred governance; no recreate assigned work; completed immutable; cash leads; owner cannot decline; no auto-assign/execute; IAM standalone.

---

## Database / migration approach

1. Inventory current Prisma models (Recommendation, GovernanceDecision, Company, FinancialImpact, …).
2. **Prefer additive migrations** (`prisma db push` / migrate):
   - Company: `trailing52WeekRevenue`, `trailing12MonthGrossProfit`, `totalInventoryBookValue` (nullable).
   - Optional later: `ScoringConfigVersion`, `RankingSnapshot`, eligibility/override tables.
3. Stamp `scoringProfileId = revised_v1_decision_priority` + full breakdown in `explainabilityJson`.
4. Preserve Recommendation IDs and published explainability history.
5. No destructive drops; interim profile remains readable on old rows.
6. Rollback: revert scorer wiring to interim; leave additive columns.

---

## Staged implementation plan

| Stage | Scope | Status |
| --- | --- | --- |
| **0** | Pre-build review (this doc) | Done |
| **1** | Versioned revised scoring config + pure calculator + §37 calc tests | Implementing |
| **2** | Wire scoring service; Company denominators; exception path | Implementing |
| **3** | Emergency test evaluation (flag only; no auto-confirm) | Implementing (calc) |
| **4** | Eligibility outcomes + duplicate 80% attach | Deferred (gap) |
| **5** | Top 2≥70 vs OEC PO decision; presentation | Deferred (conflict C-1) |
| **6** | Rank lock / suppression / override ranges / Request Discussion | Deferred |
| **7** | Ranking snapshot immutability + config admin UI | Deferred |
| **8** | Full §38 workflow suite + completion report | Partial with Stage 1–3 |

---

## Components classification (summary)

| Class | Examples |
| --- | --- |
| **Retain** | Inbound Port, unified ingestion, lifecycle core, Holdover lane, Board shell, PAP, no-auto-execution, ADR-IAM-001 |
| **Modify** | `scoring/score.ts`, `scoring/run.ts`, explainability merge, Trust story drivers |
| **Extend** | Company denominators, governance actions, eligibility |
| **Migrate** | Interim score history remains; new profile for new calculates |
| **Deprecate** | Soft use of continuous `cashImpactScore` as **authoritative** Board factor (keep for discovery until migrated) |
| **Replace** | Authoritative Board scoring formula (interim → revised config) |
| **Create** | `scoring/revised/*`, calculation tests, config version constant, completion/gap report |
