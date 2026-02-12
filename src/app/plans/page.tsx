'use client';

import { useEffect, useState } from 'react';

type Plan = { id: string; name: string; weekCount?: number | null; status: string };

type Template = { id: string; name: string; weekCount?: number | null };

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
    <main>
      <section className="card white">
        <div className="section-title">
          <h1>Plans</h1>
        </div>
        <p className="muted">Your active plans and available templates.</p>
      </section>

      <section className="container" style={{ marginTop: 24 }}>
        <div className="card">
          <div className="section-title">
            <h3>Active plans</h3>
          </div>
          <p className="muted">Upload a PDF or create a plan from a template.</p>
          <div style={{ marginTop: 12 }}>
            <a className="cta" href="/upload">Upload plan</a>
          </div>
          <table>
            <thead>
              <tr>
                <th>Plan</th>
                <th>Weeks</th>
                <th>Status</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {plans.map((plan) => (
                <tr key={plan.id}>
                  <td>{plan.name}</td>
                  <td>{plan.weekCount || '-'}</td>
                  <td>{plan.status}</td>
                  <td><a className="cta secondary" href={`/plans/${plan.id}`}>Open</a></td>
                </tr>
              ))}
              {plans.length === 0 && (
                <tr>
                  <td colSpan={4} className="muted">No assigned plans yet.</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        <div className="card">
          <div className="section-title">
            <h3>Templates</h3>
          </div>
          {error && <p className="muted" style={{ color: '#b42318' }}>{error}</p>}
          <table>
            <thead>
              <tr>
                <th>Template</th>
                <th>Weeks</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {templates.map((tpl) => (
                <tr key={tpl.id}>
                  <td>{tpl.name}</td>
                  <td>{tpl.weekCount || '-'}</td>
                  <td>
                    <button
                      className="cta secondary"
                      onClick={() => handleUseTemplate(tpl.id)}
                      disabled={!userId || assigning === tpl.id}
                    >
                      {assigning === tpl.id ? 'Assigning...' : 'Use template'}
                    </button>
                  </td>
                </tr>
              ))}
              {templates.length === 0 && (
                <tr>
                  <td colSpan={3} className="muted">No templates yet.</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>
    </main>
  );
}
