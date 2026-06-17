export type ValidationStatus = "pass" | "fail" | "skip";

export interface ValidationCase {
  id: string;
  name: string;
  area: string;
  docRef: string;
  status: ValidationStatus;
  message: string;
}

export interface ValidationReport {
  ranAt: string;
  summary: { pass: number; fail: number; skip: number; total: number };
  cases: ValidationCase[];
  readinessLevel: "Level 3 - Functional Test Ready" | "Level 4 - Controlled Validation Ready";
  uatWorkbookPresent: boolean;
}

export interface AcceptanceItem {
  id: string;
  category: string;
  requirement: string;
  status: "Pass" | "Pass with Notes" | "Fail - Correction Required" | "Blocked" | "Not Applicable" | "Pending";
  autoChecked: boolean;
  notes?: string;
}
