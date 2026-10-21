# IAM V1.5 baseline record (captured BEFORE any Stage 4A code change)

This is the standalone behavioural baseline that the DPOS integration must preserve. It was recorded from
`main @ b48e21273745814942ecdb443f26bc7c8db19c56` ("Add Start IAM desktop launchers that pull latest main", 2026-10-17)
before any file in the working tree was changed. The workshop branch is `workshop/dpos-iam-integration`, created from that
commit. IAM `main` and `integration/dpos-iam` are not modified by Stage 4A.

**Product Owner verification (recorded, not re-judged here):** before Stage 4A the Product Owner manually verified that
IAM V1.5 launches, that the existing review cycle opens, and that the existing Decision Board renders. The V1.5 UI is not
considered defective; Stage 4A does not redesign it.

## 1. Commit and schema

| Item | Value |
| --- | --- |
| Commit | `b48e21273745814942ecdb443f26bc7c8db19c56` |
| `prisma/schema.prisma` git blob at the commit | `3ef23db24107f47fa35b808552169194b9f62651` (636 lines) |
| Verbatim copy | `docs/dpos-integration/baseline/schema.v1.5.prisma` (equality with `git show b48e212:prisma/schema.prisma` is asserted by `tests/dpos/baseline-and-migration.test.ts`) |
| Datasource | SQLite, `DATABASE_URL="file:../data/iam.db"` |
| Tables | 30 (`@@map` names, see section 8) |
| Migration history in the V1.5 database | none — the database was created with `prisma db push` |

Every V1.5 model and enum is asserted byte-identical in the Stage 4A schema (the test compares each `model`/`enum`
block). Stage 4A only appends new `Dpos*` / `IamCore*` models.

## 2. Application routes (28 route handlers, 9 pages, 1 layout)

Pages: `/`, `/validation`, `/companies/[companyId]/config`, `/runs/new`, `/runs/[runId]`,
`/runs/[runId]/recommendations/[id]`, `/runs/[runId]/assigned`, `/runs/[runId]/archive`,
`/runs/[runId]/actions/[actionId]`.

API: `/api/runs`, `/api/runs/[runId]` (+ `calculate`, `cycle/lock`, `evidence`, `evidence/data-hub`, `evidence/rse`,
`export`, `import-signals`, `keystroke`, `merge`, `presentation`, `upload`), `/api/actions/[actionId]` (+ `notes`,
`transition`), `/api/recommendations/[id]` (+ `coi/adjust`, `notes`, `progress`, `transition`),
`/api/companies/[companyId]` (`carrying-cost-rate`, `oec`), `/api/inbound/{evidence,recommendations,status/[batchId]}`,
`/api/seed`, `/api/seed/validation`, `/api/validation/run`.

Header text: "Decision Priority · IAM Version 1.5".

## 3. Scoring implementation (V1.5)

`src/lib/iam/scoring/` (`run.ts`, `score.ts`, `profile.ts`, `types.ts`) and `src/lib/iam/scoring/revised/`
(`calculate.ts`, `config.ts`, `bands.ts`, `emergency.ts`, `tie-break.ts`); impact `src/lib/iam/engine/impact-score.ts`.
Active profile: `revised_v1_decision_priority` (100-point factor model). Stage 4A does **not** change any of it.

## 4. Review-cycle model

A Review Cycle is an `iam_runs` row (`IamRun`): `runStatus`, `cycleStatus` (Open | Locked | Closed), `cycleLockedAt`,
`evidenceApprovalStatus` (draft | pending_approval | approved), `runVersion`/`parentRunId`. Recommendations,
financial impacts, actions, evidence batches and upload staging all hang off the run. Cycle lock rejects governed
transitions for that cycle.

## 5. Action / workflow model

Lifecycle LS-01 … LS-11 (`src/lib/iam/lifecycle/`), with `Archived` terminal; legacy workflow states
(`workflow-states.ts`, `workflow-transitions.ts`, `workflow.ts`); action plans attached by `lib/iam/actions/`.
Assignments and contributors are separate tables with history.

## 6. Archive / no-reopen behaviour

Completed and Archived records are terminal: transitions out of them are rejected, and archive moves rows to
`action_history_archive`. The Stage 4A canonical model (`iam_core_*`) deliberately mirrors this rule (service checks plus
database triggers) and never reopens a closed candidate — a recurrence is a new, linked candidate.

## 7. Tests at the baseline (clean temp database, never `data/iam.db`)

| Script | Result |
| --- | --- |
| validate:unit | exit 0 (the script prints some UAT lines marked ✗ yet exits 0 — pre-existing, not changed) |
| test:phase1-inbound | 8/8 |
| test:phase2-keystroke | 16/16 |
| test:phase2-closure | 9/9 |
| test:phase3-lifecycle | 14/14 |
| test:phase3-closure | 7/7 |
| test:phase4-scoring | 14/14 |
| test:phase5-board | 8/8 |
| test:phase5a-experience | 9/9 |
| test:unified-ingestion | exit 0 |
| test:classification-segment | exit 0 |
| test:prescribed-action-plan | exit 0 |
| test:revised-scoring | 28/28 |
| test:coi | 22/22 |
| test:carrying-cost-rate | 8/8 |

Total: 15/15 scripts exit 0. Reproduce with `npm run test:regression -- --baseline-only`.

Type-check baseline (`tsc --noEmit`): **53 pre-existing errors in 4 files** — 49 in `src/lib/iam/lifecycle/engine.ts`,
2 in `src/lib/iam/presentation/defer-status.ts`, 1 in `src/app/runs/[runId]/assigned/page.tsx`, 1 in
`scripts/run-carrying-cost-rate-tests.ts`. They are V1.5 issues, were not "fixed" in Stage 4A, and Stage 4A adds none.

## 8. Database inventory (a copy of the Product Owner's working database; the original is never touched)

`action_candidates` 22, `action_history_archive` 2, `actions` 26, `audit_events` 1597, `change_logs` 82, `companies` 7,
`company_configuration_changes` 5, `data_gaps` 8, `demand_history` 54180, `evidence_batches` 15, `evidence_conflicts` 0,
`field_mappings` 230, `financial_impacts` 1538, `governance_decisions` 15, `grouped_action_items` 6, `iam_runs` 17,
`incoming_supply` 11296, `inventory_snapshots` 109860, `module_signals` 4, `notes` 4, `receipt_history_summary` 0,
`recommendation_assignment_history` 6, `recommendation_assignments` 3, `recommendation_contributors` 0,
`recommendation_notes` 0, `recommendations` 1538, `source_documents` 31, `upload_batches` 27,
`upload_staging_rows` 287759, `workflow_events` 18 (30 tables).

Preservation rule for Stage 4A: none of these structures is deleted or repurposed, and no row is changed. Migration proof
(row counts + order-independent digests of all 30 legacy tables before/after) is in the Stage 4A implementation report.
