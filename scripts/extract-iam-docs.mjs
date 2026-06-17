import fs from "fs/promises";
import path from "path";
import mammoth from "mammoth";

const iamDistDir = "C:\\Users\\Terry Johnston\\Desktop\\IAM-Dist";
const outDir = path.join(process.cwd(), "docs", "specs");
const workbookOutDir = path.join(process.cwd(), "docs", "workbooks");

/** Authoritative IAM-Distribution V1.0 Cursor build package (IAM-Dist on Desktop). */
const packageDocx = [
  "00_IAM_Distribution_V1_0_Package_Index_and_Cursor_Load_Guide_v1_1.docx",
  "01_IAM_Distribution_V1_0_Cursor_Build_Package_Index_Checklist_v1_2.docx",
  "02_IAM_Distribution_V1_0_Cursor_Build_Instruction_Brief_v1_2.docx",
  "03_IAM_Distribution_V1_0_Data_Model_Field_Mapping_Guide_v1_1.docx",
  "04_IAM_Distribution_V1_0_Calculation_Decision_Logic_Guide_v1_2.docx",
  "05_IAM_Distribution_V1_0_Screen_Workflow_Specification_v1_2.docx",
  "06_IAM_Distribution_V1_0_Output_Export_Specification_v1_2.docx",
  "07_IAM_Distribution_V1_0_Sample_Test_Data_Expected_Results_v1_2.docx",
  "08_IAM_Distribution_V1_0_Developer_Acceptance_Checklist_v1_2.docx",
  "09_IAM_Inventory_Cash_Recovery_Action_Playbook_Library_v1_2.docx",
  "10_IAM_RSE_IFM_Signal_Data_Exchange_Map_v1_0.docx",
  "IAM_Cursor_Build_Brief_v1_3.docx",
  "IAM_Developer_Packet_Refresh_Summary_v1_1.docx",
  "IAM_Distribution_Cursor_Master_Package_Index_v1_1.docx",
  "IAM_Package_Wide_Versioning_Standard_v1_0.docx",
  "IAM_Playbook_Library_Future_Growth_Framework_v1_0.docx",
];

const workbookXlsx = "IAM_UAT_Validation_Test_Workbook_v1_1.xlsx";

await fs.mkdir(outDir, { recursive: true });
await fs.mkdir(workbookOutDir, { recursive: true });

for (const file of packageDocx) {
  const input = path.join(iamDistDir, file);
  const base = file.replace(/\.docx$/i, ".txt");
  const output = path.join(outDir, base);
  const result = await mammoth.extractRawText({ path: input });
  await fs.writeFile(output, result.value.trim() + "\n", "utf-8");
  console.log("Wrote", base, `(${result.value.length} chars)`);
}

const xlsxSrc = path.join(iamDistDir, workbookXlsx);
const xlsxDest = path.join(workbookOutDir, workbookXlsx);
await fs.copyFile(xlsxSrc, xlsxDest);
console.log("Copied", workbookXlsx, "→", xlsxDest);
