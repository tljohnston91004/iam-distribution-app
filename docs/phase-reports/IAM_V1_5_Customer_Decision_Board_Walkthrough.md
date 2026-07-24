# IAM Version 1.5 — Customer Experience & Decision Board Walkthrough

| Field | Value |
|-------|--------|
| **Document title** | Customer Experience & Decision Board Walkthrough |
| **Purpose** | Evaluate the Decision Board as a real distribution-company customer would experience it on a Monday morning — not as a developer review |
| **Date** | 2026-07-21 |
| **Prepared by** | Cursor (customer-experience walkthrough agent) |
| **Code modified** | **None** (read-only product walkthrough) |
| **Persona assumed** | Owner / Executive Manager of a mid-size distributor (e.g. Steve’s Bowling Supply), first meaningful Monday-morning open of IAM |
| **Surface walked** | Decision Board `/runs/[runId]`, Recommendation drill-down, My Assigned, Archive / History |
| **Related documents** | [Phase 5 Completion Report](./IAM_V1_5_Phase_5_Completion_Report.md); [Decision Board Experience Review](./IAM_V1_5_Decision_Board_Experience_Review.md); [Scoring Validation Report](./IAM_V1_5_Scoring_Validation_Report.md) |
| **Phase 6** | **Not authorized** by this document |

**Method:** Walk the implemented V1.5 Board end-to-end in the order a customer encounters it. Judgments reflect product clarity and management confidence, not code quality.

---

## Setting the scene

It is Monday morning. Steve (or the general manager) opens this week’s Review Cycle Decision Board after Operations has loaded inventory/demand and run Calculate · Score · Present. The question in his head is simple:

> “What are the two things I should care about this week — and can I trust them enough to assign people?”

---

## Part 1 — First Impression

### What the customer notices first

1. Dark “ops console” chrome and the title **Decision Board** with the run name and company.  
2. Soft **View as Executive / Operations / Owner** switches (plus a disclaimer that this is not security).  
3. A banner about the **interim scoring profile**.  
4. **Alerts**, then **Business Health** tiles, then **Next best action**.  
5. Only then the lane sections — starting with **Top 2 Priorities**.

### Does the screen immediately communicate priorities?

**Partially.**  
Once the eye reaches **Top 2 Priorities**, yes — two ranked cards with large Priority numbers and cash figures. Before that, the customer must pass persona switches, scoring disclaimer, alerts, and health tiles. A first-time Monday user may not feel “priorities first” until they scroll or learn the layout.

### Is the visual hierarchy clear?

**Mostly clear after learning.**  
Lane order (Top 2 → Emergency → Holdover → Deferred → Backlog) is correct for IAM. Chip labels (`top_2`, lifecycle state names) are accurate but look like system tags, not customer language. Top 2 cards are not dramatically larger than backlog cards, so hierarchy is structural more than visual.

### Is anything distracting or overwhelming?

**Yes, for a first open:**
- Persona switcher and “not security” note feel internal/demo-oriented.  
- Scoring profile banner is honest but dense.  
- Business Health + Alerts before Top 2 compete for attention.  
- Emergency section with an empty “pending SD-2” explanation can look unfinished.  
- Browser `prompt()` dialogs later in the workflow feel unprofessional.

### Rating — First Impression

**Needs Improvement**

(Clear enough for a facilitated pilot; not yet “open and instantly calm” for an unattended first Monday.)

---

## Part 2 — Understanding the Top 2

Assume two Top 2 cards such as:

| # | Example customer sees |
|---|------------------------|
| 1 | “Trapped cash review — SKU-…” · Cash impact · Priority ~53–70 · Confidence · Source module/interim · Required: Approve, Defer, or Reject |
| 2 | “Stock risk review — SKU-…” · Possibly higher Priority if service risk leads · Confidence · Required action hint |

### For each Top 2 Recommendation

| Question | Assessment |
|----------|------------|
| **Is it obvious why it is ranked here?** | **Partially.** Customer sees Priority score and cash, and that it sits in Top 2 with #1/#2. They do **not** see a plain-English “why this beat the others” on the card. |
| **Does the customer understand the business impact?** | **Mostly for cash.** Cash/financial fields help. COI often shows “Not available,” which correctly avoids inventing numbers but leaves a gap for “cost of waiting.” |
| **Does the customer know what action to take?** | **Yes, directionally.** The “Required: …” line (e.g. Approve, Defer, or Reject) is one of the strongest customer-facing cues. |
| **Does the customer understand the expected benefit?** | **Weak.** Title/type imply the play (trapped cash, stock risk), but there is no short expected-outcome sentence on the card. |

### Explanations missing on the Top 2 card face

1. One-sentence **rationale** (“Highest cash trapped at 40+ weeks of supply among open review items”).  
2. **Relative ranking** (“Ranked above X because …”).  
3. **If ignored** consequence (especially when COI is blank).  
4. **Expected benefit if acted** (cash released / service risk reduced) in business language.  
5. Customer-friendly labels instead of raw chips like `top_2` / `Management Review`.

Drill-down *can* show score breakdown JSON — that answers a technical user, not Steve in a meeting.

---

## Part 3 — Management Workflow

Walk-through of the weekly governance path as implemented.

| Step | What happens | Intuitive? | Confusing / friction | Simplify |
|------|--------------|------------|----------------------|----------|
| **Review Top 2** | Scroll/scan Top 2 section; read cash, score, required action | Yes once Top 2 is found | Must pass health/alerts first | Put Top 2 above health for Executive view |
| **Open a Recommendation** | “Drill down” → detail page | Yes | Extra navigation away from Board | Optional side panel instead of full page |
| **Understand supporting evidence** | Detail shows explainability JSON, impacts, source, history | Impacts yes; evidence narrative weak | JSON breakdown is not customer-readable | Human “Why” summary + evidence bullets |
| **Approve** | Button on Board when in Management Review | Yes | Must already be Presented for review; Identified needs “Present for review” first — easy to miss | Auto-present or combine Present+Approve for Top 2 |
| **Assign** | Assign button → browser prompts for owner id/name | Concept clear | Prompt UX feels broken for a business app; ids vs names confusing | Inline assign form with people picker |
| **Accept** | Owner view / My Assigned → Accept & start | Clear for owners | Executive may not know owner must Accept before Active | Show “Waiting on owner” badge on Board |
| **Track progress** | Lifecycle chip + Holdover lane for open execution; detail timeline | Holdover concept learnable | No % complete / due date on Board card | Simple progress + due on Active cards |
| **Pause** | On Active → prompt for reason + approvedBy | Governance-correct | Double prompt; easy to abandon | Single Pause dialog with both fields |
| **Resume** | Resume button from Paused/Escalated | Yes | — | — |
| **Complete** | Not prominent on Board card toolbar (lifecycle continues via further actions / detail) | Weaker | Customer may not see “Complete” next to Pause/Escalate | Surface Complete when Active |
| **Validate outcome** | Required hint points to Outcome Validation → Pass → Archive | Spec-aligned | Multi-step; easy to lose in meeting | Guided “Close the loop” checklist |

### Workflow summary

- **Intuitive:** Top 2 focus, Required-action hints, Defer as its own section, Accept on owner queue.  
- **Confusing:** Present-before-Approve gate, technical chips, prompt dialogs, COI often empty.  
- **Unnecessary friction:** Full-page drill-down for every question; multiple prompts; persona disclaimer noise.  
- **Could simplify without redesigning V1.5:** Executive-first layout (Top 2 first), inline forms, one-line rationale, Complete/OV on the card when relevant.

---

## Part 4 — Decision Board Sections

| Section | Purpose obvious? | Belong on main Board? | Appropriate for executives? | Placement / prominence change? |
|---------|------------------|------------------------|-----------------------------|--------------------------------|
| **Business Health** | Moderately — tiles are clear once labeled | Useful, but secondary | Yes as a 10-second pulse | Move **below** Top 2 for Executive Monday view |
| **Alerts** | Yes when messages are plain language | Yes | Yes | Keep near top, but shorter and fewer |
| **Top 2** | Yes | **Essential — primary** | Yes | Make visually dominant; first content after a one-line header |
| **Emergency** | Empty-state text explains deferral | Lane belongs; empty “SD-2” wording does not | Concept yes; implementation caveat feels unfinished | Keep lane; soften wording to “None this week” for customers |
| **Holdover** | After one explanation, yes | Yes | Yes — open work visibility | Keep after Top 2 |
| **Deferred** | Yes with alert + section | Yes (V1.5 rule) | Yes | Keep; use friendly “Deferred — not competing for Top 2” |
| **Managed Backlog** | Yes | Yes, but not for deep Monday debate | Skim only | Collapse by default in Executive view |
| **Owner Queue** | Clear on My Assigned page | Better as nav destination than main Board dump | Owners yes; executives optional | Keep as separate page (current) |
| **Archive** | Clear | Separate page is correct | Occasional | Keep off main Board (current) |

---

## Part 5 — Explainability

Can the customer clearly answer:

| Question | Board today | Gap |
|----------|-------------|-----|
| **Why is this Recommendation here?** | Title + type + source + maybe interim badge | Missing business “story” sentence |
| **Why ranked above the others?** | Higher Priority number; Top 2 placement | No comparison narrative; score formula not customer-facing |
| **What if I ignore it?** | COI field often “Not available” | Weakest answer on the Board — trust risk |
| **What result if I act?** | Implied by type (cash / stock risk) | No expected-benefit statement |

### Missing explanations (customer language)

1. “Why #1 this week” (3–4 lines max).  
2. “Compared to the next item…”  
3. “If we wait…” (even qualitative if COI not calculated).  
4. “Success looks like…” after Approve/Complete.  
5. Plain labels for lifecycle (Review → Approved → Assigned → Active) instead of raw state chips alone.

Drill-down JSON helps auditors/developers; it does **not** satisfy Monday-morning explainability for Steve.

---

## Part 6 — Meeting Readiness

### Monday morning management meeting

| Capability | Feasible? | Notes |
|------------|-----------|-------|
| Identify Top 2 within one minute | **Yes, if Board is already scored** and facilitator points past header chrome | First-time users may take 2–3 minutes |
| Understand the rationale | **Partial** | Cash/score visible; full “why” needs drill-down or coaching |
| Assign ownership | **Yes, but awkward** | Prompt-based Assign works; not meeting-friendly |
| Leave with clear priorities | **Yes** | Top 2 + Required hints + Defer/Holdover separation support this |

### Estimated time — typical weekly review (facilitated, data ready)

| Segment | Time |
|---------|------|
| Orient + confirm Top 2 | 3–5 min |
| Discuss / decide each Top 2 (Approve/Defer/Reject) | 8–12 min |
| Assign owners | 3–5 min |
| Skim Holdover / Deferred | 3–5 min |
| Backlog glance (optional) | 0–3 min |
| **Total** | **~20–30 minutes** |

Without a facilitator or with empty/unsure data: **35–45 minutes**, mostly spent interpreting scores and prompts.

**Meeting readiness:** Suitable for a **structured pilot meeting**; not yet “open laptop, start talking, finish in 15 minutes” without coaching.

---

## Part 7 — Customer Trust

| Question | Assessment |
|----------|------------|
| Would a first-time customer trust the recommendations? | **Cautious yes** if cash figures match their intuition and a facilitator explains interim scoring |
| Would they understand how conclusions were reached? | **Not fully** from the Board alone — score is visible, story is not |
| Would they feel comfortable acting? | **On Approve/Defer of familiar SKUs — yes.** On trusting Priority decimals blindly — no |
| What reduces confidence? | Interim scoring banner (honest but unsettling); empty Emergency/SD-2 note; COI “Not available”; `prompt()` UX; soft viewAs “not security”; JSON explainability; technical chips (`top_2`, lifecycle jargon) |

Trust is highest when the customer recognizes the SKU and cash story. Trust is lowest when the Board looks like an unfinished engineering console.

---

## Part 8 — Improvement Opportunities

Do **not** redesign V1.5 architecture. Recommend only changes that materially improve usability or confidence.

### High priority

1. **One-line business rationale on each Top 2 card** (from existing explainability inputs — presentation only).  
2. **Replace browser `prompt()`** with simple inline forms for Defer / Reject / Pause / Assign.  
3. **Executive layout: Top 2 first** (Health/Alerts secondary or collapsed).  
4. **Customer-friendly labels** for lanes and lifecycle (keep system values underneath).  
5. **Qualitative “if we wait”** when COI is null (without inventing SD-1 formulas).

### Medium priority

6. Surface **Complete / Outcome Validation** actions on the Board when lifecycle requires them.  
7. **“Waiting on owner acceptance”** badge after Assign.  
8. Soften Emergency empty state to customer language (“None elevated this week”).  
9. Collapse **Managed Backlog** by default in Executive view.  
10. Short **Monday checklist** (“Confirm Top 2 → Decide → Assign → Skim Holdover/Deferred”).

### Nice to have

11. Side-panel drill-down instead of full page.  
12. Side-by-side Top 2 comparison.  
13. Progress % / due date on Active Holdover cards.  
14. Printable / projector “meeting mode” (large Top 2 only).

---

## Final Assessment

| Dimension | Rating |
|-----------|--------|
| **Overall customer experience** | **62%** |
| **Executive usability** | **58%** |
| **Operations usability** | **72%** (intake + calculate adjacent to Board helps ops more than executives) |
| **Weekly management meeting readiness** | **Conditionally ready** — with facilitator / pilot script |
| **Customer pilot readiness** | **Yes — facilitated pilot** |
| **Commercial demonstration readiness** | **Not yet** — prompts, rationale gaps, and console chrome would hurt a sales demo |

### Ratings in context

- The **decision model** (Top 2, Deferred rule, Holdover as lane, interim scoring labeled) is sound and visible.  
- The **customer packaging** still reads like a strong internal pilot console, not a finished Monday-morning product.

---

## Direct answer

**If you were running a $15–20 million distribution company, would you trust this Decision Board enough to use it every Monday morning? Why or why not?**

**Not yet as the sole Monday ritual — but yes as a facilitated pilot for 4–6 weeks.**

**Why not fully yet**
- I would not want my leadership team fighting browser prompts and technical chips in a live meeting.  
- I need a plain-English “why these two” before I will defend Priority scores to my managers.  
- Empty COI and interim-score disclaimers are honest, but they make me hesitate to act without a human vouching for the list.

**Why I would still pilot it**
- Top 2 + cash impact + clear next action is the right management shape.  
- Deferred staying visible without stealing Top 2 slots matches how real executives think.  
- Holdover visibility for open work is valuable.  
- The system does not hide uncertainty (interim profile, confidence, interim evidence badges) — that builds long-term trust if packaging improves.

**Bottom line:** Trust the **direction**; do not yet bet the weekly operating rhythm on the **current presentation**. Close the high-priority packaging gaps (rationale line, inline forms, Top-2-first executive view) before calling it a standing Monday tool.

---

## Explicit stop

Customer Experience & Decision Board Walkthrough complete.  
**No application code was modified.**  
**Stopped.** Awaiting Project Owner review. Phase 6 remains unauthorized until separately approved.
