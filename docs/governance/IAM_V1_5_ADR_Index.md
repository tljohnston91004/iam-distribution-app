# IAM Version 1.5 — Architecture Decision Record Index

| Field | Value |
|-------|--------|
| **Document ID** | IAM-V15-ADR-INDEX |
| **Governing** | IAM-000 §8; ADR-IAM-001 Change control |
| **Rule** | No architecture-affecting implementation without updating the applicable ADR first. |

| ADR ID | Title | Status | Date | Path | Notes |
|--------|-------|--------|------|------|-------|
| ADR-IAM-001 | Canonical Inbound Port and Replaceable Source Adapter Architecture | Accepted | 2026-07-21 | [`../architecture/ADR-IAM-001-Canonical-Inbound-Port-and-Replaceable-Source-Adapter-Architecture.md`](../architecture/ADR-IAM-001-Canonical-Inbound-Port-and-Replaceable-Source-Adapter-Architecture.md) | Controlling V1.5 integration architecture |

## Change-control reminder

Before any change to layering, canonical contracts, ownership boundaries, idempotency keys, quantity-basis rules, or Hub replaceability:

1. Update the ADR (or add a superseding ADR)  
2. Document the reason  
3. Obtain approval  
4. Then implement  

## Future ADR slots (not yet opened)

| Tentative ID | Topic | Open when |
|--------------|-------|-----------|
| ADR-IAM-002 | Recommendation / Review Cycle physical data model & migration | Phase 1 design freeze |
| ADR-IAM-003 | Scoring profile (interim vs final) | When SD-1 resolved or interim waiver approved |
| ADR-IAM-004 | Presentation category persistence | When SD-13 resolved |
| ADR-IAM-005 | Authentication / tenancy model | Phase 6 |
