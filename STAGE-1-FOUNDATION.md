# IAM Stage 1 — Foundation (Complete)

Stage 1 documents loaded: **00**, **01**, **02**, **IAM Cursor Build Brief v1.3**

Checkpoint per package guide: summarize understanding, hard rules, build plan, and gaps **before** Stage 2 code.

---

## 1. What IAM is

**Inventory Action Manager — Distribution** is the inventory **action engine** in DPOS-Distribution.

It answers:

> Based on inventory conditions, demand evidence, cash impact, service/operational risk, and confidence — **what inventory action matters most now**, what should be approved or rejected **this cycle**, who owns approved work, and how unfinished work moves to holdover or completed/archive?

IAM sits **between analysis and execution**:

| Question | Owner | IAM role |
|----------|-------|----------|
| Replenishment settings? | **RSE** | May reference signals only |
| Funding / capital discipline? | **IFM** | May reference context only |
| What action matters most now? | **IAM** | Surface, rank, workflow |
| Who approves / owns? | Management + IAM | Approval, assignment, follow-through |
| PO / settings changes? | POS/ERP/buyer | IAM does **not** execute in V1 |

IAM is **not**: replenishment engine, PO system, write-back tool, ERP replacement, or a dashboard without action discipline.

---

## 2. Locked hard rules (must not violate)

### Product boundary
- IAM does not replace RSE, IFM, or Decision OS.
- V1 is a **validation-stage** build — prove core workflow before enterprise layers.
- **One company per workspace** in V1.

### Priority logic (weights fixed in V1)
- **Cash impact leads** by default.
- Service/operational risk overrides only when **clearly more dangerous** (high threshold).
- Urgency is **not** a separate top-level ranking factor.
- Confidence **modifies strength/certainty** — not the lead ranking factor.
- **New priorities and holdovers rank separately.**

### Weekly featured work-package cycle
- Surfacing unit is the **work package** (shared action type + vendor/business case), not a lone SKU.
- **Top 2 work packages** = core management-focus priorities for the week.
- Ranked **Candidate packages** may be **released to execution** without using a featured slot.
- Management **approves or rejects** featured packages in the same cycle.
- **Rejected featured packages do not auto-replace** with lower-ranked packages — week may end with **zero** approved featured packages.
- Approved / released packages need **owner + due/review date**.
- Unresolved featured packages → **holdover** at week end.
- Management may **elevate** packages; material out-of-cycle events may create a **3rd featured package**.
- Management-priority packages stay active **outside** the normal top-2 focus cycle.

### Grouped actions
- One business decision case, **one owner**, **one action type**.
- Handled inside **Action Detail View** — **no separate grouped screen** in V1.

### Archive / history
- **Completed and archived actions never reopen.**
- Similar later issues = **new action IDs**.

### Visibility
- **Management-only notes** protected — never in ordinary views or ordinary exports.

### Source mapping
- Do **not** block build waiting for perfect Keystroke/AIMS mapping.
- Keystroke import-ready files: **tab-delimited `.txt` only**.

---

## 3. V1 workflow states (minimum)

```
Featured → Approved → Awaiting Acceptance → Active → Completed → Archived
Featured → Rejected for Cycle → (future cycle evaluation)
Featured → Approved → Active → Holdover → Completed → Archived
```

States: Featured, Approved, Rejected for Cycle, Awaiting Acceptance, Active, Holdover, Paused, Completed, Archived.

---

## 4. Required V1 build components (from doc 01)

| Component | Stage |
|-----------|-------|
| Run Setup | ✅ Stage 1 scaffold |
| Source-agnostic intake + mapping | Stage 2 (doc 03) |
| Priority engine (top 2 + rejection rules) | Stage 2 (doc 04) |
| Workflow engine (states above) | Stage 2–3 |
| Management-priority / 3rd priority | Stage 2–3 |
| Grouped actions (Action Detail View) | Stage 3 |
| Archive / history (no reopen) | Stage 2–3 |
| Role / visibility + protected notes | Stage 3 |
| Minimal functional UI (4 core screens) | Stage 3 |
| Outputs / exports | Stage 3 |
| UAT + acceptance (doc 07–08, workbook) | Stage 4 |

### Core screens (V1)
1. Management Dashboard
2. Assigned User View
3. Action Detail View (includes grouped actions)
4. Completed Archive View

---

## 5. Stage 2 build plan (next — do not start until confirmed)

1. **Data model** — implement doc 03 tables/fields on top of foundation schema.
2. **Ranking logic** — doc 04: cash-led scoring, fixed weights, separate new vs holdover lanes.
3. **State machine** — transitions with rejection-no-backfill and no-reopen rules enforced in code.
4. **RSE/IFM signals** — doc 10 exchange map (read-only intake first).

---

## 6. Known gaps / honest deferrals

| Gap | Treatment |
|-----|-----------|
| Final Keystroke/AIMS field mapping | Separate addendum — use manual upload + mapped domains for validation |
| Full doc 03 field inventory | Stage 2 first deliverable |
| Sample test scenarios | Stage 4 (doc 07) |
| Playbook library routing detail | Reference doc 09 during Stage 3 Action Detail |

---

## 7. Code artifacts (Stage 1)

| File | Purpose |
|------|---------|
| `src/lib/iam/enums.ts` | Controlled workflow + run enums |
| `src/lib/iam/constants.ts` | Fixed V1 limits (top 2, weights placeholder) |
| `src/lib/iam/hard-rules.ts` | Machine-readable rule checklist for tests |
| `prisma/schema.prisma` | Foundation schema extended for workflow categories |

---

## Stage 1 sign-off

- [x] Package 00–02 + Build Brief v1.3 reviewed
- [x] Hard rules documented
- [x] Build plan for Stage 2 written
- [x] Gaps stated honestly
- [x] Foundation enums + constants in code
- [ ] User confirms → proceed to **Stage 2**
