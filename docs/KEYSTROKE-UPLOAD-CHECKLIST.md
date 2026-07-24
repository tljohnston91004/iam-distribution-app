# IAM Keystroke Upload Checklist

RSE-style multi-file upload for IAM (unified ingestion).

## Slots

| Slot | File examples | Required |
|------|---------------|----------|
| Inventory | `SCBSRSE3.XLS`, `INVENTORYPOSITION.XLS` | Yes |
| 13-week Demand — Standard | `TRUEDEMANDREPLISHMENT-STANDARD.XLS` | At least one demand slot |
| 13-week Demand — Matrix | `TRUEDEMANDREPLENISHMENT-MATRIX.XLS` | At least one demand slot |
| True Demand Classification — Standard | `TrueDemandClassification-Standard…` | Optional (standalone); use when RSE outputs available |
| True Demand Classification — Matrix | `TrueDemandClassification-Matrix…` | Optional |
| Inventory Classification | `InventoryClassification…` | Optional |

Classification reports enrich inventory **class / vendor / category / department / location / product group** dimensions. IAM **consumes** RSE outputs; it does not recalculate classification. Weeks-of-supply still uses 13-week replenishment units.

## Flow

1. Open a weekly IAM run → **View as Operations**  
2. Use **Keystroke upload checklist**  
3. Upload inventory, then Standard and/or Matrix replenishment (classification optional)  
4. Click **Merge uploads into run**  
5. Click **Approve evidence**  
6. Click **Calculate · Score · Present**

## Merge rules

- **Inventory:** last upload wins per Stock# (matrix parent schemes excluded)
- **Demand (Matrix + Standard):** union of SKUs; **no summing on overlaps**
- **SKU in both Matrix and Standard:** treated as shared **matrix parent/scheme** → **excluded** (RLC/RSE rule)
- **Inferred parents:** Stock #s like `37826` with children `37826.12` are also excluded
- **Classification:** applied as dimensional overlay (RSE channel wins when RSE active)
- Variant / non-parent items are kept for ranking

See also: [`IAM_V1_5_Classification_and_Segment_Ranking.md`](./IAM_V1_5_Classification_and_Segment_Ranking.md)
