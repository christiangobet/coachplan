'use client';

import { useEffect, useState } from 'react';

type Athlete = { id: string; name: string; email: string };
type Template = { id: string; name: string };

export default function CoachPage() {
  const [athletes, setAthletes] = useState<Athlete[]>([]);
  const [templates, setTemplates] = useState<Template[]>([]);
  const [athleteId, setAthleteId] = useState('');
  const [templateId, setTemplateId] = useState('');
  const [status, setStatus] = useState<string | null>(null);
  const [newTemplateName, setNewTemplateName] = useState('');
  const [newTemplateWeeks, setNewTemplateWeeks] = useState('');

  useEffect(() => {
    fetch('/api/coach/athletes')
      .then((res) => res.json())
      .then((data) => setAthletes(data.athletes || []));
    fetch('/api/coach/templates')
      .then((res) => res.json())
      .then((data) => setTemplates(data.templates || []));
  }, []);

  async function assign() {
    setStatus('Assigning...');
    const res = await fetch('/api/coach/assign', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ athleteId, templateId })
    });
    const data = await res.json();
    if (!res.ok) {
      setStatus(data?.error || 'Failed');
      return;
    }
    setStatus('Assigned');
  }

  async function createTemplate() {
    setStatus('Creating template...');
    const res = await fetch('/api/coach/templates', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: newTemplateName, weekCount: newTemplateWeeks })
    });
    const data = await res.json();
    if (!res.ok) {
      setStatus(data?.error || 'Failed');
      return;
    }
    setStatus('Template created');
    setNewTemplateName('');
    setNewTemplateWeeks('');
    const refreshed = await fetch('/api/coach/templates').then((r) => r.json());
    setTemplates(refreshed.templates || []);
  }

  return (
    <main>
      <section className="card white">
        <div className="section-title">
          <h1>Coach dashboard</h1>
        </div>
        <p className="muted">Assign templates to athletes and track progress.</p>
      </section>

      <section className="container" style={{ marginTop: 24 }}>
        <div className="card">
          <div className="section-title">
            <h3>Create template</h3>
          </div>
          <div className="form-stack">
            <label>
              Template name
              <input value={newTemplateName} onChange={(e) => setNewTemplateName(e.target.value)} placeholder="Half Marathon 2026" />
            </label>
            <label>
              Week count
              <input value={newTemplateWeeks} onChange={(e) => setNewTemplateWeeks(e.target.value)} placeholder="16" />
            </label>
            <button className="cta" onClick={createTemplate} disabled={!newTemplateName}>
              Create template
            </button>
          </div>
        </div>

        <div className="card">
          <div className="section-title">
            <h3>Assign plan template</h3>
          </div>
          <div className="form-stack">
            <label>
              Athlete
              <select value={athleteId} onChange={(e) => setAthleteId(e.target.value)}>
                <option value="">Choose athlete</option>
                {athletes.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name} ({a.email})
                  </option>
                ))}
              </select>
            </label>
            <label>
              Template
              <select value={templateId} onChange={(e) => setTemplateId(e.target.value)}>
                <option value="">Choose template</option>
                {templates.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name}
                  </option>
                ))}
              </select>
            </label>
            <button className="cta" onClick={assign} disabled={!athleteId || !templateId}>
              Assign
            </button>
            {status && <span className="muted">{status}</span>}
          </div>
        </div>
      </section>
    </main>
  );
}
