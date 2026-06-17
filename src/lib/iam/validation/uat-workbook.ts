import fs from "fs";
import path from "path";
import * as XLSX from "xlsx";

const WORKBOOK_NAME = "IAM_UAT_Validation_Test_Workbook_v1_1.xlsx";

export function uatWorkbookPath(): string {
  return path.join(process.cwd(), "docs", "workbooks", WORKBOOK_NAME);
}

export function isUatWorkbookPresent(): boolean {
  return fs.existsSync(uatWorkbookPath());
}

export interface UatWorkbookSummary {
  present: boolean;
  path: string;
  sheetNames: string[];
  rowCount: number;
  scenarioIdsFound: string[];
}

/** Read UAT workbook metadata — formal pass/fail control file (doc 08). */
export function readUatWorkbookSummary(): UatWorkbookSummary {
  const wbPath = uatWorkbookPath();
  if (!fs.existsSync(wbPath)) {
    return { present: false, path: wbPath, sheetNames: [], rowCount: 0, scenarioIdsFound: [] };
  }

  const wb = XLSX.readFile(wbPath);
  let rowCount = 0;
  const scenarioIdsFound: string[] = [];

  for (const name of wb.SheetNames) {
    const sheet = wb.Sheets[name];
    const rows = XLSX.utils.sheet_to_json<Record<string, string>>(sheet, { defval: "" });
    rowCount += rows.length;
    for (const row of rows) {
      for (const val of Object.values(row)) {
        const m = String(val).match(/SC-\d{3}/);
        if (m && !scenarioIdsFound.includes(m[0])) scenarioIdsFound.push(m[0]);
      }
    }
  }

  scenarioIdsFound.sort();
  return {
    present: true,
    path: wbPath,
    sheetNames: wb.SheetNames,
    rowCount,
    scenarioIdsFound,
  };
}
