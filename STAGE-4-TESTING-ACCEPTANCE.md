# IAM Stage 4 — Testing and Acceptance (Complete)

Documents loaded: **07** Sample Test Data & Expected Results, **08** Developer Acceptance Checklist, **UAT Workbook v1.1**

## Implemented

### Automated validation (doc 07)

| Layer | Location | Coverage |
| ----- | -------- | -------- |
| Unit tests | `src/lib/iam/validation/unit-tests.ts` | SC-001–SC-012, pass/fail matrix, playbook follow-up |
| Integration tests | `src/lib/iam/validation/integration-tests.ts` | Full DB pipeline: calculate, reject, archive, notes, exports |
| Orchestrator | `src/lib/iam/validation/run-all.ts` | Combines unit + integration + UAT workbook check |
| Acceptance mapping | `src/lib/iam/validation/acceptance-checklist.ts` (in run-all) | Doc 08 checklist auto-status from test results |

### Scenario fixtures (doc 07 sample run)

Extended validation dataset (7 SKUs):

- **SKU-100** — trapped cash (SC-001)
- **SKU-200 / SKU-210** — stock risk + service override (SC-002, SC-003)
- **SKU-300** — management-priority elevation (SC-007)
- **SKU-500** — low confidence (SC-009)
- **SKU-600** — grouped action with partial child resolution (SC-006)
- **featuredSlot 3** — material 3rd priority (SC-008)

Load on any run:

```bash
POST /api/seed/validation  { "runId": "<run-id>" }
```

Or use **Load validation scenarios** from the run workspace (after calculate).

### UAT workbook (doc 08)

- Expected path: `docs/workbooks/IAM_UAT_Validation_Test_Workbook_v1_1.xlsx`
- Copy from Desktop: `npm run docs:extract`
- Metadata reader: `src/lib/iam/validation/uat-workbook.ts`

The workbook remains the **formal manual pass/fail control**; automated tests are the regression backbone.

### UI & CLI

| Entry | Purpose |
| ----- | ------- |
| `/validation` | Dashboard — run tests, view doc 08 checklist |
| `npm run validate` | Full validation (unit + integration) — exit 1 on failure |
| `npm run validate:unit` | Unit tests only (no DB writes) |
| `POST /api/validation/run` | Programmatic full run |

### Shared visibility helpers

- `src/lib/iam/notes.ts` — `filterNotesForView`, `exportContainsProtectedContent`

## Run validation

```bash
npm install
npm run db:push
npm run validate
```

Open [http://localhost:3002/validation](http://localhost:3002/validation) for interactive results.

## Readiness levels (doc 08)

| Level | Meaning | This build |
| ----- | ------- | ---------- |
| Level 3 | Functional test ready | Achieved when core screens + workflow work |
| Level 4 | Controlled validation ready | Achieved when `npm run validate` reports 0 failures |

## Known limitations (honest)

- UAT workbook execution is **manual** — automated tests map to SC-xxx scenarios but do not write pass/fail into the xlsx
- Keystroke `.txt` tab-delimited export is deferred (CSV used for review/QA per spec)
- Production readiness (Level 5) is out of scope for V1 validation build

## All stages complete

IAM V1.0 validation-stage build package is fully loaded (docs 00–10 + UAT workbook).
