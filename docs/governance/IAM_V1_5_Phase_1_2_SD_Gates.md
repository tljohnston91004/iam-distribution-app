# IAM Version 1.5 — Phase 1–2 Specification Decision Gates

| Field | Value |
|-------|--------|
| **Document ID** | IAM-V15-SD-GATES-P1-P2 |
| **Purpose** | Confirm which open SDs block Phase 1–2 vs which may proceed under documented waiver/interim |
| **Date** | 2026-07-21 |

| Decision ID | Status | Phase 1 | Phase 2 | Gate type |
|-------------|--------|---------|---------|-----------|
| SD-4 Keystroke in baseline | Resolved (Yes — adapter) | OK | **Required** | Closed |
| SD-12 Idempotency keys | Resolved | **Required** | Required | Closed |
| SD-15 QOH basis | Resolved (Available preferred) | **Required** | Required | Closed |
| SD-16 Case-break ownership | Resolved (outside core) | OK | Adapter-only if fields appear | Closed |
| SD-13 Presentation persistence | Open | **Interim allowed** if documented (A-004) | N/A | Soft gate |
| SD-10 Grouped actions | Open | Defer schema commitment or keep nullable legacy | N/A | Soft gate — do not invent |
| SD-1 Scoring formulas | Open | Does not block Port/schema | Does not block adapter | Hard gate for **Phase 4 final** only |
| SD-7 RBAC | Open | Does not block Port | Does not block adapter | Hard gate for **Phase 6** |
| RSE/PRE contracts | Open | Port must accept Recommendation Package shape | Evidence only from Keystroke | Hard gate for **Phase 7 completeness** |
| SD-2, SD-3, SD-8, SD-9, SD-11, SD-14 | Open | Not required to start Phase 1 | Not required for Phase 2 | Later phases |
| SD-17 Module vs interim evidence precedence | **Resolved** | **Required** — schema/intake must support attach-evidence + no-duplicate | Adapter must not emit duplicate Recommendations when module ID exists | Closed |

## Phase 1 entry recommendation (for Project Owner)

Phase 1 **may** be authorized after Phase 0 completion approval **without** resolving SD-1, SD-2, SD-3, SD-7, SD-8, SD-9, SD-11, or RSE/PRE contracts, provided:

- ADR-IAM-001 remains unmodified unless a change is formally approved  
- SD-13 interim persistence (if used) is recorded in Assumptions Log  
- SD-10 does not expand into undocumented Grouped Action product scope  
- **SD-17** is implemented as: Decision Module Recommendations authoritative; no duplicate from evidence path; evidence may enrich; consolidate before rank/Board; all modules  

Phase 0 completion was **Approved** 2026-07-21. Phase 1 remains **Waiting for Authorization** until the Project Owner explicitly authorizes it.

## Phase 2 entry recommendation

Phase 2 **may** follow Phase 1 completion using resolved SD-4/12/15/16/17; no new hard blockers identified beyond Phase 1 completion approval.
