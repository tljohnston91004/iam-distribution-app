/** Keystroke adapter — column aliases (outside IAM Core). */

export const KS_SKU_ALIASES = [
  "STOCK #",
  "STOCK#",
  "Stock#",
  "Stock #",
  "STK#",
  "STK #",
  "SKU",
];

export const KS_ON_HAND_ALIASES = [
  "On-Hand Qty",
  "On Hand Qty",
  "On Hand",
  "QOH",
  "Qty On Hand",
];

export const KS_AVAILABLE_QOH_ALIASES = [
  "Available QOH",
  "Available Qty",
  "Avail QOH",
];

export const KS_COST_ALIASES = ["Last Cost", "LAST COST", "Cost", "Unit Cost"];

export const KS_VALUE_ALIASES = ["Inventory Value", "Ext Cost", "Extended Cost"];

export const KS_DESC_ALIASES = ["Description", "DESCRIPTION", "Item Description"];

export const KS_UNITS_SOLD_ALIASES = [
  "Units Sold/Shipped",
  "UNITS SOLD/SHIPPED",
  "Qty Sold",
  "Units Sold",
];

export const KS_SALES_DOLLARS_ALIASES = ["Total Sale", "TOTAL SALE", "Gross Sales", "Sales $"];

export const KS_OPEN_ORDER_ALIASES = ["Qty Ordered", "Open Order", "On Order", "On Order Qty"];

export const KS_LAST_SOLD_ALIASES = ["Last Sold Date", "LAST SOLD DATE", "Last Sold"];

export const KS_LAST_RECV_ALIASES = [
  "Last Purchased Date",
  "LAST RECD DATE",
  "Last Received Date",
  "Last Purchase Date",
];

/** Summary / non-entity rows excluded before Evidence Package build. */
export function isExcludedSummarySku(sku: string): boolean {
  const s = String(sku).trim();
  return !s || s === "0";
}

export const KS_CLASSIFICATION_ALIASES = [
  "Classification",
  "Class",
  "ABC Class",
  "ABC",
  "Inventory Class",
  "Inventory Classification",
  "Item Class",
];

export const KS_VENDOR_ALIASES = ["Vendor", "Vendor Name", "VENDOR", "Supplier"];

export const KS_CATEGORY_ALIASES = ["Category", "CATEGORY", "Product Category"];

export const KS_DEPARTMENT_ALIASES = ["Department", "Dept", "DEPT", "Department Name"];

export const KS_LOCATION_ALIASES = ["Location", "Loc", "Warehouse", "Store"];

export const KS_PRODUCT_GROUP_ALIASES = [
  "Product Group",
  "ProductGroup",
  "Group",
  "Item Group",
];

export const KS_ITEM_STATUS_ALIASES = ["Item Status", "Status", "SKU Status"];

