# IAM Version 1.5 — Scoring and Prioritization Validation Report

| Field | Value |
|-------|--------|
| **Document title** | Scoring and Prioritization Validation Report |
| **Purpose** | Product validation that the Phase 4 scoring and presentation engine produces business priorities consistent with IAM Version 1.5 specifications and approved clarifications |
| **Date** | 2026-07-21 |
| **Prepared by** | Cursor (validation agent) |
| **Code modified** | **None** (read-only product validation) |
| **Implementation under review** | `src/lib/iam/scoring/*`, `src/lib/iam/presentation/*`, calculate pipeline orchestration, SD-17 Port consolidation |
| **Governing specs / decisions** | IAM-006/006A (scoring intent); IAM-004 Board lanes; IAM-007B clarifications (Holdover = lane, not LS); SD-1 / A-005 interim profile; SD-2 Emergency open; SD-14 actionability; SD-17 module precedence |
| **Related reports** | [Phase 4 Completion Report](./IAM_V1_5_Phase_4_Completion_Report.md); Decision Flow Validation Report + Addendum A |
| **Phase 5** | **Not authorized** by this report |

**Verdict scale (scenario rows):** Match · Match with interim/open-SD caveat · Gap (documented / intentional) · Concern (product risk; does not clearly violate frozen specs)

---

## Executive verdict

| Question | Answer |
|----------|--------|
| Does the interim scoring model match Phase 4 / A-005 intent? | **Yes** — labeled cash-led interim profile; actionability out of composite; no confidence-only suppress |
| Do Board lanes behave as specified for Top 2 / Holdover / Backlog? | **Substantially yes** |
| Is Emergency handled correctly for current authority? | **Yes as deferred** (SD-2 open; no auto-assign) |
| Are outputs suitable to feed a Decision Board (Phase 5)? | **Yes** — Fully Ready after Deferred Presentation Rule |
| **Overall rating** | **Ready** (updated 2026-07-21 after Deferred Presentation Rule) |

> **Addendum (2026-07-21):** Project Owner accepted this report; approved `interim_v1_cash_led` for V1.5; accepted Emergency deferral; directed and implemented the **Deferred Presentation Rule** (see Scenario E update and Addendum B below). Phase 5 remains unauthorized until separately approved.


## Part 1 — Scoring Model Validation

### 1.1 Scoring profile

| Attribute | Value |
|-----------|--------|
| **Profile ID** | `interim_v1_cash_led` |
| **Authority** | Assumption **A-005** while **SD-1** remains Open |
| **Label (stamped)** | Interim scoring profile (SD-1 open; A-005 waiver) — cash-led V1 weights without actionability in composite |
| **Finality** | **Non-final.** Full formulas, weights, thresholds, and COI remain open under SD-1 |

Every scored Recommendation persists `scoringProfileId` and a structured explainability payload including the profile stamp and score breakdown.

### 1.2 Priority Score — composition

**Priority Score** is computed as:

1. Derive component scores (0–100 scale) from Recommendation fields + optional evidence hints  
2. Form a **composite** from cash, operational/service risk, and inventory condition (weights below)  
3. Optionally reorder weight emphasis when a **service-risk override** triggers  
4. Multiply composite by a **confidence factor**  
5. Result = **Priority Score** (higher = more urgent for Top 2 competition)

Actionability is **not** in the composite. It is retained only as a **sequencing / tie-break** score.

### 1.3 Factor contributions

| Factor | Role in Priority Score | How derived (interim engine) | Weight / effect |
|--------|------------------------|------------------------------|-----------------|
| **Cash impact** | Primary composite driver | From `estimatedCashImpact` (else financial impact). Mapped via `min(100, log10(cash+1) × 25)` | **~48.9%** of composite (`0.45/0.92`) |
| **Operational / service risk** | Secondary composite driver (“Risk”) | Evidence/service hint or prior explainability `serviceRiskScore` (0–100). Backorder / short WOS inform hints at score time | **~38.0%** of composite (`0.35/0.92`) |
| **Inventory condition** | Tertiary composite driver (excess / trapped-cash posture) | From weeks of supply: `min(100, (WOS / 26) × 100)`; default **30** if unknown | **~13.0%** of composite (`0.12/0.92`) |
| **Actionability** | **Not in Priority Score** | 80 if required evidence present, else 40 | Sequencing / tie-break only (**SD-14** interim default) |
| **Confidence** | Soft factor on composite; narrative readiness label | Multiplier after composite (see §1.5) | Influences magnitude; **does not remove** the Recommendation from ranking |
| **Cost of Inaction (COI)** | Stored on Recommendation; **not used** in interim Priority Score | Field retained for future SD-1 | Gap vs full IAM-006 until SD-1 |

**Service-risk override:** If `serviceRiskScore / cashScore ≥ 1.5`, the composite still uses the same three weights but **emphasizes service risk first** in the weighted sum (cash and inventory remain). Threshold = `SERVICE_RISK_OVERRIDE_MIN_RATIO` (1.5).

### 1.4 Confidence — interpretation vs suppression

| Behavior | Implemented? |
|----------|----------------|
| Confidence recorded on Recommendation and in explainability narrative | **Yes** |
| Confidence applied as a soft multiplier on composite | **Yes** |
| Readiness label derived for interpretation (e.g. Cautious / Review Posture) | **Yes** |
| Confidence **suppresses** Recommendations from ranking / Top 2 eligibility | **No** — confirmed `suppressByConfidence: false`; ranking includes all scored rows |

**Confidence multipliers (interim):**

| Confidence label | Multiplier |
|------------------|------------|
| High Confidence | 1.00 |
| Medium Confidence | 0.88 |
| Low Confidence | 0.68 |
| Insufficient Data | 0.45 |
| Unknown / other | 0.75 |

**Confirmation required by Project Owner:** Confidence influences interpretation and score magnitude but **does not suppress** Recommendations. **Validated: Match.**

### 1.5 End-to-end score path (product view)

```
Recommendation (+ evidence hints)
        │
        ▼
 Cash score · Service/risk score · Inventory condition score
        │
        ▼
 Composite (interim weights; optional service-lead emphasis)
        │
        ▼
 × Confidence multiplier  ──►  Priority Score
        │
        ├── Actionability sequence score (tie-break only)
        └── Explainability JSON + scoringProfileId persisted
```

Presentation assignment is a **separate** step and does not recompute the formula.

---

## Part 2 — Business Scenario Validation

Scores below are **illustrative calculations** using the live interim formulas (rounded). Presentation assumes a normal weekly cycle with multiple competitors unless noted. “Expected Management Action” is the intended Board/governance behavior under V1.5 clarifications—not a Phase 5 UI promise.

### Scenario A — High cash impact / Medium confidence

| Field | Value |
|-------|--------|
| **Inputs** | Cash ≈ $100,000; service risk low (10); WOS ≈ 40 weeks; confidence = Medium |
| **Calculated Priority Score** | Cash score ≈ 100; inventory condition ≈ 100; composite ≈ 65.8; × 0.88 → **≈ 57.9** |
| **Presentation Category** | Competes for **top_2** / **managed_backlog** by rank among Identified / Management Review peers (not holdover unless already in execution LS) |
| **Expected Management Action** | Present for review; strong cash case with readiness “Ready with Limitations” |
| **Match?** | **Match** — high cash still surfaces; medium confidence dampens score but does not hide the item |

### Scenario B — Low cash impact / Very high confidence

| Field | Value |
|-------|--------|
| **Inputs** | Cash ≈ $800; service risk low (5); WOS ≈ 20; confidence = High |
| **Calculated Priority Score** | Cash score ≈ 72.6; inventory ≈ 76.9; composite ≈ 47.4; × 1.00 → **≈ 47.4** |
| **Presentation Category** | Typically **managed_backlog** unless few peers |
| **Expected Management Action** | Visible in backlog; not forced into Top 2 solely because confidence is high |
| **Match?** | **Match** — confidence does not inflate a weak cash case into automatic Top 2 |

### Scenario C — Medium cash / High operational risk

| Field | Value |
|-------|--------|
| **Inputs** | Cash ≈ $12,000 (cash score ≈ 100); service risk ≈ 90; WOS ≈ 6; confidence = High |
| **Calculated Priority Score** | Override ratio 90/100 = 0.9 (**no** override); composite ≈ 85.3; × 1.00 → **≈ 85.3** |
| **Presentation Category** | Strong Top 2 contender |
| **Expected Management Action** | Elevate for stock/service risk review alongside cash narrative |
| **Match?** | **Match with caveat** — service risk raises priority via weight, but the 1.5× override only fires when risk dominates cash score. Very large cash with high risk may not “service-lead” even when operations feel urgent. Product may want SD-1 to revisit override semantics for Board intuition |

### Scenario D — Existing Holdover recommendation

| Field | Value |
|-------|--------|
| **Inputs** | Lifecycle in open execution set (e.g. **Active**, Paused, Escalated, Approved → Outcome Validation); may have high Priority Score |
| **Calculated Priority Score** | Still scored and persisted |
| **Presentation Category** | **holdover** (forced by lifecycle class; excluded from Top 2 competition) |
| **Expected Management Action** | Track open work in Holdover lane; do not re-compete as a new Top 2 slot |
| **Match?** | **Match** — Holdover is a Board lane, not a lifecycle state |

### Scenario E — Deferred recommendation

| Field | Value |
|-------|--------|
| **Inputs** | GovernanceDecision = **Defer**; lifecycle remains **Management Review** |
| **Calculated Priority Score** | Retained (not recalculated on Defer) |
| **Presentation Category** | **`deferred`** — Deferred Board section; **excluded from Top 2** while Defer is active |
| **Expected Management Action** | Review in Deferred section; `reactivate_defer` restores Top 2/backlog eligibility using retained score unless Recommendation data changed |
| **Match?** | **Match** — V1.5 Deferred Presentation Rule (Project Owner 2026-07-21; Q-014). SD-3 auto-expiry timing remains Open and is not required for this Board behavior. |

### Scenario F — Rejected recommendation

| Field | Value |
|-------|--------|
| **Inputs** | GovernanceDecision = **Reject**; presentation set to **completed_presentation** |
| **Calculated Priority Score** | May still be scored if re-score runs |
| **Presentation Category** | **completed_presentation** (preserved on re-assign) |
| **Expected Management Action** | Off active Board competition; history/audit only |
| **Match?** | **Match** |

### Scenario G — Escalated recommendation

| Field | Value |
|-------|--------|
| **Inputs** | Lifecycle = **Escalated** (LS-08) |
| **Calculated Priority Score** | Scored |
| **Presentation Category** | **holdover** |
| **Expected Management Action** | Visible as escalated open work; resume/complete via lifecycle APIs—not as a new Top 2 pick |
| **Match?** | **Match** |

### Scenario H — Duplicate opportunities (module + evidence)

| Field | Value |
|-------|--------|
| **Inputs** | Same `opportunityKey`; module Recommendation exists; interim evidence candidate submitted |
| **Calculated Priority Score** | Applied to the **authoritative module** row (interim create skipped; module may be enriched) |
| **Presentation Category** | Single Recommendation in lanes (SD-17) |
| **Expected Management Action** | One Board card; module values authoritative |
| **Match?** | **Match** (SD-17) |

### Scenario I — Interim evidence-generated Recommendation

| Field | Value |
|-------|--------|
| **Inputs** | `generationPath = interim_evidence`; no module duplicate |
| **Calculated Priority Score** | Full interim profile scoring; explainability flags interim |
| **Presentation Category** | Competes normally for Top 2 / backlog |
| **Expected Management Action** | Treat as interim / labeled; not a permanent Decision Module substitute |
| **Match?** | **Match** (A-008 / SD-17 labeling) |

### Scenario J — Decision Module Recommendation

| Field | Value |
|-------|--------|
| **Inputs** | `generationPath = module` (e.g. RSE); typically richer cash/title |
| **Calculated Priority Score** | Same engine; module cash/confidence drive score |
| **Presentation Category** | Competes for Top 2 / backlog (or holdover if already in execution) |
| **Expected Management Action** | Prefer as authoritative opportunity when present |
| **Match?** | **Match** — scoring does not demote module; SD-17 prevents interim twins |

### Scenario K — Emergency Recommendation

| Field | Value |
|-------|--------|
| **Inputs** | N/A — Emergency auto-assignment **disabled** (`EMERGENCY_ASSIGNMENT_ENABLED = false`) |
| **Calculated Priority Score** | N/A for Emergency lane |
| **Presentation Category** | **emergency** lane remains empty unless manually set outside current auto-rules |
| **Expected Management Action** | Out-of-cycle elevation pending **SD-2** |
| **Match?** | **Gap (intentional)** — deferred under SD-2 / TD-013; does not block happy-path Top 2 |

### Scenario L — Insufficient data confidence

| Field | Value |
|-------|--------|
| **Inputs** | Material cash/risk possible; confidence = **Insufficient Data** (multiplier 0.45) |
| **Calculated Priority Score** | Composite retained × 0.45 (materially lower, still ranked) |
| **Presentation Category** | Remains eligible for Top 2 / backlog |
| **Expected Management Action** | Show with cautious readiness; do not hide |
| **Match?** | **Match** — aligns with “no confidence-only suppress” |

---

## Part 3 — Ranking Validation

| Concern | Validation | Spec alignment |
|---------|------------|----------------|
| **Top 2 selection** | Among competitors (not holdover / not preserved terminal), sort by `priorityScore` desc; first two → `top_2` with ranks 1–2 | **Match** (`FEATURED_PRIORITY_COUNT = 2`) |
| **Holdover behavior** | Open execution lifecycle states → `holdover`; excluded from Top 2 slots | **Match** (Holdover = lane) |
| **Managed Backlog** | Remaining competitors → `managed_backlog` with continuing rank | **Match** |
| **Emergency handling** | No auto-assign until SD-2 | **Match with intentional defer** |
| **Duplicate suppression** | SD-17 at Port upsert: skip interim when module owns opportunity; enrich module | **Match** |
| **Recommendation ordering** | Scoring rank: Priority Score → actionability sequence → id. Presentation assign sort: Priority Score → id (**actionability not applied at Board assign**) | **Match with minor inconsistency** — tie-break may differ between pure score list and lane assignment |
| **Tie-breaking rules** | Documented sequencing-only actionability at score rank; presentation currently id-only after score | **Partial** — acceptable for interim; Phase 5 should display score + confidence, not rely on opaque id ties |

**Ranking vs approved specifications:** Aligns with Phase 4 plan and clarifications for interim scope. Residual open SDs (1, 2, 3, 14) correctly limit claims of “final” business ranking.

---

## Part 4 — Decision Board Readiness

### Suitable for Board consumption

| Output | Board-ready? |
|--------|----------------|
| Stable lanes: Top 2, Holdover, **Deferred**, Managed Backlog, completed/archived | **Yes** |
| Priority Score + profile stamp + breakdown JSON | **Yes** (needs UI packaging) |
| Generation path (module vs interim) | **Yes** — must be visually distinct |
| Lifecycle state separate from lane | **Yes** — critical for Phase 5 card design |
| Emergency lane | **Placeholder until SD-2** (acceptable if Board shows empty / manual only) |

### Risks that may confuse management

1. ~~Deferred items in Top 2~~ — **Resolved** by Deferred Presentation Rule (`deferred` lane; not Top 2).  
2. **Holdover includes Approved through Outcome Validation** — executives may expect Holdover = “prior Active work only”; early post-Approve items also leave Top 2 competition.  
3. **Log-scaled cash** — very large cash amounts compress toward the same cash score (~100), so $50k and $500k can look similar without explainability.  
4. **Service override rarely fires when cash score is already ~100** — high-risk / high-cash items stay cash-led; intuition may expect stronger ops emphasis.  
5. **COI unused** — if specs/marketing mention Cost of Inaction, Board must not imply COI drives Priority Score under interim profile.  
6. **Interim vs module** — without clear badges, interim evidence cards can look like Decision Module authority.

### Unintuitive ranking / move higher-lower

| Observation | Suggestion (non-redesign) |
|-------------|---------------------------|
| High confidence / low cash can outrank medium confidence / slightly higher cash near boundaries | Show confidence + cash side-by-side; do not redesign unless SD-1 directs |
| Escalated in Holdover (not Top 2) | Correct per lane rules; Board should badge Escalated strongly |
| Deferred visible but not Top 2 | Correct per V1.5 rule; Board must show Deferred section |

### Explainability opportunities (no model redesign)

- Surface: Priority Score, profile label (`interim_v1_cash_led`), cash $, confidence, readiness, generation path, lane reason (`ranked_top_2` / `active_defer_presentation_rule` / `open_execution_holdover_lane`).  
- Show “actionability used for sequencing only” when ties occur.  
- Explicit banner: **Interim scoring profile — approved for V1.5; SD-1 remains open for final formulas.**

**No scoring-model redesign is required.** Deferred Presentation Rule closed the primary Phase 5 blocker from the original validation.

---

## Part 5 — Recommendations

### Strengths

- Clear separation of **scoring** vs **presentation** vs **lifecycle**  
- Labeled interim profile (A-005) with persisted breakdown — **approved for V1.5**  
- Actionability removed from composite (SD-14 interim default)  
- No confidence-only suppression  
- SD-17 duplicate consolidation before Board lanes  
- Holdover correctly modeled as a lane  
- **Deferred Presentation Rule implemented** (`deferred` lane; reactivate without rescoring)  
- Automated Phase 4 tests including P4-DEFER-LANE / P4-DEFER-REACTIVATE  

### Weaknesses

- SD-1 formulas/COI not final (accepted for V1.5 interim)  
- Emergency lane empty pending SD-2 (accepted)  
- Presentation tie-break weaker than scoring tie-break  
- Cash log compression reduces differentiation at the high end  
- Board UX not yet built (expected — Phase 5)  

### Remaining technical debt (scoring / presentation relevant)

| ID | Topic | Status |
|----|--------|--------|
| **TD-004** | Confidence suppress on Recommendation path | Resolved for V1.5 scoring path |
| **TD-005** | Actionability in composite | Resolved for interim profile; final policy = SD-14 |
| **TD-010** | Board still Action-centric | Open — Phase 5 |
| **TD-013** | Emergency auto-assign | Open — SD-2 (accepted deferral) |
| **SD-1 / SD-2 / SD-3 / SD-14** | Final scoring, Emergency, auto Defer return timing, actionability policy | Open (presentation rule does not close SD-3) |

### Suggested refinements (optional)

1. Align presentation sort tie-break with scoring (include actionability sequence).  
2. Board must display interim profile banner + module vs interim badge + Deferred section.  
3. Do not claim COI-driven priority until SD-1 closes.  
4. Keep Emergency lane UI placeholder until SD-2—do not invent criteria.

### Ready for Phase 5 (Decision Board)?

**Yes — Fully Ready** for Phase 5 authorization (Decision Board implementation), provided Phase 5:

- Consumes Recommendation lanes/scores (including **`deferred`**)  
- Labels interim profile and generation path  
- Surfaces Deferred / Reject / Escalated / Holdover per governance  
- Treats Emergency as unavailable/manual until SD-2  

---

## Overall rating

# Ready

### Prior conditions (from original Conditionally Ready) — disposition

| # | Prior minimum action | Disposition |
|---|----------------------|-------------|
| 1 | Accept Validation Report | **Done** — Project Owner 2026-07-21 |
| 2 | Accept interim scores for V1.5 | **Done** — `interim_v1_cash_led` approved |
| 3 | Decide Deferred Top 2 handling | **Done** — Deferred Presentation Rule implemented |
| 4 | Accept Emergency non-automated | **Done** |

---

## Addendum B — Deferred Presentation Rule (2026-07-21)

| Field | Value |
|-------|--------|
| **Authority** | Project Owner product decision |
| **Clarification IDs** | Q-014 Resolved; Q-003 Partial; A-004 updated |
| **Implementation** | Phase 4 refinement — `presentationCategory: deferred`; `reactivate_defer` / `ReactivateFromDefer` |
| **Tests** | P4-DEFER-LANE, P4-DEFER-REACTIVATE |
| **Phase 5** | Still requires separate authorization |

---

## Explicit stop

Scoring and Prioritization Validation Report updated for Deferred Presentation Rule.  
**Stopped.** Phase 5 remains unauthorized until separately approved.
