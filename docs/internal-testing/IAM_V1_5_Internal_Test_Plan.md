# IAM Version 1.5 — Internal Test Plan

| Field | Value |
|-------|--------|
| **Document** | Internal Test Plan |
| **Product** | IAM Version 1.5 |
| **Date** | 2026-07-23 |
| **Prerequisite** | Internal Testing Entry Checklist signed; unified ingestion **accepted**; PO authorizes execution |
| **Execution status** | **Pause lifted** — awaiting PO authorization to begin IT-01…IT-22 |
| **Code modified** | Unified ingestion (V1.5 product-completeness correction) |

---

## 0. Pause status

**Internal Validation pause for unified ingestion is LIFTED** (PO accepted IAM-specific correction 2026-07-23).

Scenario execution begins only after **separate PO authorization**. Do not start Design Partner Validation.

Reference: [`../IAM_V1_5_Unified_Source_Priority_Rules.md`](../IAM_V1_5_Unified_Source_Priority_Rules.md) · [`Pre_Execution_Confirmation_Unified_Ingestion_Lift.md`](./Pre_Execution_Confirmation_Unified_Ingestion_Lift.md)

---

## 1. Objectives

1. Prove end-to-end Recommendation / Decision Board workflows on an isolated environment.  
2. Validate OEC, Paused≠OEC, Deferred, aging advisory, Trust Pyramid, primary CTA.  
3. Exercise data confidence / incomplete-data behavior.  
4. Prove **one** unified ingestion path across standalone / RSE / Data Hub / combinations.  
5. Capture defects before any Design Partner engagement.  
6. Produce exit evidence for Design Partner Validation gate.

---

## 2. Scope

**In scope:** Unified evidence ingestion (customer upload, Keystroke, RSE, Data Hub) → Port → reconcile → **Approve evidence** → Calculate → Recommendations → Score/Present → Board governance → Owner Accept → Progress → Pause/Defer → Complete/Archive; soft viewAs roles; exports if available.

**Out of scope:** Phase 6 RBAC/IdP; Emergency auto-rules; UnlockCycle; changing scoring/Recommendation/governance/lifecycle/OEC/EEP logic; Design Partner customer data.

---

## 3. Scenario catalog

| ID | Scenario | Steps (summary) | Expected | Pass? |
|----|----------|-----------------|----------|-------|
| IT-01 | First-time user onboarding | Fresh browser → open Board → dismiss/read first-five-minutes | Onboarding visible once; dismissible; hierarchy clear | |
| IT-02 | Valid complete dataset | Upload inventory + demand → merge → **Approve evidence** → calculate | Recommendations scored; Active Priorities ≤ OEC; Waiting ordered | |
| IT-03 | Partial dataset | Inventory only or demand only → approve → calculate | Data gaps / readiness signals; no silent false certainty | |
| IT-04 | Invalid or conflicting data | Bad file / matrix+standard overlap parents | Staging/merge rules applied; errors or exclusions explained | |
| IT-05 | No Recommendations generated | Empty/near-empty evidence | Empty lanes + calm messaging; no crash | |
| IT-06 | Recommendations exceeding OEC | Seed many Identified + set OEC=2 | Active Priorities ≤ available; remainder Waiting | |
| IT-07 | Paused Recommendations | Active → Pause; measure OEC | Paused in WIP/Holdover; **does not** consume OEC | |
| IT-08 | Deferred Recommendations | Defer from Management Review; re-present | Deferred lane; not competing; score retained; Reactivate works | |
| IT-09 | Long-aging Recommendations | Rec with old createdAt / aging threshold low | Advisory message only; category/lifecycle unchanged | |
| IT-10 | Rejection and re-analysis | Reject with reason; optionally new evidence + recalculate | Reject audited; Board consistent; no raw transition API | |
| IT-11 | Progress updates and completion | Accept → progress/blocker → Complete → OV path as available | Progress persists; lifecycle advances per engine | |
| IT-12 | Weekly management meeting | Timed 20–30 min: Summary→Momentum→OEC→Decisions→Active→WIP | Meeting completable; primary CTAs work; no Board `prompt()` | |
| IT-13 | Multiple user roles | Same run as Executive / Operations / Owner | Soft views differ appropriately; Owner Accept path works | |
| IT-14 | Browser and screen-size | Chrome + Edge (or Safari); 1440px and ~390px width | Usable; critical actions reachable; note defects | |
| IT-15 | Export or reporting | Any available export/report/archive views | Completes or defect logged; no data corruption | |
| IT-16 | Failure and recovery | Force API error / offline / double-submit | Error message; recoverable; no partial corrupt LS | |
| IT-17 | Standalone ingestion | Company: upload on, RSE/Hub off → customer/Keystroke upload → approve → calculate | Works without RSE or Data Hub | |
| IT-18 | IAM + RSE | Enable RSE → submit RSE evidence package → reconcile/approve → calculate | Same path as upload; lineage `RSE` | |
| IT-19 | IAM + Data Hub | Enable Hub → submit Hub package → approve → calculate | Same path; lineage `DataHub` | |
| IT-20 | Combination + priority | Upload + RSE + Hub on same SKU with different qty | Hub wins; conflicts logged; losers not selected | |
| IT-21 | Approval gate | Merge/upload then Calculate **without** Approve | Calculate rejected; after Approve, Calculate succeeds | |
| IT-22 | Channel disabled | RSE/Hub flag off → submit that channel | Rejected with DISABLED; standalone still works | |
| IT-23 | Classification optional (standalone) | IT-02 without classification files | Merge/calculate succeed; class dims may be empty | |
| IT-24 | True Demand Classification upload | Stage Standard/Matrix classification → merge | Checklist shows optional slots; dims applied to inventory | |
| IT-25 | Inventory Classification / RSE class | Upload or RSE overlay with class=D on many SKUs | Segment Trapped Cash Review appears; member SKUs in drill-down | |
| IT-26 | Segment outranks small SKU | D-class aggregate >> single SKU $ exposure | Segment ranks above small SKU unless critical override | |
| IT-27 | No double-count | After calculate with segment | Member SKUs not separate priorities for same action | |
| IT-28 | Prescribed Action Plan present | Calculate → Board / Detail | Every actionable priority shows Prescribed Action Plan (summary + full fields) | |
| IT-29 | Differentiated SKU actions | Segment with mixed WOS / PO / age / RSE | Action groups vary; supporting SKUs not all same generic action | |
| IT-30 | Data gaps | SKU/evidence missing qty/value or key dims | Plan recommends data correction / management review, not unsupported disposition | |
| IT-31 | Location "0" | Inventory with locationCode `0` | No Location "0" Recommendation; company-level priority + data-quality warning | |
| IT-32 | Prescribe in decision flow | Walk Active Priority | Detect→Analyze→Aggregate→Prioritize→Prescribe→Present→Assign→Track→Measure visible in content | |

---

## 4. Execution log (copy per run)

| Scenario | Tester | Date | Result (Pass/Fail/Blocked) | Defect IDs | Notes |
|----------|--------|------|----------------------------|------------|-------|

---

## 5. Daily rhythm

1. Confirm environment + DB identity  
2. Run smoke: `test:unified-ingestion` + open Board + Approve evidence + one calculate if data changed  
3. Execute assigned scenarios  
4. Log defects same day  
5. Retest fixes next day  

---

## 6. Exit handoff

Attach completed execution log + defect summary to Exit Checklist.
