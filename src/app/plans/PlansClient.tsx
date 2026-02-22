'use client';

import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import AthleteSidebar from '@/components/AthleteSidebar';
import { pickSelectedPlan, SELECTED_PLAN_COOKIE } from '@/lib/plan-selection';
import '../dashboard/dashboard.css';
import './plans.css';

type Plan = {
  id: string;
  name: string;
  weekCount?: number | null;
  status: string;
  progress?: number;
  raceName?: string | null;
  raceDate?: string | null;
  createdAt?: string | null;
  updatedAt?: string | null;
};
type Template = { id: string; name: string; weekCount?: number | null };

function statusColor(status: string) {
  if (status === 'ACTIVE') return 'var(--d-green)';
  if (status === 'DRAFT') return 'var(--d-amber)';
  return 'var(--d-muted)';
}



function heroClass(status: string) {
  if (status === 'ACTIVE') return 'active';
  if (status === 'DRAFT') return 'draft';
  return 'archived';
}

function formatRaceDate(value: string | null | undefined) {
  if (!value) return 'Not set';
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return 'Not set';
  return parsed.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

export default function PlansClient() {
  const [plans, setPlans] = useState<Plan[]>([]);
  const [templates, setTemplates] = useState<Template[]>([]);
  const [userId, setUserId] = useState<string | null>(null);
  const [athleteName, setAthleteName] = useState('Athlete');
  const [assigning, setAssigning] = useState<string | null>(null);
  const [processingPlanId, setProcessingPlanId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [cookieSelectedPlanId, setCookieSelectedPlanId] = useState<string | null>(null);

  const rememberSelectedPlan = (planId: string) => {
    if (!planId) return;
    document.cookie = `${SELECTED_PLAN_COOKIE}=${encodeURIComponent(planId)}; Path=/; Max-Age=31536000; SameSite=Lax`;
    setCookieSelectedPlanId(planId);
  };

  const readSelectedPlanCookie = () => {
    const prefix = `${SELECTED_PLAN_COOKIE}=`;
    const raw = document.cookie
      .split(';')
      .map((item) => item.trim())
      .find((item) => item.startsWith(prefix));
    if (!raw) return null;
    const value = raw.slice(prefix.length);
    if (!value) return null;
    try {
      return decodeURIComponent(value);
    } catch {
      return value;
    }
  };

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

    setCookieSelectedPlanId(readSelectedPlanCookie());
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

  const updatePlanStatus = async (planId: string, status: 'DRAFT' | 'ACTIVE' | 'ARCHIVED') => {
    setProcessingPlanId(planId);
    setError(null);
    try {
      const res = await fetch(`/api/plans/${planId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status })
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) throw new Error(data?.error || 'Failed to update plan status');
      setPlans((prev) => prev.map((plan) => (
        plan.id === planId
          ? { ...plan, status: data?.plan?.status || status }
          : plan
      )));
      if ((data?.plan?.status || status) === 'ACTIVE') {
        rememberSelectedPlan(planId);
      }
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to update plan status');
    } finally {
      setProcessingPlanId(null);
    }
  };

  const deletePlan = async (planId: string) => {
    if (!window.confirm('Delete this plan permanently? This cannot be undone.')) return;
    setProcessingPlanId(planId);
    setError(null);
    try {
      const res = await fetch(`/api/plans/${planId}`, { method: 'DELETE' });
      const data = await res.json().catch(() => null);
      if (!res.ok) throw new Error(data?.error || 'Failed to delete plan');
      setPlans((prev) => prev.filter((plan) => plan.id !== planId));
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to delete plan');
    } finally {
      setProcessingPlanId(null);
    }
  };

  const activePlans = plans.filter((plan) => plan.status === 'ACTIVE');
  const draftPlans = plans.filter((plan) => plan.status === 'DRAFT');
  const archivedPlans = plans.filter((plan) => plan.status === 'ARCHIVED');
  const focusedPlan = useMemo(
    () => pickSelectedPlan(plans, { cookiePlanId: cookieSelectedPlanId }),
    [plans, cookieSelectedPlanId]
  );
  const focusedPlanId = focusedPlan?.id || null;

  return (
    <main className="dash plans-page-shell">
      <div className="dash-grid">
        <AthleteSidebar active="plans" name={athleteName} />

        <section className="dash-center">
          <div className="dash-card plans-shell-header">
            <div className="plans-header">
              <div>
                <h1>Plans Management</h1>
                <p className="muted">Your training plans and available templates.</p>
              </div>
              <Link className="cta" href="/upload">Upload Plan</Link>
            </div>
          </div>

          <section className="plans-section plans-shell-section">
            <h2 className="plans-section-title">Active Plans</h2>
            {error && <p style={{ color: 'var(--d-red)', fontSize: 14, marginBottom: 12 }}>{error}</p>}
            {activePlans.length === 0 ? (
              <div className="plans-empty">
                <p className="muted">No active plans. Activate a draft plan to show it on dashboard.</p>
              </div>
            ) : (
              <div className="plans-grid">
                {activePlans.map((plan) => (
                  <div className={`plan-card${plan.id === focusedPlanId ? ' focused' : ''}`} key={plan.id}>
                    <div className={`plan-card-hero ${heroClass(plan.status)}`}>
                      <span className="plan-card-hero-badge">Training Plan</span>
                    </div>
                    <div className="plan-card-top">
                      <span
                        className="plan-status-dot"
                        style={{ background: statusColor(plan.status) }}
                      />
                      <span className="plan-status-label">{plan.status}</span>
                      {plan.id === focusedPlanId && (
                        <span className="plan-focus-badge">Current Plan</span>
                      )}
                    </div>
                    <h3 className="plan-card-name">{plan.name}</h3>
                    <span className="plan-card-meta">
                      {plan.weekCount ? `${plan.weekCount} weeks` : 'No weeks set'}
                    </span>
                    <span className="plan-card-meta">
                      Race: {plan.raceName?.trim() || 'Not set'}
                    </span>
                    <span className="plan-card-meta">
                      Date: {formatRaceDate(plan.raceDate)}
                    </span>
                    <div className="plan-card-progress">
                      <span>{plan.progress ?? 0}% complete</span>
                      <div className="plan-card-progress-track">
                        <div
                          className="plan-card-progress-fill"
                          style={{ width: `${plan.progress ?? 0}%` }}
                        />
                      </div>
                    </div>
                    <div className="plan-card-actions">
                      <Link className="plan-card-use" href={`/plans/${plan.id}`} onClick={() => rememberSelectedPlan(plan.id)}>Open</Link>
                      <Link className="plan-card-use" href={`/plans/${plan.id}?mode=edit`} style={{ marginLeft: '8px' }} onClick={() => rememberSelectedPlan(plan.id)}>Edit</Link>
                      <button
                        className="plan-card-use"
                        onClick={() => updatePlanStatus(plan.id, 'DRAFT')}
                        disabled={processingPlanId === plan.id}
                      >
                        {processingPlanId === plan.id ? 'Saving...' : 'Move to draft'}
                      </button>
                      <button
                        className="plan-card-use"
                        onClick={() => updatePlanStatus(plan.id, 'ARCHIVED')}
                        disabled={processingPlanId === plan.id}
                      >
                        {processingPlanId === plan.id ? 'Saving...' : 'Archive'}
                      </button>
                      <button
                        className="plan-card-use plan-card-delete"
                        onClick={() => deletePlan(plan.id)}
                        disabled={processingPlanId === plan.id}
                      >
                        {processingPlanId === plan.id ? 'Deleting...' : 'Delete'}
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </section>

          <section className="plans-section plans-shell-section">
            <h2 className="plans-section-title">Draft Plans</h2>
            {draftPlans.length === 0 ? (
              <div className="plans-empty">
                <p className="muted">No draft plans.</p>
              </div>
            ) : (
              <div className="plans-grid">
                {draftPlans.map((plan) => (
                  <div className={`plan-card${plan.id === focusedPlanId ? ' focused' : ''}`} key={plan.id}>
                    <div className={`plan-card-hero ${heroClass(plan.status)}`}>
                      <span className="plan-card-hero-badge">Training Plan</span>
                    </div>
                    <div className="plan-card-top">
                      <span
                        className="plan-status-dot"
                        style={{ background: statusColor(plan.status) }}
                      />
                      <span className="plan-status-label">{plan.status}</span>
                      {plan.id === focusedPlanId && (
                        <span className="plan-focus-badge">Current Plan</span>
                      )}
                    </div>
                    <h3 className="plan-card-name">{plan.name}</h3>
                    <span className="plan-card-meta">
                      {plan.weekCount ? `${plan.weekCount} weeks` : 'No weeks set'}
                    </span>
                    <span className="plan-card-meta">
                      Race: {plan.raceName?.trim() || 'Not set'}
                    </span>
                    <span className="plan-card-meta">
                      Date: {formatRaceDate(plan.raceDate)}
                    </span>
                    <div className="plan-card-progress">
                      <span>{plan.progress ?? 0}% complete</span>
                      <div className="plan-card-progress-track">
                        <div
                          className="plan-card-progress-fill"
                          style={{ width: `${plan.progress ?? 0}%` }}
                        />
                      </div>
                    </div>
                    <div className="plan-card-actions">
                      <Link className="plan-card-use" href={`/plans/${plan.id}`} onClick={() => rememberSelectedPlan(plan.id)}>Open</Link>
                      <Link className="plan-card-use" href={`/plans/${plan.id}?mode=edit`} style={{ marginLeft: '8px' }} onClick={() => rememberSelectedPlan(plan.id)}>Edit</Link>
                      <button
                        className="plan-card-use"
                        onClick={() => updatePlanStatus(plan.id, 'ACTIVE')}
                        disabled={processingPlanId === plan.id}
                      >
                        {processingPlanId === plan.id ? 'Saving...' : 'Activate'}
                      </button>
                      <button
                        className="plan-card-use"
                        onClick={() => updatePlanStatus(plan.id, 'ARCHIVED')}
                        disabled={processingPlanId === plan.id}
                      >
                        {processingPlanId === plan.id ? 'Saving...' : 'Archive'}
                      </button>
                      <button
                        className="plan-card-use plan-card-delete"
                        onClick={() => deletePlan(plan.id)}
                        disabled={processingPlanId === plan.id}
                      >
                        {processingPlanId === plan.id ? 'Deleting...' : 'Delete'}
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </section>

          <section className="plans-section plans-shell-section">
            <h2 className="plans-section-title">Archived Plans</h2>
            {archivedPlans.length === 0 ? (
              <div className="plans-empty">
                <p className="muted">No archived plans.</p>
              </div>
            ) : (
              <div className="plans-grid">
                {archivedPlans.map((plan) => (
                  <div className={`plan-card${plan.id === focusedPlanId ? ' focused' : ''}`} key={plan.id}>
                    <div className={`plan-card-hero ${heroClass(plan.status)}`}>
                      <span className="plan-card-hero-badge">Training Plan</span>
                    </div>
                    <div className="plan-card-top">
                      <span
                        className="plan-status-dot"
                        style={{ background: statusColor(plan.status) }}
                      />
                      <span className="plan-status-label">{plan.status}</span>
                      {plan.id === focusedPlanId && (
                        <span className="plan-focus-badge">Current Plan</span>
                      )}
                    </div>
                    <h3 className="plan-card-name">{plan.name}</h3>
                    <span className="plan-card-meta">
                      {plan.weekCount ? `${plan.weekCount} weeks` : 'No weeks set'}
                    </span>
                    <span className="plan-card-meta">
                      Race: {plan.raceName?.trim() || 'Not set'}
                    </span>
                    <span className="plan-card-meta">
                      Date: {formatRaceDate(plan.raceDate)}
                    </span>
                    <div className="plan-card-progress">
                      <span>{plan.progress ?? 0}% complete</span>
                      <div className="plan-card-progress-track">
                        <div
                          className="plan-card-progress-fill"
                          style={{ width: `${plan.progress ?? 0}%` }}
                        />
                      </div>
                    </div>
                    <div className="plan-card-actions">
                      <Link className="plan-card-use" href={`/plans/${plan.id}`} onClick={() => rememberSelectedPlan(plan.id)}>Open</Link>
                      <button
                        className="plan-card-use"
                        onClick={() => updatePlanStatus(plan.id, 'ACTIVE')}
                        disabled={processingPlanId === plan.id}
                      >
                        {processingPlanId === plan.id ? 'Saving...' : 'Activate'}
                      </button>
                      <button
                        className="plan-card-use plan-card-delete"
                        onClick={() => deletePlan(plan.id)}
                        disabled={processingPlanId === plan.id}
                      >
                        {processingPlanId === plan.id ? 'Deleting...' : 'Delete'}
                      </button>
                    </div>
                  </div>
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
                    <div className="plan-card-hero template">
                      <span className="plan-card-hero-badge">Library</span>
                    </div>
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
                <strong>{activePlans.length}</strong>
                <span>Active</span>
              </div>
              <div>
                <strong>{draftPlans.length}</strong>
                <span>Drafts</span>
              </div>
              <div>
                <strong>{archivedPlans.length}</strong>
                <span>Archived</span>
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
