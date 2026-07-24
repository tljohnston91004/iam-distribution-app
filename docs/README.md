# IAM Distribution — Spec Package (V1.0)

Authoritative build package extracted from `Desktop/IAM-Dist/`.

## Version 1.5 control documents

| Document | Path |
|----------|------|
| **Phase Authorization Register** (Project Owner authorization required before each phase) | [`IAM_V1_5_Phase_Authorization_Register.md`](./IAM_V1_5_Phase_Authorization_Register.md) |
| **Implementation Dashboard** (running status) | [`IAM_V1_5_Implementation_Dashboard.md`](./IAM_V1_5_Implementation_Dashboard.md) |
| **ADR-IAM-001** (Canonical Inbound Port / replaceable adapters) | [`architecture/ADR-IAM-001-Canonical-Inbound-Port-and-Replaceable-Source-Adapter-Architecture.md`](./architecture/ADR-IAM-001-Canonical-Inbound-Port-and-Replaceable-Source-Adapter-Architecture.md) |
| **V1.5 Implementation Plan** | [`IAM_V1_5_Implementation_Plan.md`](./IAM_V1_5_Implementation_Plan.md) |
| **Governance control files** | [`governance/`](./governance/) (Assumptions, Questions, ADR index, Defect, Tech debt, SD gates) |
| **Company standards** | [`standards/`](./standards/) — includes **DPVS Final v1.0** (Design Partner Validation Standard) |
| **DPVS package (canonical)** | [`design-partner/`](./design-partner/) — IAM V1.5 first module implementation |
| **Specification Errata** | [`errata/IAM_V1_5_Specification_Errata.md`](./errata/IAM_V1_5_Specification_Errata.md) |
| **Prescribed Action Plan** (required Recommendation content) | [`IAM_V1_5_Prescribed_Action_Plan.md`](./IAM_V1_5_Prescribed_Action_Plan.md) |
| **PAP — PO review stop** | [`IAM_V1_5_Prescribed_Action_Plan_PO_Review_Stop.md`](./IAM_V1_5_Prescribed_Action_Plan_PO_Review_Stop.md) |
| **Revised scoring — pre-build review** | [`IAM_Actions_Revised_Scoring_Pre_Build_Review.md`](./IAM_Actions_Revised_Scoring_Pre_Build_Review.md) |
| **Revised scoring — completion / gaps** | [`IAM_Actions_Revised_Scoring_Completion_Report.md`](./IAM_Actions_Revised_Scoring_Completion_Report.md) |
| **Phase Completion Reports** | [`phase-reports/`](./phase-reports/) |
| Keystroke upload checklist | [`KEYSTROKE-UPLOAD-CHECKLIST.md`](./KEYSTROKE-UPLOAD-CHECKLIST.md) |

External IAM Version 1.5 specifications (Desktop package) remain the product authority. ADR-IAM-001 is the controlling **integration** architecture. Update the Implementation Dashboard at the end of every work session and phase checkpoint. No phase implementation may begin until the Phase Authorization Register marks that phase **Authorized**.

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
