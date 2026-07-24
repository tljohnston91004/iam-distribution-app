# IAM Version 1.5 — Internal Defect Log Template

| Field | Value |
|-------|--------|
| **Document** | Internal Defect Log Template |
| **Cycle** | Internal Testing — ________ |
| **Date opened** | |

---

## 1. Severity levels

| Severity | Definition | Default handling |
|----------|------------|------------------|
| **Critical (S1)** | Board/E2E unusable; data loss; incorrect lifecycle write; OEC/Paused policy violated | **Blocker** — stop scenario area until fixed |
| **High (S2)** | Major workflow wrong/missing; Trust/CTA broken on Active Priorities; calculate fails on valid pack | **Blocker** for Exit unless PO Waives |
| **Medium (S3)** | Workaround exists; secondary lane/UX issue; intermittent | Non-blocking if workaround documented |
| **Low (S4)** | Cosmetic, copy, minor a11y | Non-blocking |

---

## 2. Blocking vs non-blocking

| Class | Rule |
|-------|------|
| **Blocker** | Prevents Entry continuation of related scenarios **or** prevents Exit (S1 always; S2 unless Waived) |
| **Non-blocking** | Logged; may ship to Design Partner only if listed in accepted limitations memo |

---

## 3. Defect report format (one row per defect)

| Field | Content |
|-------|---------|
| Defect ID | IT-DEF-### |
| Title | Short summary |
| Severity | S1–S4 |
| Blocking? | Y / N |
| Scenario ID | IT-xx |
| Environment | DB path / build / browser |
| Steps to reproduce | 1…n |
| Expected | |
| Actual | |
| Evidence | screenshot / runId / recId |
| Owner | |
| Status | Open / In fix / Ready retest / Closed / Waived |
| Waived by | PO name / date (if any) |
| Retest result | Pass / Fail / date |
| Regression run? | Y / N (suite or scenario list) |

### Log table

| ID | Title | Sev | Block | Scenario | Status | Owner | Retest |
|----|-------|-----|-------|----------|--------|-------|--------|
| | | | | | | | |

---

## 4. Retest requirements

- Every fix: retest original scenario + nearest neighbor (e.g. Approve fix → also Defer once).  
- S1/S2 fixes: re-run affected automated suite(s) before marking Closed.  
- Waived defects: remain on Exit limitations list.

---

## 5. Regression requirements

Before Exit: full `test:phase1` … `test:phase5a` green, plus smoke of IT-02, IT-06, IT-07, IT-08, IT-12.

---

## 6. Approval authority for accepted limitations

| Action | Authority |
|--------|-----------|
| Accept S3/S4 open at Exit | Facilitator + note in Exit memo |
| Waive S2 Blocker for Exit | **Project Owner only** |
| Waive S1 | **Not permitted** for Exit to Design Partner Validation |

---

## Explicit stop

Template only. No code changes.
