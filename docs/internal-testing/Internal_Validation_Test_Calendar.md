# IAM Version 1.5 — Internal Validation Test Calendar (Two Weeks)

| Field | Value |
|-------|--------|
| **Document** | Test-cycle calendar |
| **Recommended duration** | 10 business days |
| **Proposed window** | **Week A: 2026-07-22 – 2026-07-25** · **Week B: 2026-07-28 – 2026-07-31** (adjust if PO shifts start) |
| **Execution start** | **Only after Project Owner authorizes scenario execution** |
| **Daily sync** | 15 minutes (start of day) |

*If PO authorizes on a later date, shift this calendar forward keeping the same day structure.*

---

## Week A — Setup confirmation + core data / Board

| Day | Date (proposed) | Focus | Scenarios | Owner role |
|-----|-----------------|-------|-----------|------------|
| 0 | Before Day 1 | PO authorizes execution; Facilitator dry-runs DB reset; switch to `iam-internal-validation.db` | — | Facilitator + PO |
| 1 | Tue 7/22 | Smoke + onboarding + valid dataset | IT-01, IT-02 | Exec + Ops |
| 2 | Wed 7/23 | Partial / invalid / empty | IT-03, IT-04, IT-05 | Ops |
| 3 | Thu 7/24 | OEC / Pause / Defer | IT-06, IT-07, IT-08 | Exec + Ops |
| 4 | Fri 7/25 | Aging / Reject / Progress | IT-09, IT-10, IT-11 | Exec + Owner persona |
| — | Weekend | Optional defect triage only | — | Facilitator |

## Week B — Meeting, roles, browsers, recovery, close

| Day | Date (proposed) | Focus | Scenarios | Owner role |
|-----|-----------------|-------|-----------|------------|
| 5 | Mon 7/28 | Weekly management meeting (timed) | IT-12 | Exec + PO observe |
| 6 | Tue 7/29 | Multi-role + browsers | IT-13, IT-14 | All |
| 7 | Wed 7/30 | Export/archive + failure/recovery | IT-15, IT-16 | Ops + Facilitator |
| 8 | Thu 7/31 | Retest open defects; re-run automated suites | Regression | Facilitator |
| 9 | Fri 8/01 | Exit package draft; PO Exit review (if ready) | Exit Checklist | PO + Facilitator |

---

## Mandatory Pass before Exit (any day, must be green)

- IT-06 OEC  
- IT-07 Paused ≠ OEC  
- IT-08 Deferred  
- IT-09 Aging advisory only  
- IT-12 Weekly meeting workflow  

---

## Calendar risks

| Risk | Mitigation |
|------|------------|
| PO start delayed | Shift Week A/B intact |
| Tester names not assigned | **Blocks Day 1** — PO action |
| Reset dry-run not done | Facilitator completes Day 0 |
| Dataset typo filename confusion | Use frozen pack only; follow Frozen Dataset Pack doc |
