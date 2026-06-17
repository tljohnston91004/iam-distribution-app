# IAM Stage 2 — Data and Logic (Complete)

Documents loaded: **03** Data Model, **04** Calculation Logic, **10** RSE/IFM Signal Map

## Implemented

### Data model (doc 03 — Build First tables)

- `source_documents`, `field_mappings`
- `inventory_snapshots`, `demand_history`, `receipt_history_summary`, `incoming_supply`
- `action_candidates`, `actions`, `grouped_action_items`, `notes`, `action_history_archive`
- Extended `module_signals` (category + integration status)

### Intake

- `POST /api/runs/[runId]/upload` — spreadsheet inventory / demand / supply
- `POST /api/runs/[runId]/import-signals` — RSE/IFM signal JSON (doc 10 minimum viable)
- `POST /api/seed` — sample validation SKUs

### Calculation (doc 04)

- Cash-led ranking with fixed V1 weights (`src/lib/iam/constants.ts`)
- Service/operational risk override when ratio ≥ 1.5× cash score
- Confidence modifies score strength, not lead factor
- Separate holdover lane (existing holdover actions preserved)
- Top 2 featured — **no auto-backfill** on rejection
- Candidate types: Trapped Cash, Stock Risk, Reduce/Pause Replenishment

### Workflow

- `POST /api/actions/[actionId]/transition` — state machine with no-reopen guard
- Owner + due/review date required leaving Featured status
- Archive record on transition to Archived

## Try it

```bash
npm run dev
```

1. Create run → open run workspace
2. **Load sample data** → **Calculate & rank**
3. Optional: **Import sample RSE/IFM signals** → recalculate
4. **Approve** or **Reject for cycle** on featured items

## Stage 3 next

- Screen workflow (doc 05): Action Detail View, Assigned User View, Archive View
- Outputs/exports (doc 06)
- Playbook routing (doc 09)
