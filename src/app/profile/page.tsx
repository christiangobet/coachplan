'use client';

import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import AthleteSidebar from '@/components/AthleteSidebar';
import StravaConnectButton from '@/components/StravaConnectButton';
import '../dashboard/dashboard.css';
import '../athlete-pages.css';

type Coach = { id: string; name: string; email: string };

type PaceTargets = {
  [key: string]: unknown;
  easy?: string;
  tempo?: string;
  long?: string;
  race?: string;
  threshold?: string;
  interval?: string;
  recovery?: string;
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

const RACE_DISTANCES = [
  { label: '5K', key: '5K', km: 5 },
  { label: '10K', key: '10K', km: 10 },
  { label: 'Half Marathon', key: 'HALF', km: 21.0975 },
  { label: 'Marathon', key: 'FULL', km: 42.195 },
  { label: '50K', key: '50K', km: 50 },
  { label: 'Custom', key: 'CUSTOM', km: 0 }
];

const ZONE_MULTIPLIERS: Record<string, number> = {
  recovery: 1.22,
  easy: 1.14,
  long: 1.09,
  race: 1.0,
  tempo: 0.96,
  threshold: 0.93,
  interval: 0.87
};

const PACE_ZONE_DEFS = [
  { key: 'recovery', label: 'Recovery' },
  { key: 'easy', label: 'Easy' },
  { key: 'long', label: 'Long run' },
  { key: 'race', label: 'Race' },
  { key: 'tempo', label: 'Tempo' },
  { key: 'threshold', label: 'Threshold' },
  { key: 'interval', label: 'Interval' }
] as const;

function formatDate(value: string | null | undefined) {
  if (!value) return 'Never';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'Never';
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

function parseGoalTimeSec(str: string): number | null {
  const parts = str.trim().split(':').map(Number);
  if (parts.some((p) => Number.isNaN(p))) return null;
  if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
  if (parts.length === 2) return parts[0] * 60 + parts[1];
  return null;
}

function formatGoalTime(sec: number): string {
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = Math.round(sec % 60);
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  return `${m}:${String(s).padStart(2, '0')}`;
}

function calcPace(raceSecPerKm: number, multiplier: number, unit: 'KM' | 'MILES'): string {
  const secPerKm = raceSecPerKm * multiplier;
  const secPerUnit = unit === 'KM' ? secPerKm : secPerKm * 1.609344;
  const mins = Math.floor(secPerUnit / 60);
  const secs = Math.round(secPerUnit - mins * 60);
  return `${mins}:${String(secs).padStart(2, '0')} ${unit === 'KM' ? '/km' : '/mi'}`;
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

  const [selectedDistanceKey, setSelectedDistanceKey] = useState('');
  const [customDistanceKm, setCustomDistanceKm] = useState('');
  const [goalTimeStr, setGoalTimeStr] = useState('');

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
        if (data?.paceTargets) {
          setPaceTargets(data.paceTargets);
          const rg = data.paceTargets?.raceGoal as Record<string, unknown> | undefined;
          if (rg?.raceDistanceKm && typeof rg.raceDistanceKm === 'number') {
            const known = RACE_DISTANCES.find(
              (d) => d.km > 0 && Math.abs(d.km - (rg.raceDistanceKm as number)) < 0.1
            );
            if (known) {
              setSelectedDistanceKey(known.key);
            } else {
              setSelectedDistanceKey('CUSTOM');
              setCustomDistanceKm(String(rg.raceDistanceKm));
            }
          }
          if (rg?.goalTimeSec && typeof rg.goalTimeSec === 'number') {
            setGoalTimeStr(formatGoalTime(rg.goalTimeSec));
          }
        }
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

  function calculateZones() {
    const dist = RACE_DISTANCES.find((d) => d.key === selectedDistanceKey);
    const distKm =
      selectedDistanceKey === 'CUSTOM' ? parseFloat(customDistanceKm) : (dist?.km ?? 0);
    if (!distKm || distKm <= 0) return;
    const timeSec = parseGoalTimeSec(goalTimeStr);
    if (!timeSec || timeSec <= 0) return;
    const raceSecPerKm = timeSec / distKm;
    const zones: Partial<PaceTargets> = {};
    for (const [zone, mult] of Object.entries(ZONE_MULTIPLIERS)) {
      zones[zone] = calcPace(raceSecPerKm, mult, units);
    }
    setPaceTargets((prev) => ({ ...prev, ...zones }));
  }

  async function saveProfile() {
    setStatus('Saving...');
    const zoneKeys = PACE_ZONE_DEFS.map((d) => d.key);
    const sanitizedPaceTargets: PaceTargets = { ...paceTargets };
    for (const zone of zoneKeys) {
      const val =
        typeof paceTargets[zone] === 'string' ? (paceTargets[zone] as string).trim() : '';
      if (val) sanitizedPaceTargets[zone] = val;
      else delete sanitizedPaceTargets[zone];
    }

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

  const stravaAccount = useMemo(
    () => integrationAccounts.find((account) => account.provider === 'STRAVA') || null,
    [integrationAccounts]
  );
  const garminAccount = useMemo(
    () => integrationAccounts.find((account) => account.provider === 'GARMIN') || null,
    [integrationAccounts]
  );

  const filledZones = PACE_ZONE_DEFS.filter(({ key }) => paceTargets[key]);

  const resolvedDistKm =
    selectedDistanceKey === 'CUSTOM'
      ? parseFloat(customDistanceKm) || 0
      : (RACE_DISTANCES.find((d) => d.key === selectedDistanceKey)?.km ?? 0);
  const canCalculate = resolvedDistKm > 0 && (parseGoalTimeSec(goalTimeStr) ?? 0) > 0;

  return (
    <main className="dash athlete-page-shell">
      <div className="dash-grid">
        <AthleteSidebar name={sidebarName} />

        <section className="dash-center">
          <section className="dash-card athlete-page-header">
            <h1>Profile Setup</h1>
            <p className="muted">
              Tell us how you train so CoachPlan can personalize your weekly execution.
            </p>
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
                  <select
                    value={role}
                    onChange={(e) => setRole(e.target.value as 'ATHLETE' | 'COACH')}
                  >
                    <option value="ATHLETE">Athlete</option>
                    <option value="COACH">Coach</option>
                  </select>
                </label>
                <label>
                  Units
                  <select
                    value={units}
                    onChange={(e) => setUnits(e.target.value as 'MILES' | 'KM')}
                  >
                    <option value="MILES">Miles</option>
                    <option value="KM">Kilometers</option>
                  </select>
                </label>
              </div>
            </div>

            <div className="dash-card athlete-page-card">
              <div className="section-title">
                <h3>Pace targets</h3>
              </div>

              <div className="pace-race-goal">
                <p className="pace-race-goal-label">Calculate from race goal</p>
                <div className="pace-race-goal-inputs">
                  <select
                    value={selectedDistanceKey}
                    onChange={(e) => setSelectedDistanceKey(e.target.value)}
                  >
                    <option value="">Distance</option>
                    {RACE_DISTANCES.map((d) => (
                      <option key={d.key} value={d.key}>
                        {d.label}
                      </option>
                    ))}
                  </select>
                  {selectedDistanceKey === 'CUSTOM' && (
                    <input
                      type="number"
                      className="pace-race-goal-custom-km"
                      placeholder="km"
                      value={customDistanceKm}
                      onChange={(e) => setCustomDistanceKm(e.target.value)}
                      min="1"
                    />
                  )}
                  <input
                    type="text"
                    placeholder="Goal time (H:MM:SS)"
                    value={goalTimeStr}
                    onChange={(e) => setGoalTimeStr(e.target.value)}
                  />
                </div>
                <button
                  type="button"
                  className="cta secondary pace-calc-btn"
                  onClick={calculateZones}
                  disabled={!canCalculate}
                >
                  Calculate zones
                </button>
              </div>

              <div className="pace-zone-divider" />

              <div className="pace-zone-list">
                {PACE_ZONE_DEFS.map(({ key, label }) => (
                  <div key={key} className="pace-zone-row">
                    <span className="pace-zone-label">{label}</span>
                    <input
                      className="pace-zone-input"
                      value={(paceTargets[key] as string) || ''}
                      onChange={(e) =>
                        setPaceTargets({ ...paceTargets, [key]: e.target.value })
                      }
                      placeholder={units === 'KM' ? '0:00 /km' : '0:00 /mi'}
                    />
                  </div>
                ))}
              </div>
              <p className="pace-zone-hint">
                Format: M:SS {units === 'KM' ? '/km' : '/mi'} — edit manually or use Calculate above
              </p>
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
                  <select
                    value={selectedCoach}
                    onChange={(e) => setSelectedCoach(e.target.value)}
                  >
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
              Sync recorded activities so completed sessions automatically feed your training-plan
              workout logs.
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
                  {!stravaAccount?.connected ? (
                    <StravaConnectButton
                      className="cta secondary"
                      disabled={busyProvider === 'STRAVA'}
                      onClick={startStravaConnect}
                    />
                  ) : (
                    <>
                      <button
                        className="cta secondary"
                        type="button"
                        onClick={syncStravaNow}
                        disabled={busyProvider === 'STRAVA'}
                      >
                        Sync now
                      </button>
                      <button
                        className="cta secondary"
                        type="button"
                        onClick={() => disconnectProvider('STRAVA')}
                        disabled={busyProvider === 'STRAVA'}
                      >
                        Disconnect
                      </button>
                      <button
                        className="cta secondary athlete-reconnect-btn"
                        type="button"
                        onClick={startStravaConnect}
                        disabled={busyProvider === 'STRAVA'}
                      >
                        Reconnect
                      </button>
                    </>
                  )}
                </div>
                {!integrationCapability.stravaConfigured && (
                  <p className="muted">
                    Server credentials missing: set `STRAVA_CLIENT_ID` and `STRAVA_CLIENT_SECRET`.
                  </p>
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
                  Garmin requires approved Garmin Health API credentials before OAuth + activity
                  sync can be enabled.
                </p>
              </article>
            </div>

            {integrationStatus && (
              <p className="muted athlete-integration-status">{integrationStatus}</p>
            )}
          </section>

          <section className="dash-card athlete-save-row">
            <button className="cta" onClick={saveProfile}>
              Save profile
            </button>
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
                <strong>Strava</strong>
                <span>{stravaAccount?.connected ? 'Connected' : 'Not connected'}</span>
              </div>
              {filledZones.length > 0 && (
                <div>
                  <strong>Pace zones</strong>
                  <div className="athlete-summary-paces">
                    {filledZones.map(({ key, label }) => (
                      <span key={key} className="athlete-pace-chip">
                        <span className="athlete-pace-chip-label">{label}</span>
                        <span className="athlete-pace-chip-value">
                          {paceTargets[key] as string}
                        </span>
                      </span>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>

          <div className="dash-card athlete-right-card">
            <div className="dash-card-header">
              <span className="dash-card-title">Actions</span>
            </div>
            <div className="athlete-link-list">
              <Link href="/dashboard">
                <span>Go to today dashboard</span>
                <span className="athlete-link-arrow">→</span>
              </Link>
              <Link href="/plans">
                <span>Open Plans Management</span>
                <span className="athlete-link-arrow">→</span>
              </Link>
              <Link href="/plans">
                <span>Manage plans and uploads</span>
                <span className="athlete-link-arrow">→</span>
              </Link>
            </div>
          </div>
        </aside>
      </div>
    </main>
  );
}
