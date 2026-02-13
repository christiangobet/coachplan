'use client';

import { useEffect, useState } from 'react';
import './plans.css';

type Plan = { id: string; name: string; weekCount?: number | null; status: string };
type Template = { id: string; name: string; weekCount?: number | null };

function statusColor(status: string) {
  if (status === 'ACTIVE') return 'var(--green)';
  if (status === 'DRAFT') return 'var(--amber)';
  return 'var(--muted)';
}

export default function PlansPage() {
  const [plans, setPlans] = useState<Plan[]>([]);
  const [templates, setTemplates] = useState<Template[]>([]);
  const [userId, setUserId] = useState<string | null>(null);
  const [assigning, setAssigning] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch('/api/me')
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then((d) => setUserId(d.id))
      .catch(() => setUserId(null));

    fetch('/api/plans')
      .then((r) => r.json())
      .then((d) => setPlans(d.plans || []));

    fetch('/api/templates')
      .then((r) => r.json())
      .then((d) => setTemplates(d.templates || []));
  }, []);

  const handleUseTemplate = async (templateId: string) => {
    if (!userId) return;
    setAssigning(templateId);
    setError(null);
    try {
      const res = await fetch('/api/coach/assign', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ templateId, athleteId: userId })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || 'Failed to assign template');
      if (data?.planId) window.location.href = `/plans/${data.planId}`;
    } catch (err: any) {
      setError(err?.message || 'Failed to assign template');
    } finally {
      setAssigning(null);
    }
  };

  return (
    <main className="plans-page">
      <div className="plans-header">
        <div>
          <h1>Plans</h1>
          <p className="muted">Your training plans and available templates.</p>
        </div>
        <a className="cta" href="/upload">Upload Plan</a>
      </div>

      {/* Active plans */}
      <section className="plans-section">
        <h2 className="plans-section-title">Your Plans</h2>
        {plans.length === 0 ? (
          <div className="plans-empty">
            <p className="muted">No plans yet. Upload a PDF or use a template to get started.</p>
          </div>
        ) : (
          <div className="plans-grid">
            {plans.map((plan) => (
              <a className="plan-card" href={`/plans/${plan.id}`} key={plan.id}>
                <div className="plan-card-top">
                  <span
                    className="plan-status-dot"
                    style={{ background: statusColor(plan.status) }}
                  />
                  <span className="plan-status-label">{plan.status}</span>
                </div>
                <h3 className="plan-card-name">{plan.name}</h3>
                <span className="plan-card-meta">
                  {plan.weekCount ? `${plan.weekCount} weeks` : 'No weeks set'}
                </span>
                <span className="plan-card-action">Open plan &rarr;</span>
              </a>
            ))}
          </div>
        )}
      </section>

      {/* Templates */}
      <section className="plans-section">
        <h2 className="plans-section-title">Templates</h2>
        {error && <p style={{ color: 'var(--red)', fontSize: 14, marginBottom: 12 }}>{error}</p>}
        {templates.length === 0 ? (
          <div className="plans-empty">
            <p className="muted">No templates available.</p>
          </div>
        ) : (
          <div className="plans-grid">
            {templates.map((tpl) => (
              <div className="plan-card template" key={tpl.id}>
                <div className="plan-card-top">
                  <span className="plan-template-badge">Template</span>
                </div>
                <h3 className="plan-card-name">{tpl.name}</h3>
                <span className="plan-card-meta">
                  {tpl.weekCount ? `${tpl.weekCount} weeks` : 'No weeks set'}
                </span>
                <button
                  className="plan-card-use"
                  onClick={() => handleUseTemplate(tpl.id)}
                  disabled={!userId || assigning === tpl.id}
                >
                  {assigning === tpl.id ? 'Assigning...' : 'Use template'}
                </button>
              </div>
            ))}
          </div>
        )}
      </section>
    </main>
  );
}
