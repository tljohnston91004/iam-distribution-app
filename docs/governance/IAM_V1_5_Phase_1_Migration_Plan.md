# IAM Version 1.5 — Phase 1 Data Migration Plan

| Field | Value |
|-------|--------|
| **Document ID** | IAM-V15-P1-MIGRATION |
| **Phase** | 1 |
| **Date** | 2026-07-21 |
| **ADR** | ADR-IAM-001 |

## Strategy

Phase 1 **adds** canonical V1.5 tables and fields alongside the V1.0 `Action` / `ActionCandidate` model. No destructive rename of `iam_runs` or deletion of legacy action tables in Phase 1.

| Artifact | Phase 1 treatment |
|----------|-------------------|
| `IamRun` | Remains physical Review Cycle; documented as Review Cycle synonym |
| `Action` / `ActionCandidate` | **Legacy bridge** for existing UI/workflow until Phases 3–5 |
| `Recommendation` (+ assignments, contributors, financial impacts) | **New** primary entity for inbound Recommendations |
| `EvidenceBatch` + inventory/demand provenance fields | **New** Evidence Package persistence |
| `GovernanceDecision`, `WorkflowEvent`, `AuditEvent` | **New** (parallel to `ChangeLog`; ChangeLog remains for V1 paths) |
| Keystroke `UploadBatch` | Unchanged; Phase 2 will feed Inbound Port |

## Applied migration (local SQLite)

- `npx prisma db push` syncs additive schema to `data/iam.db`
- Existing inventory/demand rows keep defaults: `entity_eligibility=rankable`, nullable QOH basis fields

## Future phases

| Phase | Migration work |
|-------|----------------|
| 2 | Keystroke Adapter emits Evidence Packages into Inbound Port (may dual-write or replace direct merge) |
| 3 | Map lifecycle to LS-* on `Recommendation`; retire Featured/Holdover-as-state on Action |
| 5–6 | UI/RBAC consume Recommendation; optional backfill Action→Recommendation |
| 9 | Drop legacy Action tables only after dual-run acceptance |

## Rollback

- Restore prior `schema.prisma` from git and re-push, or restore `data/iam.db` backup
- New tables can be dropped without affecting V1 Action flows if Phase 1 inbound APIs are unused
