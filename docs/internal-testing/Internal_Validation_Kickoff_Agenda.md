# IAM Version 1.5 — Internal Validation Kickoff Agenda

| Field | Value |
|-------|--------|
| **Document** | Internal Validation Kickoff Agenda |
| **Product / stage** | IAM Version 1.5 — Internal Validation |
| **Standard alignment** | DPVS Final v1.0 (pre–Design Partner); reusable for future Decision Priority modules |
| **Date** | 2026-07-21 |
| **Status** | Approved process document — use at kickoff when Project Owner initiates testing |

---

## Meeting purpose

Align all Internal Validation participants on purpose, scope, success/exit criteria, defect handling, communication, schedule, and roles **before** executing IT-01 through IT-22.

**Duration:** 30–45 minutes  
**When:** Immediately before Day 1 scenario execution (or Day 0)

---

## 1. Purpose of the validation

| Goal | Description |
|------|-------------|
| Prove readiness | Confirm the V1.5 / EEP **Decision Board** path works end-to-end in an isolated environment |
| Find defects early | Capture and triage issues before any Design Partner engagement |
| Validate policy rules | OEC, Paused ≠ OEC, Deferred, aging advisory-only, Trust Pyramid, primary CTA |
| Produce exit evidence | Complete execution log, defect log, and Final Test Report for PO decision on Design Partner Validation |

Internal Validation is **not** Design Partner Validation and **not** a commercial release gate by itself.

---

## 2. Scope of testing

**In scope**
- IAM Version 1.5 / EEP **Decision Board** experience only  
- Review Cycles, Keystroke (frozen pack) upload → merge → Calculate · Score · Present  
- Active Priorities, Waiting, WIP/Holdover, Deferred, Recently Completed  
- Soft viewAs personas: Executive / Operations / Owner  
- Scenarios **IT-01 through IT-22** (includes unified ingestion IT-17…IT-22)  
- Isolated SQLite Internal Validation database  

**Primary surfaces:** `/`, `/runs/new`, `/runs/[runId]`, recommendation detail, My Assigned / Archive as needed for Board workflows  

---

## 3. Out-of-scope items

| Out of scope | Notes |
|--------------|--------|
| Legacy Action workflow pages | Do not test as source of truth (L-ACTION-01) |
| Design Partner customer engagement | Separate stage under DPVS |
| New product functionality | No feature adds during this cycle |
| Phase 6 / full RBAC / IdP | Soft viewAs only (L-ACCESS-01) |
| Emergency auto-assignment | Stub accepted (L-EMERGENCY-01) |
| UnlockCycle | Not implemented (L-UNLOCK-01) |
| Full Outcome Validation comparable UI | Partial accepted (L-OV-01) |
| Commercial a11y audit | Baseline only (L-A11Y-01) |
| Interim scoring formula changes | L-SCORE-01 — test as labeled, do not retune |

**Important:** Accepted Internal Validation limitations are **not** automatically acceptable for Design Partner Validation, Limited Commercial Release, or General Commercial Availability.

---

## 4. Success criteria (cycle)

| Criterion | Target |
|-----------|--------|
| Scenario coverage | ≥90% of IT-01…IT-22 executed |
| Mandatory passes | IT-06, IT-07, IT-08, IT-09, IT-12 = **Pass** |
| Blockers | Zero open Blockers at Exit |
| High severity | All S1 closed; S2 closed or PO-waived |
| Automation | Phase suites re-run green after final fixes |
| Scope discipline | Decision Board path only; no legacy Action testing |

---

## 5. Exit criteria (advance toward Design Partner Validation)

See [`Internal_Testing_Entry_and_Exit_Checklist.md`](./Internal_Testing_Entry_and_Exit_Checklist.md) Section B.

Minimum package for PO decision:
1. Completed Execution Log  
2. Defect log (no open Blockers)  
3. Post-fix automated suite snapshot  
4. Completed **Internal Validation Final Test Report** with recommendation  
5. Signed Exit Checklist  

PO then chooses: Ready / Ready with Conditions / Not Ready for Design Partner Validation.

---

## 6. Defect reporting process

| Step | Action |
|------|--------|
| 1 | Log same day in [`Internal_Defect_Log_IV_Cycle_2026-07-21.md`](./Internal_Defect_Log_IV_Cycle_2026-07-21.md) |
| 2 | Use severity S1–S4 per Defect Log Template |
| 3 | Mark Blocking Y/N; link Scenario ID (IT-xx) |
| 4 | Facilitator triages daily; S1 escalated same day to Project Owner |
| 5 | Retest after fix; S1/S2 require suite or neighbor regression |
| 6 | S2 Waive for Exit = **Project Owner only**; S1 cannot be waived for DP Exit |

Do **not** log accepted limitations (L-*) as defects unless behavior is worse than the accepted limitation.

---

## 7. Daily communication process

| Cadence | Forum | Owner |
|---------|-------|--------|
| Daily | 15-min stand-up (blockers, today’s scenarios, new defects) | Facilitator role |
| Same day | Defect log updates | Discovering tester role |
| End of day | Execution Log updated | Facilitator role |
| As needed | S1 escalation to Project Owner | Facilitator role |

---

## 8. Testing schedule

| Item | Reference |
|------|-----------|
| Duration | ~10 business days (2 weeks) |
| Calendar | [`Internal_Validation_Test_Calendar.md`](./Internal_Validation_Test_Calendar.md) |
| Start | When Project Owner initiates testing (calendar may shift) |
| Day 0 | Env reset dry-run; point `.env` at Internal Validation DB |
| Days 1–4 | Core data + Board policy scenarios |
| Days 5–7 | Meeting, roles, browsers, recovery |
| Days 8–9 | Retest, regression suites, Final Test Report draft |
| Close | Exit Checklist + PO recommendation |

---

## 9. Roles and responsibilities

Assignments are **by role** (reusable for future Decision Priority modules). Individual names are optional and not required in this package.

| Role | Responsibilities |
|------|------------------|
| **Executive tester** | Onboarding, OEC/Pause/Defer/Aging, weekly meeting (IT-01, IT-06–IT-10, IT-12, IT-13 Exec) |
| **Operations / data tester** | Frozen pack upload, partial/invalid/empty data, calculate, export, unified ingestion configs (IT-02–IT-05, IT-15–IT-22) |
| **Project Owner tester** | Authority, kickoff/exit decisions, S2 waivers, meeting observation, Final Report recommendation |
| **Testing facilitator** | Env Spec, dataset integrity, suite snapshots, defect log hygiene, calendar, daily sync (may combine with Ops) |

Detail: [`Internal_Testing_Roles_and_Responsibilities.md`](./Internal_Testing_Roles_and_Responsibilities.md) · [`Internal_Validation_Tester_Assignments.md`](./Internal_Validation_Tester_Assignments.md)

---

## Kickoff checklist (complete in meeting)

- [ ] Purpose and stage boundaries understood  
- [ ] Scope / out-of-scope confirmed (Decision Board only)  
- [ ] Limitations L-* acknowledged as Internal-only  
- [ ] Defect and daily comms process confirmed  
- [ ] Calendar / Day 0 env steps confirmed  
- [ ] Roles covered (who acts in each role this cycle — informal, not filed as named assignments)  
- [ ] Project Owner confirms **initiate testing**  

**Project Owner initiates testing:** ☐ Yes · Date: ________  

---

## Explicit stop

Kickoff Agenda ready. Execution begins only when Project Owner initiates testing.
