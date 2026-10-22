# IAM ↔ DPOS Data Hub integration (Stage 4A foundation)

Branch `workshop/dpos-iam-integration` (from IAM `main @ b48e212`, the V1.5 baseline). Stage 4A is a **foundation** only:
identity, company context, eligibility, Data Hub input client, refresh scheduling, Results Return producer/outbox, and the
canonical core persistence structures. It contains **no** Decision Board V4, no Inventory Management Health Score, no
final scoring/ranking change, no action recommendation engine and no closeout/learning logic. V1.5 behaviour is unchanged
in the default `STANDALONE_LEGACY` mode. IAM is **not** marked Implementation Ready.

Baseline record: [`baseline/V1_5_BASELINE.md`](baseline/V1_5_BASELINE.md).

## 1. Modes

| `IAM_DEPLOYMENT_MODE` | Behaviour |
| --- | --- |
| unset / `STANDALONE_LEGACY` (default) | V1.5 exactly as before. No DPOS code path is active; routes are pass-through; no workers are started. |
| `DPOS_INTEGRATED` | Every V1.5 API route and page is behind the eligibility guard; the instance is bound to exactly one DPOS company; `/api/dpos/*` endpoints exist; optional scheduler + outbox flusher start via `src/instrumentation.ts`. Invalid or missing configuration is an explicit, closed failure (HTTP 503 / "not available" page) — never a silent default. |

## 2. Architecture (src/lib/dpos)

| Module | Responsibility |
| --- | --- |
| `config.ts` | Environment parsing/validation. No hard-coded paths, hosts, company ids or secrets. Secrets are referenced by the **name** of an environment variable only. |
| `company-context.ts` | One installation ↔ one DPOS company binding (`dpos_company_bindings`). Missing/mismatched company ⇒ reject; no default company. |
| `service-identity.ts` | IAM service identity (`dpos_service_identities`): issue, list, revoke; company + installation scoped, audited, revocable. Dedicated least-privilege capabilities `datahub.iam_results_return.write` / `.read` and `datahub.iam_governed_input.read` (service-to-service only; never granted to a user role; generic source/canonical/lineage keys are refused at issuance). `WorkshopServiceIdentityProvider` issues in workshop; `DposIdentityPlatformProvider` is the production seam and throws `501` until the platform can issue (documented gap). |
| `eligibility.ts`, `access-guard.ts` | Installed → Entitled → Implementation Ready → Enabled → User Authorized, enforced by IAM using the DPOS Stage 1B `module-access` runtime (fail closed). The service path never grants end-user access. Front-door trust uses a credential read from a named env var. |
| `with-access.ts`, `dpos-route.ts`, `page-gate.tsx` | Wrap the 28 V1.5 API routes, the new `/api/dpos/*` routes and the 9 pages. |
| `data-hub-client.ts` | Governed Data Hub HTTP client: input status, paged input records (`OPEN_PURCHASE_ORDER_LINE`, `CUSTOMER_BACKORDER_LINE`), sync status, Results Return submit. parentSku = `Stck#`, childPartOrVariant = `Class`, no normalization. No raw Keystroke reads. |
| `refresh.ts`, `scheduler.ts` | Manual refresh and the Sunday 02:00 company-local scheduler (IANA zone, DST rules, catch-up, bounded retry). No scoring. Missing/invalid zone ⇒ recorded failure, never a UTC fallback. |
| `outbox.ts`, `fixtures.ts`, `contract/` | Persisted-before-send Results Return outbox, `IAM_RESULTS_RETURN_V1` (vendored, hash-pinned contract), fixture events. |
| `core.ts` | Canonical persistence: candidate (A), immutable system recommendation (B), separate management-approved plan (C), ownership (D), execution-state structure (E), outcome structure (F). E and F are structures only (not calculated). |
| `migrate/` | Governed migration tooling (scripts/tests only). |
| `background.ts`, `src/instrumentation.ts` | Optional scheduler + outbox flusher (integrated mode and `IAM_SCHEDULER_ENABLED=true` only). |

### Operator endpoints (integrated mode only, always eligibility-enforced)

- `GET /api/dpos/status` – binding, eligibility, identity, refresh and outbox summary.
- `GET|POST /api/dpos/refresh` – refresh status / manual refresh (backend operation, no scoring).
- `GET|POST /api/dpos/outbox` – outbox summary / flush; `POST /api/dpos/outbox/{id}` `{action:"release"|"correct"}`.

## 3. Configuration

See the commented block in `.env.example`. Nothing there contains a secret; credentials are referenced by env-var **name**
(`IAM_SERVICE_CREDENTIAL_ENV`, `IAM_FRONT_DOOR_CREDENTIAL_ENV`). Validate with `npm run dpos:admin -- config-check`.

## 4. Migrations (additive only)

- `20260724000000_v1_5_baseline` – the V1.5 schema exactly as shipped (30 tables).
- `20261021100000_stage4a_core_integration_foundation` – 15 new tables, no `ALTER`/`DROP` of any V1.5 table.
  Constraint triggers enforce: candidates are never deleted/reopened; system recommendations are append-only; plans,
  ownership, execution state and outcomes freeze when a candidate is closed; the outbox is never deleted and its
  `producerEventId` is immutable; audit and attempt ledgers are append-only.

Commands (`npm run dpos:migrate -- <command>`):

```
status                              # what would happen (no change)
apply --dry-run --yes               # structural + digest checks, no change
apply --yes [--database <file>] [--backup-dir <dir>]
rollback-4a --yes [--allow-data-loss]   # runs down.sql; refuses if Stage 4A tables hold data unless --allow-data-loss
```

`apply` on a legacy `db push` database: (1) a verified `VACUUM INTO` backup, (2) structural-equality proof against the
baseline, (3) `migrate resolve --applied` for the baseline, (4) deploy Stage 4A, (5) per-table legacy fingerprint
(row count + order-independent digest) compared before/after, with automatic restore from the backup on any mismatch.
Re-running is a no-op (`ALREADY_CURRENT`).

## 5. V1.5 data

Legacy data stays readable and unchanged (PO decision 4A-D5). Legacy V1.5 records are never auto-converted into canonical
active candidates; they remain legacy/history. Any future promotion must be explicit, reviewable, evidence-backed,
reversible/recoverable and Product Owner approved - no such logic exists. No mappings are invented and no legacy test board
is promoted to a canonical candidate. In integrated mode the existing company/run/recommendation queries are scoped to the bound company.

## 6. Tests

```
npm run test:dpos-4a      # Stage 4A suite (129 tests incl. a live test against the real Data Hub application)
npm run test:regression   # all 15 V1.5 scripts on an isolated temp database, baseline + Stage 4A
```

`tests/dpos/live-data-hub.test.ts` imports the real DPOS `buildDataHubApp`. `DPOS_REPO_ROOT` must be set explicitly to a
DPOS checkout (no path is searched, guessed or encoded; the test is skipped visibly if it is absent) and drives IAM's real client/outbox against it over loopback HTTP. All tests use throw-away databases; the real
`data/iam.db` is never opened.

## 7. Admin tooling

`npm run dpos:admin -- <config-check | bind-company | update-binding | issue-identity | list-identities | revoke-identity | fixture-run [--send]>`

## 8. Known gaps (see the Stage 4A implementation report in the DPOS repository)

- Production service-identity issuance (identity platform) is not available; workshop identity only. The Data Hub
  allow-list and permission grant are operator actions.
- The shipped DPOS module registry keeps IAM `operationalService:false`, so IAM stays not Implementation Ready.
- The vendored contract copy must be replaced by the published `@dpos/shared` package when it is available
  (`npm run dpos:sync-contract -- --check` detects drift).
- The front door does not yet forward `x-dpos-allowed-modules` and IAM is not proxied yet.

## 9. Product Owner closeout decisions (4A-D1 to 4A-D9)

- **D1** Production service identities are issued by Decision Priority during customer implementation through a governed operator/admin process (company/installation scoped, revocable, auditable, never a user). Workshop/test identities are marked `WORKSHOP` and are kept separate. Production configuration is never hand-edited with identities.
- **D2** IAM reads governed input only through the dedicated capability `datahub.iam_governed_input.read` (no generic source/canonical/lineage permission, no unrestricted Data Hub access).
- **D3** The relocated DPOS worktree is accepted for development. The old path is a TEMPORARY junction and is not referenced by any source, release metadata or configuration (a test scans for it). A clean normal path is required before customer-ready release verification.
- **D4** `IAM_DEPLOYMENT_MODE` unset means standalone. Integrated mode is intentional and fails closed on missing/invalid configuration.
- **D5** No automatic conversion of legacy V1.5 records (see section 5).
- **D6** Data Hub stays authoritative for governed input data. IAM persists only run references, freshness metadata, snapshots/evidence references, candidate/action history, audit and outcome history - never the full governed dataset.
- **D7** The vendored, hash-pinned contract is temporary. **Pre-customer-release requirement:** consume the published `@dpos/shared` package; DPOS and IAM contract definitions must not drift.
- **D8** Front-door IAM proxy/user routing is deferred; the current front-door enforcement architecture is unchanged.
- **D9** Stage 4A is committed and pushed separately in each repository on workshop branches; neither is merged to main.
## 10. Stage 4B: governed candidate workflow (src/lib/dpos/workflow)

Additive migration `20261021140000_stage4b_workflow` (13 tables, append-only ledgers, vocabulary and closed-candidate triggers;
`rollback-4b` removes it). Clean domain/service functions (no page, route or session coupling): evidence -> grouped candidate ->
presented -> management decision (approve / reject / suppress / escalate / risk accept / return for review) -> responsible
department -> task owner -> owner acceptance (or Request Discussion) -> active action -> progress and condition-reduction tracking
-> aging / escalation (Management Decision Required) -> completion -> management validation -> Completed History.

- The system recommendation is immutable; the management plan is a separate, versioned record with a mandatory deviation reason.
- A CLOSED candidate (rejected / risk-accepted, or formally closed in the later closeout stage) is never reopened; a returning condition is a NEW candidate linked as a recurrence.
- Action completion and condition reduction are stored and sent separately; reduction is only computed against a valid baseline.
- Every meaningful transition writes its Results Return event(s) to the Stage 4A outbox in the same transaction; meaningless changes
  write none. No scoring, ranking, Health Score, recommendation engine or closeout learning exists in this stage (4C and later).
- Production identity mapping for actors (who is a manager / task owner) is deferred; the API takes an explicit `WorkflowActor`.
- Product Owner review corrections (4B-D1..D7): the Data Hub preserves `actionStartedAt` / `actionCompletedAt` when later events omit them; management decisions are explicit (`MANAGEMENT_DECISION_REQUIRED` then `MANAGEMENT_DECISION_RESOLVED`, emitted by IAM whenever the requirement is resolved); `NOT_STARTED` is a first-class contract status (reported by `OWNER_ACCEPTED`); Completed History is execution completion only (`executionCompleted = true`, `closeoutCompleted = false`, candidate not closed, no outcome written; new evidence waits for the later closeout stage); a pause never extends the target dates (reactivation re-evaluates against the original target); `domainScore` / `domainRank` are deferred to Stage 4C and stay null (supplying them is refused). Contract revision `1.0-r4b`, vendored hash in `CONTRACT-SOURCE.json`.
- Tests: `npm run test:dpos-4a` runs the whole `tests/dpos` suite (4A + 4B, including live Data Hub tests).
## 11. Stage 4C: deterministic scoring, ranking and priority publication (src/lib/dpos/scoring)

Additive migration `20261021200000_stage4c_scoring` (6 tables: scoring inputs, scoring runs, score results, priority governance
ledger, forced reviews, emergency reviews; append-only, vocabulary and closed-candidate triggers; `rollback-4c` removes it,
refused while Stage 4C data exists). Scoring version `IAM_PRIORITY_SCORING_V1`, configuration `IAM_PRIORITY_CONFIG_V1`
(`scoring/config.ts` holds every approved number as data; the whole configuration and its SHA-256 are stored with every run).

- The IAM 100-point model: Cash 30, Profitability 15, Inventory Exposure 15, Operational Risk 15, Customer & Revenue 10,
  Time Sensitivity 10, Actionability 5; confidence multipliers (High 1.00 / Medium 0.95 / Low 0.85; Insufficient is not ranked and
  is routed to data investigation); six modifiers with caps of +15 / -15 (individual, uncapped and capped values are preserved);
  final score = confidence-adjusted core + capped modifiers, clamped to 0..100; bands Critical 85+, High 70, Moderate 55, Watch 40.
  Ratio bands are compared with exact integer arithmetic. There is no hidden factor: unknown input fields are refused.
- `runScoring` is one governed transaction per company: it scores every OPEN canonical candidate in the new-candidate pool,
  orders them (the approved 12-step tie-break, then explicit manual management tie-break, then a flagged deterministic id
  fallback), assigns the calculated `domainRank` and the displayed (management) rank, selects the Top 2 (qualified >= 70, never
  filled, new candidates only), raises emergency-review candidates (triggers A-E; management confirms), forced reviews
  (Critical outside Top 2, repeated rejection, additional emergency, suppression re-review, data investigation, possible double
  counting) and writes the Results Return events. A repeated run key returns the stored run.
- IAM is authoritative for `domainScore` and `domainRank`; DPOS never overwrites them. Overrides, rank locks, strategic
  authorizations and manual tie-breaks are append-only governance records (stable DPOS user id, role, reason, time); they take
  effect at the next scoring run and never edit the calculated values. Rank locks last at most one weekly cycle; scoring still runs.
- Publication: `CANDIDATE_SCORED` (first score, or a changed score / rank / band) and `DOMAIN_PRIORITY_CHANGED` (override, lock,
  flags, displayed rank, emergency confirmation / decline / clearing), plus the dedicated 4B governance events `PLAN_REVISED`,
  `RETURNED_FOR_REVIEW`, `PAUSE_REQUESTED`, `PAUSE_APPROVED`, `PAUSE_DENIED`. Condition reduction is signed and never clamped; a zero or
  missing baseline is published as `NOT_MEASURABLE`. Contract revision `1.0-r4c`.
- Not in this stage: the Inventory Management Health Score, the IAM Decision Board V4 / any scoring UI, the full Recommended
  Action Plan UI, closeout and learning logic, DPOS enterprise ranking, and any RSE/PRE business-logic change.
- Tests: `tests/dpos/scoring-pure.test.ts` (engine), `scoring-run.test.ts` (governed runs, ranking, governance, database guards) and
  `live-scoring-4c.test.ts` (real Data Hub). `npm run test:dpos-4a` runs the whole `tests/dpos` suite.
