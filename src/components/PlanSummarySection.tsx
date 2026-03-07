'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import PlanSummaryCard, { type WeeklyRunPoint } from './PlanSummaryCard';
import type { PlanSummary } from '@/lib/types/plan-summary';

type Props = {
  summary: PlanSummary | null;
  planId: string;
  weeklyRuns?: WeeklyRunPoint[];
  weeklyRunUnit?: string;
  currentWeekIndex?: number | null;
  onExtract?: () => Promise<void>;
};

export default function PlanSummarySection({
  summary,
  planId,
  weeklyRuns,
  weeklyRunUnit,
  currentWeekIndex,
  onExtract
}: Props) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);

  async function handleExtract() {
    if (onExtract) {
      await onExtract();
      return;
    }
    setLoading(true);
    try {
      await fetch(`/api/plans/${planId}/extract-guide`, { method: 'POST' });
      router.refresh();
    } finally {
      setLoading(false);
    }
  }

  return (
    <PlanSummaryCard
      summary={summary}
      planId={planId}
      weeklyRuns={weeklyRuns}
      weeklyRunUnit={weeklyRunUnit}
      currentWeekIndex={currentWeekIndex}
      onExtract={loading ? undefined : handleExtract}
    />
  );
}
