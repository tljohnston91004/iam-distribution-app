/**
 * Stage 4D: the governed Customer Backorder feed for the shortage component.
 *
 * Reads the governed records through the existing Stage 4A Data Hub client (IAM never reads another service's tables and never
 * recreates Data Hub canonicalization). Fails safe: when the feed is not supplied, has no successful run, is unreadable or
 * invalid, the provider reports UNAVAILABLE with the reason - it never reports "zero backorders". parentSku (Stck#) and
 * childPartOrVariant (Class) are carried exactly as supplied and are never merged.
 */
import { DataHubClientError, type DataHubClient, type GovernedInputRecord } from "../data-hub-client";
import type { BackorderLine, ShortageInput } from "./components";

export type BackorderFetch = { ok: true; input: ShortageInput } | { ok: false; reason: string };

export interface BackorderProvider {
  fetch(): Promise<BackorderFetch>;
}

const num = (v: unknown): number | null => {
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  if (typeof v === "string" && v.trim() !== "" && Number.isFinite(Number(v))) return Number(v);
  return null;
};
const text = (v: unknown): string | null => (typeof v === "string" && v.trim() !== "" ? v : v === null || v === undefined ? null : String(v));

const CLOSED_STATUS = /^(FULFILLED|CANCELLED|CANCELED|CLOSED|CLOSED_UNSPECIFIED)$/i;

/** Map one governed record to a backorder line; returns null when the record is not an open, usable backorder line. */
export function backorderLineOf(rec: GovernedInputRecord): BackorderLine | null {
  if (rec.publicationStatus !== "PUBLISHED") return null;
  const v = rec.values as Record<string, unknown>;
  const parentSku = text(v.parentSku);
  const qty = num(v.quantityBackordered ?? v.quantity);
  if (!parentSku || qty === null || qty <= 0) return null;
  const status = text(v.backorderStatus);
  if (status && CLOSED_STATUS.test(status)) return null;
  const extended = num(v.extendedBackorderValue);
  const price = num(v.sellingPrice);
  const value = extended !== null && extended >= 0 ? extended : price !== null && price >= 0 ? price * qty : null;
  return {
    orderRef: text(v.orderRef),
    parentSku,
    childPartOrVariant: v.childPartOrVariant === undefined ? null : text(v.childPartOrVariant),
    locationRef: text(v.locationRef),
    quantity: qty,
    value,
    originalOrderDate: text(v.originalOrderDate),
    promisedDate: text(v.promisedDate),
  };
}

export function createDataHubBackorderProvider(client: Pick<DataHubClient, "getInputStatus" | "iterateInputRecords">, opts: { pageSize?: number; maxPages?: number } = {}): BackorderProvider {
  return {
    async fetch(): Promise<BackorderFetch> {
      try {
        const status = await client.getInputStatus();
        const src = status.sources.find((s) => s.objectFamily === "CUSTOMER_BACKORDER_LINE");
        if (!src || src.availability !== "AVAILABLE" || !src.latestSuccessfulRun) {
          return { ok: false, reason: `The Customer Backorder feed is ${src ? src.availability : "not reported"} in the Data Hub, so shortage cannot be measured.` };
        }
        const run = src.latestSuccessfulRun;
        const asOfRaw = run.sourceRunAt ?? run.ingestedAt ?? run.receivedAt;
        const asOf = new Date(asOfRaw);
        if (Number.isNaN(asOf.getTime())) return { ok: false, reason: "The Customer Backorder feed reports an unreadable as-of time." };
        const lines: BackorderLine[] = [];
        for await (const rec of client.iterateInputRecords("CUSTOMER_BACKORDER_LINE", { pageSize: opts.pageSize ?? 500, maxPages: opts.maxPages ?? 200 })) {
          const line = backorderLineOf(rec);
          if (line) lines.push(line);
        }
        return { ok: true, input: { lines, asOf, sourceRefs: [`datahub:CUSTOMER_BACKORDER_LINE:${run.importBatchId}`] } };
      } catch (e) {
        if (e instanceof DataHubClientError) return { ok: false, reason: `The Customer Backorder feed could not be read (${e.category}: ${e.code}).` };
        return { ok: false, reason: "The Customer Backorder feed could not be read." };
      }
    },
  };
}
