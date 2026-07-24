# IAM Version 1.5 — Internal Testing Entry Checklist (Completed for Setup)

| Field | Value |
|-------|--------|
| **Document** | Internal Testing Entry Checklist — setup completion record |
| **Cycle** | Internal Validation — IAM V1.5 / EEP Decision Board |
| **Date** | 2026-07-21 |
| **Authorization level** | PO approved **Ready for Internal Testing with Documented Limitations** |
| **Scenario execution** | **Not started** — awaiting separate PO authorization to begin IT-01…IT-16 |

---

## A. Entry criteria

| # | Criterion | Type | Status | Evidence |
|---|-----------|------|--------|----------|
| E1 | Isolated test environment specified | Must | **Met** | [`Internal_Validation_Environment_Spec.md`](./Internal_Validation_Environment_Spec.md) |
| E2 | Reset / restore procedure documented; dry-run once | Must | **Partial** | Procedure **documented**; physical dry-run **Pending Facilitator** (Day 0) |
| E3 | No production / customer data in use | Must | **Met** | Local SQLite only; no DP customer data |
| E4 | Frozen Internal Test Dataset Pack designated | Must | **Met** | [`Frozen_Internal_Test_Dataset_Pack.md`](./Frozen_Internal_Test_Dataset_Pack.md) + `samples/frozen-v1/` |
| E5 | Automated suites green on Entry day | Must | **Met** | [`artifacts/automated-suite-snapshot-2026-07-21.txt`](./artifacts/automated-suite-snapshot-2026-07-21.txt) — **85/85 PASS** |
| E6 | Accepted limitations acknowledged | Must | **Met** | PO acceptance 2026-07-21 (Internal Validation only) |
| E7 | Testers assigned (roles filled) | Must | **Met (role-based)** | Roles defined; **no named individuals required** — [`Internal_Validation_Tester_Assignments.md`](./Internal_Validation_Tester_Assignments.md) |
| E8 | Defect log opened | Must | **Met** | [`Internal_Defect_Log_IV_Cycle_2026-07-21.md`](./Internal_Defect_Log_IV_Cycle_2026-07-21.md) |
| E9 | Internal Test Plan / scenarios prepared | Must | **Met** | Plan + [`Internal_Test_Scenario_Pack_IT01_IT16.md`](./Internal_Test_Scenario_Pack_IT01_IT16.md) + Execution Log |
| E10 | No open Sev-1 Board E2E defects | Must | **Met** | Defect register empty; cycle log initialized with no S1 |

### Limitations accepted (Internal Validation only)

L-ACCESS-01 · L-SCORE-01 · L-EMERGENCY-01 · L-UNLOCK-01 · L-ACTION-01 · L-OV-01 · L-A11Y-01  

**Not** auto-accepted for Design Partner / Limited Commercial / GA.

### Approved scope

**Decision Board path only** (V1.5 / EEP). Legacy Action path excluded.

---

## Entry readiness decision (setup)

| Outcome | Status |
|---------|--------|
| **Setup complete enough to request PO authorization to execute** | **Yes** — with open items below |
| **Ready to execute scenarios without further PO action** | **No** — see incomplete items |

### Incomplete / requires Project Owner action (before or at initiate)

| # | Item | Owner |
|---|------|-------|
| 1 | **Initiate testing** when ready (Kickoff Agenda) | **Project Owner** |
| 2 | Facilitator completes **DB reset dry-run** + switch to validation DB (Day 0) | Facilitator role |
| 3 | Informally cover Executive / Ops / Facilitator roles at kickoff (names optional) | Project Owner / team |

**Named tester assignments are not required** for package completeness.

---

## Facilitator / PO sign-off blocks

**Facilitator (setup):** ________ **Date:** ________  

**Project Owner — authorize execution of IT-01…IT-16:** ☐ Authorized · ☐ Hold  

**PO signature:** ________ **Date:** ________  

---

## Explicit stop

Do **not** begin Design Partner Validation.  
Do **not** execute IT scenarios until PO checks **Authorized** above.
