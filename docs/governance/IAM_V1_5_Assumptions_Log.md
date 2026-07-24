# IAM Version 1.5 — Assumptions Log

| Field | Value |
|-------|--------|
| **Document ID** | IAM-V15-ASSUMPTIONS |
| **Governing** | IAM-000 §8; Implementation Plan Phase 0 |
| **Rule** | Record material technical assumptions. Do not invent unresolved business behavior—use the Questions Log / SD register. |

| Assumption ID | Assumption | Rationale | Risk if wrong | Affected phases | Status | Date logged | Superseded by |
|---------------|------------|-----------|---------------|-----------------|--------|-------------|---------------|
| A-001 | ADR-IAM-001 remains the controlling integration architecture for V1.5 | Project Owner accepted Integration Boundary Design and ADR | Hub replaceability or module boundaries break | 1–9 | Active | 2026-07-21 | — |
| A-002 | Keystroke remains V1.5 baseline as Evidence adapter only (not Recommendation engine) | SD-4 resolved; ADR-IAM-001 | Wrong intake scope or permanent dual engines | 1–2, 7 | Active | 2026-07-21 | — |
| A-003 | Available QOH preferred; On-Hand fallback; both + basis retained | ADR-IAM-001 / SD-15 | Incorrect cash/WOS inputs | 1–2, 4 | Active | 2026-07-21 | — |
| A-004 | Phase 1 uses interim presentation-category persistence on `Recommendation.presentationCategory` / `presentationRank` (SD-13 still open). Allowed values: top_2, emergency, holdover, **deferred**, managed_backlog, completed_presentation, archived_history. Not lifecycle states. Default `managed_backlog`. **deferred** = V1.5 Deferred Presentation Rule (Project Owner 2026-07-21). | Implementation Plan Phase 1; SD-13 soft gate; PO clarification 2026-07-21 | Rework of Board placement storage in Phase 4–5 | 1, 4–5 | Active | 2026-07-21 | — |
| A-005 | Phase 4 may ship an explicitly labeled interim scoring profile if SD-1 remains open, only with Project Owner waiver | Implementation Plan Phase 4 | Non-final rankings in pilot | 4, 8–9 | **Active — applied** 2026-07-21 (`interim_v1_cash_led`) | 2026-07-21 | Phase 4 Completion Report |
| A-006 | Existing V1.0 SQLite / Prisma app is the migration baseline; no greenfield rewrite required for V1.5 | Gap Analysis reuse estimate | Underestimated rewrite | 1–2 | Active | 2026-07-21 | — |
| A-007 | Document content overrides filename/numbering inconsistencies (e.g. IAM-014/015) | Project Owner final interpretation | Wrong freeze vs backlog artifact | 0, 9 | Active | 2026-07-21 | — |
| A-008 | Evidence-only recommendation generation is interim/legacy and must be labeled—not the permanent Decision Module replacement. When both a Decision Module Recommendation and an interim evidence-generated candidate exist for the same underlying business opportunity, the Decision Module Recommendation is authoritative; no duplicate Recommendation; evidence may enrich the authoritative Recommendation; consolidate before ranking/Board. Applies to all Decision Modules (**SD-17**). | ADR-IAM-001; SD-17 Project Owner 2026-07-21 | IAM absorbs RSE/PRE responsibilities or duplicate Board items | 1, 2, 4, 7 | Active | 2026-07-21 | — |
| A-010 | SD-17 does not require an ADR-IAM-001 amendment unless implementation reveals a conflict with the Inbound Port / adapter boundaries | Project Owner 2026-07-21 | Unexpected ADR stop-work mid Phase 1–4 | 1–4, 7 | Active | 2026-07-21 | — |
