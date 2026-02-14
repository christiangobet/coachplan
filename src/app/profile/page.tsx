'use client';

import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import AthleteSidebar from '@/components/AthleteSidebar';
import '../dashboard/dashboard.css';
import '../athlete-pages.css';

type Coach = { id: string; name: string; email: string };

type PaceTargets = {
  [key: string]: unknown;
  easy?: string;
  tempo?: string;
};

type IntegrationProvider = 'STRAVA' | 'GARMIN';

type IntegrationAccount = {
  provider: IntegrationProvider;
  connected: boolean;
  isActive: boolean;
  providerUsername: string | null;
  connectedAt: string | null;
  lastSyncAt: string | null;
  expiresAt: string | null;
};

type IntegrationCapability = {
  stravaConfigured: boolean;
  garminConfigured: boolean;
};

function formatDate(value: string | null | undefined) {
  if (!value) return 'Never';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'Never';
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

export default function ProfilePage() {
  const searchParams = useSearchParams();

  const [name, setName] = useState('');
  const [units, setUnits] = useState<'MILES' | 'KM'>('MILES');
  const [goalRaceDate, setGoalRaceDate] = useState('');
  const [paceTargets, setPaceTargets] = useState<PaceTargets>({});
  const [role, setRole] = useState<'ATHLETE' | 'COACH'>('ATHLETE');
  const [coaches, setCoaches] = useState<Coach[]>([]);
  const [selectedCoach, setSelectedCoach] = useState('');
  const [status, setStatus] = useState<string | null>(null);

  const [integrationAccounts, setIntegrationAccounts] = useState<IntegrationAccount[]>([]);
  const [integrationCapability, setIntegrationCapability] = useState<IntegrationCapability>({
    stravaConfigured: false,
    garminConfigured: false
  });
  const [integrationStatus, setIntegrationStatus] = useState<string | null>(null);
  const [busyProvider, setBusyProvider] = useState<IntegrationProvider | null>(null);

  async function loadIntegrationStatus() {
    try {
      const res = await fetch('/api/integrations/accounts');
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setIntegrationStatus(data?.error || 'Failed to load integration status');
        return;
      }
      setIntegrationAccounts(data.accounts || []);
      setIntegrationCapability({
        stravaConfigured: Boolean(data?.capability?.stravaConfigured),
        garminConfigured: Boolean(data?.capability?.garminConfigured)
      });
    } catch {
      setIntegrationStatus('Failed to load integration status');
    }
  }

  useEffect(() => {
    fetch('/api/me')
      .then((res) => res.json())
      .then((data) => {
        if (data?.name) setName(data.name);
        if (data?.units === 'MILES' || data?.units === 'KM') setUnits(data.units);
        if (data?.goalRaceDate) setGoalRaceDate(data.goalRaceDate.slice(0, 10));
        if (data?.paceTargets) setPaceTargets(data.paceTargets);
        if (data?.role === 'ATHLETE' || data?.role === 'COACH') setRole(data.role);
      });

    fetch('/api/coaches')
      .then((res) => res.json())
      .then((data) => setCoaches(data.coaches || []));

    loadIntegrationStatus();
  }, []);

  useEffect(() => {
    const integration = searchParams.get('integration');
    const integrationError = searchParams.get('integrationError');
    const integrationWarning = searchParams.get('integrationWarning');
    if (integration === 'strava_connected') {
      setIntegrationStatus('Strava connected successfully.');
      loadIntegrationStatus();
    }
    if (integrationWarning === 'sync_failed') {
      setIntegrationStatus('Strava connected, but first sync failed. Try sync now.');
    }
    if (integrationError) {
      setIntegrationStatus(`Integration error: ${integrationError}`);
    }
  }, [searchParams]);

  async function saveProfile() {
    setStatus('Saving...');
    const sanitizedPaceTargets: PaceTargets = { ...paceTargets };
    const easy = typeof paceTargets.easy === 'string' ? paceTargets.easy.trim() : '';
    const tempo = typeof paceTargets.tempo === 'string' ? paceTargets.tempo.trim() : '';
    if (easy) sanitizedPaceTargets.easy = easy;
    else delete sanitizedPaceTargets.easy;
    if (tempo) sanitizedPaceTargets.tempo = tempo;
    else delete sanitizedPaceTargets.tempo;

    await fetch('/api/me', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, units, goalRaceDate, paceTargets: sanitizedPaceTargets, role })
    });

    if (role === 'ATHLETE' && selectedCoach) {
      await fetch('/api/coach-link', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ coachId: selectedCoach })
      });
    }

    setStatus('Saved');
  }

  async function startStravaConnect() {
    if (!integrationCapability.stravaConfigured) {
      setIntegrationStatus('Strava server credentials are missing.');
      return;
    }

    setBusyProvider('STRAVA');
    setIntegrationStatus('Redirecting to Strava...');
    try {
      const res = await fetch('/api/integrations/strava/connect', { method: 'POST' });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data?.url) {
        setIntegrationStatus(data?.error || 'Failed to start Strava connection');
        return;
      }
      window.location.href = data.url;
    } catch {
      setIntegrationStatus('Failed to start Strava connection');
      setBusyProvider(null);
    }
  }

  async function syncStravaNow() {
    setBusyProvider('STRAVA');
    setIntegrationStatus('Syncing Strava activities...');
    try {
      const res = await fetch('/api/integrations/strava/sync', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ lookbackDays: 120 })
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setIntegrationStatus(data?.error || 'Failed to sync Strava activities');
        return;
      }
      const summary = data?.summary;
      setIntegrationStatus(
        `Sync complete: ${summary?.imported ?? 0} imported, ${summary?.matched ?? 0} matched, ${summary?.workoutsUpdated ?? 0} workouts updated`
      );
      await loadIntegrationStatus();
    } catch {
      setIntegrationStatus('Failed to sync Strava activities');
    } finally {
      setBusyProvider(null);
    }
  }

  async function disconnectProvider(provider: IntegrationProvider) {
    setBusyProvider(provider);
    setIntegrationStatus(`Disconnecting ${provider === 'STRAVA' ? 'Strava' : 'Garmin'}...`);
    try {
      const res = await fetch(`/api/integrations/accounts/${provider}`, { method: 'DELETE' });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setIntegrationStatus(data?.error || 'Failed to disconnect provider');
        return;
      }
      setIntegrationStatus(`${provider === 'STRAVA' ? 'Strava' : 'Garmin'} disconnected`);
      await loadIntegrationStatus();
    } catch {
      setIntegrationStatus('Failed to disconnect provider');
    } finally {
      setBusyProvider(null);
    }
  }

  async function connectGarmin() {
    setBusyProvider('GARMIN');
    try {
      const res = await fetch('/api/integrations/garmin/connect', { method: 'POST' });
      const data = await res.json().catch(() => ({}));
      setIntegrationStatus(data?.error || 'Garmin integration is not configured yet');
      await loadIntegrationStatus();
    } catch {
      setIntegrationStatus('Garmin integration is not configured yet');
    } finally {
      setBusyProvider(null);
    }
  }

  const sidebarName = name.trim() || 'Athlete';
  const raceDateLabel = goalRaceDate
    ? new Date(`${goalRaceDate}T00:00:00`).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
    : 'Not set';

  const stravaAccount = useMemo(
    () => integrationAccounts.find((account) => account.provider === 'STRAVA') || null,
    [integrationAccounts]
  );
  const garminAccount = useMemo(
    () => integrationAccounts.find((account) => account.provider === 'GARMIN') || null,
    [integrationAccounts]
  );

  return (
    <main className="dash athlete-page-shell">
      <div className="dash-grid">
        <AthleteSidebar name={sidebarName} />

        <section className="dash-center">
          <section className="dash-card athlete-page-header">
            <h1>Profile Setup</h1>
            <p className="muted">Tell us how you train so CoachPlan can personalize your weekly execution.</p>
          </section>

          <section className="grid-2 athlete-form-grid">
            <div className="dash-card athlete-page-card">
              <div className="section-title">
                <h3>Basic details</h3>
              </div>
              <div className="form-stack">
                <label>
                  Name
                  <input value={name} onChange={(e) => setName(e.target.value)} />
                </label>
                <label>
                  Role
                  <select value={role} onChange={(e) => setRole(e.target.value as 'ATHLETE' | 'COACH')}>
                    <option value="ATHLETE">Athlete</option>
                    <option value="COACH">Coach</option>
                  </select>
                </label>
                <label>
                  Units
                  <select value={units} onChange={(e) => setUnits(e.target.value as 'MILES' | 'KM')}>
                    <option value="MILES">Miles</option>
                    <option value="KM">Kilometers</option>
                  </select>
                </label>
                <label>
                  Default goal date
                  <input type="date" value={goalRaceDate} onChange={(e) => setGoalRaceDate(e.target.value)} />
                </label>
              </div>
            </div>

            <div className="dash-card athlete-page-card">
              <div className="section-title">
                <h3>Pace targets</h3>
              </div>
              <div className="form-stack">
                <label>
                  Easy pace
                  <input value={paceTargets.easy || ''} onChange={(e) => setPaceTargets({ ...paceTargets, easy: e.target.value })} placeholder="e.g. 6:00 min/km" />
                </label>
                <label>
                  Tempo pace
                  <input value={paceTargets.tempo || ''} onChange={(e) => setPaceTargets({ ...paceTargets, tempo: e.target.value })} placeholder="e.g. 5:15 min/km" />
                </label>
              </div>
            </div>
          </section>

          {role === 'ATHLETE' && (
            <section className="dash-card athlete-page-card">
              <div className="section-title">
                <h3>Select your coach</h3>
              </div>
              <div className="form-stack">
                <label>
                  Coach
                  <select value={selectedCoach} onChange={(e) => setSelectedCoach(e.target.value)}>
                    <option value="">Choose a coach</option>
                    {coaches.map((coach) => (
                      <option key={coach.id} value={coach.id}>
                        {coach.name} ({coach.email})
                      </option>
                    ))}
                  </select>
                </label>
              </div>
            </section>
          )}

          <section className="dash-card athlete-page-card">
            <div className="section-title">
              <h3>Activity Integrations</h3>
            </div>
            <p className="muted athlete-intro">
              Sync recorded activities so completed sessions automatically feed your training-plan workout logs.
            </p>

            <div className="athlete-integration-grid">
              <article className="athlete-integration-item">
                <div className="athlete-integration-head">
                  <strong>Strava</strong>
                  <span className={stravaAccount?.connected ? 'on' : 'off'}>
                    {stravaAccount?.connected ? 'Connected' : 'Not connected'}
                  </span>
                </div>
                <div className="athlete-integration-meta">
                  <span>User: {stravaAccount?.providerUsername || 'Not linked'}</span>
                  <span>Last sync: {formatDate(stravaAccount?.lastSyncAt)}</span>
                </div>
                <div className="athlete-integration-actions">
                  <button
                    className="cta secondary"
                    type="button"
                    disabled={busyProvider === 'STRAVA'}
                    onClick={startStravaConnect}
                  >
                    {stravaAccount?.connected ? 'Reconnect' : 'Connect Strava'}
                  </button>
                  <button
                    className="cta secondary"
                    type="button"
                    disabled={!stravaAccount?.connected || busyProvider === 'STRAVA'}
                    onClick={syncStravaNow}
                  >
                    Sync now
                  </button>
                  <button
                    className="cta secondary"
                    type="button"
                    disabled={!stravaAccount?.connected || busyProvider === 'STRAVA'}
                    onClick={() => disconnectProvider('STRAVA')}
                  >
                    Disconnect
                  </button>
                </div>
                {!integrationCapability.stravaConfigured && (
                  <p className="muted">Server credentials missing: set `STRAVA_CLIENT_ID` and `STRAVA_CLIENT_SECRET`.</p>
                )}
              </article>

              <article className="athlete-integration-item">
                <div className="athlete-integration-head">
                  <strong>Garmin</strong>
                  <span className={garminAccount?.connected ? 'on' : 'off'}>
                    {garminAccount?.connected ? 'Connected' : 'Not connected'}
                  </span>
                </div>
                <div className="athlete-integration-meta">
                  <span>User: {garminAccount?.providerUsername || 'Not linked'}</span>
                  <span>Last sync: {formatDate(garminAccount?.lastSyncAt)}</span>
                </div>
                <div className="athlete-integration-actions">
                  <button
                    className="cta secondary"
                    type="button"
                    disabled={busyProvider === 'GARMIN'}
                    onClick={connectGarmin}
                  >
                    Connect Garmin
                  </button>
                  <button className="cta secondary" type="button" disabled>
                    Sync now
                  </button>
                  <button
                    className="cta secondary"
                    type="button"
                    disabled={!garminAccount?.connected || busyProvider === 'GARMIN'}
                    onClick={() => disconnectProvider('GARMIN')}
                  >
                    Disconnect
                  </button>
                </div>
                <p className="muted">
                  Garmin requires approved Garmin Health API credentials before OAuth + activity sync can be enabled.
                </p>
              </article>
            </div>

            {integrationStatus && <p className="muted athlete-integration-status">{integrationStatus}</p>}
          </section>

          <section className="dash-card athlete-save-row">
            <button className="cta" onClick={saveProfile}>Save profile</button>
            {status && <span className="muted">{status}</span>}
          </section>
        </section>

        <aside className="dash-right">
          <div className="dash-card athlete-right-card">
            <div className="dash-card-header">
              <span className="dash-card-title">Current Setup</span>
            </div>
            <div className="athlete-summary-list">
              <div>
                <strong>Role</strong>
                <span>{role === 'ATHLETE' ? 'Athlete' : 'Coach'}</span>
              </div>
              <div>
                <strong>Units</strong>
                <span>{units === 'MILES' ? 'Miles' : 'Kilometers'}</span>
              </div>
              <div>
                <strong>Default goal date</strong>
                <span>{raceDateLabel}</span>
              </div>
              <div>
                <strong>Strava</strong>
                <span>{stravaAccount?.connected ? 'Connected' : 'Not connected'}</span>
              </div>
            </div>
          </div>

          <div className="dash-card athlete-right-card">
            <div className="dash-card-header">
              <span className="dash-card-title">Actions</span>
            </div>
            <div className="athlete-link-list">
              <Link href="/dashboard">Go to today dashboard</Link>
              <Link href="/plans">Open plans library</Link>
              <Link href="/upload">Upload a new plan</Link>
            </div>
          </div>
        </aside>
      </div>
    </main>
  );
}
