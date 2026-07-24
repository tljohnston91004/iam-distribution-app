# ADR-IAM-001 — Canonical Inbound Port and Replaceable Source Adapter Architecture

| Field | Value |
|-------|--------|
| **ADR ID** | ADR-IAM-001 |
| **Title** | Canonical Inbound Port and Replaceable Source Adapter Architecture |
| **Status** | Accepted |
| **Product** | Inventory Action Manager (IAM) |
| **Product version** | 1.5 |
| **Date** | 2026-07-21 |
| **Authority** | Controlling IAM Version 1.5 integration architecture |
| **Related** | IAM-001, IAM-007/007A/007C, IAM-008, IAM-009; Integration Boundary Design (approved); Integration Reference Assessment; Gap Analysis SD-4, SD-12, SD-15, SD-16 |

---

## Context

IAM Version 1.5 must ingest inventory and demand evidence from Keystroke (and later from the Decision Priority Data Hub) and must ingest qualified opportunities from Decision Priority modules (RSE, PRE, IFM, and others) without absorbing those modules’ analytical responsibilities.

The existing repository includes Keystroke-specific stage/merge logic tightly coupled to run evidence tables. Version 1.5 requires that Keystroke remain in the baseline while remaining replaceable. IAM core (scoring, Decision Board, lifecycle, governance, RBAC, reporting) must not depend on Keystroke filenames, spreadsheet layouts, Matrix/Standard heuristics, or Hub transport details.

This ADR formalizes the approved Integration Boundary Design as the controlling integration architecture for IAM Version 1.5.

---

## Decision

1. **IAM core depends only on canonical inbound contracts:**
   - **Evidence Package** — normalized inventory, demand, supply, and related item attributes for a Review Cycle.
   - **Recommendation Package** — qualified opportunities from Decision Modules (or interim controlled paths), never raw Keystroke report rows as Recommendations.

2. **Keystroke is included in Version 1.5 as a replaceable source adapter** that produces canonical **Evidence Packages** only. It does not write Decision Board placement, scores, workflow transitions, assignments, or governance decisions.

3. **The future Decision Priority Data Hub** connects through an adapter or connector that produces the **same** canonical Evidence Package and Recommendation Package contracts. Replacing Keystroke with the Hub must not require changes to IAM scoring, Decision Board, lifecycle, governance, RBAC, or reporting behavior.

4. **Source-specific logic remains outside IAM core**, including: parsing, mapping, filename/report detection, Matrix/Standard rules, summary-row exclusions (e.g. Stock# `0`), period identification (e.g. W13 vs classification window), parent/template eligibility, and related normalization.

5. **Decision Modules submit Recommendations** through the canonical Recommendation Package using at minimum:
   - `source_module`
   - `source_recommendation_id`  
   These fields form the **primary recommendation idempotency key**.

6. **IAM core owns:** Recommendation intake (via the Inbound Port), Review Cycles, ranking and presentation, Decision Board, workflow and governance, assignments and contributors, audit, outcome validation, and reporting.

7. **Adapters must never directly create** Decision Board placement, scores, workflow transitions, assignments, or governance decisions.

8. **Quantity basis:** **Available QOH** is the preferred usable inventory quantity when reliably supplied. **On-Hand Qty** is the fallback. Both values, when present, and the **quantity basis used** must be retained for provenance and reproducibility.

9. **Case-break, packaging, parent/child multiplier, and Keystroke write-back** remain owned by RSE, the source adapter, or the future Data Hub—not IAM core. Analytical Keystroke exports (e.g. `.XLS`) are distinct from Keystroke re-import/write-back formats (e.g. tab-delimited `.txt` / IMP.EXE), which are out of IAM Version 1.5 write-back scope.

10. **Raw evidence** may support confidence, validation, explainability, and **interim** recommendation generation. IAM must **not** become the permanent replacement recommendation engine for Decision Modules. Evidence-only recommendation generation must be identified as a **controlled interim or legacy path**.

---

## Architectural layers

```text
┌──────────────────────┐  ┌──────────────────────┐
│ Keystroke Adapter    │  │ Data Hub Adapter     │
│ (V1.5 baseline)      │  │ (future)             │
└──────────┬───────────┘  └──────────┬───────────┘
           │  Evidence Package       │ Evidence + Recommendation Packages
           │  (and optional attrs)   │
           └────────────┬────────────┘
                        ▼
           ┌────────────────────────┐
           │ IAM Inbound Port       │
           │ validate · idempotent  │
           │ upsert · provenance    │
           └────────────┬───────────┘
                        ▼
           ┌────────────────────────┐
           │ IAM Core               │
           │ Evidence store         │
           │ Recommendations        │
           │ Scoring · Board · WF   │
           │ Governance · Audit     │
           │ Reporting              │
           └────────────────────────┘
```

| Layer | Responsibility | Forbidden |
|-------|----------------|-----------|
| **Source adapters** | Transport I/O; source auth; report detection; alias mapping; Matrix/Standard and eligibility normalization; period labeling; batch identity | Scoring; Top 2 / Emergency placement; lifecycle; Defer/Approve/Assign; product RBAC rules |
| **IAM Inbound Port** | Contract validation; idempotent upsert; provenance; structured rejection; integration audit events | Keystroke/Hub-specific parsing; Board/workflow mutation |
| **IAM Core** | All product behavior listed under Decision §6 | Source filenames, XLS layouts, Matrix∩Standard heuristics, Hub topic names |

**Configuration seam:** Per environment/company, select `evidence_source` (e.g. KeystrokeAdapter | DataHubAdapter | Manual) and `recommendation_sources` (e.g. RSE, PRE). Core branches only on presence/validity of canonical data—not on adapter brand inside scoring or workflow.

---

## Canonical contract summaries

### Evidence Package

Logical contents (transport-agnostic):

| Element | Description |
|---------|-------------|
| `review_cycle_id` | Target IAM Review Cycle |
| `evidence_batch_id` | Idempotent load identity for the batch |
| `source_system` | e.g. `Keystroke`, `DataHub` |
| `source_report_type` | Normalized enum (not raw filename) |
| `as_of_timestamp` / freshness | Confidence and audit |
| `items[]` | Per-SKU normalized rows |

**Item fields (minimum / preferred):**

- `sku_or_item_id`
- `quantity_on_hand` (On-Hand Qty when supplied)
- `available_qoh` (Available QOH when supplied)
- `quantity_basis_used` — `available_qoh` \| `on_hand` (required when inventory is applied)
- `unit_cost`, optional open order qty, sold/received dates
- Demand: `period_code` (e.g. `W13`), `units_sold`, `sales_dollars`
- Optional attributes: description, class, vendor, hidden/closeout/service
- `entity_eligibility` — e.g. `rankable` \| `excluded_non_entity` (set by adapter; core honors it)

**Evidence idempotency (summary):** `review_cycle_id` + report slot / `source_report_type` (+ variant) + content identity (e.g. hash) + `source_system`, per Integration Reference Assessment.

### Recommendation Package

| Element | Description |
|---------|-------------|
| `source_module` | RSE, PRE, IFM, IPM, PDM, VPM, … |
| `source_recommendation_id` | Stable ID from the owning module |
| `sku_or_item_id` | Optional link to evidence |
| `recommendation_type`, title, rationale / evidence refs | Explainability |
| Impact / risk / confidence / COI fields as available | Scoring inputs when provided |
| `source_payload_ref` / hash | Traceability |

**Primary recommendation idempotency key:** `(source_module, source_recommendation_id)`.

Stock# alone is an item key, not a recommendation idempotency key.

### Inbound Port operations (logical)

1. `UpsertEvidenceBatch(package)`
2. `UpsertRecommendations(batch)`
3. `GetIngestionStatus(batch_id)`
4. Structured reject on invalid payloads (no silent corruption)

Adapters never call scoring, Board placement, or workflow APIs as a side effect of ingest.

---

## Consequences

### Benefits

- Keystroke can ship in V1.5 without blocking Data Hub.
- IAM product behavior stays module-boundary clean (IAM-001 / IAM-008).
- Scoring, Board, lifecycle, governance, RBAC, and reporting remain testable against stable contracts.
- Recommendation deduplication is well-defined for module integrations.
- Quantity basis is reproducible for audit and explainability.
- Clear ownership: RSE/Hub/adapters own source normalization and write-back; IAM owns execution accountability.

### Risks

- Interim evidence-only recommendation generation may be mistaken for the permanent module engine if not labeled and gated.
- Dual paths (Keystroke evidence + module Recommendations) require explicit precedence rules during transition.
- Incomplete module contracts (RSE/PRE payloads) delay full IAM-008 compliance even with a correct port.
- Adapter bugs in eligibility/QOH basis can skew scores without failing core validation if packages are “valid” but wrong.
- Refactoring the current tightly coupled Keystroke merge into an adapter + port is non-trivial migration work.

### Transitional considerations

- **V1.5 baseline:** Keystroke Adapter → Evidence Packages → Inbound Port → evidence store; existing calculate path may still generate interim candidates from evidence under a **controlled interim/legacy** flag and documentation.
- **Module Recommendations:** Introduced via Recommendation Package as RSE/PRE (and other) contracts become available; prefer module Recommendations when present.
- **Data Hub:** Add Hub adapter emitting the same packages; switch `evidence_source` / recommendation connectors by configuration; retire or idle Keystroke when Hub SLA is accepted.
- **Write-back:** Remains out of IAM core; `.txt` / IMP.EXE paths stay RSE-owned.
- **Case-break / packaging multipliers:** Not implemented as IAM core rules; await adapter/Hub/RSE field availability (see open dependencies).

### Replaceability acceptance criteria

The architecture is satisfied when:

1. IAM core has **no** dependency on Keystroke report names, spreadsheet headers, or Matrix/Standard merge rules.
2. A Data Hub adapter can complete a Review Cycle by emitting only canonical Evidence and Recommendation Packages.
3. Switching adapters requires **no** changes to scoring, Decision Board, lifecycle, governance, RBAC, or reporting **behavior**.
4. Audit/provenance records `source_system`, batch IDs, recommendation source IDs, both QOH fields when known, and `quantity_basis_used`.
5. Adapters cannot create Board placement, scores, workflow transitions, assignments, or governance decisions.
6. Evidence-only recommendation generation, if present, is explicitly marked interim/legacy and is not the permanent module replacement path.

### Open dependencies

- Live **RSE→IAM** and **PRE→IAM** Recommendation Package field dictionaries and transport.
- Formal product confirmation of remaining scoring formulas (gap analysis SD-1) — orthogonal to this ADR but required for scoring completeness.
- **SD-16:** Case-break Parent/Child field availability from Keystroke/RSE/Hub (owned outside IAM core).
- Data Hub field dictionary and SLA when Hub onboarding begins.
- Precedence policy when both module Recommendations and interim evidence-generated candidates exist for the same SKU/cycle.

### Superseded alternatives

| Alternative | Why rejected |
|-------------|--------------|
| Embed Keystroke parsing inside scoring / calculate pipeline permanently | Blocks Hub replaceability; couples core to source layout |
| Treat Keystroke Stock# rows as Recommendations | Violates module ownership; weak idempotency; wrong abstraction |
| Require Data Hub before V1.5 Keystroke evidence | Conflicts with approved V1.5 baseline including Keystroke adapter |
| IAM owns Min/Max, case-break multipliers, or Keystroke IMP.EXE write-back | Violates IAM-001 module boundaries; RSE-owned |
| Prefer On-Hand always when Available QOH exists | Rejected; Available QOH preferred when reliably supplied, with both retained |
| Single “import API” that also transitions workflow / features Top 2 | Violates adapter isolation; governance must remain human/module-gated in core |

---

## Compliance notes

- Aligns with IAM-001 (module boundaries; approved source processes; no automatic business execution).
- Aligns with IAM-008 (consume recommendations; preserve source identifiers; auditable integrations; Hub-compatible).
- Resolves Integration Reference Assessment guidance for SD-4 (Keystroke as adapter) and SD-12 (recommendation idempotency key), and records SD-15 quantity basis as **Available QOH preferred, On-Hand fallback**.
- Does not override IAM product specs for Board, lifecycle, or scoring methodology.

---

## Change control

**No implementation phase may change the approved architecture without first updating this Architecture Decision Record and documenting the reason.**

Required before any architecture-affecting implementation change:

1. Propose the architectural delta and rationale (problem, options considered, impact on replaceability and IAM core boundaries).
2. Update **ADR-IAM-001** (or add a superseding / amending ADR that explicitly references this one).
3. Record the reason, date, and approval in the ADR (and Assumptions / Questions Log if the change resolves or creates an open decision).
4. Only then implement code, schema, or adapter behavior that depends on the new decision.

Implementation convenience, performance shortcuts, or Keystroke-/Hub-specific coupling inside IAM core are **not** valid grounds to bypass this control. If work discovers that the approved architecture cannot be followed, stop and amend the ADR—do not silently diverge.

---

## Approval

| Role | Status |
|------|--------|
| Product / architecture acceptance | **Accepted** — controlling IAM Version 1.5 integration architecture |
| Implementation | Not started at ADR acceptance (documentation only) |
| Architecture change during build | **Forbidden** unless this ADR (or a superseding ADR) is updated first with documented reason |
