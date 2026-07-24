# Decision Priority Design Partner Validation Standard — Final Version 1.0 (DPVS v1.0)
## Module implementation: IAM Version 1.5

| Field | Value |
|-------|--------|
| **Standard** | Decision Priority Design Partner Validation Standard |
| **Standard ID** | DPVS |
| **Standard version** | **Final Version 1.0** |
| **Document** | Design Partner Validation Program (master) — IAM V1.5 module implementation |
| **Module** | IAM Version 1.5 (Inventory Action Manager) — **first module implementation** of this standard |
| **Platform family** | Decision Priority |
| **Status** | **Final — Approved Decision Priority company standard** |
| **Approved by** | Project Owner |
| **Effective / archived** | 2026-07-21 |
| **Archive record** | [`../standards/DPVS-v1.0_Archive_Record.md`](../standards/DPVS-v1.0_Archive_Record.md) |
| **Standards register** | [`../standards/README.md`](../standards/README.md) |
| **Prerequisite** | Final Executive Experience Validation — Ready for Limited Customer Pilot |
| **Code changes / Phase 6** | Out of scope — methodology / standard only |
| **Primary commercial market** | Decision Priority focus: distributors up to approximately **$50M** annual revenue |
| **Design Partner validation range** | Primary **$10M–$50M**; Strategic Validation **$50M–$75M** (not a market-strategy change) |
| **Package index** | [`README.md`](./README.md) |
| **Baseline rule** | Baseline for future Decision Priority modules unless formally revised through version control |

---

## 1. Program Objectives

The Design Partner Validation Program is the official method for validating Decision Priority products in real customer environments before advancing from **Design Partner Validation** to **Limited Commercial Release** (and, later, **General Commercial Availability**).

| Objective | Definition of done |
|-----------|-------------------|
| **Product validation** | Core IAM V1.5 workflows operate reliably with partner data, cadence, and roles |
| **Executive experience validation** | Executives can run weekly Decision Board meetings with acceptable cognitive load and confidence |
| **Recommendation validation** | Recommendations are useful, explainable, accepted at target rates, and tied to measurable impact |
| **Workflow validation** | Present → Decide → Assign → Accept → Execute → Complete/OV path works in live operations |
| **Customer adoption validation** | Weekly usage becomes habitual (not facilitator-dependent after ramp) |
| **Business value validation** | Agreed KPIs move in the intended direction vs baseline |
| **ROI validation** | Documented ROI using the standard framework (cash, inventory, productivity, decision quality) |
| **Commercial readiness validation** | Evidence package supports go/no-go to advance product **release stage** (see §11) |

**Program intent:** Prove value with a small number of engaged partners; generate testimonials, case studies, and a Product Improvement Report — then pass the gate to the next release stage.

---

## 2. Design Partner Selection Criteria

### Market positioning vs. validation range (important)

| Concept | Definition |
|---------|------------|
| **Decision Priority primary commercial market** | Companies up to approximately **$50M** annual revenue. This remains the **current core market strategy** for IAM / Decision Priority. |
| **Design Partner validation range** | Broader than the primary commercial market for learning: **Primary Design Partners ($10M–$50M)** plus optional **Strategic Validation Partners ($50M–$75M)**. |
| **What $50M–$75M is not** | Including a Strategic Validation Partner does **not** redefine Decision Priority’s primary commercial focus above $50M. It is an **intentional validation opportunity** for scalability and operational complexity. |

**Revenue alone must not determine suitability.** Always weigh operational complexity, SKU count, data readiness, executive engagement, and alignment with current IAM V1.5 scope.

### Primary Design Partner Profile (preferred for IAM V1.5)

| Criterion | Characteristic |
|-----------|----------------|
| **Role in program** | Preferred validation profile; represents Decision Priority’s **current primary commercial market** |
| **Annual revenue** | Approximately **$10M–$50M** |
| **Company size** | Mid-market distributor; ~20–150 employees typical |
| **Industry** | Wholesale / distribution; inventory-intensive |
| **SKU count** | **1,000–25,000** active SKUs (enough complexity; not extreme long-tail chaos) |
| **Operational maturity** | Weekly or near-weekly inventory/purchasing rhythm; named owners for actions |
| **Executive engagement** | CEO, GM, or Owner attends **≥75%** of weekly reviews for first 8 weeks |
| **Data quality** | Usable Keystroke (or equivalent) extracts; willing to fix critical data gaps |
| **Feedback** | Weekly ops feedback + monthly executive interview + final executive review interview |
| **Testimonial** | Soft commit if success criteria met (legal review OK) |

### Strategic Validation Partner Profile (optional)

| Criterion | Characteristic |
|-----------|----------------|
| **Role in program** | Validates **scalability and broader operational complexity** without changing primary market positioning |
| **Annual revenue** | Approximately **$50M–$75M** |
| **When to include** | Only when operational complexity aligns with **current IAM V1.5 scope** (single-site or bounded pilot scope preferred) |
| **Executive sponsor** | **Strong** sponsor required; must understand the engagement is a **collaborative validation program**, not a mature enterprise deployment |
| **Data** | Usable weekly data; clearer ops ownership than typical larger orgs |
| **Expectations** | Explicit kickoff language: interim scoring, soft viewAs / pre–General Availability security posture, Design Partner cadence |
| **Commercial framing** | Evidence may inform future expansion messaging; does **not** by itself authorize positioning Decision Priority primarily above $50M |

### Above $75M

Companies **above approximately $75M** annual revenue are **outside the standard IAM V1.5 Design Partner profile**. They may be engaged only as a **special strategic engagement** with **separate Project Owner approval** and a written scope that fits V1.5 capabilities.

### Shared non-revenue fit criteria (all profiles)

| Criterion | Requirement |
|-----------|-------------|
| Operational complexity | Inventory decision load that benefits from OEC / Active Priorities |
| SKU count | Prefer 1,000–25,000 active; extremes need PO review |
| Data readiness | Can produce Recommendations for ≥4 consecutive weeks |
| Executive engagement | Named sponsor with attendance commitment |
| Scope alignment | Willing to validate V1.5 as-is (no V1.6 custom build as entry condition) |

### Disqualifiers (relative)

- No executive sponsor  
- Unwilling to run a weekly meeting for the pilot window  
- Data too incomplete to produce Recommendations for ≥4 consecutive weeks  
- Expects custom V1.6 build as a condition of participation  
- Treats the program as a full mature enterprise deployment (especially Strategic Validation Partners)  
- Above $75M without separate PO special-engagement approval  

### Recommended number of Design Partners for V1.5

| Recommendation | Rationale |
|----------------|-----------|
| **Primary target: 2 Design Partners** | Prefer both in the **Primary ($10M–$50M)** profile |
| **Acceptable mix** | 2 Primary; **or** 1–2 Primary + **at most 1** Strategic Validation ($50M–$75M) |
| **Maximum: 3 total** | Do not exceed 3 for V1.5 |
| **Strategic Validation** | Optional; never replace all Primary-profile seats |

One partner alone is insufficient for advancing release stage; more than three risks shallow engagement.

---

## 3. Success Criteria

Measurable targets for a **successful Design Partner engagement** (per partner, default 12-week window unless otherwise agreed).

| Criterion | Target (success) | Stretch |
|-----------|------------------|---------|
| **Executive adoption** | Sponsor attends ≥75% of weekly reviews | ≥90% |
| **Weekly management meeting usage** | Board used in ≥10 of 12 weeks | 12/12 |
| **Recommendation acceptance rate** | ≥60% of Active Priority decisions are Approve (vs Defer/Reject) among items presented for decision | ≥75% |
| **Recommendation completion rate** | ≥50% of Approved items reach Completed or Outcome Validation within pilot window | ≥70% |
| **Owner Accept rate** | ≥80% of assignments Accepted within 5 business days | ≥95% |
| **Customer satisfaction (CSAT)** | ≥4.0 / 5.0 at final assessment | ≥4.5 |
| **Executive confidence** | ≥4.0 / 5.0 “I trust Active Priorities enough to assign work” | ≥4.5 |
| **Decision quality (self-rated)** | ≥3.5 / 5.0 “Better decisions than pre-IAM Mondays” | ≥4.0 |
| **Time saved** | Weekly review ≤30 minutes steady-state (weeks 5–12) | ≤20 minutes |
| **User engagement** | ≥1 progress update/week on open Active/Holdover items (avg) | ≥2 |
| **Financial improvements** | ≥1 KPI meets Success Threshold (Section 4) | ≥2 KPIs |
| **Testimonial** | Willing draft quote if CSAT ≥4.0 and ≥1 KPI success | Published case study |

**Program-level success (before commercial gate):** ≥2 partners meet **≥8 of 12** row targets above (or equivalent negotiated scorecard).

---

## 4. Business KPI Validation

See **KPI Measurement Guide** for full worksheets. Summary:

| KPI | Baseline | Target improvement (indicative) | Method | Frequency | Success threshold (pilot) |
|-----|----------|----------------------------------|--------|-----------|---------------------------|
| Inventory investment ($) | Week 0 snapshot | −2% to −5% on addressed categories / trapped-cash cohort | ERP/Keystroke inventory $ | Bi-weekly | Directionally improved vs baseline on intervened SKUs |
| Inventory turns | Trailing 12 / pilot window | +5% relative on focus set | COGS / avg inventory | Monthly | Improved vs baseline or peer set |
| Gross profit ($) / GP% | Monthly P&L | Maintain or +0.2–0.5 pts where stockouts reduced | Finance report | Monthly | No material GP degradation from actions |
| Cash flow (operating) | Monthly | Qualitative + estimated cash released | Finance + IAM cash impact fields | Monthly | Documented cash release ≥ agreed $ floor |
| Slow-moving inventory | $ and units >X weeks | −10% $ slow-moving in acted cohort | Weeks-of-supply report | Bi-weekly | Cohort reduction ≥5% |
| Stockouts / lost sales proxy | Count or fill events | −10% on monitored SKUs | Order fill / stockout log | Weekly | Improved vs baseline |
| Purchasing efficiency | Expedite count / overtime buys | −15% expedites | Purchasing log | Monthly | Reduced expedites |
| Fill rate | % lines filled | +1–2 pts | Order metrics | Weekly/Monthly | Improved or stable-high |
| Management productivity | Minutes/week in inventory crisis | −25% firefight time (survey) | Time study / survey | Monthly | Self-reported improvement ≥3.5/5 |

Exact numeric targets are **negotiated in kickoff** and recorded in the partner’s Baseline Pack. Indicative ranges above are defaults for mid-market distributors.

---

## 5. Recommendation Validation

Framework dimensions (score 1–5 or % as noted):

| Dimension | Question | Measure |
|-----------|----------|---------|
| **Accuracy** | Was the underlying condition real? | % of sampled Recs confirmed true by Ops (weekly sample n≥5) |
| **Usefulness** | Did it deserve management attention? | % rated Useful/Very Useful |
| **Acceptance** | Approved vs Defer/Reject when decided | Acceptance rate (Section 3) |
| **Completion** | Finished through lifecycle | Completion rate (Section 3) |
| **Financial impact** | Expected vs realized (where measurable) | $ expected (IAM) vs $ actual / estimate |
| **Confidence** | Did confidence labels match reality? | Mismatch rate on Low/Insufficient vs outcomes |
| **Explainability** | Could exec explain Why without facilitator? | Monthly interview score ≥4.0 |

**Recommendation Quality Index (RQI)** = weighted average: Accuracy 20%, Usefulness 20%, Acceptance 15%, Completion 15%, Financial 15%, Confidence 5%, Explainability 10%.

**Target RQI:** ≥3.5 / 5.0 by midpoint; ≥4.0 by final assessment.

---

## 6. Executive Experience Validation

Structured evaluation at weeks 0 (baseline perception after demo), 6, and 12 using the **Executive Feedback Questionnaire**.

Covered themes:
- Ease of use / understanding  
- Decision Board & information hierarchy  
- Weekly Business Summary, Business Momentum, OEC  
- Recommendation clarity & trust  
- Weekly management meeting effectiveness  
- Overall confidence  

**Pass:** Mean ≥4.0 on hierarchy, meeting readiness, and trust items at final; no Critical UX defect open without workaround.

---

## 7. Customer Feedback Program

| Cadence | Forum | Owner | Output |
|---------|-------|-------|--------|
| Weekly | 30-min review (Board + feedback) | Customer Success / Product | Weekly Executive Review Template |
| Monthly | 45–60 min executive interview | Product + Sponsor | Monthly Executive Summary |
| Continuous | Observation notes during meetings | Facilitator | Product observations log |
| Continuous | Intake form / email | Partner | Improvement & feature requests |
| As found | Pain point register | Product | Prioritized backlog (V1.6+) |
| Ongoing | Success story capture | CS | Quote bank / story drafts |

Feedback taxonomy: **Defect** · **UX friction** · **Data issue** · **Process issue** · **Feature request** · **Success story**.

---

## 8. ROI Validation Framework

See dedicated **ROI Validation Framework** document for formulas.

Value pillars:
1. Cash / inventory release  
2. Gross profit protection (fill / stockout)  
3. Purchasing efficiency  
4. Management productivity / time  
5. Decision quality (qualitative → scored)

**Pilot ROI narrative** prefers conservative estimates and clear assumptions over aggressive marketing numbers.

---

## 9. Design Partner Timeline (recommended 12 weeks)

| Week | Phase | Key activities |
|------|-------|----------------|
| −2 to 0 | **Discovery** | Fit assessment (Primary vs Strategic profile); data sample; success criteria; legal/NDA |
| 0 | **Onboarding / Kickoff** | Executive Kickoff Package; roles; OEC baseline; meeting schedule; profile expectations |
| 0–1 | **Configuration** | Company OEC; aging threshold; owners list; evidence intake path |
| 1 | **Baseline measurement** | KPI baselines locked; photo/export of pre-IAM Monday process |
| 1–2 | **Initial rollout** | First scored Boards; facilitated meetings |
| 2–11 | **Weekly review meetings** | Steady-state usage; Weekly Review Reports |
| 6 | **Midpoint assessment** | KPI check; RQI; exec questionnaire; go/adjust |
| 11–12 | **Final assessment** | Full scorecard; ROI draft; questionnaires |
| 12 | **Final Executive Review** | Structured interview (Final Executive Review Interview Template); joint readout; testimonial ask |
| 12+ | **Program completion** | Case study inputs; Lessons Learned; release-stage gate evidence |

---

## 10. Deliverables

| Deliverable | When |
|-------------|------|
| Executive Kickoff Package | Week 0 |
| Baseline Pack (KPIs + process) | Week 1 |
| Weekly Review Report | Each week |
| Monthly Executive Summary | End of each month |
| KPI Progress Report | Bi-weekly / monthly |
| Midpoint Assessment | Week 6 |
| ROI Report (draft → final) | Week 6 draft; Week 12 final |
| Final Design Partner Assessment | Week 12 |
| **Final Executive Review Interview** | Week 12 |
| Customer Testimonial | Week 12+ (if earned) |
| Customer Success Story | Week 12+ |
| Case Study | After ≥1 successful partner |
| Lessons Learned | Program end |
| Product Improvement Report | Program end |
| Commercial Readiness Assessment / Checklist | When advancing release stage |

Templates for the above are provided in this documentation set.

---

## 11. Commercial Readiness Gate (product release stages)

Decision Priority uses explicit **product release stages**. The Design Partner Program is the validation method between internal proof and broader market offer — it is **not** framed as a Phase 6 waiver.

### Release stages

| Stage | Meaning |
|-------|---------|
| **1. Internal Validation** | Product validated internally (engineering, experience reviews, controlled fixtures). Not sold as a customer program. |
| **2. Design Partner Validation** | Live collaborative validation with selected Design Partners (this program). Primary commercial market still ≤~$50M positioning. |
| **3. Limited Commercial Release** | Narrow paid/offerable release to a controlled set of customers after Design Partner gate criteria are met; known limitations disclosed in writing. |
| **4. General Commercial Availability (GA)** | Broad market offer with completed commercial evidence, support readiness, and product maturity appropriate for the stated market. |

IAM V1.5 may advance **from Design Partner Validation → Limited Commercial Release** only when the gate criteria below are met. Advancement **from Limited Commercial Release → General Commercial Availability** requires a separate PO decision (additional evidence, packaging, and maturity — including security/identity as required for GA).

### Gate criteria (Design Partner Validation → Limited Commercial Release)

| Gate criterion | Minimum |
|----------------|---------|
| Successful Design Partners | **≥2** partners meet program success scorecard (≥8/12 criteria); prefer ≥1 **Primary** profile ($10M–$50M) |
| Customer satisfaction | Mean final CSAT **≥4.0** across successful partners |
| ROI | **≥1** partner with documented positive ROI under standard framework; second partner at least directional KPI success |
| Recommendation quality | Mean final RQI **≥4.0** (or ≥3.7 with PO accepted exception) |
| Executive adoption | Mean attendance **≥75%**; steady-state meeting **≤30 min** |
| Product stability | No Sev-1 defects open; Sev-2 have workarounds; intake/calculate/Board path reliable for 4 consecutive weeks per partner |
| Documentation | Kickoff, ROI, Final Executive Review Interview, Lessons Learned, Improvement Report complete |
| Support readiness | Support runbook + escalation path defined for Limited Commercial Release customers |
| Limitations disclosure | Written disclosure of known limitations for Limited Commercial Release (e.g. interim scoring, identity/authorization posture) |
| Market positioning | Messaging remains aligned with primary commercial focus **≤~$50M**; Strategic Validation ($50M–$75M) results labeled as scalability evidence, not a repositioning |

### Gate outcomes

| Outcome | Meaning |
|---------|---------|
| **Advance to Limited Commercial Release** | Must criteria met |
| **Remain in Design Partner Validation** | Extend partners / evidence |
| **Return toward Internal Validation** | Product remediation required before further customer validation |
| **Advance to General Commercial Availability** | **Not** decided by this gate alone — separate PO checklist after Limited Commercial Release learning |

---

## 12. Reusable Decision Priority Standard

This package **is** the **Decision Priority Design Partner Validation Standard v1.0**. IAM Version 1.5 is the first module implementation.

Future Decision Priority modules should inherit the following (adapt only module-specific columns):

| Reusable (standard) | Module-specific (adapt per product) |
|---------------------|-------------------------------------|
| Program objectives structure | KPI catalog (inventory vs other domains) |
| **Primary vs Strategic Validation partner profiles** + primary commercial market vs validation range | Revenue bands and complexity proxies per module |
| Non-revenue fit criteria (data, exec, scope) | Data source / adapter prerequisites |
| Success criteria pattern (adoption, CSAT, time, RQI) | Recommendation type taxonomy |
| Feedback cadences (weekly/monthly/final exec interview) | Domain workflow steps |
| ROI pillar structure | Domain formulas (cash, turns, etc.) |
| Timeline phases (discover → complete) | Duration defaults |
| Deliverable list & templates | Demo scripts / evidence fixtures |
| **Release stages** (Internal → Design Partner → Limited Commercial → GA) | Module-specific GA prerequisites |

**Rule:** New Decision Priority modules inherit this standard skeleton; only Section 4 KPIs, Recommendation taxonomy, and module workflows are rewritten.

---

## Related documents in this package

| Document |
|----------|
| Design Partner Implementation Guide |
| KPI Measurement Guide |
| Executive Feedback Questionnaire |
| Weekly Executive Review Template |
| Monthly Executive Review Template |
| Final Design Partner Assessment Template |
| **Final Executive Review Interview Template** |
| ROI Validation Framework |
| Customer Testimonial Template |
| Customer Success Story Template |
| Case Study Template |
| Commercial Readiness Checklist |

---

## Explicit stop

**DPVS Final Version 1.0** marked Final and archived as an approved Decision Priority company standard.  
IAM Version 1.5 remains the first module implementation.  
**No application code modified.** No additional IAM functionality or future product release begun.  
**Work approved and complete.**
