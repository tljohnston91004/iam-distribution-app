# IAM Version 1.5 — Internal Testing Entry and Exit Checklist

| Field | Value |
|-------|--------|
| **Document** | Internal Testing Entry and Exit Checklist |
| **Date** | 2026-07-21 |
| **Authority** | Project Owner (exit to Design Partner Validation) |

---

## A. Entry criteria (before internal testing begins)

Mark **Met** / **Not met**. All Must items required.

| # | Criterion | Type | Status | Evidence |
|---|-----------|------|--------|----------|
| E1 | Isolated test environment specified (machine, DB path, port) | Must | | Env Spec |
| E2 | Reset / restore procedure documented and dry-run once | Must | | Env Spec |
| E3 | Confirmed no production / customer data in use | Must | | Sign-off |
| E4 | Frozen Internal Test Dataset Pack designated | Must | | Pack manifest |
| E5 | All `test:phase1` … `test:phase5a` suites green on Entry day | Must | | Console log / CI note |
| E6 | Accepted limitations L-ACCESS-01 … L-A11Y-01 acknowledged | Must | | This checklist |
| E7 | Testers assigned (roles filled) | Must | | RACI |
| E8 | Defect log template opened for this cycle | Must | | Defect log file |
| E9 | Internal Test Plan issued to testers | Must | | Plan |
| E10 | No open Sev-1 product defects against Board E2E path | Must | | Defect register |

**Entry decision:** Ready / Not ready  
**Facilitator:** ________ **Date:** ________  

---

## B. Exit criteria (Internal Validation → Design Partner Validation)

| # | Criterion | Type | Status | Evidence |
|---|-----------|------|--------|----------|
| X1 | ≥90% of Internal Test Plan scenarios executed | Must | | Execution log |
| X2 | All Critical/High defects Closed or Waived (PO) | Must | | Defect log |
| X3 | Zero open Blockers | Must | | Defect log |
| X4 | IT-06 OEC, IT-07 Paused≠OEC, IT-08 Deferred, IT-09 Aging advisory **Pass** | Must | | Execution log |
| X5 | IT-12 weekly meeting workflow **Pass** | Must | | Execution log |
| X6 | Automated suites re-run green after final fixes | Must | | Suite log |
| X7 | Lessons / limitations list for Design Partner kickoff filed | Must | | Short memo |
| X8 | Final Internal Testing Readiness Recommendation = Ready (or Ready with DP-acceptable limitations) | Must | | Recommendation doc |
| X9 | Project Owner approves advancement to Design Partner Validation | Must | | Signature below |

**Exit decision:**  

| Outcome | Meaning |
|---------|---------|
| **Advance to Design Partner Validation** | All Must Met |
| **Remain in Internal Validation** | Retest / fix |
| **Not ready for Design Partner** | Material gaps |

**Project Owner:** ________ **Date:** ________  

---

## Explicit stop

Checklist template only. Do not begin Design Partner testing until Exit signed.
