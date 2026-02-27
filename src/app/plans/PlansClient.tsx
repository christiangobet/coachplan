'use client';

import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import AthleteSidebar from '@/components/AthleteSidebar';
import PlanGuidePanel from '@/components/PlanGuidePanel';
import PlanSummaryCard from '@/components/PlanSummaryCard';
import type { PlanSummary } from '@/lib/types/plan-summary';
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
  planGuide?: string | null;
};
type Template = { id: string; name: string; weekCount?: number | null; planGuide?: string | null; planSummary?: PlanSummary | null };

function statusColor(status: string) {
  if (status === 'ACTIVE') return 'var(--d-green)';
  if (status === 'DRAFT') return 'var(--d-amber)';
  return 'var(--d-muted)';
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
  const [initialLoading, setInitialLoading] = useState(true);
  const [plansLoadError, setPlansLoadError] = useState<string | null>(null);
  const [templatesLoadError, setTemplatesLoadError] = useState<string | null>(null);
  const [assigning, setAssigning] = useState<string | null>(null);
  const [processingPlanId, setProcessingPlanId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [cookieSelectedPlanId, setCookieSelectedPlanId] = useState<string | null>(null);
  const [expandedMenuId, setExpandedMenuId] = useState<string | null>(null);
  const [useTemplateId, setUseTemplateId] = useState<string | null>(null);
  const [templateRaceDate, setTemplateRaceDate] = useState('');
  const [savingAsTemplate, setSavingAsTemplate] = useState<string | null>(null);
  const [expandedGuideId, setExpandedGuideId] = useState<string | null>(null);
  const [renamingTemplateId, setRenamingTemplateId] = useState<string | null>(null);
  const [renamingPlanId, setRenamingPlanId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState('');

  const toggleMenu = (planId: string) =>
    setExpandedMenuId((prev) => (prev === planId ? null : planId));

  useEffect(() => {
    if (!expandedMenuId) return;
    const handler = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      if (!target.closest('.plan-card-overflow-menu') && !target.closest('.plan-card-menu-btn')) {
        setExpandedMenuId(null);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [expandedMenuId]);

  useEffect(() => {
    if (!expandedGuideId) return;
    const handler = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      if (!target.closest('.plan-card')) {
        setExpandedGuideId(null);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [expandedGuideId]);

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
    let cancelled = false;

    const load = async () => {
      setInitialLoading(true);
      setPlansLoadError(null);
      setTemplatesLoadError(null);
      setCookieSelectedPlanId(readSelectedPlanCookie());

      try {
        const [meRes, plansRes, templatesRes] = await Promise.all([
          fetch('/api/me'),
          fetch('/api/plans'),
          fetch('/api/templates')
        ]);

        if (meRes.ok) {
          const meData = await meRes.json().catch(() => null);
          if (!cancelled) {
            setUserId(meData?.id || null);
            if (meData?.name) setAthleteName(meData.name);
          }
        } else if (!cancelled) {
          setUserId(null);
        }

        if (plansRes.ok) {
          const plansData = await plansRes.json().catch(() => null);
          if (!cancelled) {
            setPlans(Array.isArray(plansData?.plans) ? plansData.plans : []);
          }
        } else if (!cancelled) {
          setPlans([]);
          setPlansLoadError('Could not load plans right now. Refresh to try again.');
        }

        if (templatesRes.ok) {
          const templatesData = await templatesRes.json().catch(() => null);
          if (!cancelled) {
            setTemplates(Array.isArray(templatesData?.templates) ? templatesData.templates : []);
          }
        } else if (!cancelled) {
          setTemplates([]);
          setTemplatesLoadError('Could not load templates right now. Refresh to try again.');
        }
      } catch {
        if (cancelled) return;
        setUserId(null);
        setPlans([]);
        setTemplates([]);
        setPlansLoadError('Could not load plans right now. Check your connection and refresh.');
        setTemplatesLoadError('Could not load templates right now. Check your connection and refresh.');
      } finally {
        if (!cancelled) setInitialLoading(false);
      }
    };

    void load();
    return () => {
      cancelled = true;
    };
  }, []);

  const handleUseTemplate = async (templateId: string) => {
    if (!userId || !templateRaceDate) return;
    setAssigning(templateId);
    setError(null);
    try {
      const res = await fetch('/api/plans/from-template', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ templateId, raceDate: templateRaceDate })
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

  const handleSaveAsTemplate = async (planId: string) => {
    setSavingAsTemplate(planId);
    setExpandedMenuId(null);
    try {
      const res = await fetch(`/api/plans/${planId}/save-as-template`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({})
      });
      if (!res.ok) throw new Error('Failed');
      const tRes = await fetch('/api/templates');
      if (tRes.ok) {
        const tData = await tRes.json().catch(() => null);
        setTemplates(Array.isArray(tData?.templates) ? tData.templates : []);
      }
    } catch {
      // silent
    } finally {
      setSavingAsTemplate(null);
    }
  };

  const handleRenameTemplate = async (tplId: string) => {
    const trimmed = renameValue.trim();
    if (!trimmed) return;
    setProcessingPlanId(tplId);
    try {
      const res = await fetch(`/api/plans/${tplId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: trimmed })
      });
      if (!res.ok) throw new Error('Failed');
      setTemplates((prev) => prev.map((t) => t.id === tplId ? { ...t, name: trimmed } : t));
      setRenamingTemplateId(null);
    } catch {
      // silent
    } finally {
      setProcessingPlanId(null);
    }
  };

  const handleRenamePlan = async (planId: string) => {
    const trimmed = renameValue.trim();
    if (!trimmed) return;
    setProcessingPlanId(planId);
    try {
      const res = await fetch(`/api/plans/${planId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: trimmed })
      });
      if (!res.ok) throw new Error('Failed');
      setPlans((prev) => prev.map((p) => p.id === planId ? { ...p, name: trimmed } : p));
      setRenamingPlanId(null);
    } catch {
      // silent
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
      setTemplates((prev) => prev.filter((tpl) => tpl.id !== planId));
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
  const plansOverviewUnavailable = Boolean(plansLoadError);

  if (initialLoading) {
    return (
      <main className="dash plans-page-shell">
        <div className="dash-grid">
          <AthleteSidebar active="plans" name={athleteName} />
          <section className="dash-center">
            <div className="dash-card plans-shell-header">
              <p className="muted">Loading plans…</p>
            </div>
          </section>
        </div>
      </main>
    );
  }

  return (
    <main className="dash plans-page-shell">
      <div className="dash-grid">
        <AthleteSidebar active="plans" name={athleteName} />

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
            <h2 className="plans-section-title">Active Plans</h2>
            {error && <p style={{ color: 'var(--d-red)', fontSize: 14, marginBottom: 12 }}>{error}</p>}
            {plansLoadError ? (
              <p className="plans-empty-text" style={{ color: 'var(--d-red)' }}>{plansLoadError}</p>
            ) : activePlans.length === 0 ? (
              <p className="plans-empty-text">No active plans. Activate a draft plan to show it on the dashboard.</p>
            ) : (
              <div className="plans-grid">
                {activePlans.map((plan) => (
                  <div className={`plan-card status-active${plan.id === focusedPlanId ? ' focused' : ''}`} key={plan.id}>
                    <div className="plan-card-top">
                      <span
                        className="plan-status-dot"
                        style={{ background: statusColor(plan.status) }}
                      />
                      <span className="plan-status-label">{plan.status}</span>
                      {plan.id === focusedPlanId && (
                        <span className="plan-focus-badge">Current Plan</span>
                      )}
                      <button
                        className="plan-card-menu-btn"
                        onClick={() => toggleMenu(plan.id)}
                        aria-label="More actions"
                      >···</button>
                    </div>
                    {renamingPlanId === plan.id ? (
                      <div className="plan-template-rename">
                        <input
                          className="plan-template-rename-input"
                          value={renameValue}
                          onChange={(e) => setRenameValue(e.target.value)}
                          onKeyDown={(e) => { if (e.key === 'Enter') handleRenamePlan(plan.id); if (e.key === 'Escape') setRenamingPlanId(null); }}
                          autoFocus
                        />
                        <div className="plan-template-rename-actions">
                          <button
                            className="dash-btn-primary plan-card-cta"
                            onClick={() => handleRenamePlan(plan.id)}
                            disabled={!renameValue.trim() || processingPlanId === plan.id}
                          >
                            {processingPlanId === plan.id ? 'Saving…' : 'Save'}
                          </button>
                          <button className="plan-template-cancel" onClick={() => setRenamingPlanId(null)}>Cancel</button>
                        </div>
                      </div>
                    ) : (
                      <h3 className="plan-card-name">{plan.name}</h3>
                    )}
                    <span className="plan-card-meta">
                      {plan.weekCount ? `${plan.weekCount} wks` : '–'} · {plan.raceName?.trim() || 'No race'} · {formatRaceDate(plan.raceDate)}
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
                    {expandedGuideId === plan.id && plan.planGuide && (
                      <div className="plan-template-guide-body">
                        <PlanGuidePanel guideText={plan.planGuide} planId={plan.id} />
                      </div>
                    )}
                    <div className="plan-card-actions">
                      <Link className="dash-btn-primary plan-card-cta" href={`/plans/${plan.id}`} onClick={() => rememberSelectedPlan(plan.id)}>Open Plan</Link>
                    </div>
                    {expandedMenuId === plan.id && (
                      <div className="plan-card-overflow-menu">
                        <button
                          className="plan-card-overflow-item"
                          onClick={() => { setRenameValue(plan.name); setRenamingPlanId(plan.id); setExpandedMenuId(null); }}
                        >
                          Rename
                        </button>
                        <Link
                          className="plan-card-overflow-item"
                          href={`/plans/${plan.id}?mode=edit`}
                          onClick={() => { rememberSelectedPlan(plan.id); setExpandedMenuId(null); }}
                        >Edit plan</Link>
                        {plan.planGuide && (
                          <button
                            className="plan-card-overflow-item"
                            onClick={() => { setExpandedGuideId((prev) => (prev === plan.id ? null : plan.id)); setExpandedMenuId(null); }}
                          >
                            {expandedGuideId === plan.id ? 'Hide guide' : 'Show guide'}
                          </button>
                        )}
                        <button
                          className="plan-card-overflow-item"
                          onClick={() => { updatePlanStatus(plan.id, 'DRAFT'); setExpandedMenuId(null); }}
                          disabled={processingPlanId === plan.id}
                        >
                          {processingPlanId === plan.id ? 'Saving…' : 'Move to draft'}
                        </button>
                        <button
                          className="plan-card-overflow-item"
                          onClick={() => { updatePlanStatus(plan.id, 'ARCHIVED'); setExpandedMenuId(null); }}
                          disabled={processingPlanId === plan.id}
                        >
                          {processingPlanId === plan.id ? 'Saving…' : 'Archive'}
                        </button>
                        <button
                          className="plan-card-overflow-item"
                          onClick={() => handleSaveAsTemplate(plan.id)}
                          disabled={savingAsTemplate === plan.id}
                        >
                          {savingAsTemplate === plan.id ? 'Saving…' : 'Save as template'}
                        </button>
                        <button
                          className="plan-card-overflow-item danger"
                          onClick={() => { deletePlan(plan.id); setExpandedMenuId(null); }}
                          disabled={processingPlanId === plan.id}
                        >
                          {processingPlanId === plan.id ? 'Deleting…' : 'Delete'}
                        </button>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </section>

          {!plansLoadError && (
            <>
              {draftPlans.length > 0 && (
              <section className="plans-section plans-shell-section">
                <h2 className="plans-section-title">Draft Plans</h2>
                <div className="plans-grid">
                  {draftPlans.map((plan) => (
                    <div className={`plan-card status-draft${plan.id === focusedPlanId ? ' focused' : ''}`} key={plan.id}>
                      <div className="plan-card-top">
                        <span
                          className="plan-status-dot"
                          style={{ background: statusColor(plan.status) }}
                        />
                        <span className="plan-status-label">{plan.status}</span>
                        {plan.id === focusedPlanId && (
                          <span className="plan-focus-badge">Current Plan</span>
                        )}
                        <button
                          className="plan-card-menu-btn"
                          onClick={() => toggleMenu(plan.id)}
                          aria-label="More actions"
                        >···</button>
                      </div>
                      <h3 className="plan-card-name">{plan.name}</h3>
                      <span className="plan-card-meta">
                        {plan.weekCount ? `${plan.weekCount} wks` : '–'} · {plan.raceName?.trim() || 'No race'} · {formatRaceDate(plan.raceDate)}
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
                      {expandedGuideId === plan.id && plan.planGuide && (
                        <div className="plan-template-guide-body">
                          <PlanGuidePanel guideText={plan.planGuide} planId={plan.id} />
                        </div>
                      )}
                      <div className="plan-card-actions">
                        <Link className="dash-btn-primary plan-card-cta" href={`/plans/${plan.id}/review?fromUpload=1`} onClick={() => rememberSelectedPlan(plan.id)}>Open Review</Link>
                        <Link className="dash-btn-ghost plan-card-edit-btn" href={`/plans/${plan.id}`} onClick={() => rememberSelectedPlan(plan.id)}>View Plan</Link>
                      </div>
                      {expandedMenuId === plan.id && (
                        <div className="plan-card-overflow-menu">
                          {plan.planGuide && (
                            <button
                              className="plan-card-overflow-item"
                              onClick={() => { setExpandedGuideId((prev) => (prev === plan.id ? null : plan.id)); setExpandedMenuId(null); }}
                            >
                              {expandedGuideId === plan.id ? 'Hide guide' : 'Show guide'}
                            </button>
                          )}
                          <Link
                            className="plan-card-overflow-item"
                            href={`/plans/${plan.id}?mode=edit`}
                            onClick={() => { rememberSelectedPlan(plan.id); setExpandedMenuId(null); }}
                          >Edit</Link>
                          <button
                            className="plan-card-overflow-item"
                            onClick={() => { updatePlanStatus(plan.id, 'ARCHIVED'); setExpandedMenuId(null); }}
                            disabled={processingPlanId === plan.id}
                          >
                            {processingPlanId === plan.id ? 'Saving…' : 'Archive'}
                          </button>
                          <button
                            className="plan-card-overflow-item"
                            onClick={() => handleSaveAsTemplate(plan.id)}
                            disabled={savingAsTemplate === plan.id}
                          >
                            {savingAsTemplate === plan.id ? 'Saving…' : 'Save as template'}
                          </button>
                          <button
                            className="plan-card-overflow-item danger"
                            onClick={() => { deletePlan(plan.id); setExpandedMenuId(null); }}
                            disabled={processingPlanId === plan.id}
                          >
                            {processingPlanId === plan.id ? 'Deleting…' : 'Delete'}
                          </button>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </section>
            )}

          {archivedPlans.length > 0 && (
              <section className="plans-section plans-shell-section">
                <h2 className="plans-section-title">Archived Plans</h2>
                <div className="plans-grid">
                  {archivedPlans.map((plan) => (
                    <div className={`plan-card status-archived${plan.id === focusedPlanId ? ' focused' : ''}`} key={plan.id}>
                      <div className="plan-card-top">
                        <span
                          className="plan-status-dot"
                          style={{ background: statusColor(plan.status) }}
                        />
                        <span className="plan-status-label">{plan.status}</span>
                        {plan.id === focusedPlanId && (
                          <span className="plan-focus-badge">Current Plan</span>
                        )}
                        <button
                          className="plan-card-menu-btn"
                          onClick={() => toggleMenu(plan.id)}
                          aria-label="More actions"
                        >···</button>
                      </div>
                      <h3 className="plan-card-name">{plan.name}</h3>
                      <span className="plan-card-meta">
                        {plan.weekCount ? `${plan.weekCount} wks` : '–'} · {plan.raceName?.trim() || 'No race'} · {formatRaceDate(plan.raceDate)}
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
                      {expandedGuideId === plan.id && plan.planGuide && (
                        <div className="plan-template-guide-body">
                          <PlanGuidePanel guideText={plan.planGuide} planId={plan.id} />
                        </div>
                      )}
                      <div className="plan-card-actions">
                        <Link className="dash-btn-ghost plan-card-edit-btn" href={`/plans/${plan.id}`} onClick={() => rememberSelectedPlan(plan.id)}>Open</Link>
                        <button
                          className="dash-btn-primary plan-card-cta"
                          onClick={() => updatePlanStatus(plan.id, 'ACTIVE')}
                          disabled={processingPlanId === plan.id}
                        >
                          {processingPlanId === plan.id ? 'Saving…' : 'Activate'}
                        </button>
                      </div>
                      {expandedMenuId === plan.id && (
                        <div className="plan-card-overflow-menu">
                          {plan.planGuide && (
                            <button
                              className="plan-card-overflow-item"
                              onClick={() => { setExpandedGuideId((prev) => (prev === plan.id ? null : plan.id)); setExpandedMenuId(null); }}
                            >
                              {expandedGuideId === plan.id ? 'Hide guide' : 'Show guide'}
                            </button>
                          )}
                          <button
                            className="plan-card-overflow-item"
                            onClick={() => handleSaveAsTemplate(plan.id)}
                            disabled={savingAsTemplate === plan.id}
                          >
                            {savingAsTemplate === plan.id ? 'Saving…' : 'Save as template'}
                          </button>
                          <button
                            className="plan-card-overflow-item danger"
                            onClick={() => { deletePlan(plan.id); setExpandedMenuId(null); }}
                            disabled={processingPlanId === plan.id}
                          >
                            {processingPlanId === plan.id ? 'Deleting…' : 'Delete'}
                          </button>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </section>
            )}
            </>
          )}

          {(templates.length > 0 || Boolean(templatesLoadError)) && (
          <section className="plans-section plans-shell-section">
            <h2 className="plans-section-title">Templates</h2>
            {error && <p style={{ color: 'var(--d-red)', fontSize: 14, marginBottom: 12 }}>{error}</p>}
            {templatesLoadError ? (
              <p className="plans-empty-text" style={{ color: 'var(--d-red)' }}>{templatesLoadError}</p>
            ) : (
              <div className="plans-grid">
                {templates.map((tpl) => (
                  <div className="plan-card template" key={tpl.id}>
                    <div className="plan-card-top">
                      <span className="plan-template-badge">Template</span>
                      <button
                        className="plan-card-menu-btn"
                        onClick={() => toggleMenu(tpl.id)}
                        aria-label="More actions"
                      >···</button>
                    </div>
                    {renamingTemplateId === tpl.id ? (
                      <div className="plan-template-rename">
                        <input
                          className="plan-template-rename-input"
                          value={renameValue}
                          onChange={(e) => setRenameValue(e.target.value)}
                          onKeyDown={(e) => { if (e.key === 'Enter') handleRenameTemplate(tpl.id); if (e.key === 'Escape') setRenamingTemplateId(null); }}
                          autoFocus
                        />
                        <div className="plan-template-rename-actions">
                          <button
                            className="dash-btn-primary plan-card-cta"
                            onClick={() => handleRenameTemplate(tpl.id)}
                            disabled={!renameValue.trim() || processingPlanId === tpl.id}
                          >
                            {processingPlanId === tpl.id ? 'Saving…' : 'Save'}
                          </button>
                          <button className="plan-template-cancel" onClick={() => setRenamingTemplateId(null)}>Cancel</button>
                        </div>
                      </div>
                    ) : (
                      <h3 className="plan-card-name">{tpl.name}</h3>
                    )}
                    <span className="plan-card-meta">
                      {tpl.weekCount ? `${tpl.weekCount} wks` : 'No weeks set'}
                    </span>
                    {expandedGuideId === tpl.id && (tpl.planSummary || tpl.planGuide) && (
                      <div className="plan-template-guide-body">
                        {tpl.planSummary && (
                          <PlanSummaryCard summary={tpl.planSummary} planId={tpl.id} />
                        )}
                        {tpl.planGuide && (
                          <PlanGuidePanel guideText={tpl.planGuide} planId={tpl.id} />
                        )}
                      </div>
                    )}
                    {useTemplateId === tpl.id ? (
                      <div className="plan-template-setup">
                        <label className="plan-template-setup-label">
                          <span>Race date <span className="plan-template-required">*</span></span>
                          <input
                            type="date"
                            value={templateRaceDate}
                            onChange={(e) => setTemplateRaceDate(e.target.value)}
                            autoFocus
                          />
                        </label>
                        {templateRaceDate && tpl.weekCount && (() => {
                          const race = new Date(templateRaceDate);
                          const start = new Date(race);
                          start.setDate(start.getDate() - tpl.weekCount * 7);
                          return (
                            <p className="plan-template-start-hint">
                              Starts {start.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
                            </p>
                          );
                        })()}
                        <div className="plan-card-actions">
                          <button
                            className="dash-btn-primary plan-card-cta"
                            onClick={() => handleUseTemplate(tpl.id)}
                            disabled={!templateRaceDate || assigning === tpl.id}
                          >
                            {assigning === tpl.id ? 'Creating...' : 'Create plan'}
                          </button>
                          <button
                            className="plan-template-cancel"
                            type="button"
                            onClick={() => { setUseTemplateId(null); setTemplateRaceDate(''); }}
                          >
                            Cancel
                          </button>
                        </div>
                      </div>
                    ) : (
                      <div className="plan-card-actions">
                        <button
                          className="dash-btn-primary plan-card-cta"
                          onClick={() => { setUseTemplateId(tpl.id); setTemplateRaceDate(''); }}
                          disabled={!userId}
                        >
                          Use template
                        </button>
                      </div>
                    )}
                    {expandedMenuId === tpl.id && (
                      <div className="plan-card-overflow-menu">
                        <button
                          className="plan-card-overflow-item"
                          onClick={() => { setRenameValue(tpl.name); setRenamingTemplateId(tpl.id); setExpandedMenuId(null); }}
                        >
                          Rename
                        </button>
                        {(tpl.planSummary || tpl.planGuide) && (
                          <button
                            className="plan-card-overflow-item"
                            onClick={() => { setExpandedGuideId((prev) => (prev === tpl.id ? null : tpl.id)); setExpandedMenuId(null); }}
                          >
                            {expandedGuideId === tpl.id ? 'Hide preview' : 'Show preview'}
                          </button>
                        )}
                        <button
                          className="plan-card-overflow-item danger"
                          onClick={() => { deletePlan(tpl.id); setExpandedMenuId(null); }}
                          disabled={processingPlanId === tpl.id}
                        >
                          {processingPlanId === tpl.id ? 'Deleting…' : 'Delete'}
                        </button>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </section>
          )}
        </section>

        <aside className="dash-right">
          <div className="dash-card plans-right-card">
            <div className="dash-card-header">
              <span className="dash-card-title">Overview</span>
            </div>
            <div className="plans-overview-grid">
              <div>
                <strong>{plansOverviewUnavailable ? '—' : plans.length}</strong>
                <span>Total plans</span>
              </div>
              <div>
                <strong>{plansOverviewUnavailable ? '—' : activePlans.length}</strong>
                <span>Active</span>
              </div>
              <div>
                <strong>{plansOverviewUnavailable ? '—' : draftPlans.length}</strong>
                <span>Drafts</span>
              </div>
              <div>
                <strong>{plansOverviewUnavailable ? '—' : archivedPlans.length}</strong>
                <span>Archived</span>
              </div>
            </div>
          </div>

          <div className="dash-card plans-right-card">
            <div className="dash-card-header">
              <span className="dash-card-title">Actions</span>
            </div>
            <div className="plans-links">
              <Link href="/dashboard"><span>Open today dashboard</span><span className="plans-link-arrow">→</span></Link>
              <Link href="/upload"><span>Upload a PDF plan</span><span className="plans-link-arrow">→</span></Link>
              <Link href="/profile"><span>Update athlete profile</span><span className="plans-link-arrow">→</span></Link>
            </div>
          </div>
        </aside>
      </div>
    </main>
  );
}
