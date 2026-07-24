import {
  detectIntakeDomain,
  QOH_ALIASES,
  COST_ALIASES,
  SKU_ALIASES,
} from "../src/lib/iam/mapping";
import { pickField } from "../src/lib/parsers/spreadsheet";

const headers = [
  "Stock#",
  "On-Hand Qty",
  "Last Cost",
  "Available QOH",
  "Qty Ordered",
  "Qty Allocated",
  "Last Sold Date",
  "Last Purchased Date",
];
const rec = {
  "Stock#": "38303",
  "On-Hand Qty": "79",
  "Last Cost": "95",
  "Available QOH": "79",
  "Qty Ordered": "0",
};

console.log({
  domain: detectIntakeDomain(headers),
  sku: pickField(rec, SKU_ALIASES),
  qoh: pickField(rec, QOH_ALIASES),
  cost: pickField(rec, COST_ALIASES),
});
