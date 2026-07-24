/** Column aliases for generic spreadsheet intake (non-Keystroke). Keystroke aliases live in adapters/keystroke. */

export const SKU_ALIASES = [
  "SKU",
  "Item",
  "Item ID",
  "sku_or_item_id",
  "Stock#",
  "Stock #",
];

export const QOH_ALIASES = [
  "QOH",
  "On-Hand Qty",
  "On Hand",
  "On Hand Qty",
  "quantity_on_hand",
  "Qty On Hand",
  "ON HAND",
];

export const COST_ALIASES = [
  "Cost",
  "Unit Cost",
  "AVG COST",
  "Avg Cost",
  "Average Cost",
  "cost",
];

export const LAST_SOLD_ALIASES = ["Last Sold Date", "Last Sold", "Last Sale Date"];
export const LAST_PURCHASE_ALIASES = [
  "Last Purchased Date",
  "Last Purchase Date",
  "Last Received Date",
  "Last Purchase",
];

export const VALUE_ALIASES = ["Inventory Value", "Ext Cost", "inventory_value", "Extended Cost"];

export const DESC_ALIASES = ["Description", "Item Description", "description"];

export const VENDOR_ALIASES = ["Vendor", "Vendor Name", "vendor_name"];

export const UNITS_SOLD_ALIASES = [
  "Qty Sold",
  "QTY SOLD",
  "Units Sold",
  "Sales Qty",
  "units_sold",
];

export const SALES_DOLLARS_ALIASES = [
  "Gross Sales",
  "gross_sales_dollars",
  "Sales $",
  "Sales Dollars",
];

export const PERIOD_ALIASES = ["Period", "period_label", "Week", "Month"];

export const BACKORDER_ALIASES = ["Backorder", "backorder_quantity", "BO Qty"];

export const OPEN_ORDER_ALIASES = [
  "Open Order",
  "open_order_quantity",
  "On Order",
  "Qty On Order",
  "On Order Qty",
];

export type IntakeDomain = "inventory" | "demand" | "supply";

export function detectIntakeDomain(headers: string[]): IntakeDomain {
  const h = headers.join(" ").toLowerCase();
  if (/qty sold|units sold|gross sales|sales \$/.test(h)) return "demand";
  if (
    /on-hand|on hand|qoh|last cost|inventory position/.test(h) ||
    (/sku|item/.test(h) && /cost/.test(h) && /qty|qoh|on-hand|on hand/.test(h))
  ) {
    return "inventory";
  }
  if (/on order|open order|backorder|incoming/.test(h)) return "supply";
  return "inventory";
}

export function defaultDemandPeriodLabel(filename: string): string {
  const f = filename.toLowerCase().replace(/[^a-z0-9]/g, "");
  if (f.includes("13week") || f.includes("w13")) return "13_weeks";
  if (f.includes("52week") || f.includes("w52")) return "52_weeks";
  return "review_window";
}
