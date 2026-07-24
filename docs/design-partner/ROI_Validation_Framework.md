# Decision Priority Design Partner Validation Standard v1.0 — ROI Validation Framework (IAM V1.5)

| Field | Value |
|-------|--------|
| **Standard** | Decision Priority Design Partner Validation Standard |
| **Standard version** | **Final Version 1.0** |
| **Status** | **Final Version 1.0** — Approved Decision Priority company standard (Project Owner 2026-07-21) |
| **Module** | IAM Version 1.5 (first module implementation) |
| **Document** | ROI Validation Framework |
| **Parent** | Design Partner Validation Program |
| **Principle** | Conservative, assumption-labeled, auditable |
| **Date** | 2026-07-21 |

---

## 1. Purpose

Standardize how Design Partner ROI is calculated so commercial claims are comparable across partners and reusable for other Decision Priority modules.

**Rules**
- Separate **Measured**, **Estimated**, and **Qualitative** value.  
- Never present Estimated as Measured.  
- Prefer cohort-level attribution over whole-company claims.  
- Document counterfactuals (“what would have happened anyway”).  

---

## 2. Value pillars & formulas

### 2.1 Cash / inventory release (primary for IAM)

\[
V_{cash} = \sum_{i \in Completed} A_i
\]

Where \(A_i\) is:
- **Measured:** actual cash released / inventory $ reduction for SKU/action \(i\), or  
- **Estimated:** IAM `estimatedCashImpact` × realization factor \(r\) (default \(r = 0.5\) unless partner agrees higher with evidence)

**Realization factor guidance:** Start at 0.5; raise only with documented actuals on a sample.

### 2.2 Gross profit protection (stockout / fill)

\[
V_{GP} = (\text{Stockouts avoided} \times \text{Avg GP \$ per stockout event})
\]

or

\[
V_{GP} = \Delta \text{Fill rate} \times \text{Relevant revenue} \times \text{GP\%}
\]

Use **one** method; label inputs. If uncertain, report as Qualitative.

### 2.3 Purchasing improvements

\[
V_{purch} = (\text{Expedite cost}_{baseline} - \text{Expedite cost}_{pilot}) + (\text{Hours saved} \times \text{Fully loaded hourly rate})
\]

### 2.4 Productivity / time savings

\[
V_{time} = (\text{Hours}_{baseline} - \text{Hours}_{pilot}) \times \text{Loaded hourly rate of attendees}
\]

Include weekly meeting + estimated firefight hours from survey.

### 2.5 Decision quality (scored, optional $)

Not always monetized. Report questionnaire delta (Week 0 → 12) as a scored benefit. Optional:

\[
V_{quality} = \text{Avoided bad buy \$}_{sampled}
\]

only with explicit examples.

---

## 3. Total pilot ROI

\[
V_{total} = V_{cash} + V_{GP} + V_{purch} + V_{time} + V_{quality}
\]

\[
ROI = \frac{V_{total} - C_{pilot}}{C_{pilot}}
\]

Where \(C_{pilot}\) = subscription/pilot fee + internal hours cost (optional) + implementation support cost.

**Payback (weeks)** = \(C_{pilot} / (V_{total} / \text{pilot weeks})\) when \(V_{total} > 0\).

---

## 4. Measurement methodology

| Step | Action |
|------|--------|
| 1 | Lock Baseline Pack (KPI Guide) |
| 2 | Tag Recommendations that enter Approve/Active (intervention set) |
| 3 | On Complete/OV, capture actuals if available; else apply \(r\) |
| 4 | Monthly roll-up of pillars with confidence tag (High/Med/Low) |
| 5 | Week 12: ROI Report with sensitivity (\(r = 0.3 / 0.5 / 0.7\)) |

---

## 5. ROI Report outline (per partner)

1. Executive summary (1 paragraph + $ range Low/Base/High)  
2. Scope & cohort  
3. Costs \(C_{pilot}\)  
4. Pillar detail tables  
5. Assumptions & realization factor  
6. Sensitivity  
7. Qualitative benefits  
8. Conclusion: Positive / Neutral / Negative / Insufficient data  
9. Quote candidates  

---

## 6. Platform reuse

Other Decision Priority modules keep pillars **Cash/Financial, Risk Avoidance, Process Efficiency, Time, Decision Quality** and replace IAM-specific estimators (e.g., trapped cash → module-native value fields).

---

## Explicit stop

ROI Validation Framework complete. Methodology only.

Work approved and complete.
