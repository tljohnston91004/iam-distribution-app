# IAM Stage 3 — Workflow and Outputs (Complete)

Documents loaded: **05** Screen Workflow, **06** Outputs and Exports, **09** Playbook Routing

## Implemented

### Screen workflow (doc 05)

| Screen | Route | Purpose |
| ------ | ----- | ------- |
| Management Dashboard | `/runs/[runId]` | Featured priorities, banners, holdovers, exports |
| Action Detail View | `/runs/[runId]/actions/[actionId]` | Full review, playbook, notes, transitions |
| Assigned User View | `/runs/[runId]/assigned` | Owner queue — accept and progress work |
| Completed Archive View | `/runs/[runId]/archive` | Completed + archived history (read-only) |

- `IamRunNav` — navigation between the four workflow screens
- `ActionDetailPanel` — role-aware transitions (`?viewAs=management|owner`)
- Management-only protected notes (hidden from owner view and ordinary exports)
- Grouped action child items displayed on detail view
- State history from `change_logs`

### Outputs and exports (doc 06)

- `GET /api/runs/[runId]/export?type=management` — management summary CSV
- `GET /api/runs/[runId]/export?type=tracker` — action tracker CSV
- `GET /api/runs/[runId]/export?type=archive` — archive CSV
- Export filenames follow `IAM_Management_{Company}_{Date}_Summary_v1.csv` pattern
- Dashboard banners + next-best-action guidance (`src/lib/iam/banners.ts`)

### Playbook routing (doc 09)

- `recommendPlaybook()` maps action type + detail to recovery playbooks
- Shown on Action Detail View with follow-up measurement flag
- Included in management export CSV

### APIs added

- `POST /api/actions/[actionId]/notes` — management-only protected notes

## Try it

```bash
npm run dev
```

1. Open a run → **Load sample data** → **Calculate & rank**
2. **Open & review** a featured priority → approve or reject
3. **My Assigned Actions** → **Accept & start** → mark progress on detail view
4. Complete and archive → **Completed Archive** → download archive CSV
5. On dashboard: export management summary and action tracker

## Stage 4 next

- Sample validation tests (doc 07)
- Acceptance criteria (doc 08)
- UAT workbook execution (`docs/workbooks/`)
