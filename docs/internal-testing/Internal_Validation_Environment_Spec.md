# IAM Version 1.5 — Internal Validation Environment Spec

| Field | Value |
|-------|--------|
| **Document** | Internal Test Environment Spec |
| **Cycle** | Internal Validation — IAM V1.5 / EEP Decision Board |
| **Date** | 2026-07-21 |
| **Status** | Confirmed for Entry (local isolated SQLite) |

---

## 1. Isolation statement

| Item | Value |
|------|--------|
| **Machine** | Local workstation — Terry Johnston Desktop |
| **Application root** | `C:\Users\Terry Johnston\Desktop\iam-distribution-app` |
| **Runtime** | Next.js `npm run dev` via Desktop **Start IAM** / **Fix and Start IAM** |
| **Host / port** | `http://127.0.0.1:3002` |
| **Database (production/customer)** | **None** — no remote production IAM; local SQLite only |
| **Customer Design Partner data** | **Not used** in this cycle |

This environment is **isolated from production and customer systems**. Test activity uses local files under the application `data\` directory only.

---

## 2. Database files (isolation)

| File | Purpose |
|------|---------|
| `data\iam.db` | Day-to-day local DB (do not treat as production) |
| `data\iam-internal-validation-baseline-backup.db` | Snapshot taken at Entry setup (restore source) |
| `data\iam-internal-validation.db` | **Dedicated Internal Validation cycle database** |

### How to run against the Internal Validation DB

1. Stop IAM (close Start IAM window).  
2. In `.env`, temporarily set:  
   `DATABASE_URL="file:../data/iam-internal-validation.db"`  
3. Run **Fix and Start IAM** (or `npx prisma generate` + `npm run db:push` + Start IAM).  
4. After the cycle, restore `.env` to `file:../data/iam.db` if returning to day-to-day use.

**Reset procedure (dry-run documented):**

1. Stop IAM.  
2. Copy `data\iam-internal-validation-baseline-backup.db` → overwrite `data\iam-internal-validation.db`.  
3. Or delete `iam-internal-validation.db` and run `npm run db:push` for a clean schema.  
4. Restart IAM.  
5. Re-upload **Frozen Dataset Pack** (`docs/internal-testing/samples/frozen-v1/`).

**Dry-run status:** Procedure documented 2026-07-21. Facilitator must perform one physical reset dry-run before scenario Day 1 and initial the line below.

| Dry-run performed by | Date | Initials |
|----------------------|------|----------|
| | | |

---

## 3. Accounts / access

| Item | Value |
|------|--------|
| Authentication | None (soft `viewAs` only) — limitation L-ACCESS-01 |
| Personas | Executive / Operations / Owner via Board toggle |
| `performedBy` strings | `executive-user` · `operations-user` · `owner-user` |

---

## 4. Configuration defaults for cycle

| Setting | Value |
|---------|--------|
| OEC (start) | **2** (adjust only per scenario IT-06) |
| Aging days | **14** (lower temporarily only for IT-09, then restore) |
| Approved UI scope | **Decision Board path only** (`/runs/[runId]`); no legacy Action pages |

---

## 5. Confirmation

| Check | Status |
|-------|--------|
| Isolated local SQLite | **Met** |
| No production/customer data | **Met** |
| Port 3002 local only | **Met** |
| Reset procedure documented | **Met** |
| Reset dry-run executed | **Pending Facilitator** (PO may accept as Day-0 action) |

---

## Explicit stop

Environment Spec filed for Internal Validation Entry. No Design Partner data.
