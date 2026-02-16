export const SELECTED_PLAN_COOKIE = 'coachplan_selected_plan';
export const PLAN_QUERY_ROUTES = new Set(['/dashboard', '/calendar', '/progress', '/strava']);

type PlanLike = {
  id: string;
  status?: string | null;
  updatedAt?: Date | string | null;
  createdAt?: Date | string | null;
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
    preferActive?: boolean;
  }
): T | null {
  const preferActive = options?.preferActive !== false;
  const requestedPlanId = normalizePlanId(options?.requestedPlanId);
  if (requestedPlanId) {
    const requested = plans.find((plan) => plan.id === requestedPlanId);
    if (requested) return requested;
  }

  const activePlans = plans.filter((plan) => plan.status === 'ACTIVE');
  const hasActivePlans = activePlans.length > 0;

  const cookiePlanId = normalizePlanId(options?.cookiePlanId);
  if (cookiePlanId) {
    const fromCookie = plans.find((plan) => plan.id === cookiePlanId);
    if (fromCookie) {
      if (!preferActive || !hasActivePlans || fromCookie.status === 'ACTIVE') {
        return fromCookie;
      }
    }
  }

  const toEpoch = (value: Date | string | null | undefined) => {
    if (!value) return 0;
    const asDate = value instanceof Date ? value : new Date(value);
    const epoch = asDate.getTime();
    return Number.isFinite(epoch) ? epoch : 0;
  };

  const pickLatest = (items: T[]) =>
    items.reduce((best, current) => {
      if (!best) return current;
      const bestEpoch = Math.max(toEpoch(best.updatedAt), toEpoch(best.createdAt));
      const currentEpoch = Math.max(toEpoch(current.updatedAt), toEpoch(current.createdAt));
      return currentEpoch > bestEpoch ? current : best;
    }, null as T | null);

  if (preferActive && hasActivePlans) {
    return pickLatest(activePlans);
  }

  const firstDraft = pickLatest(plans.filter((plan) => plan.status === 'DRAFT'));
  if (firstDraft) return firstDraft;
  return plans[0] || null;
}

export function extractPlanIdFromPathname(pathname: string | null | undefined) {
  if (!pathname) return null;
  const match = pathname.match(/^\/plans\/([^/?#]+)/);
  if (!match?.[1]) return null;
  try {
    return decodeURIComponent(match[1]);
  } catch {
    return match[1];
  }
}

export function appendPlanQueryToHref(href: string, planId: string | null | undefined) {
  const cleanPlanId = normalizePlanId(planId);
  if (!cleanPlanId) return href;
  if (!href.startsWith('/')) return href;

  const [pathAndQuery, hashFragment] = href.split('#');
  const [pathname, queryString] = pathAndQuery.split('?');
  if (!PLAN_QUERY_ROUTES.has(pathname)) return href;

  const params = new URLSearchParams(queryString || '');
  if (!params.get('plan')) {
    params.set('plan', cleanPlanId);
  }
  const withQuery = `${pathname}?${params.toString()}`;
  return hashFragment ? `${withQuery}#${hashFragment}` : withQuery;
}
