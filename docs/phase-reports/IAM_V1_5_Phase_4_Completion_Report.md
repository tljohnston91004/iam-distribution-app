# IAM Version 1.5 — Phase 4 Completion Report

| Field | Value |
|-------|--------|
| **Phase** | 4 — Scoring and presentation separation |
| **Authorization** | Project Owner, 2026-07-21 |
| **Report date** | 2026-07-21 |
| **Prepared by** | Cursor (implementation agent) |
| **Completion Approved by Project Owner** | **Yes — Project Owner** |
| **Completion Date** | **2026-07-21** |
| **Phase 5** | Separately authorized 2026-07-21 (see Authorization Register) |

---

## 1. Deliverables completed

| Deliverable | Status | Notes |
|-------------|--------|-------|
| Scoring service reads canonical evidence + Recommendations only | Done | `src/lib/iam/scoring/` — no adapter imports |
| Actionability rehomed per SD-14 default | Done | Excluded from composite; sequencing/tie-break only |
| Persist score breakdown + explainability narrative | Done | `explainabilityJson` + `priorityScore` / `scoringProfileId` columns |
| Presentation service: Top 2, Holdover, Managed Backlog, Emergency | Done | Top 2 / Holdover / Backlog live; Emergency stubbed (SD-2) |
| Interim evidence-generated candidates clearly flagged | Done | `generationPath: interim_evidence` + explainability flags |
| Prefer module Recommendations when present (SD-17) | Done | Port upsert unchanged; scored set includes module + interim; no duplicate interim |
| Board categories independent of lifecycle mutation | Done | Presentation never writes `lifecycleState` |
| Interim scoring profile labeled (SD-1 / A-005) | Done | `interim_v1_cash_led` stamped on every scored row |

---

## 2. Scoring, ranking, and presentation functionality

### Scoring (`src/lib/iam/scoring/`)

- **Profile:** `interim_v1_cash_led` — cash-led interim weights (A-005 waiver while SD-1 open).
- **Composite inputs:** cash impact, service/operational risk, inventory condition (renormalized; actionability **not** included).
- **Confidence:** soft factor + narrative only; **no confidence-only suppression** from ranking.
- **Actionability:** sequencing score only (tie-break); SD-14 remains Open for final policy.
- **Persistence:** `Recommendation.priorityScore`, `scoringProfileId`, structured `explainabilityJson` (breakdown + narrative inputs + profile stamp).
- **API orchestration:** `scoreReviewCycle(iamRunId)` scores all Recommendations on the cycle.

### Ranking

- All Recommendations on the Review Cycle are ranked by `priorityScore` (desc), then actionability sequencing, then id.
- Calculate candidate discovery no longer drops suppressed rows before Port upsert (`rankAllPriorityCandidates`).

### Presentation (`src/lib/iam/presentation/`)

| Lane | Rule |
|------|------|
| **top_2** | Top `FEATURED_PRIORITY_COUNT` (2) among competitors by score |
| **managed_backlog** | Remaining competitors |
| **holdover** | Open execution lifecycle (Approved → Outcome Validation) — Board lane only |
| **deferred** | Active Defer governance — visible Deferred section; **does not compete for Top 2** (V1.5 product rule) |
| **emergency** | **Not auto-assigned** until SD-2 (`EMERGENCY_ASSIGNMENT_ENABLED = false`) |
| **completed_presentation / archived_history** | Preserved across re-assign |

`assignPresentation` and `scoreAndPresentReviewCycle` never mutate lifecycle state. Reactivation (`reactivate_defer`) re-assigns lanes **without** recalculating Priority Score.

### Calculate pipeline

`runIamCalculatePipeline` now: identify interim candidates → Port upsert (SD-17) → **scoreAndPresentReviewCycle**.

---

## 3. Database / schema changes

| Change | Detail |
|--------|--------|
| `Recommendation.priorityScore` | `Float?` — authoritative Phase 4 score |
| `Recommendation.scoringProfileId` | `String?` — e.g. `interim_v1_cash_led` |
| Index | `@@index([iamRunId, priorityScore])` |

Applied via `npx prisma db push`.

---

## 4. API changes

| Method | Path | Purpose |
|--------|------|---------|
| GET | `/api/runs/[runId]/presentation` | Read Board presentation lanes |
| POST | `/api/runs/[runId]/presentation` | Re-score and re-assign presentation (no lifecycle writes) |
| POST | `/api/runs/[runId]/calculate` | Unchanged route; pipeline now returns `scoredCount`, `scoringProfileId`, `presentationLanes` |
| POST | `/api/recommendations/[id]/transition` `action=reactivate_defer` | Clear active Defer; restore Top 2 eligibility without rescoring |

---

## 5. Tests executed and results

| Suite | Result |
|-------|--------|
| `npm run test:phase4-scoring` | **14/14 PASS** (includes Deferred Presentation Rule) |
| `npm run test:phase1-inbound` | **8/8 PASS** (regression) |
| `npm run test:phase2-closure` | **9/9 PASS** (regression) |
| `npm run test:phase3-lifecycle` | **14/14 PASS** (regression) |
| `npm run test:phase3-closure` | **7/7 PASS** (regression) |

### Phase 4 case IDs

P4-PROFILE, P4-SD14, P4-NOSUPPRESS, P4-PERSIST, P4-TOP2, P4-HOLDOVER, P4-BACKLOG, P4-LS-INDEP, P4-INTERIM-FLAG, P4-MODULE, P4-PRESERVE, P4-SEP, **P4-DEFER-LANE**, **P4-DEFER-REACTIVATE**

---

## 6. New Specification Decisions / clarifications

**No new SD opened.** Product clarifications:

| ID | Disposition |
|----|-------------|
| **Q-014** | **Resolved** — V1.5 Deferred Presentation Rule (Project Owner 2026-07-21) |
| **Q-003** | **Partial** — Board presentation/reactivation defined; SD-3 auto-expiry timing still Open |
| **A-004** | Updated — `deferred` allowed presentation category |
| **Scoring Validation Report** | Accepted; interim profile `interim_v1_cash_led` approved for V1.5; Emergency defer accepted |

| SD | Phase 4 handling |
|----|------------------|
| **SD-1** | Remains Open — interim profile **approved for V1.5** under A-005 |
| **SD-2** | Remains Open — Emergency auto-assign disabled (accepted) |
| **SD-3** | Remains Open for auto return timing; presentation rule does **not** wait on SD-3 |
| **SD-14** | Remains Open — interim default: actionability = sequencing only |
| **SD-13** | Unchanged — presentation categories on Recommendation (A-004 includes `deferred`) |

---

## 7. New / updated technical debt

| ID | Disposition |
|----|-------------|
| **TD-004** | **Resolved for V1.5 Recommendation path** — scoring/presentation no longer suppress by confidence; legacy `rankNewPriorityCandidates` retain suppress for V1 unit fixtures only |
| **TD-005** | **Resolved for interim profile** — actionability removed from composite; sequencing-only until SD-14 closes |
| **TD-010** | Remains Open — Board UX still Action-bound (Phase 5) |
| **TD-011** | Remains Open — legacy Action workflow still callable |
| **TD-012** | Remains Open — UnlockCycle deferred |
| **TD-013** (new) | Emergency Priority auto-assignment deferred pending **SD-2** |

---

## 8. ADR-IAM-001 conformance

| Criterion | Result |
|-----------|--------|
| Scoring/presentation in Core only | **Pass** — no Keystroke/adapter imports in `scoring/` or `presentation/` |
| Scores from canonical evidence + Recommendations | **Pass** |
| Adapters do not write Board scores/lanes | **Pass** |
| No inbound/adapter/contract redesign | **Pass** — ADR freeze held |
| Interim evidence path labeled | **Pass** — `generationPath` + profile stamp |

---

## 9. Recommendation whether to authorize Phase 5

**Yes — recommend authorizing Phase 5** (Decision Board and role UX) after Project Owner sets Phase 4 **Completion Approved**.

Phase 5 should consume Recommendation presentation lanes (`top_2`, `holdover`, `deferred`, `managed_backlog`, …) and lifecycle APIs — not invent scoring in the UI.

**Phase 5 is not authorized by this report.**

---

## 10. Phase 4 product refinement — Deferred Presentation Rule (2026-07-21)

Project Owner accepted the Scoring Validation Report and approved interim scoring for V1.5. Directed Phase 4 refinement:

| Requirement | Implementation |
|-------------|----------------|
| Remain visible with Deferred status | `presentationCategory = deferred` |
| Retain Priority Score / evidence / audit | No rescoring on Defer; evidence and audit unchanged |
| Do not compete for Top 2 while Defer active | Excluded from Top 2 competitors in `assignPresentation` |
| Reactivate → normal ranking without recalculation | `reactivate_defer` → `ReactivateFromDefer` governance + lane re-assign; score retained |
| Does not wait on SD-3 | Q-014 resolved; SD-3 timing remains Open |

**Scoring and prioritization engine readiness for Phase 5:** **Fully Ready** (subject to Phase 4 Completion Approved).

---

## 11. Explicit stop

Phase 4 (including Deferred Presentation refinement) complete pending Project Owner **Completion Approved**.  
**Stopped.** Do not begin Phase 5 until separately authorized.
