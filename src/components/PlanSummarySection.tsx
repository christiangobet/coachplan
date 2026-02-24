'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import PlanSummaryCard from './PlanSummaryCard';
import type { PlanSummary } from '@/lib/types/plan-summary';

type Props = {
  summary: PlanSummary | null;
  planId: string;
};

export default function PlanSummarySection({ summary, planId }: Props) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);

  async function handleExtract() {
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
      onExtract={loading ? undefined : handleExtract}
    />
  );
}
