# IAM Version 1.5 — EEP Blueprint Traceability Matrix

| Blueprint / Checklist theme | Implementation location | Test / evidence |
|----------------------------|-------------------------|-----------------|
| OEC configuration | `Company.organizationalExecutionCapability`; `/api/companies/[companyId]/oec` | EEP-OEC-AUDIT |
| OEC consumption (Active + Holdover; not Paused/Deferred/Waiting) | `presentation/oec.ts`; `rules.ts` OEC_CONSUMING_* | EEP-CONSUME, EEP-PAUSED-LANE |
| Active Priorities | `assignPresentation` → `active_priority` | EEP-PROMOTE; P4-TOP2 |
| Waiting for Activation | `waiting_activation` | EEP-PROMOTE; Board lane |
| Deferred presentation rule | `defer-status` + assign | P4-DEFER-* |
| Weekly Business Summary | `presentation/summary.ts`; DecisionBoard | EEP-SUMMARY |
| Business Momentum | `buildBusinessMomentum` | Walkthrough |
| Trust Pyramid | `presentation/story.ts`; Recommendation fields | EEP-TRUST, EEP-STORY-PERSIST |
| Primary CTA | `primaryCtaLabel`; RecommendationCard | Manual / Walkthrough |
| Inline decision forms | RecommendationCard forms | TD-015 closure on Board |
| Progress / blockers | Recommendation progress fields; PATCH progress | EEP-PROGRESS |
| Aging advisory only | `presentation/aging.ts` | EEP-AGING |
| Onboarding | DecisionBoard localStorage intro | Walkthrough |
| Role views | soft viewAs | Phase 5 / EEP Board |
| Recently Completed | Board completed section | Walkthrough |

ADR-IAM-001: no inbound/adapter/contract change required for EEP.
