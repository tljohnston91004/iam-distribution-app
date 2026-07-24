# IAM Version 1.5 — Phase 2 Completion Report

| Field | Value |
|-------|--------|
| **Phase** | 2 — Keystroke Adapter → Evidence Packages |
| **Authorization** | Project Owner, 2026-07-21 |
| **Report date** | 2026-07-21 |
| **Prepared by** | Cursor (implementation agent) |
| **Completion Approved by Project Owner** | **Pending** |

---

## 1. Deliverables completed

| Deliverable | Location / notes | Status |
|-------------|------------------|--------|
| Keystroke as replaceable source adapter outside IAM Core | `src/lib/iam/adapters/keystroke/*` | Done |
| All supported Keystroke evidence via Canonical Inbound Port | `mergeKeystrokeViaInboundPort` → `upsertEvidenceBatch` | Done |
| Legacy Keystroke merge bypass eliminated | `src/lib/iam/keystroke/merge.ts` re-exports port path only; no direct snapshot writes | Done |
| IAM Core free of Keystroke parsing/filenames/aliases/spreadsheet rules | Inbound port unchanged (no Keystroke imports); Core mapping/intake stripped of Keystroke rules; generic upload rejects Keystroke | Done |
| Canonical Evidence Package + provenance | Source system, file, batch key, import timestamp, source row ref | Done |
| Approved Keystroke rules (XLS, ID, Matrix/Standard, aliases, STK#0, Available/On-Hand + basis) | Adapter `aliases`, `file-types`, `stage-upload`, `merge-via-port`, `matrix-parents` | Done |
| Case-break not in IAM (SD-16) | Documented; only parent/scheme exclusion for ranking eligibility | Done |
| EvidenceBatch idempotency (ADR-IAM-001) | Stable keys `keystroke:inventory:{runId}`, `keystroke:demand:{runId}` | Done |
| Hub replaceability confirmed | Smoke test `P2-HUB` — DataHub adapter uses same port; Core unchanged | Done |

**Phase 3 was not started.**

---

## 2. Files created / modified / removed / deprecated

### Created

| Path | Role |
|------|------|
| `src/lib/iam/adapters/keystroke/index.ts` | Adapter public API |
| `src/lib/iam/adapters/keystroke/aliases.ts` | Field aliases; STK# `0` exclusion |
| `src/lib/iam/adapters/keystroke/file-types.ts` | Filename/report identification; checklist |
| `src/lib/iam/adapters/keystroke/matrix-parents.ts` | Matrix parent / shared-scheme exclusion (not case-break) |
| `src/lib/iam/adapters/keystroke/stage-upload.ts` | XLS staging into `UploadBatch` / `UploadStagingRow` |
| `src/lib/iam/adapters/keystroke/merge-via-port.ts` | Build Evidence Packages → Inbound Port |
| `scripts/run-phase2-keystroke-adapter-tests.ts` | Phase 2 automated suite |
| `docs/phase-reports/IAM_V1_5_Phase_2_Completion_Report.md` | This report |

### Modified

| Path | Change |
|------|--------|
| `prisma/schema.prisma` | `UploadStagingRow.availableQoh`, `sourceRowRef` |
| `src/app/api/runs/[runId]/keystroke/route.ts` | Uses adapter; typed Keystroke errors |
| `src/app/api/runs/[runId]/merge/route.ts` | Calls `mergeKeystrokeViaInboundPort` |
| `src/lib/iam/intake.ts` | Blocks Keystroke / Keystroke filenames on generic intake |
| `src/lib/iam/mapping.ts` | Generic aliases only (Keystroke rules removed) |
| `src/lib/iam/constants.ts` | Renamed Keystroke-specific export |
| `src/lib/iam/inbound/port.ts` | Type fix for createMany row arrays (no behavior change) |
| `package.json` | Script `test:phase2-keystroke` |
| `docs/IAM_V1_5_Implementation_Dashboard.md` | Phase 2 Ready for Review |
| `docs/IAM_V1_5_Phase_Authorization_Register.md` | Phase 2 Ready for Review |
| `docs/governance/IAM_V1_5_Technical_Debt_Register.md` | TD-001 / TD-008 resolved |

### Deprecated (thin re-exports — no direct Core Keystroke logic)

| Path | Notes |
|------|-------|
| `src/lib/iam/keystroke/file-types.ts` | Re-exports adapter |
| `src/lib/iam/keystroke/matrix-parents.ts` | Re-exports adapter |
| `src/lib/iam/keystroke/stage-upload.ts` | Re-exports adapter |
| `src/lib/iam/keystroke/merge.ts` | **Legacy bypass disabled** — re-exports `mergeKeystrokeViaInboundPort` only |

### Removed

None (legacy paths retained as deprecated re-exports for import safety).

---

## 3. Keystroke adapter structure and responsibilities

```
adapters/keystroke/
  aliases.ts        Column aliases; isExcludedSummarySku (STK# 0)
  file-types.ts     Classify SCBSRSE3 / INVENTORYPOSITION / TrueDemand Replenishment|Classification; Matrix|Standard; checklist
  matrix-parents.ts Shared Matrix+Standard parents + inferred parent.variant templates (eligibility only)
  stage-upload.ts   Parse XLS → UploadBatch staging (no Core evidence writes)
  merge-via-port.ts Normalize → Evidence Packages → upsertEvidenceBatch only
  index.ts          Public exports
```

**Responsibilities:** detect supported reports; map headers; exclude STK# `0`; prefer Available QOH / fall back to On-Hand; retain both + `quantityBasisUsed`; Matrix/Standard merge eligibility; preserve provenance; submit packages to the Canonical Inbound Port.

**Not responsibilities:** case-break multipliers (RSE / SD-16); Board placement; scoring; lifecycle; governance decisions.

---

## 4. Legacy bypass path

| Check | Result |
|-------|--------|
| Direct Prisma inventory/demand writes from Keystroke merge | **Removed** — merge only calls Inbound Port |
| API `/api/runs/[runId]/merge` | Uses `mergeKeystrokeViaInboundPort` |
| Generic `/upload` for Keystroke | **Disabled** — rejects Keystroke source/filenames |
| Risk **R-P2-01** | **Fully resolved** |

---

## 5. Exclusive Canonical Inbound Port entry

Keystroke merge builds Evidence Packages with:

- `sourceSystem: "Keystroke"`
- `evidenceBatchKey: keystroke:inventory:{iamRunId}` / `keystroke:demand:{iamRunId}`
- `sourceFileName`, `asOfTimestamp`, `contentIdentity`
- Items with `sourceRowRef`, QOH fields, `quantityBasisUsed`

All resulting `InventorySnapshot` / `DemandHistory` rows are linked to `EvidenceBatch` (`P2-PORT` pass).

---

## 6. IAM Core contains no Keystroke-specific logic

| Area | Confirmation |
|------|----------------|
| `src/lib/iam/inbound/*` | No Keystroke imports or filenames/aliases |
| `src/lib/iam/mapping.ts` | Generic intake aliases only |
| `src/lib/iam/intake.ts` | Explicitly refuses Keystroke; no KS rules |
| Scoring / Board / workflow | Unchanged this phase; no Keystroke added |

---

## 7. Mappings, transformations, aliases, exclusions, fallbacks

| Rule | Behavior |
|------|----------|
| Supported XLS | Inventory: SCBSRSE3 / INVENTORYPOSITION; Demand: TrueDemandReplenishment (Standard/Matrix); Classification staged but ignored for W13 merge |
| SKU aliases | STOCK #, STOCK#, Stock#, STK#, SKU, … |
| On-Hand aliases | On-Hand Qty, On Hand, QOH, … |
| Available QOH aliases | Available QOH, Available Qty, Avail QOH |
| Cost / value / desc / units / dollars / open order | See `aliases.ts` |
| STK# `0` | Excluded before staging and evidence |
| SD-15 | Available preferred; On-Hand fallback; both retained; `quantityBasisUsed` = `available_qoh` \| `on_hand` |
| Matrix + Standard | Union by Stock#; shared parents + inferred `parent.variant` parents excluded from ranking inputs |
| Classification | Not used for 13-week demand |
| Case-break | **Not implemented in IAM** (SD-16 / RSE) |
| Inventory value | Cost × basis quantity when Ext Cost absent |

---

## 8. Tests executed and results

| Suite | Result |
|-------|--------|
| `npm run test:phase2-keystroke` | **16/16 PASS** |
| `npm run test:phase1-inbound` | **8/8 PASS** (regression) |

### Phase 2 cases

| ID | Coverage | Result |
|----|----------|--------|
| P2-STK0 | STK#0 exclusion helper | PASS |
| P2-UNSUP | Unsupported report/file type | PASS |
| P2-MAL | Malformed empty buffer | PASS |
| P2-MISS | Missing required filename | PASS |
| P2-ALIAS | Header aliases + STK#0 out of staging | PASS |
| P2-QOH-AVAIL | Available QOH selection | PASS |
| P2-QOH-FALL | On-Hand fallback | PASS |
| P2-QOH-AVAIL-ONLY | Available-only row | PASS |
| P2-STK0-MERGE | STK#0 excluded from evidence | PASS |
| P2-PROV | Provenance (system/file/batch/row) | PASS |
| P2-PORT | Exclusive Inbound Port entry | PASS |
| P2-IDEM | Repeat import idempotency | PASS |
| P2-DUP | Duplicate batch submission | PASS |
| P2-FTYPE | Filename/report identification | PASS |
| P2-HUB | Hub replaceability smoke | PASS |
| P2-REQ | Missing required QOH fields | PASS |

---

## 9. ADR-IAM-001 conformance

| Criterion | Result |
|-----------|--------|
| Adapters normalize to canonical packages | **Pass** |
| Core depends on packages / port, not source layout | **Pass** |
| Keystroke parsing outside Core | **Pass** |
| EvidenceBatch idempotency | **Pass** |
| Hub can replace Keystroke without Core/port contract change | **Pass** (`P2-HUB`) |
| Adapter does not set Board/scores/workflow/governance | **Pass** |
| ADR updated before implementation? | **N/A** — no ADR amendment |

---

## 10. SD-15, SD-16, SD-17 conformance

| Decision | Result |
|----------|--------|
| **SD-15** Available preferred; On-Hand fallback; retain both + basis | **Pass** (adapter + port; tests) |
| **SD-16** Case-break outside IAM | **Pass** — not implemented; parent eligibility only |
| **SD-17** Module Recommendations authoritative | **Pass** — Phase 2 did not add interim recommendation generation from Keystroke; port rules unchanged |

---

## 11. New Specification Decisions / architectural issues

| Item | Notes |
|------|-------|
| New SDs | **None** |
| Architectural issues | **None** requiring ADR update |
| Architecture Closure (2026-07-21) | Generic `/upload` and calculate interim path corrected to Port / Recommendation architecture (see §15) |

---

## 12. Risk R-P2-01

**Fully resolved.** Keystroke no longer bypasses the Canonical Inbound Port; legacy merge direct writes are disabled.

---

## 13. Recommendation whether to authorize Phase 3

**Yes — recommend authorizing Phase 3** (Lifecycle, governance, and workflow engine) after Project Owner approves Phase 2 completion (including Architecture Closure).

**Phase 3 is not authorized by this report.** Cursor will not begin Phase 3 until the Phase Authorization Register marks Phase 3 **Authorized**.

---

## 14. Explicit stop (initial Phase 2 delivery)

Initial Phase 2 delivery stopped pending Project Owner review. Architecture Closure completed subsequently (§15).

---

## 15. Phase 2 Architecture Closure (2026-07-21)

Project Owner accepted the Canonical Architecture Compliance Report and directed limited corrective work within Phase 2 (not Phase 3).

### Corrections completed

| Item | Disposition |
|------|-------------|
| Generic `/upload` | **Corrected** — `intakeSpreadsheet` normalizes to Evidence Package; persists only via `upsertEvidenceBatch`. No direct inventory/demand/supply writes. |
| Legacy V1 calculate → Action | **Corrected** — `runIamCalculatePipeline` creates `generationPath: interim_evidence` Recommendations via `upsertRecommendations` (SD-17). Does not create new `Action` / `ActionCandidate` records. Historical Holdover Actions retained. |
| Runtime `evidence_source` product setting | **Not a Phase 2 blocker** — logged as **TD-009**, target Phase 7 (Hub connectors) / Phase 9 hardening. Provenance already records `sourceSystem` on EvidenceBatch. |

### Files touched (closure)

| Path | Change |
|------|--------|
| `src/lib/iam/intake.ts` | Port-only generic upload |
| `src/lib/iam/engine/calculate-pipeline.ts` | Interim Recommendations; no new Actions |
| `src/lib/iam/inbound/types.ts` | `backorderQuantity`, `presentationRank` |
| `src/lib/iam/inbound/port.ts` | Supply backorder; presentationRank; SD-17 enrich preserves module impacts |
| `src/lib/iam/validation/integration-tests.ts` | Seed via Port; INT cases aligned to Recommendations |
| `scripts/run-phase2-architecture-closure-tests.ts` | New suite (`test:phase2-closure`) |
| `package.json` | `test:phase2-closure` script |

### Closure tests

| Suite | Result |
|-------|--------|
| `npm run test:phase2-closure` | **9/9 PASS** |
| `npm run test:phase1-inbound` | **8/8 PASS** (regression) |
| `npm run test:phase2-keystroke` | **16/16 PASS** (regression) |

### Phase 2 status after closure

**Ready for Completion Approval.** Architectural bypasses around the Canonical Inbound Port and Recommendation architecture for evidence entry and evidence-generated recommendations have been removed. ADR-IAM-001 inbound/adapter layer remains freeze-ready. Phase 3 not started.
