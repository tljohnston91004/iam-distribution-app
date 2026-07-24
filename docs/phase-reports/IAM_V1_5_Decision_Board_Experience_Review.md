# IAM Version 1.5 — Decision Board Experience Review

| Field | Value |
|-------|--------|
| **Document title** | Decision Board Experience Review |
| **Purpose** | Product experience evaluation of the Phase 5 Decision Board for clarity, usability, and customer-validation readiness |
| **Date** | 2026-07-21 |
| **Prepared by** | Cursor (experience review — read-only after Phase 5 implementation) |
| **Code modified for this review** | **None** |
| **Surfaces reviewed** | `/runs/[runId]` Decision Board; recommendation drill-down; My Assigned; Archive / History; soft viewAs personas |
| **Governing intent** | IAM-004 management experience; Phase 3–4 scoring/presentation rules |
| **Phase 6** | **Not authorized** by this review |

---

## 1. Executive summary

| Dimension | Rating |
|-----------|--------|
| Clarity of priorities | **Strong** |
| Explainability | **Good** (technical depth available; narrative polish thin) |
| Usability | **Adequate for internal pilot** |
| Visual hierarchy | **Good** within existing dark ops UI |
| Decision support effectiveness | **Good** for weekly Top 2 / Defer / Holdover workflow |
| Management workflow | **Good** for Executive / Operations / Owner happy paths |
| First-time user experience | **Fair** — needs guided empty states and less prompt-driven input |
| Overall readiness for customer validation | **Conditionally Ready** |

**Verdict:** The Board is ready for **structured internal / friendly customer validation** with coaching. It is not yet a polished commercial UX, but priorities, Deferred handling, and role perspectives are clear enough to validate the V1.5 decision model.

---

## 2. Clarity of priorities

**Strengths**
- Top 2 is visually first and labeled with rank chips.
- Deferred is a distinct section and called out in Alerts — matches the approved Deferred Presentation Rule.
- Holdover vs backlog separation reinforces that open execution work is not “new Top 2.”
- Priority score is prominent on each card; cash/financial sit beside it.
- Interim evidence badges prevent module authority confusion.

**Gaps**
- Emergency lane empty state is explanatory but may look like a missing feature to first-time users.
- Log-compressed scores still need verbal coaching (inherited from interim scoring).

**Rating:** Strong.

---

## 3. Explainability

**Strengths**
- Drill-down exposes score breakdown JSON, profile id, governance history, and lifecycle timeline.
- Board banner states interim profile approval for V1.5.
- COI shown as “Not available” when null — honest, not fabricated.
- Required-action hint ties lifecycle + lane to next step.

**Gaps**
- Breakdown is raw JSON — managers will want a short prose “why this is Top 2” sentence.
- Confidence readiness labels exist in data but are not always surfaced on the card face.

**Rating:** Good for pilot; polish before broad customer demos.

---

## 4. Usability

**Strengths**
- Soft viewAs makes Executive / Operations / Owner perspectives demoable without accounts.
- Named governance actions are available from the card without leaving the Board.
- Owner queue and Accept path are short.
- Archive isolates completed/rejected history from active decisioning.

**Gaps**
- Defer/Reject/Pause/Assign use browser `prompt()` — brittle and unprofessional for customer sessions.
- Owner Board filter is heuristic; dedicated Assigned page is clearer.
- No keyboard/accessibility pass; dense dark theme may tire long sessions.

**Rating:** Adequate for internal pilot.

---

## 5. Visual hierarchy

**Strengths**
- Lane sections create a clear top-to-bottom decision scan: Top 2 → Emergency → Holdover → Deferred → Backlog.
- Business Health and Alerts sit above lanes — context before decisions.
- Chips separate lane vs lifecycle (important IAM-007B teaching).

**Gaps**
- All cards share similar weight; Top 2 could use stronger visual distinction (size/accent).
- Operations intake can compete with decision content when expanded.

**Rating:** Good within the established app chrome.

---

## 6. Decision support effectiveness

**Strengths**
- Supports the weekly management loop: review Top 2 → Approve/Assign or Defer/Reject → track Holdover → keep Deferred visible without polluting Top 2.
- Reactivate Deferred restores ranking without surprising rescoring.
- Operations can refresh evidence and recalculate without leaving the Board.

**Gaps**
- No side-by-side Top 2 comparison view.
- No capacity/sequencing UI (SD-14 still open) — actionability is invisible to managers.

**Rating:** Good for validating the V1.5 decision model.

---

## 7. Management workflow

| Persona | Workflow fit |
|---------|----------------|
| Executive | Strong — decide Top 2, Defer, Reject, Assign, escalate/pause active work |
| Operations | Strong — intake + calculate adjacent to Board |
| Owner | Good — Accept + execute cues; management notes correctly hidden |

**Residual:** Soft viewAs must be verbally framed as demo convenience until Phase 6 RBAC.

---

## 8. First-time user experience

**What works**
- Clear “Decision Board” naming and lane titles.
- Next-best-action line.
- Empty Emergency explanation.

**Friction**
- Empty Board before calculate may confuse users who expect sample data.
- Prompt dialogs interrupt flow.
- No short “how to run a weekly review” checklist on the page.

**Rating:** Fair — pair new users with a 5-minute script for validation sessions.

---

## 9. Overall readiness for customer validation

| Question | Answer |
|----------|--------|
| Ready for internal stakeholder walkthrough? | **Yes** |
| Ready for friendly customer validation with facilitator? | **Yes, conditionally** |
| Ready for unattended external UAT / sales demo? | **Not yet** — replace prompts; add prose explainability; empty-state onboarding |

### Minimum before broader customer validation
1. Replace `prompt()` governance inputs with inline forms.  
2. Add a one-screen “Weekly review” checklist for first-time users.  
3. Surface a short human-readable reason on Top 2 cards (from explainability).  
4. Keep facilitator script covering interim scoring + Deferred rule + Emergency placeholder.

---

## 10. Relation to Phase 6

Experience gaps that are **security/permissions** belong to Phase 6 (TD-014). Experience polish items above may be done in a Phase 5 patch or early Phase 5 hardening without authorizing Phase 6.

**Phase 6 is not authorized by this review.**

---

## Explicit stop

Decision Board Experience Review complete. No application code was modified for this review.  
**Stopped.** Awaiting Project Owner review of Phase 5 Completion Report + this Experience Review before any Phase 6 authorization.
