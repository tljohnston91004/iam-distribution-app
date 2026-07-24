# IAM Version 1.5 — Internal Test Scenario Pack (IT-01 … IT-16)

| Field | Value |
|-------|--------|
| **Cycle** | Internal Validation |
| **Status** | **Paused** — awaiting PO acceptance of Prescribed Action Plan (IT-01…IT-32) |
| **UI scope** | Decision Board path only |
| **Dataset** | [`Frozen_Internal_Test_Dataset_Pack.md`](./Frozen_Internal_Test_Dataset_Pack.md) |
| **Execution log** | [`Internal_Validation_Execution_Log.md`](./Internal_Validation_Execution_Log.md) |

---

## Scope banner

**Approved test scope:** IAM Version 1.5 / EEP Decision Board experience only.  
**Excluded:** Legacy Action path · Design Partner · new functionality.

---

## Scenarios (ready)

| ID | Title | Prep | Primary tester |
|----|-------|------|----------------|
| IT-01 | First-time user onboarding | Clear `localStorage` key `iam-eep-onboarding-dismissed` or use private window | Executive |
| IT-02 | Valid complete dataset | Frozen pack: SCBSRSE3 + Standard + Matrix demand | Operations |
| IT-03 | Partial dataset | Inventory-only **or** demand-only upload | Operations |
| IT-04 | Invalid or conflicting data | Both demand variants; observe parent exclusions / errors | Operations |
| IT-05 | No Recommendations | New cycle; calculate with insufficient evidence | Operations |
| IT-06 | Exceeding OEC | OEC=2; ensure enough Identified after calculate; confirm Waiting | Executive |
| IT-07 | Paused | Promote/approve path to Active → Pause; confirm OEC | Executive |
| IT-08 | Deferred | Management Review → Defer → Reactivate | Executive |
| IT-09 | Long-aging | Temporarily set aging days low **or** use aged fixture; advisory only | Executive |
| IT-10 | Reject + re-analysis | Reject with reason; optional recalculate | Executive |
| IT-11 | Progress + completion | Assign → Accept → progress API/UI → Complete/OV as available | Owner persona |
| IT-12 | Weekly meeting | Timed 20–30 min Board walk | Executive (+ PO observe) |
| IT-13 | Multiple roles | Same run: Exec / Ops / Owner soft viewAs | All |
| IT-14 | Browser / screen | Chrome + Edge; ~1440px and ~390px | Facilitator + Exec |
| IT-15 | Export / reporting | Archive / any export available | Operations |
| IT-16 | Failure / recovery | Double-submit / offline / invalid transition | Operations |
| IT-17 | Standalone ingestion | Upload on; RSE/Hub off → Approve → Calculate | Operations |
| IT-18 | IAM + RSE | Enable RSE; POST RSE evidence → Approve → Calculate | Operations |
| IT-19 | IAM + Data Hub | Enable Hub; POST Hub evidence → Approve → Calculate | Operations |
| IT-20 | Combination + priority | Overlapping SKUs; Hub wins; conflicts logged | Operations |
| IT-21 | Approval gate | Calculate without Approve must fail | Operations |
| IT-22 | Channel disabled | RSE/Hub off → submit rejected; standalone OK | Operations |
| IT-23 | Classification optional | Standalone without class files still calculates | Operations |
| IT-24 | True Demand Classification | Classification upload overlays dims | Operations |
| IT-25 | Inventory Classification segment | Class=D aggregate → segment priority | Operations |
| IT-26 | Segment vs small SKU | Segment outranks small SKU cash exposure | Operations |
| IT-27 | No double-count | Member SKUs not duplicate same-action priorities | Operations |
| IT-28 | Prescribed Action Plan present | After Calculate, Active/Waiting cards show plan summary; Detail shows full plan | Executive |
| IT-29 | Differentiated SKU actions | Segment drill-down shows varied action groups (not one generic action) | Operations |
| IT-30 | Data gaps block disposition | Incomplete evidence → management review / data correction, not invented action | Operations |
| IT-31 | Location "0" invalid | No Location "0" Recommendation; company-level + data-quality warning | Operations |
| IT-32 | Decision flow Prescribe step | Confirm Detect→…→Prescribe→Present→Assign→Track→Measure content on Board | Executive |

Detailed expected results: [`IAM_V1_5_Internal_Test_Plan.md`](./IAM_V1_5_Internal_Test_Plan.md) §3.
