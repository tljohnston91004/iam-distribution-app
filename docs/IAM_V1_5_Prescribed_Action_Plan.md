# IAM V1.5 — Prescribed Action Plan (required Recommendation content)

| Field | Value |
| --- | --- |
| **Status** | Implemented — **awaiting Project Owner review** |
| **Date** | 2026-07-23 |
| **Scope** | Recommendation content + action-playbook logic only |
| **Out of scope** | Governance, assignment, Holdover, lifecycle, OEC, Executive Experience rules |

## Product completeness gap addressed

Prior IAM priority output identified and quantified problems (e.g. “Location ‘0’ excess inventory — 229 SKUs · Review trapped cash · Reduce inventory”) without telling management **what corrective action to take**.

**Prescribed Action Plan is now required** on every actionable priority produced by Calculate.

## Decision flow (complete)

Detect → Analyze → Aggregate → Prioritize → **Prescribe Action** → Present for Approval → Assign → Track → Measure Results.

## Plan contents (every priority)

| Field | Purpose |
| --- | --- |
| Recommended management action | What management should do |
| Reason selected | Why that action fits the evidence |
| Immediate next steps | First execution moves |
| Affected inventory population | Grain, SKU count, value, segment key |
| Action groups | SKU / subgroup prescriptions (not one generic action) |
| Execution sequence | Suggested order |
| Owner / responsible role | Who should own |
| Target completion period | e.g. 90-day program or 14-day data close |
| Expected financial / operational result | Intended outcome |
| Success measures | How to know it worked |
| Risks and cautions | Guardrails |
| Data gaps / decisions required | What is still unknown |
| Alternative actions | Secondary options |

## Segment excess inventory — action groups

IAM evaluates supporting SKUs and assigns them into evidence-based groups, including where applicable:

- Return to vendor  
- Transfer to another location  
- Stop or reduce replenishment  
- Freeze purchasing  
- Correct Min/Max settings  
- Bundle with stronger products  
- Promotional markdown  
- Customer-specific sale  
- Sales-team focus  
- Vendor negotiation  
- Liquidation  
- Discontinue  
- Hold and monitor  
- Data correction or further review  
- Management review / additional data required  

**Insufficient evidence → management review or data correction**, not an unsupported disposition.

## Location “0” investigation

| Question | Finding |
| --- | --- |
| Valid customer location? | **No** for bare `0` / `00` / blank / `N/A` / `unknown` |
| Likely meaning | Source-system **default**, missing mapping, or company-level aggregate incorrectly labeled as a location (common in Keystroke extracts) |
| IAM behavior | **Do not** create a location-level Recommendation for invalid keys |
| Presentation | When location is an **explicit invalid placeholder** (e.g. `"0"`), roll trapped-cash SKUs into a **company / portfolio** priority with a **data-quality warning**. Missing location alone still aggregates by classification/vendor/etc. without inventing a Location `"0"` priority. |

Validation: `isValidLocationCode()` / `isInvalidPlaceholderLocation()` in `src/lib/iam/actions/playbook.ts`.

## Implementation map

| Area | Path |
| --- | --- |
| Action playbook | `src/lib/iam/actions/playbook.ts` |
| Attach plans to candidates | `src/lib/iam/actions/attach-plans.ts` |
| Segment + company rollup | `src/lib/iam/engine/segments.ts` |
| Calculate wiring | `src/lib/iam/engine/calculate-pipeline.ts` |
| Trust Pyramid uses plan | `src/lib/iam/presentation/story.ts` |
| Score merge preserves plan | `src/lib/iam/scoring/run.ts` |
| Board card summary | `src/components/RecommendationCard.tsx` |
| Detail full plan | `src/components/RecommendationDetailClient.tsx` |
| Automated tests | `npm run test:prescribed-action-plan` |

## Governance unchanged

Lifecycle transitions, Present / Approve / Defer / Reject, assignment, Holdover, OEC, and Executive Experience presentation rules are **not** modified. This work extends Recommendation **content** and discovery titles only.

## Stop for Project Owner

Internal Validation is **paused** until PO accepts this completeness change. See Internal Validation readiness docs.
