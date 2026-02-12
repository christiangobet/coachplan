'use client';

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';

export default function PlanDetailPage() {
  const params = useParams<{ id: string }>();
  const planId = Array.isArray(params?.id) ? params?.id[0] : params?.id;
  const [plan, setPlan] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!planId) return;
    (async () => {
      try {
        const res = await fetch(`/api/plans/${planId}`);
        const text = await res.text();
        let data: any = null;
        try {
          data = JSON.parse(text);
        } catch {
          setError('Server returned non-JSON response.');
          return;
        }
        if (!res.ok) {
          setError(data?.error || 'Failed to load plan.');
          return;
        }
        setPlan(data.plan);
      } catch (err: any) {
        setError(err?.message || 'Failed to load plan.');
      }
    })();
  }, [planId]);

  if (error) {
    return (
      <main className="container">
        <p className="muted" style={{ color: '#b42318' }}>{error}</p>
      </main>
    );
  }

  if (!plan) return <main className="container"><p className="muted">Loading...</p></main>;

  return (
    <main>
      <section className="card white">
        <div className="section-title">
          <h1>{plan.name}</h1>
        </div>
        <p className="muted">Weeks: {plan.weekCount || '-'} · Status: {plan.status}</p>
      </section>

      <section className="container" style={{ marginTop: 24 }}>
        <div className="card">
          <div className="section-title">
            <h3>Activities</h3>
          </div>
          <table>
            <thead>
              <tr>
                <th>Week</th>
                <th>Day</th>
                <th>Activity</th>
              </tr>
            </thead>
            <tbody>
              {plan.weeks?.flatMap((week: any) =>
                (week.days || []).flatMap((day: any) =>
                  (day.activities || []).map((a: any) => (
                    <tr key={a.id}>
                      <td>{week.weekIndex}</td>
                      <td>{day.dayOfWeek}</td>
                      <td>{a.title}</td>
                    </tr>
                  ))
                )
              )}
            </tbody>
          </table>
        </div>
      </section>
    </main>
  );
}
