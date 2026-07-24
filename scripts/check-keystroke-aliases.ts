import { pickField } from "../src/lib/parsers/spreadsheet";
import {
  SKU_ALIASES,
  UNITS_SOLD_ALIASES,
  SALES_DOLLARS_ALIASES,
  detectIntakeDomain,
  defaultDemandPeriodLabel,
} from "../src/lib/iam/mapping";

const rec = { "Stock#": "ABC", "Qty Sold": "12", "Total Sale": "345.50" };
console.log({
  sku: pickField(rec, SKU_ALIASES),
  units: pickField(rec, UNITS_SOLD_ALIASES),
  dollars: pickField(rec, SALES_DOLLARS_ALIASES),
  domain: detectIntakeDomain(Object.keys(rec)),
  period: defaultDemandPeriodLabel("TRUEDEMANDREPLISHMENT-STANDARD.XLS"),
});
