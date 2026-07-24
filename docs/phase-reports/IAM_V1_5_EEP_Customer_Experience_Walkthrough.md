# IAM Version 1.5 — EEP Customer Experience Walkthrough

| Field | Value |
|-------|--------|
| **Audience** | Project Owner / executive pilot facilitator |
| **Blueprint** | IAM Executive Experience Blueprint v1.0 |
| **Date** | 2026-07-21 |
| **Scenario** | Weekly distributor inventory action review (post-EEP Board) |

---

## Timed path (~5 minutes)

1. Open Decision Board for the Review Cycle (`/runs/[runId]`), View as **Executive**.  
2. Dismiss or read **Your first five minutes** (onboarding).  
3. Read **Weekly Business Summary** headline + bullets (&lt;30s).  
4. Check **Business Momentum** direction + reason.  
5. Confirm **OEC** display (slots used / capacity). Adjust only if authorized.  
6. If present, resolve **Decisions Requiring Management** with the single primary CTA.  
7. Review **This Week's Active Priorities** — Trust Pyramid (What / Why / Why now / Expected / Confidence).  
8. Scan **Work in Progress / Holdover** for progress and blockers.  
9. Expand **Waiting for Activation** only if promoting more work (after capacity frees).  
10. Leave **Deferred** collapsed unless reactivating.  
11. Optionally expand **Recently Completed**.

---

## Distributor scenario script

| Step | What the executive should see / do | Pass signal |
|------|--------------------------------------|-------------|
| A | Summary explains capacity and attention without developer language | Can restate “what needs me this week” |
| B | Momentum has a direction + reason from run facts | Not invented KPI theater |
| C | Active Priorities count ≤ available OEC after Holdover | No overflow without deliberate OEC change |
| D | Waiting list ordered by score; Deferred excluded from competition | Deferred never “steals” a slot |
| E | Paused Holdover visible but does not consume OEC | Slot count matches policy |
| F | One primary button per card; Defer/Reject via inline form | No browser `prompt()` on Board |
| G | Aging advisory (if any) suggests reassessment only | No auto pause/defer/reprioritize |
| H | Owner view shows waiting-acceptance badge | Soft viewAs only — not security |

---

## Walkthrough questions (Checklist §4)

| # | Question | Observed (2026-07-21 implementation) |
|---|----------|--------------------------------------|
| 1 | Can an executive explain Active Priorities without translation? | Yes — labeled section + Trust Pyramid |
| 2 | Is cognitive load lower than pre-EEP Top-2 console? | Yes — collapsed Waiting/Deferred; Summary first |
| 3 | Does OEC feel like a real capacity control? | Yes — visible, editable, audited |
| 4 | Are Waiting items clearly not commitments? | Yes — Waiting for Activation lane |
| 5 | Is confidence explained with limitations? | Yes — confidence narrative cites interim profile / SD-1 |

---

## Facilitated vs unattended

| Mode | Assessment |
|------|------------|
| Facilitated pilot | Ready |
| Unattended executive weekly use | Substantially improved vs Phase 5; still interim scoring language and soft viewAs caveats |

**STOP — include with EEP Completion package for Project Owner review.**
