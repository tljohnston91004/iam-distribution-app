# IAM V1.5 — RSE Classification Reports & Segment Impact Ranking

| Field | Value |
|-------|--------|
| **Date** | 2026-07-23 |
| **Scope** | Unified ingestion + ranking (governance / OEC / EEP unchanged) |

## Supported classification sources

| Report | File type | Required? |
|--------|-----------|-----------|
| True Demand Classification Standard | `demand_classification` + standard | Optional standalone; used when present / when RSE active |
| True Demand Classification Matrix | `demand_classification` + matrix | Optional standalone |
| Inventory Classification | `inventory_classification` | Optional standalone |
| RSE Evidence Package (classification dims) | Port `sourceReportType` inventory/demand classification | When `enableRseEvidence` |

IAM **consumes** RSE classification outputs; it does **not** recalculate ABC/class logic.

Standalone continues without classification files; confidence is not blocked (optional enrichment).

## Priority hierarchy (business impact)

Recommendations rank by **combined financial and operational impact**, whether SKU or segment:

1. Critical operational override (service / safety / contractual risk) may outrank pure cash  
2. Else **total financial exposure** leads  
3. Else composite priority score  

Segment grains evaluated: classification, vendor, category, department, location, product group.

Segment Recommendations show total inventory/excess value, affected SKU count, urgency, Data Confidence, and **drill-down member SKUs**. Member SKUs are **not** separately ranked for the same action type (double-count guard), unless a critical SKU-level override applies.

## Tests

`npm run test:classification-segment`
