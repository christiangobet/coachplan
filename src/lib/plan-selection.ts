export const SELECTED_PLAN_COOKIE = 'coachplan_selected_plan';

type PlanLike = {
  id: string;
  status?: string | null;
};

function normalizePlanId(value: string | null | undefined) {
  if (!value) return null;
  const trimmed = String(value).trim();
  return trimmed.length > 0 ? trimmed : null;
}

export function pickSelectedPlan<T extends PlanLike>(
  plans: T[],
  options?: {
    requestedPlanId?: string | null;
    cookiePlanId?: string | null;
  }
): T | null {
  const requestedPlanId = normalizePlanId(options?.requestedPlanId);
  if (requestedPlanId) {
    const requested = plans.find((plan) => plan.id === requestedPlanId);
    if (requested) return requested;
  }

  const cookiePlanId = normalizePlanId(options?.cookiePlanId);
  if (cookiePlanId) {
    const fromCookie = plans.find((plan) => plan.id === cookiePlanId);
    if (fromCookie) return fromCookie;
  }

  const firstActive = plans.find((plan) => plan.status === 'ACTIVE');
  if (firstActive) return firstActive;
  const firstDraft = plans.find((plan) => plan.status === 'DRAFT');
  if (firstDraft) return firstDraft;
  return plans[0] || null;
}
