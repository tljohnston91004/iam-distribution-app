# IAM Actions Revised Scoring — Completion, Exception, and Gap Report

| Field | Value |
| --- | --- |
| **Date** | 2026-07-24 |
| **Controlling instruction** | IAM Actions Revised Scoring and Ranking Cursor Implementation Instruction v1.0 |
| **Product** | Existing Inventory Action Manager (`iam-distribution-app`) — **not** a separate IAM 2 app |
| **Pre-build** | [`IAM_Actions_Revised_Scoring_Pre_Build_Review.md`](./IAM_Actions_Revised_Scoring_Pre_Build_Review.md) |

---

## 1. Implementation summary

Implemented Stage 1–3 of the revised Decision Priority scoring architecture **inside** the existing IAM application:

- Version-controlled 100-point factor configuration (`revised_v1_decision_priority`)
- Pure calculator: cash / profitability / exposure ratio bands, risk/customer/time/actionability points, confidence multipliers, modifier caps, priority bands, Emergency Tests A–E (review candidate only — **not** auto-confirmed), structured tie-breakers
- Scoring service attempts revised model when company denominators + net scoreable cash exist; otherwise records a **calculation exception** and retains interim Board `priorityScore` (no fabricated revised score)
- Additive Prisma fields on `Company` and `FinancialImpact`
- Detail UI surfaces revised structured explanation or exception
- Automated calculation tests: `npm run test:revised-scoring` (**28/28**)
- Regression: `npm run test:phase4-scoring` (**14/14**)

Preserved: Inbound Port, unified ingestion, lifecycle/governance core, OEC presentation, Holdover lane, Prescribed Action Plan, no-auto-execution.

---

## 2. Retained components

Inbound Port / ADR-IAM-001 · unified ingestion · Recommendation lifecycle · Defer/Reject governance · OEC Active Priorities presentation · Holdover as presentation lane · Decision Board / Trust Pyramid · Prescribed Action Plan · interim profile readable on historical rows · soft viewAs (until Phase 6 RBAC).

---

## 3. Modified components

| Component | Change |
| --- | --- |
| `scoring/score.ts` | Dual path: revised when possible; interim fallback |
| `scoring/run.ts` | Loads company denominators + FinancialImpact; stamps profile id |
| `scoring/types.ts` | `revisedScore` / `authoritativeProfile` on explainability |
| `RecommendationDetailClient` | Shows revised explanation or exception |
| `prisma/schema.prisma` | Additive Company + FinancialImpact fields |

---

## 4. New components

| Path | Role |
| --- | --- |
| `src/lib/iam/scoring/revised/config.ts` | Versioned thresholds / weights |
| `…/bands.ts` | Ratio/time/band helpers |
| `…/calculate.ts` | Full score sequence |
| `…/emergency.ts` | Tests A–E |
| `…/tie-break.ts` | Ordered tie resolution |
| `scripts/run-revised-scoring-tests.ts` | §37 calculation suite |
| Pre-build + this completion report | Required Cursor reports |

---

## 5. Database changes (additive)

| Object | Fields |
| --- | --- |
| `companies` | `trailing_52_week_revenue`, `trailing_12_month_gross_profit`, `total_inventory_book_value` |
| `financial_impacts` | `net_scoreable_13_week_cash`, `net_scoreable_profitability`, `estimation_method`, `impact_period` |

Applied via `prisma db push`. No destructive migration. Rollback = ignore new columns + revert scorer wiring.

---

## 6. Requirement traceability (implemented vs deferred)

| Instruction area | Status |
| --- | --- |
| §7–§15 Factor model, confidence, modifiers, bands | **Implemented** (calc + config) |
| §16 Tie-breakers | **Implemented** (engine + test) |
| §17 Emergency A–E | **Implemented** (flag only; no auto-confirm) |
| §8 Net vs book value | **Enforced** (exception if net missing) |
| §18 Top 2 ≥ 70 | **Deferred** — conflict with OEC (C-1) |
| §19 Emergency Priority publish | **Deferred** (evaluation only) |
| §20–§24 Rank lock / suppress / override UX | **Deferred** |
| §25 Request Discussion | **Deferred** (Accept exists) |
| §6 Eligibility outcomes + 80% duplicate attach | **Deferred** |
| §32 Config admin UI / DB version table | **Partial** (code constant version; no admin UI) |
| §38 Full workflow E2E A–E | **Partial** (calc tests only) |
| §39 Weekly Decision View Top 1/2 labels | **Deferred** (OEC labels retained) |
| §40 Immutable ranking snapshot table | **Deferred** |

---

## 7. Test results

| Suite | Result |
| --- | --- |
| `test:revised-scoring` | **28/28 PASS** |
| `test:phase4-scoring` | **14/14 PASS** |

Not yet run as a full §38 workflow acceptance pack (see gaps).

---

## 8. Exceptions and gaps

### Exceptions (by design / reported conflicts)

1. **C-1 Top 2≥70 vs OEC** — OEC presentation unchanged pending PO reconciliation.
2. **C-2 / C-3** — Without company denominators **and** `FinancialImpact.netScoreable13WeekCash`, revised score is a **calculation exception**; Board continues on interim profile.
3. **Discovery still uses continuous cashImpactScore** — discovery ranking not yet migrated to revised factors (Board authoritative path is).
4. **Signal→level heuristics** (`mapDiscoverySignalsToLevels`) — documented technical mapping, not a new business policy; PO may replace with explicit assessments.

### Gaps (authorized next work)

| Gap | Needed |
| --- | --- |
| G-1 | PO decision: Top 2≥70 vs OEC Active Priorities |
| G-2 | Admin UX to set company denominators |
| G-3 | Capture net scoreable cash/profit on Recommendations (not book value) |
| G-4 | Eligibility outcomes matrix + 80% scope duplicate attach |
| G-5 | Request Discussion lifecycle action |
| G-6 | Rank lock, temporary suppression, override ranges with audit |
| G-7 | Emergency Priority management confirmation + publish (≤1) |
| G-8 | Immutable weekly Ranking Snapshot table |
| G-9 | Config Administration UI + DB `ScoringConfigVersion` rows |
| G-10 | Full §37–§38 workflow automated suite |
| G-11 | Permissions Phase 6 (Auditor vs Executive) |

---

## 9. Recommended next steps (PO)

1. Accept or revise Pre-Build conflict **C-1** (Top 2 vs OEC).
2. Provide or authorize entry of company denominators + net scoreable cash methodology (do **not** treat inventory BV as recoverable cash).
3. Authorize Stage 4–7 (eligibility/duplicate, governance locks, Emergency publish, snapshots).
4. Resume Internal Validation only after scoring stage acceptance (separate from prior PAP pause if still open).

---

## 10. Prohibited decisions respected

No second IAM app · no silent weight changes · no auto-confirm Emergency · no auto-execution · no owner decline · no Holdover as mandatory LS · no delete of history · interim retained for transitional Board continuity when revised cannot score.
