/** Column aliases for source-agnostic intake (doc 03). */

export const SKU_ALIASES = ["STOCK #", "STOCK#", "SKU", "Item", "Item ID", "sku_or_item_id"];
export const QOH_ALIASES = ["QOH", "On Hand", "quantity_on_hand", "Qty On Hand", "ON HAND"];
export const COST_ALIASES = ["Cost", "Unit Cost", "cost", "AVG COST"];
export const VALUE_ALIASES = ["Inventory Value", "Ext Cost", "inventory_value", "Extended Cost"];
export const DESC_ALIASES = ["Description", "Item Description", "description"];
export const VENDOR_ALIASES = ["Vendor", "Vendor Name", "vendor_name"];
export const UNITS_SOLD_ALIASES = ["Units Sold", "units_sold", "Qty Sold", "Sales Qty"];
export const SALES_DOLLARS_ALIASES = ["Gross Sales", "gross_sales_dollars", "Sales $", "Sales Dollars"];
export const PERIOD_ALIASES = ["Period", "period_label", "Week", "Month"];
export const BACKORDER_ALIASES = ["Backorder", "backorder_quantity", "BO Qty"];
export const OPEN_ORDER_ALIASES = ["Open Order", "open_order_quantity", "On Order", "Qty On Order"];

export type IntakeDomain = "inventory" | "demand" | "supply";

export function detectIntakeDomain(headers: string[]): IntakeDomain {
  const h = headers.join(" ").toLowerCase();
  if (/units sold|sales|demand|gross sales/.test(h)) return "demand";
  if (/on order|open order|backorder|incoming/.test(h)) return "supply";
  return "inventory";
}
