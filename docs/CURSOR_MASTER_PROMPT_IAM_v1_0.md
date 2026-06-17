# Cursor Master Prompt — IAM-Distribution V1.0

You are building **IAM-Distribution (Inventory Action Manager)** as a sibling app to RSE and IFM. Do not rebuild RSE or IFM from scratch. Do not blur IAM logic into replenishment (RSE) or funding (IFM).

## Active handoff path

Load the **numbered staged package** together with:

- `docs/specs/IAM_Cursor_Build_Brief_v1_3.txt` — detailed front-door build brief
- `docs/workbooks/IAM_UAT_Validation_Test_Workbook_v1_1.xlsx` — validation control workbook

## Staged load order

### Stage 1 — Foundation (before code)

1. `docs/specs/00_IAM_Distribution_V1_0_Package_Index_and_Cursor_Load_Guide_v1_1.txt`
2. `docs/specs/01_IAM_Distribution_V1_0_Cursor_Build_Package_Index_Checklist_v1_2.txt`
3. `docs/specs/02_IAM_Distribution_V1_0_Cursor_Build_Instruction_Brief_v1_2.txt`
4. `docs/specs/IAM_Cursor_Build_Brief_v1_3.txt`

**Checkpoint:** Summarize hard rules, what IAM is/is not, and proposed build plan. List conflicts or gaps before writing code.

### Stage 2 — Data and Logic

5. `docs/specs/03_IAM_Distribution_V1_0_Data_Model_Field_Mapping_Guide_v1_1.txt`
6. `docs/specs/04_IAM_Distribution_V1_0_Calculation_Decision_Logic_Guide_v1_2.txt`
7. `docs/specs/10_IAM_RSE_IFM_Signal_Data_Exchange_Map_v1_0.txt` (integration reference)

**Checkpoint:** List tables, workflow states, ranking rules, confidence logic, and archive rules before implementation.

### Stage 3 — Workflow and Outputs

8. `docs/specs/05_IAM_Distribution_V1_0_Screen_Workflow_Specification_v1_2.txt`
9. `docs/specs/06_IAM_Distribution_V1_0_Output_Export_Specification_v1_2.txt`
10. `docs/specs/09_IAM_Inventory_Cash_Recovery_Action_Playbook_Library_v1_2.txt` (playbook reference)

**Checkpoint:** Explain UI flow, role/visibility rules, and export rules before building screens.

### Stage 4 — Testing and Acceptance

11. `docs/specs/07_IAM_Distribution_V1_0_Sample_Test_Data_Expected_Results_v1_2.txt`
12. `docs/specs/08_IAM_Distribution_V1_0_Developer_Acceptance_Checklist_v1_2.txt`
13. `docs/workbooks/IAM_UAT_Validation_Test_Workbook_v1_1.xlsx`

## Locked hard rules (V1 validation build)

- IAM is the **inventory action engine** — not RSE, IFM, or a generic dashboard.
- **One company** per workspace/environment in V1.
- **Priority weights are fixed** in V1 (not user-adjustable).
- **Cash impact leads by default**; service/operational risk overrides only when clearly more dangerous.
- **New priorities and holdovers rank separately.**
- **Top 2** are the core weekly surfaced priorities.
- **Rejected top priorities do not auto-replace** with lower-ranked items in the same cycle (week may end with zero approved top priorities).
- Management may elevate items; out-of-cycle events may create a **3rd top priority**.
- **Grouped actions:** one business case, one owner, one action type — handled inside Action Detail View (no separate grouped screen in V1).
- **Completed/archived actions never reopen** — similar later issues get new IDs.
- **Management-only notes** must not leak to ordinary views or exports.
- Do not block build waiting for perfect Keystroke/AIMS mapping.
- Keystroke import-ready files: tab-delimited `.txt` only.

## Stack (match RSE / IFM)

- Next.js 15 App Router, React 19, TypeScript strict
- Prisma 6 + SQLite (`data/iam.db`)
- Controlled enums in `src/lib/iam/enums.ts`
- Dev server port **3002** (RSE 3000, IFM 3001)

## Current scaffold status

Stage 1 shell exists: home page, create run, minimal schema, spec package loaded.

**Next:** Complete Stage 1 review against docs 00–02, then Stage 2 data model from doc 03.
