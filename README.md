# IAM — Inventory Action Manager (Distribution) · V1.0

IAM is the inventory action engine in the **DPOS-Distribution** family.
It answers: **What inventory action matters most now, who owns it, and how do we keep current work and completed history clearly separated?**

This app is a **sibling** to the RSE and IFM distribution apps and mirrors their stack and conventions.

**Version 1.5:** Phase authorization — [`docs/IAM_V1_5_Phase_Authorization_Register.md`](./docs/IAM_V1_5_Phase_Authorization_Register.md). Running status — [`docs/IAM_V1_5_Implementation_Dashboard.md`](./docs/IAM_V1_5_Implementation_Dashboard.md). ADR — [`docs/architecture/ADR-IAM-001-Canonical-Inbound-Port-and-Replaceable-Source-Adapter-Architecture.md`](./docs/architecture/ADR-IAM-001-Canonical-Inbound-Port-and-Replaceable-Source-Adapter-Architecture.md). Plan — [`docs/IAM_V1_5_Implementation_Plan.md`](./docs/IAM_V1_5_Implementation_Plan.md). No phase implementation until the Project Owner marks that phase **Authorized**.

| Module | Role |
|--------|------|
| **RSE** | Replenishment settings — identifies what inventory may need buying |
| **IFM** | Funding priority — decides which purchases can be funded now |
| **IAM** | Action priority — decides what inventory action to execute first |

## Stack

- Next.js 15 (App Router) + React 19
- TypeScript (strict), `@/*` path alias → `src/*`
- Prisma 6 + SQLite (`data/iam.db`)
- `xlsx` for spreadsheet intake and UAT workbook

## Build package

Authoritative specs are in [`docs/specs`](./docs/specs), extracted from **`Desktop/IAM-Dist/`** (docs 00–10 plus control files).

| Stage | Documents | Status |
| ----- | --------- | ------ |
| 1 — Foundation | 00, 01, 02 + Build Brief v1.3 | ✅ complete — `STAGE-1-FOUNDATION.md` |
| 2 — Data and Logic | 03, 04, 10 (RSE/IFM map) | ✅ complete — `STAGE-2-DATA-LOGIC.md` |
| 3 — Workflow and Outputs | 05, 06, 09 (playbooks) | ✅ complete — `STAGE-3-WORKFLOW-OUTPUTS.md` |
| 4 — Testing and Acceptance | 07, 08 + UAT workbook | ✅ complete — `STAGE-4-TESTING-ACCEPTANCE.md` |

Start Cursor with [`docs/CURSOR_MASTER_PROMPT_IAM_v1_0.md`](./docs/CURSOR_MASTER_PROMPT_IAM_v1_0.md).

## Getting started

```bash
npm install
cp .env.example .env
npm run db:push
npm run dev
```

Open [http://localhost:3002](http://localhost:3002) (IAM uses port 3002 so it can run beside RSE on 3000 and IFM on 3001).

### Validation (Stage 4)

```bash
npm run validate          # unit + integration tests
npm run validate:unit     # unit tests only
```

Interactive results: [http://localhost:3002/validation](http://localhost:3002/validation)

## Project layout

```
iam-distribution-app/
├── docs/
│   ├── specs/              # IAM-Dist docs 00–10 (extracted .txt)
│   ├── workbooks/          # UAT validation workbook (.xlsx)
│   └── CURSOR_MASTER_PROMPT_IAM_v1_0.md
├── prisma/schema.prisma    # Full data model (Stage 2+)
├── data/iam.db             # Local SQLite (gitignored)
└── src/
    ├── app/                # Pages + API routes
    └── lib/iam/            # Enums, engine, workflow, exports, playbooks
```

## Regenerate spec text from Desktop

```bash
npm run docs:extract
```

Source: `C:\Users\Terry Johnston\Desktop\IAM-Dist\`
