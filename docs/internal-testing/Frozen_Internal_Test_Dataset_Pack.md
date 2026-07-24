# IAM Version 1.5 — Frozen Internal Test Dataset Pack

| Field | Value |
|-------|--------|
| **Document** | Frozen Dataset Confirmation |
| **Freeze ID** | IAM-V15-IV-DATASET-2026-07-21 (+ evidence extension 2026-07-23) |
| **Freeze date** | 2026-07-21 (Keystroke XLS); **2026-07-23** (multi-source Evidence Packages) |
| **Status** | **Frozen** for Internal Validation cycle |
| **Location** | `docs/internal-testing/samples/frozen-v1/` |

---

## Coverage by configuration

| Configuration | Frozen material | Scenarios |
|---------------|-----------------|-----------|
| **Standalone** (Keystroke) | `SCBSRSE3.XLS`, demand Standard/Matrix, optional `INVENTORYPOSITION.XLS` | IT-02…IT-04, IT-17 (Keystroke path) |
| **Standalone** (customer upload JSON) | `evidence/customer-inventory.json` + `evidence/customer-demand.json` | IT-17 |
| **IAM + RSE** | `evidence/rse-inventory.json` (+ demand companion) | IT-18 |
| **IAM + Data Hub** | `evidence/data-hub-inventory.json` (+ demand companion) | IT-19 |
| **Combined sources** | customer + RSE + Hub packages (shared SKU `IV-SHARED-01`) | IT-20 |
| **Approval / channel gates** | Same packages; enablement flags | IT-21, IT-22 |

Automated coverage of all four configurations: `npm run test:unified-ingestion`.

---

## Approved Keystroke files (IT-02 path)

| Slot | Frozen filename | Required for IT-02 |
|------|-----------------|-------------------|
| Inventory (primary) | `SCBSRSE3.XLS` | Yes (prefer with Matrix) |
| Inventory (alt) | `INVENTORYPOSITION.XLS` | Optional / IT-03 partial |
| Demand — Standard | `TRUEDEMANDREPLISHMENT-STANDARD.XLS` | Yes |
| Demand — Matrix | `TRUEDEMANDREPLENISHMENT-MATRIX.XLS` | Yes for full matrix path |

Integrity: `frozen-v1/MANIFEST.txt`. **Do not overwrite** during the cycle without PO re-freeze.

---

## Approved Evidence Package fixtures (IT-17…IT-22)

| File | Channel | Use |
|------|---------|-----|
| `evidence/customer-inventory.json` | CustomerUpload | Standalone / combined |
| `evidence/customer-demand.json` | CustomerUpload | Demand companion |
| `evidence/rse-inventory.json` | RSE | IAM+RSE / combined (requires `enableRseEvidence`) |
| `evidence/data-hub-inventory.json` | DataHub | IAM+Hub / combined (requires `enableDataHub`) |

**Submit recipe:** POST body to `/api/runs/{runId}/evidence/rse` or `.../data-hub` or `/api/inbound/evidence` with `reviewCycleId` set; then **Approve evidence**; then Calculate. For combined priority: submit customer → RSE → Hub on `IV-SHARED-01`; expect Hub qty **55** selected.

---

## Upload recipe (IT-02 — valid complete)

1. Create or open Internal Validation Review Cycle on Decision Board path.  
2. Operations view → Keystroke upload.  
3. Upload **SCBSRSE3.XLS** + **TRUEDEMANDREPLISHMENT-STANDARD.XLS** + **TRUEDEMANDREPLENISHMENT-MATRIX.XLS**.  
4. Merge → **Approve evidence** → Calculate · Score · Present.  
5. Confirm Recommendations appear; Active Priorities ≤ OEC.

## Partial / invalid recipes

| Scenario | Files |
|----------|--------|
| IT-03 partial | Inventory only **or** demand only |
| IT-04 conflict | Both Standard + Matrix (parent exclusion) |
| IT-05 empty | New cycle, no uploads / calculate without evidence |

---

## Confirmation

| Check | Status |
|-------|--------|
| Pack frozen under `samples/frozen-v1/` | **Met** |
| Keystroke hashes recorded | **Met** |
| Evidence Package fixtures for RSE / Hub / customer / combined | **Met** |
| Standalone + RSE + Hub + combined covered | **Met** |
| Classification files | **Excluded** from freeze |

**Dataset Owner (Facilitator):** ________ **Date:** ________
