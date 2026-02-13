'use client';

import { useEffect, useMemo, useState } from 'react';
import './coach.css';

type ActivePlanSummary = {
  id: string;
  name: string;
  raceName: string | null;
  raceDate: string | null;
  weekCount: number | null;
  totalActivities: number;
  completedActivities: number;
  completionPct: number;
};

type Athlete = {
  id: string;
  name: string;
  email: string;
  goalRaceDate: string | null;
  activePlan: ActivePlanSummary | null;
};

type Template = {
  id: string;
  name: string;
  raceName: string | null;
  weekCount: number | null;
  status: string;
  createdAt: string;
};

function formatDate(value: string | null | undefined) {
  if (!value) return 'Not set';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'Not set';
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

export default function CoachPage() {
  const [athletes, setAthletes] = useState<Athlete[]>([]);
  const [templates, setTemplates] = useState<Template[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [athleteId, setAthleteId] = useState('');
  const [templateId, setTemplateId] = useState('');
  const [assignRaceName, setAssignRaceName] = useState('');
  const [assignRaceDate, setAssignRaceDate] = useState('');
  const [assignStatus, setAssignStatus] = useState<string | null>(null);
  const [newTemplateName, setNewTemplateName] = useState('');
  const [newTemplateWeeks, setNewTemplateWeeks] = useState('');
  const [newTemplateRaceName, setNewTemplateRaceName] = useState('');
  const [templateStatus, setTemplateStatus] = useState<string | null>(null);

  async function loadDashboardData() {
    setLoading(true);
    setLoadError(null);
    try {
      const [athletesRes, templatesRes] = await Promise.all([
        fetch('/api/coach/athletes'),
        fetch('/api/coach/templates')
      ]);

      const athletesData = await athletesRes.json();
      const templatesData = await templatesRes.json();

      if (!athletesRes.ok) {
        throw new Error(athletesData?.error || 'Failed to load athletes');
      }
      if (!templatesRes.ok) {
        throw new Error(templatesData?.error || 'Failed to load templates');
      }

      setAthletes(athletesData.athletes || []);
      setTemplates(templatesData.templates || []);
    } catch (error: unknown) {
      setLoadError(error instanceof Error ? error.message : 'Failed to load coach dashboard');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadDashboardData();
  }, []);

  const selectedTemplate = useMemo(
    () => templates.find((template) => template.id === templateId) || null,
    [templateId, templates]
  );

  const selectedAthlete = useMemo(
    () => athletes.find((athlete) => athlete.id === athleteId) || null,
    [athleteId, athletes]
  );

  useEffect(() => {
    if (!selectedTemplate) {
      setAssignRaceName('');
      return;
    }
    setAssignRaceName(selectedTemplate.raceName || '');
  }, [selectedTemplate]);

  const athletesWithActivePlan = athletes.filter((athlete) => !!athlete.activePlan);
  const activeAssignments = athletesWithActivePlan.length;
  const averageCompletion = athletesWithActivePlan.length > 0
    ? Math.round(
        athletesWithActivePlan.reduce(
          (sum, athlete) => sum + (athlete.activePlan?.completionPct || 0),
          0
        ) / athletesWithActivePlan.length
      )
    : 0;

  async function assign() {
    if (!athleteId || !templateId) return;
    setAssignStatus('Assigning...');
    const res = await fetch('/api/coach/assign', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        athleteId,
        templateId,
        raceName: assignRaceName.trim() || undefined,
        raceDate: assignRaceDate || undefined
      })
    });
    const data = await res.json();
    if (!res.ok) {
      setAssignStatus(data?.error || 'Failed');
      return;
    }
    setAssignStatus('Assigned');
    await loadDashboardData();
  }

  async function createTemplate() {
    setTemplateStatus('Creating template...');
    const res = await fetch('/api/coach/templates', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: newTemplateName,
        weekCount: newTemplateWeeks,
        raceName: newTemplateRaceName.trim() || undefined
      })
    });
    const data = await res.json();
    if (!res.ok) {
      setTemplateStatus(data?.error || 'Failed');
      return;
    }
    setTemplateStatus('Template created');
    setNewTemplateName('');
    setNewTemplateWeeks('');
    setNewTemplateRaceName('');
    await loadDashboardData();
  }

  return (
    <main className="coach-page">
      <section className="coach-header-card">
        <div>
          <h1>Coach Dashboard</h1>
          <p>Assign templates, set race context, and track athlete execution from one workspace.</p>
        </div>
        <div className="coach-kpis">
          <div>
            <strong>{athletes.length}</strong>
            <span>Athletes</span>
          </div>
          <div>
            <strong>{templates.length}</strong>
            <span>Templates</span>
          </div>
          <div>
            <strong>{activeAssignments}</strong>
            <span>Active Plans</span>
          </div>
          <div>
            <strong>{averageCompletion}%</strong>
            <span>Avg Completion</span>
          </div>
        </div>
      </section>

      {loadError && (
        <section className="coach-alert">
          <p>{loadError}</p>
        </section>
      )}

      <section className="coach-grid">
        <div className="coach-main-col">
          <article className="coach-card">
            <div className="coach-card-head">
              <h2>Assign Template</h2>
              <span>Race-aware assignment</span>
            </div>

            <div className="coach-form-grid">
              <label>
                Athlete
                <select value={athleteId} onChange={(e) => setAthleteId(e.target.value)}>
                  <option value="">Choose athlete</option>
                  {athletes.map((athlete) => (
                    <option key={athlete.id} value={athlete.id}>
                      {athlete.name} ({athlete.email})
                    </option>
                  ))}
                </select>
              </label>

              <label>
                Template
                <select value={templateId} onChange={(e) => setTemplateId(e.target.value)}>
                  <option value="">Choose template</option>
                  {templates.map((template) => (
                    <option key={template.id} value={template.id}>
                      {template.name}
                    </option>
                  ))}
                </select>
              </label>

              <label>
                Race name (optional override)
                <input
                  value={assignRaceName}
                  onChange={(e) => setAssignRaceName(e.target.value)}
                  placeholder="e.g. Berlin Marathon 2026"
                />
              </label>

              <label>
                Race date (optional override)
                <input
                  type="date"
                  value={assignRaceDate}
                  onChange={(e) => setAssignRaceDate(e.target.value)}
                />
              </label>
            </div>

            <div className="coach-assignment-meta">
              <span>
                Athlete default goal date: <strong>{formatDate(selectedAthlete?.goalRaceDate)}</strong>
              </span>
              <span>
                Template default race: <strong>{selectedTemplate?.raceName || 'Not set'}</strong>
              </span>
            </div>

            <div className="coach-action-row">
              <button className="cta" onClick={assign} disabled={!athleteId || !templateId || loading}>
                Assign Template
              </button>
              {assignStatus && <span className="coach-status">{assignStatus}</span>}
            </div>
          </article>

          <article className="coach-card">
            <div className="coach-card-head">
              <h2>Athlete Overview</h2>
              <span>Execution snapshot</span>
            </div>

            {loading && (
              <p className="coach-muted">Loading athletes...</p>
            )}
            {!loading && athletes.length === 0 && (
              <p className="coach-muted">No linked athletes yet.</p>
            )}

            <div className="coach-athlete-list">
              {athletes.map((athlete) => (
                <div className="coach-athlete-item" key={athlete.id}>
                  <div className="coach-athlete-main">
                    <h3>{athlete.name}</h3>
                    <p>{athlete.email}</p>
                  </div>

                  {!athlete.activePlan && (
                    <div className="coach-athlete-plan empty">
                      No active plan assigned
                    </div>
                  )}

                  {athlete.activePlan && (
                    <div className="coach-athlete-plan">
                      <div className="coach-athlete-plan-top">
                        <strong>{athlete.activePlan.name}</strong>
                        <span>{athlete.activePlan.completionPct}% complete</span>
                      </div>
                      <div className="coach-progress-track">
                        <div
                          className="coach-progress-fill"
                          style={{ width: `${athlete.activePlan.completionPct}%` }}
                        />
                      </div>
                      <div className="coach-athlete-plan-meta">
                        <span>
                          {athlete.activePlan.completedActivities}/{athlete.activePlan.totalActivities} workouts
                        </span>
                        <span>
                          Race: {athlete.activePlan.raceName || 'Not set'}
                        </span>
                        <span>
                          Date: {formatDate(athlete.activePlan.raceDate)}
                        </span>
                      </div>
                    </div>
                  )}
                </div>
              ))}
            </div>
          </article>
        </div>

        <aside className="coach-side-col">
          <article className="coach-card">
            <div className="coach-card-head">
              <h2>Create Template</h2>
              <span>Library builder</span>
            </div>

            <div className="coach-form-stack">
              <label>
                Template name
                <input
                  value={newTemplateName}
                  onChange={(e) => setNewTemplateName(e.target.value)}
                  placeholder="Half Marathon Build"
                />
              </label>

              <label>
                Week count
                <input
                  type="number"
                  min={1}
                  value={newTemplateWeeks}
                  onChange={(e) => setNewTemplateWeeks(e.target.value)}
                  placeholder="16"
                />
              </label>

              <label>
                Default race name
                <input
                  value={newTemplateRaceName}
                  onChange={(e) => setNewTemplateRaceName(e.target.value)}
                  placeholder="e.g. New York City Marathon"
                />
              </label>
            </div>

            <div className="coach-action-row">
              <button className="cta" onClick={createTemplate} disabled={!newTemplateName.trim() || loading}>
                Create Template
              </button>
              {templateStatus && <span className="coach-status">{templateStatus}</span>}
            </div>
          </article>

          <article className="coach-card">
            <div className="coach-card-head">
              <h2>Template Library</h2>
              <span>{templates.length} total</span>
            </div>

            {loading && (
              <p className="coach-muted">Loading templates...</p>
            )}
            {!loading && templates.length === 0 && (
              <p className="coach-muted">No templates yet.</p>
            )}

            <div className="coach-template-list">
              {templates.map((template) => (
                <div className="coach-template-item" key={template.id}>
                  <strong>{template.name}</strong>
                  <div>
                    <span>{template.weekCount ? `${template.weekCount} weeks` : 'Weeks not set'}</span>
                    <span>{template.raceName || 'Race not set'}</span>
                    <span>{template.status}</span>
                  </div>
                </div>
              ))}
            </div>
          </article>
        </aside>
      </section>
    </main>
  );
}
