# IAM Version 1.5 — Internal Testing Readiness Assessment

| Field | Value |
|-------|--------|
| **Document** | Internal Testing Readiness Assessment |
| **Product** | IAM Version 1.5 |
| **Related standard** | DPVS Final v1.0 (Design Partner Validation Standard) |
| **Date** | 2026-07-21 |
| **Prepared by** | Cursor (readiness assessment) |
| **Code modified** | **None** |
| **Scope** | Structured **internal** testing readiness only — not Design Partner engagement |

---

## 1. Executive conclusion

### **Ready with Documented Limitations**

IAM Version 1.5 is ready to enter **structured internal testing** under documented limitations. There are **no confirmed Sev-1 product blockers** that prevent end-to-end Recommendation / Decision Board exercises on an isolated local/dev database.

Internal testing **must not** be treated as Design Partner Validation. Advancement to Design Partner Validation requires exit criteria in the Internal Testing Entry and Exit Checklist plus Project Owner approval.

---

## 2. Application readiness

| Area | Assessment | Notes |
|------|------------|-------|
| Core IAM workflows accessible | **Ready** | Runs, Keystroke upload/merge, Calculate · Score · Present, Decision Board, recommendation detail, My Assigned, Archive |
| Decision Board as designed (post-EEP) | **Ready** | Summary, Momentum, OEC, Decisions, Active Priorities, WIP/Holdover, Waiting, Deferred, Recently Completed |
| Active Priorities / Waiting / WIP / Deferred | **Ready** | Presentation service + Board lanes; automated coverage in phase4 / phase5a |
| Paused | **Ready (policy)** | Visible in Holdover; **does not consume OEC** (PO rule); covered in `test:phase5a-experience` |
| Completed / historical | **Ready (adequate)** | completed_presentation / archived_history preserved; Archive views exist; OV depth Partial |
| OEC rules | **Ready** | Company OEC config + audit; promotion ≤ available slots |
| Aging advisory only | **Ready** | `evaluateAgingAdvisory` — no auto-mutation |
| Trust Pyramid / primary CTA | **Ready** | Card + detail; inline forms on Board (EEP) |
| Emergency auto-assignment | **Accepted limitation** | Stubbed until SD-2 (TD-013) |

**Verdict:** Application surface is sufficient for internal testing of the approved V1.5 / EEP decision loop.

---

## 3. Data readiness

| Area | Assessment | Notes |
|------|------------|-------|
| Required inputs defined | **Ready** | Inventory + demand (Standard and/or Matrix); see Keystroke upload checklist |
| Test-data templates | **Partial → Ready with setup** | Keystroke samples expected under `C:\Keystrok` (or project fixtures); formal “template pack” should be copied into a controlled internal-test folder before kickoff |
| Sample/pilot load | **Ready** | Upload → merge → calculate path exists |
| Validation / mapping / gaps | **Ready for test** | Data gaps and readiness banners; confidence narrative discloses interim limits |
| Misleading incomplete data | **Ready with coaching** | Interim evidence badges; low confidence ranked not suppressed; testers must verify gaps are visible |

**Setup required:** Designate a frozen **Internal Test Dataset Pack** (inventory + demand files + expected SKU spot-checks) before week 1 of testing.

---

## 4. Workflow readiness

End-to-end path available for internal test:

**Data input → Evidence → Recommendations → Score/Present → Management Review → Approve/Defer/Reject → Assign → Accept → Active → Progress → Pause/Resume → Escalate → Complete → Outcome Validation → Archive**

| Check | Status |
|-------|--------|
| Role handoffs (Exec / Ops / Owner soft viewAs) | Testable; **not** real RBAC |
| Lifecycle vs IAM-007B / Defer-Reject governance | Aligned (Phases 3–5); automated suites exist |
| ADR-IAM-001 | Conforming — Keystroke via adapter → Port; Core governance not in adapter |
| Dual-path legacy Actions | **Accepted limitation** (TD-011) — internal testers instructed to use **Recommendation Board only** |

---

## 5. User and access readiness

| Need | Assessment |
|------|------------|
| Internal roles | Executive sponsor tester, Operations/data tester, Owner/assignee tester, Facilitator/recorder (may combine) |
| Current access controls | Soft `viewAs` + open APIs (TD-002, TD-014) |
| Sufficient for **internal** testing? | **Yes**, if environment is isolated and testers are trusted |
| RBAC limitations | **Accepted for internal testing**; **blocker for customer/Design Partner** unless disclosed and PO accepts Limited Commercial path later |
| Temporary acceptance | Document in Entry Checklist as limitation L-ACCESS-01 |

---

## 6. Testing environment

| Requirement | Assessment |
|-------------|------------|
| Isolated environment | **Can be established** — local Next.js + SQLite (`data/iam.db` or dedicated copy) |
| No production/customer data impact | **Yes**, if testers use a dedicated DB file / machine and never point at production |
| Setup | Node deps, `prisma db push`, `npm run dev` (port 3002), company/run seed, OEC defaults |
| Accounts/credentials | No real IdP — use soft viewAs personas; document performedBy strings |
| Reset | Delete/replace SQLite DB or delete test runs; re-seed company; re-upload dataset pack |

**Required before start:** Written **Internal Test Environment Spec** (machine, DB path, reset steps) signed by Facilitator.

---

## 7. Regression and technical readiness

### Automated suites (expected green before Entry)

| Suite | Focus |
|-------|--------|
| `test:phase1-inbound` | Port / contracts |
| `test:phase2-keystroke` / `test:phase2-closure` | Adapter → Port |
| `test:phase3-lifecycle` / `test:phase3-closure` | LS + governance |
| `test:phase4-scoring` | Scoring + presentation / Deferred |
| `test:phase5-board` | Board loader / lanes |
| `test:phase5a-experience` | OEC, Paused≠OEC, Trust, aging advisory |

### High-risk workflows with thinner automation

- Full UI weekly meeting under time pressure  
- Multi-browser / responsive layout  
- Export/report generation depth  
- Outcome Validation expected-vs-actual richness  
- Legacy Action pages if mistakenly used  
- Concurrent users on same SQLite file  

### Other technical notes

| Topic | Notes |
|-------|-------|
| Error handling | API errors surface on Board; prompt() largely removed on Board (TD-015 stale for Board — verify in smoke) |
| Logging | ChangeLog / AuditEvent / WorkflowEvent present |
| Performance | Adequate for pilot SKU volumes; not load-tested for enterprise |
| Persistence | SQLite — confirm backup before destructive reset |
| Known debt relevant to testing | TD-002/014 access; TD-011 dual path; TD-012 no UnlockCycle; TD-013 Emergency; SD-1 interim scoring |

---

## 8. Blockers vs accepted limitations

### Blockers (must clear before Entry) — **none product-code**

| ID | Item | Action |
|----|------|--------|
| B-ENV-01 | Isolated DB + reset procedure not yet written | Facilitator produces Env Spec |
| B-DATA-01 | Frozen Internal Test Dataset Pack not designated | Copy Keystroke samples + spot-check list |
| B-REG-01 | Full automated suite not re-run on Entry day | Run all `test:phase*` scripts; zero unexpected fails |

*No application code change is required to clear these blockers.*

### Accepted limitations (document at Entry)

| ID | Limitation |
|----|------------|
| L-ACCESS-01 | Soft viewAs; no server RBAC |
| L-SCORE-01 | Interim scoring profile `interim_v1_cash_led` (SD-1 open) |
| L-EMERGENCY-01 | Emergency auto-assign disabled (TD-013) |
| L-UNLOCK-01 | UnlockCycle not implemented (TD-012) |
| L-ACTION-01 | Legacy Action workflow still present — out of scope for internal Board tests |
| L-OV-01 | Outcome Validation comparable UI Partial |
| L-A11Y-01 | Accessibility baseline only |

---

## 9. Recommended internal testing shape

| Item | Recommendation |
|------|----------------|
| **Duration** | **2 weeks** (10 business days): 3 days setup/smoke + 5 days scenario execution + 2 days defect triage/retest |
| **Testers** | **3–4 people:** (1) Executive persona, (2) Operations/data, (3) Owner/assignee, (4) optional Facilitator/QA recorder |
| **Cadence** | Daily stand-up 15 min; defect log updated same day |

---

## 10. Evidence for PO to advance to Design Partner Validation

See Exit Criteria checklist. Minimum package:

1. Signed Entry Checklist (limitations accepted)  
2. Completed Internal Test Plan scenarios (≥90% executed; all Critical/High passed or waived)  
3. Defect log with no open Blockers  
4. Automated suite green snapshot  
5. Internal Testing Readiness Recommendation → **Ready for Design Partner Validation** (or Ready with limitations explicitly accepted for DP kickoff)  
6. PO signature on Exit Checklist  

---

## Explicit stop

Assessment complete. **No application code modified.**  
Do not begin Design Partner testing.  
Awaiting Project Owner review.
