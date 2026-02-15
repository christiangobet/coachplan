'use client';

import { useEffect } from 'react';
import { SELECTED_PLAN_COOKIE } from '@/lib/plan-selection';

export default function SelectedPlanCookie({ planId }: { planId: string | null | undefined }) {
  useEffect(() => {
    if (!planId) return;
    document.cookie = `${SELECTED_PLAN_COOKIE}=${encodeURIComponent(planId)}; Path=/; Max-Age=31536000; SameSite=Lax`;
  }, [planId]);

  return null;
}

