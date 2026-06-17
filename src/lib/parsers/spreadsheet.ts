import * as XLSX from "xlsx";
import path from "path";

export interface ParsedSheet {
  headers: string[];
  rows: unknown[][];
  sheetName: string;
}

export function parseSpreadsheetBuffer(buffer: Buffer, filename: string): ParsedSheet {
  const workbook = XLSX.read(buffer, { type: "buffer", cellDates: true, raw: false });
  const sheetName = workbook.SheetNames[0];
  if (!sheetName) throw new Error(`No worksheet found in ${filename}`);

  const sheet = workbook.Sheets[sheetName];
  const matrix = XLSX.utils.sheet_to_json<unknown[]>(sheet, {
    header: 1,
    defval: "",
    blankrows: false,
  }) as unknown[][];

  if (!matrix.length) return { headers: [], rows: [], sheetName };

  const headerRowIndex = findHeaderRowIndex(matrix);
  const headers = (matrix[headerRowIndex] ?? []).map((h) => String(h ?? "").trim());
  const rows = matrix.slice(headerRowIndex + 1).filter((row) => rowHasData(row));

  const ext = path.extname(filename).toLowerCase();
  if (ext === ".csv" && headers.length === 1 && headers[0]?.includes("\t")) {
    return parseDelimitedText(String(buffer), "\t", filename);
  }

  return { headers, rows, sheetName };
}

function rowHasData(row: unknown[]): boolean {
  return row.some((cell) => String(cell ?? "").trim() !== "");
}

function findHeaderRowIndex(matrix: unknown[][]): number {
  const scanLimit = Math.min(matrix.length, 10);
  let bestIndex = 0;
  let bestScore = -1;
  for (let i = 0; i < scanLimit; i++) {
    const row = matrix[i] ?? [];
    const nonEmpty = row.filter((cell) => String(cell ?? "").trim() !== "").length;
    const hasSkuHint = row.some((cell) => /stock|sku|item/i.test(String(cell ?? "")));
    const score = nonEmpty + (hasSkuHint ? 5 : 0);
    if (score > bestScore) {
      bestScore = score;
      bestIndex = i;
    }
  }
  return bestIndex;
}

function parseDelimitedText(text: string, delimiter: string, filename: string): ParsedSheet {
  const lines = text.split(/\r?\n/).filter((l) => l.trim());
  if (!lines.length) return { headers: [], rows: [], sheetName: filename };
  const headers = lines[0].split(delimiter).map((h) => h.trim());
  const rows = lines.slice(1).map((line) => line.split(delimiter));
  return { headers, rows, sheetName: filename };
}

export function rowToRecord(headers: string[], row: unknown[]): Record<string, string> {
  const record: Record<string, string> = {};
  headers.forEach((h, i) => {
    if (h) record[h] = String(row[i] ?? "").trim();
  });
  return record;
}

export function pickField(record: Record<string, string>, aliases: string[]): string {
  for (const key of Object.keys(record)) {
    const norm = key.toLowerCase().replace(/[^a-z0-9]/g, "");
    for (const alias of aliases) {
      if (norm === alias.toLowerCase().replace(/[^a-z0-9]/g, "")) return record[key] ?? "";
    }
  }
  for (const alias of aliases) {
    const direct = record[alias];
    if (direct) return direct;
  }
  return "";
}

export function parseNumber(value: string): number | null {
  const cleaned = value.replace(/[$,\s]/g, "");
  if (!cleaned || cleaned === "-" || cleaned.toLowerCase() === "n/a") return null;
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : null;
}

export function parseDate(value: string): Date | null {
  if (!value) return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}
