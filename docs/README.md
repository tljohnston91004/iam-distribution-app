# IAM Distribution — Spec Package (V1.0)

Authoritative build package extracted from `Desktop/IAM-Dist/`.

## Active front-door handoff files

Use these **together** with the numbered package:

| File | Location |
|------|----------|
| IAM Cursor Build Brief v1.3 | `specs/IAM_Cursor_Build_Brief_v1_3.txt` |
| IAM UAT / Validation Test Workbook v1.1 | `workbooks/IAM_UAT_Validation_Test_Workbook_v1_1.xlsx` |

## Staged Cursor load order

| Stage | Documents | Goal |
|-------|-----------|------|
| **1 — Foundation** | 00, 01, 02 | Product intent, hard rules, build boundary |
| **2 — Data and Logic** | 03, 04 | Data model, ranking, confidence, archive logic |
| **3 — Workflow and Outputs** | 05, 06 | Screens, visibility, outputs, exports |
| **4 — Testing and Acceptance** | 07, 08 | Sample scenarios, expected results, acceptance |

## Numbered package (load in order)

1. `00_IAM_Distribution_V1_0_Package_Index_and_Cursor_Load_Guide_v1_1.txt`
2. `01_IAM_Distribution_V1_0_Cursor_Build_Package_Index_Checklist_v1_2.txt`
3. `02_IAM_Distribution_V1_0_Cursor_Build_Instruction_Brief_v1_2.txt`
4. `03_IAM_Distribution_V1_0_Data_Model_Field_Mapping_Guide_v1_1.txt`
5. `04_IAM_Distribution_V1_0_Calculation_Decision_Logic_Guide_v1_2.txt`
6. `05_IAM_Distribution_V1_0_Screen_Workflow_Specification_v1_2.txt`
7. `06_IAM_Distribution_V1_0_Output_Export_Specification_v1_2.txt`
8. `07_IAM_Distribution_V1_0_Sample_Test_Data_Expected_Results_v1_2.txt`
9. `08_IAM_Distribution_V1_0_Developer_Acceptance_Checklist_v1_2.txt`

## Reference / library (as needed)

- `09_IAM_Inventory_Cash_Recovery_Action_Playbook_Library_v1_2.txt`
- `10_IAM_RSE_IFM_Signal_Data_Exchange_Map_v1_0.txt`
- `IAM_Developer_Packet_Refresh_Summary_v1_1.txt`
- `IAM_Distribution_Cursor_Master_Package_Index_v1_1.txt`
- `IAM_Package_Wide_Versioning_Standard_v1_0.txt`
- `IAM_Playbook_Library_Future_Growth_Framework_v1_0.txt`

## Regenerate from Desktop

```bash
npm run docs:extract
```

Source folder: `C:\Users\Terry Johnston\Desktop\IAM-Dist\`

Master prompt for Cursor: [`CURSOR_MASTER_PROMPT_IAM_v1_0.md`](../CURSOR_MASTER_PROMPT_IAM_v1_0.md)
