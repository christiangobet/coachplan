'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import AthleteSidebar from '@/components/AthleteSidebar';
import '../dashboard/dashboard.css';
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
  const [athleteName, setAthleteName] = useState('Athlete');
  const [assigning, setAssigning] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch('/api/me')
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then((d) => {
        setUserId(d.id);
        if (d?.name) setAthleteName(d.name);
      })
      .catch(() => setUserId(null));

    fetch('/api/plans')
      .then((r) => r.json())
      .then((d) => setPlans(d.plans || []))
      .catch(() => setPlans([]));

    fetch('/api/templates')
      .then((r) => r.json())
      .then((d) => setTemplates(d.templates || []))
      .catch(() => setTemplates([]));
  }, []);

  const handleUseTemplate = async (templateId: string) => {
    if (!userId) return;
    setAssigning(templateId);
    setError(null);
    try {
      const res = await fetch('/api/plans/from-template', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ templateId })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || 'Failed to create plan from template');
      if (data?.planId) window.location.href = `/plans/${data.planId}`;
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to assign template');
    } finally {
      setAssigning(null);
    }
  };

  const activePlans = plans.filter((plan) => plan.status === 'ACTIVE').length;

  return (
    <main className="dash plans-page-shell">
      <div className="dash-grid">
        <AthleteSidebar name={athleteName} />

        <section className="dash-center">
          <div className="dash-card plans-shell-header">
            <div className="plans-header">
              <div>
                <h1>Plans</h1>
                <p className="muted">Your training plans and available templates.</p>
              </div>
              <Link className="cta" href="/upload">Upload Plan</Link>
            </div>
          </div>

          <section className="plans-section plans-shell-section">
            <h2 className="plans-section-title">Your Plans</h2>
            {plans.length === 0 ? (
              <div className="plans-empty">
                <p className="muted">No plans yet. Upload a PDF or use a template to get started.</p>
              </div>
            ) : (
              <div className="plans-grid">
                {plans.map((plan) => (
                  <Link className="plan-card" href={`/plans/${plan.id}`} key={plan.id}>
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
                  </Link>
                ))}
              </div>
            )}
          </section>

          <section className="plans-section plans-shell-section">
            <h2 className="plans-section-title">Templates</h2>
            {error && <p style={{ color: 'var(--d-red)', fontSize: 14, marginBottom: 12 }}>{error}</p>}
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
        </section>

        <aside className="dash-right">
          <div className="dash-card plans-right-card">
            <div className="dash-card-header">
              <span className="dash-card-title">Overview</span>
            </div>
            <div className="plans-overview-grid">
              <div>
                <strong>{plans.length}</strong>
                <span>Total plans</span>
              </div>
              <div>
                <strong>{activePlans}</strong>
                <span>Active</span>
              </div>
              <div>
                <strong>{templates.length}</strong>
                <span>Templates</span>
              </div>
            </div>
          </div>

          <div className="dash-card plans-right-card">
            <div className="dash-card-header">
              <span className="dash-card-title">Actions</span>
            </div>
            <div className="plans-links">
              <Link href="/dashboard">Open today dashboard</Link>
              <Link href="/upload">Upload a PDF plan</Link>
              <Link href="/profile">Update athlete profile</Link>
            </div>
          </div>
        </aside>
      </div>
    </main>
  );
}
