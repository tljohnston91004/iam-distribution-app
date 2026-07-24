# IAM Version 1.5 — Internal Testing Roles and Responsibilities

| Field | Value |
|-------|--------|
| **Document** | Internal Testing Roles and Responsibilities |
| **Date** | 2026-07-21 |

---

## 1. Roles

| Role | Who (fill names) | Primary duties |
|------|------------------|----------------|
| **Project Owner** | | Approves Entry limitations; Waives S2; signs Exit to Design Partner Validation |
| **Test Facilitator / QA Lead** | | Env Spec, dataset pack, daily cadence, defect log hygiene, suite runs |
| **Executive Tester** | | IT-01, IT-12, Trust/OEC/meeting scenarios; soft viewAs Executive |
| **Operations / Data Tester** | | Upload/merge/calculate; IT-02–IT-05; data gaps |
| **Owner / Assignee Tester** | | Accept, progress, pause/resume; IT-11, IT-13 Owner path |
| **Recorder (optional)** | | Notes, screenshots, timed meeting observation |

One person may hold two roles except **Project Owner** should not be the sole executor of all scenarios.

---

## 2. RACI (summary)

| Activity | PO | Facilitator | Exec | Ops | Owner |
|----------|----|-------------|------|-----|-------|
| Env + dataset setup | I | A/R | C | C | I |
| Automated suite gate | I | A/R | I | I | I |
| Scenario execution | I | C | R | R | R |
| Defect severity call | C | A | C | C | C |
| S2 Waive | A | R (prep) | I | I | I |
| Exit sign-off | A | R | C | C | C |

R=Responsible A=Accountable C=Consulted I=Informed

---

## 3. Access model for internal testing

- Use soft **View as Executive / Operations / Owner** only.  
- Do not claim security testing coverage.  
- Record `performedBy` strings consistently in notes.  
- Limitation **L-ACCESS-01** remains accepted.

---

## 4. Communication

- Defects logged same day in Internal Defect Log.  
- Daily 15-min sync.  
- Escalation: S1 same day to Facilitator + PO.

---

## Explicit stop

Roles template only. Do not begin Design Partner testing.
