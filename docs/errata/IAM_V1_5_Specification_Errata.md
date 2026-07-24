# IAM Version 1.5 — Specification Errata (Kickoff)

| Field | Value |
|-------|--------|
| **Document ID** | IAM-V15-ERRATA |
| **Governing** | Specification Consistency Report; Project Owner interpretations |
| **Status** | Kickoff — documentation corrections only; does not change approved product intent where clarifications already control |

| Errata ID | Issue | Correction / controlling interpretation | Spec docs | Status | Date |
|-----------|-------|----------------------------------------|-----------|--------|------|
| E-001 | IAM-000 package map swaps Freeze vs V2 backlog numbering vs uploaded IAM-014/015 content | **Content authoritative**; treat uploaded IAM-014 as V2 backlog and IAM-015 as freeze | IAM-000, IAM-014, IAM-015 | Accepted interpretation | 2026-07-21 |
| E-002 | IAM-012A reuses FR-001…FR-010 with different meanings than IAM-003 | Remap 012A IDs (e.g. VAL-/TR- prefix); requirements text remains authoritative | IAM-003, IAM-012A | Open (doc fix) | 2026-07-21 |
| E-003 | IAM-001 §8.4 omitted Defer | Defer is first-class; IAM-001 incomplete on that list | IAM-001; clarification | Accepted interpretation | 2026-07-21 |
| E-004 | IAM-005 listed Holdover as sequential workflow step | Holdover is Decision Board lane; not mandatory LS state | IAM-005; clarification; IAM-007B | Accepted interpretation | 2026-07-21 |
| E-005 | IAM-002 combined Executive Reviewer/Auditor | Distinct permission profiles (may combine on one user) | IAM-002; clarification | Accepted interpretation | 2026-07-21 |
| E-006 | IAM-007 vs 007A assignment cardinality wording | Prefer 0..1 active Assignment | IAM-007, IAM-007A | Open (doc fix) | 2026-07-21 |
| E-007 | IAM-006 vs 006A required output lists differ | Harmonize; COI and priority category required per 006 + clarifications | IAM-006, IAM-006A | Open (doc fix) | 2026-07-21 |
| E-008 | V1 hard rule “Keystroke = .txt” vs analytical XLS exports | `.txt` = re-import/write-back only; analytical intake = Keystroke exports (XLS) | V1 hard-rules; Integration Assessment; ADR-IAM-001 | Accepted interpretation | 2026-07-21 |
| E-009 | IAM-007C incomplete vs 007/007A entities; section numbering | Expand dictionary in Phase 1 design; fix numbering | IAM-007C | Open (Phase 1 doc+schema) | 2026-07-21 |
| E-011 | Precedence of Decision Module vs interim evidence-generated Recommendations | **SD-17:** Module Recommendation authoritative for same opportunity; no duplicate from evidence path; evidence may enrich; interim evidence-generated only if no module Recommendation; consolidate before ranking/Board; all Decision Modules. No ADR update unless conflict with ADR-IAM-001. | ADR-IAM-001; Project Owner 2026-07-21 | Accepted | 2026-07-21 |

*Full external Word/PDF re-issue of vendor specs is not required for Phase 0; this errata + clarifications + ADR control interpretation in-repo.*
