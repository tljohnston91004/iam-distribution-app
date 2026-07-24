# IAM Version 1.5 — Decision Flow Validation Report

| Field | Value |
|-------|--------|
| **Document title** | Decision Flow Validation Report |
| **Purpose** | Validate Phase 3 Recommendation lifecycle / governance implementation against **IAM-007B** and approved clarifications before Phase 4 authorization |
| **Date** | 2026-07-21 |
| **Prepared by** | Cursor (validation agent) |
| **Code modified** | **None** (read-only validation) |
| **Primary specification** | IAM-007B Lifecycle & State Transition Architecture v1.0 (Approved Development Baseline) |
| **Governing clarifications** | Deferred/Rejected = governance outcomes (not LS states); Holdover = Board lane (not LS state); SD-3/8/9 open (happy path only) |
| **Implementation under review** | `src/lib/iam/lifecycle/*`; APIs `/api/recommendations/[id]/transition`, `/api/runs/[runId]/cycle/lock` |
| **Test evidence** | `npm run test:phase3-lifecycle` — 14/14 PASS (Phase 3 Completion Report) |
| **Closure** | See [Addendum A](./IAM_V1_5_Decision_Flow_Validation_Report_Addendum_A.md) — DF-01/02/03 resolved; DF-04 deferred (2026-07-21) |

**Verdict scale:** Match · Match with approved clarification · Gap (documented / intentional) · Defect (should be corrected before relying on the path) · Not in scope (later phase / open SD)

> **Note:** Parent report was read-only at first publication. Phase 3 Closure corrections and updated conformance are recorded in **Addendum A**.

---

## 1. Executive verdict

| Question | Answer |
|----------|--------|
| Do LS-01–LS-11 state **names** match IAM-007B? | **Yes — exact match** |
| Do **legal LS edges** match IAM-007B §4 (as clarified)? | **Yes**, with Deferred/Rejected implemented as governance outcomes rather than LS targets (approved clarification) |
| Are **illegal LS transitions** rejected by the graph? | **Yes** (transition table + tests) |
| Are IAM-007B §5 **gates** implemented? | **Substantially yes** (approval before assignment; acceptance before Active; Pause/Escalate justification; OV before Archive; invalid rejected) |
| Are there **unreachable** LS states? | **No** |
| Are there **duplicate** operational paths? | **Yes — non-harmful** (documented below) |
| Are there **missing validations** or logging gaps? | **Yes — several** (documented; none invent new architecture) |
| Ready to authorize Phase 4 on lifecycle grounds? | **Conditionally yes** — core happy-path decision flow matches IAM-007B + clarifications; residual gaps are open SDs, RBAC (Phase 6), or minor defects that do not redesign ADR-IAM-001 |

**Overall Decision-Flow Conformance:** **~92%** for Phase 3 happy-path scope (exact LS catalog + legal graph + primary gates). Residual ~8% = rollback/emergency bypass not implemented, invalid-transition audit logging incomplete, pause/escalate pre-write side effect, UnlockCycle unimplemented, RBAC not enforced.

---

## 2. Lifecycle state catalog validation (IAM-007B §3)

| State ID | IAM-007B name | Implemented (`LIFECYCLE_STATES` / `LS`) | Verdict |
|----------|---------------|------------------------------------------|---------|
| LS-01 | Identified | Identified | **Match** |
| LS-02 | Management Review | Management Review | **Match** |
| LS-03 | Approved | Approved | **Match** |
| LS-04 | Assignment Pending | Assignment Pending | **Match** |
| LS-05 | Awaiting Acceptance | Awaiting Acceptance | **Match** |
| LS-06 | Active | Active | **Match** |
| LS-07 | Paused | Paused | **Match** |
| LS-08 | Escalated | Escalated | **Match** |
| LS-09 | Completed | Completed | **Match** |
| LS-10 | Outcome Validation | Outcome Validation | **Match** |
| LS-11 | Archived | Archived | **Match** |

**Forbidden as LS (approved clarifications / Implementation Plan):**

| Name | In LS catalog? | How handled | Verdict |
|------|----------------|-------------|---------|
| Deferred | No (`NON_LIFECYCLE_OUTCOMES`) | `GovernanceDecision` type `Defer` | **Match with approved clarification** |
| Rejected | No | `GovernanceDecision` type `Reject` | **Match with approved clarification** |
| Holdover | No | Presentation lane only; cycle lock does not set Holdover LS | **Match with approved clarification** |
| Featured | No | Presentation / legacy Action only | **Match with approved clarification** |

**Unreachable LS states:** None. Happy path reaches all eleven states (test `P3-HAPPY` / `P3-ESC-LS08`).

---

## 3. Legal transitions (IAM-007B §4 vs implementation)

### 3.1 Spec list vs code

| IAM-007B §4 transition | Implementation | Verdict |
|------------------------|----------------|---------|
| Identified → Management Review | `presentForReview` / edge in `LIFECYCLE_TRANSITIONS` | **Match** |
| Management Review → Approved | `approveRecommendation` | **Match** |
| Management Review → Deferred | `deferRecommendation` (governance; LS unchanged) | **Match with approved clarification** |
| Management Review → Rejected | `rejectRecommendation` (governance; LS unchanged; presentation updated) | **Match with approved clarification** |
| Approved → Assignment Pending | `startAssignment` or auto-step inside `assignPrimaryOwner` | **Match** |
| Assignment Pending → Awaiting Acceptance | `assignPrimaryOwner` (after assignment exists) / gated `transitionRecommendation` | **Match** |
| Awaiting Acceptance → Active | `acceptAssignment` (requires `accepted`) | **Match** |
| Active → Paused | `pauseRecommendation` | **Match** |
| Active → Escalated | `escalateRecommendation` | **Match** |
| Active → Completed | `completeRecommendation` | **Match** |
| Paused → Active | `resumeRecommendation` | **Match** |
| Escalated → Active | Allowed in graph; via `transitionRecommendation` or `resumeRecommendation` | **Match** (see duplicate-path note) |
| Escalated → Completed | `completeRecommendation` | **Match** |
| Completed → Outcome Validation | `startOutcomeValidation` | **Match** |
| Outcome Validation → Archived | `passOutcomeValidation` | **Match** |

### 3.2 Allowed adjacency matrix (implemented)

Only the cells marked **Y** are legal LS→LS moves:

| From \ To | Identified | Mgmt Review | Approved | Assign Pending | Await Accept | Active | Paused | Escalated | Completed | Outcome Val | Archived |
|-----------|:----------:|:-----------:|:--------:|:--------------:|:------------:|:------:|:------:|:---------:|:---------:|:-----------:|:--------:|
| Identified | | **Y** | | | | | | | | | |
| Management Review | | | **Y** | | | | | | | | |
| Approved | | | | **Y** | | | | | | | |
| Assignment Pending | | | | | **Y** | | | | | | |
| Awaiting Acceptance | | | | | | **Y** | | | | | |
| Active | | | | | | | **Y** | **Y** | **Y** | | |
| Paused | | | | | | **Y** | | | | | |
| Escalated | | | | | | **Y** | | | **Y** | | |
| Completed | | | | | | | | | | **Y** | |
| Outcome Validation | | | | | | | | | | | **Y** |
| Archived | | | | | | | | | | | |

All other LS→LS pairs are **blocked** by `assertLifecycleTransition` (`INVALID_TRANSITION`).

**Evidence:** `transitions.ts`; tests `P3-INVALID`, `P3-NO-OV`.

---

## 4. Blocked transitions (sample of critical illegal edges)

| Illegal attempt | Expected | Implemented | Test |
|-----------------|----------|-------------|------|
| Identified → Active | Reject | Reject | `P3-INVALID` |
| Completed → Archived (skip OV) | Reject | Reject | `P3-NO-OV` |
| Archived → Active | Reject | Reject (empty outbound set) | Graph (IAM-007B §6) |
| Management Review → Active | Reject | Reject | Graph |
| Active → Archived | Reject | Reject | Graph |
| Paused → Completed | Reject | Reject | Graph |
| Outcome Validation → Active | Reject | Reject | Graph |
| Any LS transition after Defer/Reject | Blocked this cycle | `GOVERNANCE_BLOCK` | `P3-DEFER-BLOCK` |
| Any LS transition when cycle Locked/Closed | Blocked | `CYCLE_LOCKED` | `P3-LOCK` |

**Verdict:** Critical illegal edges are rejected. Full 11×11 enumeration is covered by the adjacency table (only **Y** cells allowed).

---

## 5. Governance outcomes

| Outcome | Spec basis | Implemented behavior | Verdict |
|---------|------------|----------------------|---------|
| Approve | §4/§5 management approval before assignment | From Management Review only; `GovernanceDecision` Approve; LS → Approved | **Match** |
| Defer | §4 lists Deferred; clarifications = outcome not LS; §7 re-enter future cycles | Reason required; LS stays Management Review; blocks further LS this cycle; return timing **not** implemented (SD-3/Q-003) | **Match with approved clarification** + **Gap (SD-3)** |
| Reject | §4 lists Rejected; clarifications = outcome; §6 historical | Reason required; LS unchanged; presentation → `completed_presentation`; blocks further LS | **Match with approved clarification** |
| Pause | §5 justification; LS-07 | Reason + `approvedBy` required; LS → Paused; governance Pause | **Match** |
| Escalate | §5 justification; LS-08 | Reason required; LS → Escalated; governance Escalate | **Match** |
| Outcome Validation Pass | §5 OV before archival | Only from Outcome Validation → Archived | **Match** |
| Outcome Validation Fail / rework | § open SD-8 | **Not implemented** (happy path only) | **Gap (SD-8 / intentional Phase 3)** |

---

## 6. Assignment rules

| Rule (IAM-007B) | Implementation | Verdict |
|-----------------|----------------|---------|
| Management approval required before assignment | Assign only from Approved / Assignment Pending / Awaiting Acceptance (not from Identified or Management Review without Approve) | **Match** |
| Assignment Pending = awaiting owner | LS-04; advance to LS-05 only when active assignment exists | **Match** |
| Awaiting Acceptance = assigned, awaiting owner acceptance | LS-05; `RecommendationAssignment.accepted === false` until accept | **Match** |
| Primary Owner acceptance required before Active | Gate on LS-05 → LS-06 | **Match** (`P3-ACCEPT-GATE`) |
| Optional ownerUserId must match primary owner | Enforced when provided | **Match** |
| Contributors (1 Primary + 0..n) | `addContributor` upsert; Primary via assignment | **Match** (Phase 3 scope) |
| Assignment history | `RecommendationAssignmentHistory` on assign/accept | **Match** |

**Missing validation (minor):** empty `primaryOwnerUserId` is not explicitly rejected before create (API may pass `""`). **Defect (low)** — recommend guard before Phase 5 UX.

---

## 7. Pause / resume rules

| Rule | Implementation | Verdict |
|------|----------------|---------|
| Pause only from Active (graph) | Edge Active → Paused only | **Match** |
| Documented justification | `reason` required | **Match** (`P3-PAUSE-REQ`) |
| Approval | `approvedBy` required on `pauseRecommendation` | **Match** (stronger than bare §5 text; aligns with Implementation Plan “reason + approval”) |
| Resume Paused → Active | `resumeRecommendation` | **Match** |
| Pause from non-Active | Transition rejects | **Match**, with side-effect note below |

**Defect (medium-low):** `pauseRecommendation` / `escalateRecommendation` write `GovernanceDecision` **before** the LS transition succeeds. If called from the wrong state, a Pause/Escalate governance row can be created even though LS does not change. Invalid attempt is rejected but may leave a **spurious governance record**. Invalid attempts are also **not** always written to `AuditEvent` (see §11).

---

## 8. Escalation rules

| Rule | Implementation | Verdict |
|------|----------------|---------|
| Active → Escalated (LS-08) | `escalateRecommendation` | **Match** (`P3-ESC-LS08`) |
| Justification required | `reason` required | **Match** |
| Escalated → Active | Graph allows; callable via generic transition / `resumeRecommendation` | **Match** (naming overlap — see duplicates) |
| Escalated → Completed | `completeRecommendation` | **Match** |
| Escalate from non-Active | Rejected by graph | **Match** (same pre-write side effect as Pause) |

---

## 9. Review cycle rules

| Rule / design | Implementation | Verdict |
|---------------|----------------|---------|
| Close/lock Review Cycle without Holdover-as-state | `lockReviewCycle` sets `cycleStatus` Locked/Closed + lock metadata; does not set any Recommendation LS to Holdover | **Match** with clarifications (`P3-NO-HOLDOVER-LS`, `P3-LOCK`) |
| Locked/Closed blocks governed LS transitions | `assertCycleOpen` | **Match** |
| Unlock / reopen cycle | `UnlockCycle` appears in TypeScript union only; **no `unlockReviewCycle` implementation** | **Gap** |
| Legacy `closeWeeklyCycle` (Action Featured→Holdover) | Still present in V1 `workflow.ts` (TD-011); not part of Recommendation decision flow | **Compatibility debt** — not an IAM-007B Recommendation path |

---

## 10. Archive rules

| Rule (IAM-007B §5/§6) | Implementation | Verdict |
|-----------------------|----------------|---------|
| Outcome Validation required before archival | Only OV → Archived is legal; Completed → Archived illegal | **Match** (`P3-NO-OV`) |
| Archived cannot return to Active | Archived has no outbound edges | **Match** |
| Happy-path archive via OV pass | `passOutcomeValidation` | **Match** |
| OV failure / rework | Not implemented | **Gap (SD-8)** |

---

## 11. IAM-007B §5–§8 cross-check

| Spec rule | Status | Notes |
|-----------|--------|-------|
| §5 Management approval before assignment | **Match** | Approve gate |
| §5 Primary Owner acceptance before Active | **Match** | Accept gate |
| §5 Pause/Escalate documented justification | **Match** | Plus Pause `approvedBy` |
| §5 OV before archival | **Match** | |
| §5 Invalid transitions rejected **and logged** | **Partial** | Rejected via throw; **successful** transitions audited; **failed** transitions generally **not** persisted to `AuditEvent` / `WorkflowEvent` |
| §6 Rollback only when authorized | **Gap** | No management rollback API (except natural edges like Paused→Active, Escalated→Active) |
| §6 Rollback audited | **N/A** until rollback API exists | |
| §6 Archived cannot return to Active | **Match** | |
| §6 Rejected remain historical | **Match with clarification** | Reject outcome + presentation; LS not “Rejected” |
| §7 Emergency bypass sequencing | **Gap** | Not implemented (likely Phase 4/5 + SD-2) |
| §7 Deferred re-enter future cycles | **Gap (SD-3)** | Block-this-cycle only |
| §7 System errors must not silently change LS | **Match** | Failures throw; no silent LS mutate on error path (aside from governance pre-write defect) |
| §8 Only approved transitions allowed | **Match** for LS graph | |
| §8 Every transition audited | **Match** for successful LS transitions | |
| §8 Permissions enforced at each transition | **Gap** | Soft `performedBy` string only; real RBAC = Phase 6 / SD-7 |
| §8 Historical lifecycle preserved | **Match** | `WorkflowEvent` append-only |
| §8 Workflow tests pass | **Match** | 14/14 Phase 3 suite |

---

## 12. Unreachable states, duplicate paths, missing validations

### 12.1 Unreachable states

**None** among LS-01–LS-11.

### 12.2 Duplicate / overlapping paths (non-fatal)

| Paths | Observation | Risk |
|-------|-------------|------|
| `startAssignment` vs `assignPrimaryOwner` from Approved | Both can enter Assignment Pending; assign also auto-advances to Awaiting Acceptance | Low — convenience overlap |
| `resumeRecommendation` vs Escalated → Active | `resumeRecommendation` does not assert “from Paused”; it will also move Escalated → Active if that is current | Low — works; naming misleading |
| Raw `action: "transition"` API vs named actions | Generic edge walker vs governed wrappers | Medium if callers bypass wrappers and skip governance documents (e.g. raw Active→Paused without Pause governance) |

**Raw transition API risk (important):**  
`POST .../transition` with `action: "transition"` calls `transitionRecommendation` directly. That **enforces the LS graph and reason-for-Pause/Escalate**, but **does not** always create the corresponding `GovernanceDecision` that named actions create (Approve/Defer/Pause/Escalate/OV Pass).  
→ **Missing validation / governance completeness** if clients use the raw action.

### 12.3 Missing validations / defects (summary)

| ID | Finding | Severity | Recommendation (no code changed in this review) |
|----|---------|----------|--------------------------------------------------|
| DF-01 | Invalid transitions rejected but often **not audited/logged** | Medium | Persist AuditEvent on rejected attempts (IAM-007B §5) |
| DF-02 | Pause/Escalate write GovernanceDecision before LS success | Medium-Low | Move governance write after successful transition |
| DF-03 | Raw `transition` API can skip governance decision types | Medium | Restrict raw transition to admin/tests or require decisionType |
| DF-04 | `UnlockCycle` typed but unimplemented | Low | Implement unlock or remove from type union |
| DF-05 | Empty `primaryOwnerUserId` not guarded | Low | Reject blank owner id |
| DF-06 | SD-3 Defer return-to-review | Open SD | Do not invent; resolve SD-3 before relying on multi-cycle Defer |
| DF-07 | SD-8 OV failure path | Open SD | Do not invent; Phase 3 happy path only |
| DF-08 | Emergency bypass (§7) | Gap | Phase 4/5 + SD-2 |
| DF-09 | RBAC permissions per transition | Gap | Phase 6 / SD-7 |
| DF-10 | Legacy Action `closeWeeklyCycle` Holdover-as-state still exists | Debt (TD-011) | Do not use for V1.5 Recommendation authority |

### 12.4 Illegal transitions that remain correctly impossible

No evidence of illegal LS edges in `LIFECYCLE_TRANSITIONS`. No duplicate **illegal** path that sets Deferred/Rejected/Holdover/Featured as `lifecycleState`.

---

## 13. Evidence map (implementation artifacts)

| Concern | File / symbol |
|---------|----------------|
| State catalog | `src/lib/iam/lifecycle/states.ts` |
| Legal edges | `src/lib/iam/lifecycle/transitions.ts` → `LIFECYCLE_TRANSITIONS` |
| Gates, governance, cycle lock | `src/lib/iam/lifecycle/engine.ts` |
| HTTP surface | `src/app/api/recommendations/[id]/transition/route.ts` |
| Cycle lock HTTP | `src/app/api/runs/[runId]/cycle/lock/route.ts` |
| Automated proof | `scripts/run-phase3-lifecycle-tests.ts` |

---

## 14. Conformance scorecard

| Area | Rating |
|------|--------|
| Lifecycle states LS-01–LS-11 | **Match** |
| Legal LS transitions | **Match** (clarified Defer/Reject) |
| Blocked LS transitions | **Match** |
| Governance outcomes Approve/Defer/Reject | **Match with clarification** (+ SD-3 gap on re-entry) |
| Assignment / acceptance gates | **Match** |
| Pause / resume | **Match** (+ DF-02 side effect) |
| Escalation | **Match** (+ DF-02 / resume naming) |
| Review cycle lock | **Match** (+ Unlock gap DF-04) |
| Archive / OV | **Match** happy path (+ SD-8 gap) |
| Audit on success | **Match** |
| Audit/log on invalid | **Partial (DF-01)** |
| Permissions | **Gap (Phase 6)** |
| Rollback / emergency bypass | **Gap (spec §6–7; not Phase 3 happy path)** |

---

## 15. Recommendation for Phase 4 authorization

**Lifecycle decision-flow validation does not block Phase 4 authorization**, provided the Project Owner accepts:

1. Deferred/Rejected remain governance outcomes (already approved).  
2. SD-3 / SD-8 / SD-9 remain open (happy path only).  
3. Findings DF-01–DF-05 are tracked as corrective follow-ups (may be fixed in a Phase 3 patch or early Phase 5 without ADR change).  
4. Phase 4 must **not** place scoring/presentation logic inside adapters and must **not** treat Holdover/Featured as lifecycle states.

**Phase 4 is not authorized by this report.**

---

## 16. Explicit stop

Decision Flow Validation Report complete.  
**No application code was modified.**  
**Stopped.** Awaiting Project Owner review and any separate Phase 4 authorization.
