/**
 * Slim explainability for Board list payloads — keep Prescribed Action Plan summary,
 * drop bulky per-SKU arrays that blow up RSC refresh after Present/Calculate.
 */
export function slimExplainabilityForBoard(json: string | null): string | null {
  if (!json) return null;
  try {
    const ex = JSON.parse(json) as Record<string, unknown>;
    const detail = (ex.detail as Record<string, unknown> | undefined) ?? {};
    const planRaw =
      (ex.prescribedActionPlan as Record<string, unknown> | undefined) ??
      (detail.prescribedActionPlan as Record<string, unknown> | undefined) ??
      null;

    const actionGroups = Array.isArray(planRaw?.actionGroups)
      ? (planRaw!.actionGroups as { actionCode?: string; actionLabel?: string; skuCount?: number; excessValue?: number }[]).map(
          (g) => ({
            actionCode: g.actionCode,
            actionLabel: g.actionLabel,
            skuCount: g.skuCount,
            excessValue: g.excessValue,
          })
        )
      : [];

    const plan = planRaw
      ? {
          version: planRaw.version,
          recommendedManagementAction: planRaw.recommendedManagementAction,
          reasonSelected: planRaw.reasonSelected,
          summaryLine: planRaw.summaryLine,
          immediateNextSteps: planRaw.immediateNextSteps,
          executionSequence: planRaw.executionSequence,
          ownerRole: planRaw.ownerRole,
          targetCompletionPeriod: planRaw.targetCompletionPeriod,
          expectedFinancialResult: planRaw.expectedFinancialResult,
          expectedOperationalResult: planRaw.expectedOperationalResult,
          successMeasures: planRaw.successMeasures,
          risksAndCautions: planRaw.risksAndCautions,
          dataGapsOrDecisionsRequired: planRaw.dataGapsOrDecisionsRequired,
          alternativeActions: planRaw.alternativeActions,
          dataConfidence: planRaw.dataConfidence,
          affectedPopulation: planRaw.affectedPopulation,
          actionGroups,
        }
      : null;

    const membersRaw =
      (ex.memberSkus as unknown[] | undefined) ??
      (detail.memberSkus as unknown[] | undefined) ??
      [];
    const memberSkus = (Array.isArray(membersRaw) ? membersRaw : [])
      .slice(0, 12)
      .map((m) => {
        const row = m as {
          skuOrItemId?: string;
          inventoryValue?: number | null;
          recommendedAction?: string;
        };
        return {
          skuOrItemId: row.skuOrItemId,
          inventoryValue: row.inventoryValue,
          recommendedAction: row.recommendedAction,
        };
      });

    const revised = ex.revisedScore as
      | {
          ok?: boolean;
          governedFinalScore?: number;
          priorityBand?: string;
          structuredExplanation?: string[];
          exceptionMessage?: string;
          exceptionCode?: string;
        }
      | undefined;

    return JSON.stringify({
      analysisGrain: ex.analysisGrain ?? detail.analysisGrain,
      recommendedManagementAction:
        ex.recommendedManagementAction ?? plan?.recommendedManagementAction ?? null,
      dataQualityWarning: ex.dataQualityWarning ?? detail.dataQualityWarning ?? null,
      prescribedActionPlan: plan,
      memberSkus,
      memberSkuTotal:
        (detail.affectedSkuCount as number | undefined) ??
        (Array.isArray(membersRaw) ? membersRaw.length : memberSkus.length),
      revisedScore: revised
        ? revised.ok === false
          ? {
              ok: false,
              exceptionCode: revised.exceptionCode,
              exceptionMessage: revised.exceptionMessage,
            }
          : {
              ok: true,
              governedFinalScore: revised.governedFinalScore,
              priorityBand: revised.priorityBand,
              structuredExplanation: (revised.structuredExplanation ?? []).slice(0, 6),
            }
        : undefined,
      authoritativeProfile: ex.authoritativeProfile,
      coiBoardDisplayLine: ex.coiBoardDisplayLine ?? null,
      costOfInactionDetail: ex.costOfInactionDetail
        ? {
            coiHorizonDays: (ex.costOfInactionDetail as { coiHorizonDays?: number }).coiHorizonDays,
            carryingCostComponent: (ex.costOfInactionDetail as { carryingCostComponent?: number })
              .carryingCostComponent,
            preventableLossComponent: (
              ex.costOfInactionDetail as { preventableLossComponent?: number }
            ).preventableLossComponent,
            annualCarryingCostRate: (
              ex.costOfInactionDetail as { annualCarryingCostRate?: number }
            ).annualCarryingCostRate,
            coiConfidenceLevel: (ex.costOfInactionDetail as { coiConfidenceLevel?: string })
              .coiConfidenceLevel,
            coiCalculationExplanation: (
              ex.costOfInactionDetail as { coiCalculationExplanation?: string }
            ).coiCalculationExplanation,
            coiCalculationStatus: (ex.costOfInactionDetail as { coiCalculationStatus?: string })
              .coiCalculationStatus,
          }
        : undefined,
    });
  } catch {
    return null;
  }
}
