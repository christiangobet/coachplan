'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import StravaConnectButton from '@/components/StravaConnectButton';
import NotificationToggle from '@/components/NotificationToggle';
import '../dashboard/dashboard.css';
import './profile.css';

// ── Types ─────────────────────────────────────────────────────────────────────

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

type ProfileStats = {
  totalPlans: number;
  completedSessions: number;
  activeWeeks: number;
};

type PerformanceConfidenceLabel = 'HIGH' | 'MEDIUM' | 'LOW';

type PerformanceSnapshotEstimate = {
  distanceKm: number;
  timeSec: number;
};

type ReadyPerformanceSnapshot = {
  version: 1;
  status: 'READY';
  source: 'STRAVA';
  computedAt: string;
  basedOnLastSyncAt: string | null;
  windowDays: number;
  confidence: {
    score: number;
    label: PerformanceConfidenceLabel;
  };
  estimates: {
    fiveK: PerformanceSnapshotEstimate;
    tenK: PerformanceSnapshotEstimate;
    halfMarathon: PerformanceSnapshotEstimate;
    marathon: PerformanceSnapshotEstimate;
  };
  evidenceSummary: {
    basis: string;
    evidenceCount: number;
    raceLikeCount: number;
    sustainedCount: number;
    workoutCount: number;
    newestEvidenceDate: string | null;
    oldestEvidenceDate: string | null;
    evidenceRuns?: Array<{ dateISO: string; level: 'RACE_LIKE' | 'SUSTAINED' | 'STRUCTURED'; distanceKm: number }>;
  };
};

type PerformanceSnapshotResponse = {
  status: 'ready' | 'insufficient_data' | 'disconnected' | 'error' | 'needs_sync';
  snapshot?: ReadyPerformanceSnapshot | null;
  reason?: string | null;
  cached?: boolean;
  dataAvailableDays?: number;
  requestedDays?: number;
};

// ── Constants ──────────────────────────────────────────────────────────────────

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

const SNAPSHOT_WINDOWS = [
  { label: '4w', days: 28 },
  { label: '8w', days: 56 },
  { label: '12w', days: 84 },
  { label: '6m', days: 180 },
  { label: '12m', days: 365 }
] as const;

const DEFAULT_SNAPSHOT_WINDOW = 84;

// ── Helpers ────────────────────────────────────────────────────────────────────

function formatDate(value: string | null | undefined) {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

function formatDayMonth(value: string | null | undefined) {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  const dd = String(date.getDate()).padStart(2, '0');
  const mm = String(date.getMonth() + 1).padStart(2, '0');
  return `${dd}/${mm}`;
}

function formatMonthYear(value: string | null | undefined) {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
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

function getRaceLabel(distKm: number): string {
  if (Math.abs(distKm - 5) < 0.1) return '5K';
  if (Math.abs(distKm - 10) < 0.1) return '10K';
  if (Math.abs(distKm - 21.0975) < 0.1) return 'Half Marathon';
  if (Math.abs(distKm - 42.195) < 0.1) return 'Marathon';
  if (Math.abs(distKm - 50) < 0.1) return '50K';
  return `${distKm}km race`;
}

function getCountdownLabel(dateStr: string): { label: string; variant: 'normal' | 'urgent' | 'past' } {
  const race = new Date(dateStr);
  const now = new Date();
  now.setHours(0, 0, 0, 0);
  race.setHours(0, 0, 0, 0);
  const days = Math.round((race.getTime() - now.getTime()) / 86400000);
  if (days < 0) return { label: 'Past', variant: 'past' };
  if (days === 0) return { label: 'Race day!', variant: 'urgent' };
  if (days <= 7) return { label: `${days}d — Race week!`, variant: 'urgent' };
  if (days <= 14) return { label: `${days} days`, variant: 'urgent' };
  return { label: `${days} days`, variant: 'normal' };
}

function emitProfileEvent(event: string, detail: Record<string, unknown> = {}) {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(
    new CustomEvent('coachplan:analytics', {
      detail: {
        event,
        context: 'profile',
        ...detail
      }
    })
  );
}

// ── Component ──────────────────────────────────────────────────────────────────

export default function ProfilePage() {
  const searchParams = useSearchParams();
  const paceZonesSectionRef = useRef<HTMLDivElement>(null);

  // User data
  const [email, setEmail] = useState('');
  const [name, setName] = useState('');
  const [createdAt, setCreatedAt] = useState<string | null>(null);
  const [hasBothRoles, setHasBothRoles] = useState(false);
  const [units, setUnits] = useState<'MILES' | 'KM'>('MILES');
  const [goalRaceDate, setGoalRaceDate] = useState('');
  const [paceTargets, setPaceTargets] = useState<PaceTargets>({});
  const [role, setRole] = useState<'ATHLETE' | 'COACH'>('ATHLETE');

  // Coach
  const [coaches, setCoaches] = useState<Array<{ id: string; name: string }>>([]);
  const [selectedCoach, setSelectedCoach] = useState('');

  // Pace calculator
  const [selectedDistanceKey, setSelectedDistanceKey] = useState('');
  const [customDistanceKm, setCustomDistanceKm] = useState('');
  const [goalTimeStr, setGoalTimeStr] = useState('');

  // Integrations
  const [integrationAccounts, setIntegrationAccounts] = useState<IntegrationAccount[]>([]);
  const [integrationCapability, setIntegrationCapability] = useState<IntegrationCapability>({
    stravaConfigured: false,
    garminConfigured: false
  });
  const [integrationStatus, setIntegrationStatus] = useState<string | null>(null);
  const [busyProvider, setBusyProvider] = useState<IntegrationProvider | null>(null);

  // Stats (async)
  const [stats, setStats] = useState<ProfileStats | null>(null);
  const [performanceSnapshot, setPerformanceSnapshot] = useState<ReadyPerformanceSnapshot | null>(null);
  const [performanceStatus, setPerformanceStatus] = useState<'idle' | 'loading' | 'ready' | 'insufficient_data' | 'disconnected' | 'error' | 'needs_sync'>('idle');
  const [performanceReason, setPerformanceReason] = useState<string | null>(null);
  const [performanceCached, setPerformanceCached] = useState(false);
  const [performanceRefreshing, setPerformanceRefreshing] = useState(false);
  const [snapshotWindowDays, setSnapshotWindowDays] = useState(DEFAULT_SNAPSHOT_WINDOW);
  const [snapshotNeedsSyncDays, setSnapshotNeedsSyncDays] = useState<{ available: number; requested: number } | null>(null);
  const [snapshotFetching, setSnapshotFetching] = useState(false);

  // Save feedback
  const [nameSaved, setNameSaved] = useState(false);
  const [paceStatus, setPaceStatus] = useState<string | null>(null);
  const [coachStatus, setCoachStatus] = useState<string | null>(null);

  // ── Data loading ─────────────────────────────────────────────────────────────

  async function loadIntegrationStatus() {
    const res = await fetch('/api/integrations/accounts');
    const data = await res.json().catch(() => ({}));
    if (!res.ok) return;
    setIntegrationAccounts(data.accounts || []);
    setIntegrationCapability({
      stravaConfigured: Boolean(data?.capability?.stravaConfigured),
      garminConfigured: Boolean(data?.capability?.garminConfigured)
    });
  }

  const loadPerformanceSnapshot = useCallback(async (forceRefresh = false, windowDays?: number) => {
    if (forceRefresh) setPerformanceRefreshing(true);
    if (!forceRefresh) setPerformanceStatus('loading');
    try {
      const days = windowDays ?? snapshotWindowDays;
      const params = new URLSearchParams({ lookbackDays: String(days) });
      if (forceRefresh) params.set('refresh', '1');
      const res = await fetch(`/api/profile/performance-snapshot?${params}`, { cache: 'no-store' });
      const data = (await res.json().catch(() => ({}))) as PerformanceSnapshotResponse;

      if (!res.ok || data.status === 'error') {
        setPerformanceStatus('error');
        setPerformanceSnapshot(null);
        setPerformanceCached(false);
        setPerformanceReason(data?.reason || 'Failed to load performance snapshot.');
        emitProfileEvent('profile_performance_snapshot_error', { forceRefresh, statusCode: res.status });
        return;
      }

      if (data.status === 'disconnected') {
        setPerformanceSnapshot(null);
        setPerformanceCached(Boolean(data.cached));
        setPerformanceStatus('disconnected');
        setPerformanceReason(data.reason || null);
        return;
      }

      if (data.status === 'needs_sync') {
        setPerformanceStatus('needs_sync');
        setPerformanceSnapshot(null);
        setSnapshotNeedsSyncDays({
          available: data.dataAvailableDays ?? 0,
          requested: data.requestedDays ?? days
        });
        return;
      }

      if (data.status === 'ready' && data.snapshot) {
        setSnapshotNeedsSyncDays(null);
        setPerformanceStatus('ready');
        setPerformanceSnapshot(data.snapshot);
        setPerformanceReason(null);
        setPerformanceCached(Boolean(data.cached));
        emitProfileEvent('profile_performance_snapshot_viewed', {
          confidenceLabel: data.snapshot.confidence.label,
          confidenceScore: data.snapshot.confidence.score,
          windowDays: data.snapshot.windowDays,
          forceRefresh,
          cached: Boolean(data.cached)
        });
        if (forceRefresh) {
          emitProfileEvent('profile_performance_snapshot_refreshed', {
            confidenceLabel: data.snapshot.confidence.label,
            confidenceScore: data.snapshot.confidence.score
          });
        }
        return;
      }

      setSnapshotNeedsSyncDays(null);
      setPerformanceSnapshot(null);
      setPerformanceCached(Boolean(data.cached));
      setPerformanceStatus('insufficient_data');
      setPerformanceReason(data.reason || null);
      if (data.status === 'insufficient_data') {
        emitProfileEvent('profile_performance_snapshot_insufficient_data', {
          forceRefresh,
          cached: Boolean(data.cached)
        });
      }
    } catch {
      setPerformanceStatus('error');
      setPerformanceSnapshot(null);
      setPerformanceCached(false);
      setPerformanceReason('Failed to load performance snapshot.');
      emitProfileEvent('profile_performance_snapshot_error', { forceRefresh });
    } finally {
      setPerformanceRefreshing(false);
    }
  }, [snapshotWindowDays]);

  useEffect(() => {
    // Load user + stats + integrations in parallel
    Promise.all([
      fetch('/api/me').then((r) => r.json()),
      fetch('/api/coaches').then((r) => r.json()),
      loadIntegrationStatus(),
      fetch('/api/me/stats').then((r) => r.json())
    ]).then(([userData, coachData, , statsData]) => {
      if (userData?.email) setEmail(userData.email);
      if (userData?.name) setName(userData.name);
      if (userData?.createdAt) setCreatedAt(userData.createdAt);
      if (userData?.hasBothRoles) setHasBothRoles(userData.hasBothRoles);
      if (userData?.units === 'MILES' || userData?.units === 'KM') setUnits(userData.units);
      if (userData?.goalRaceDate) setGoalRaceDate(userData.goalRaceDate.slice(0, 10));
      if (userData?.role === 'ATHLETE' || userData?.role === 'COACH') setRole(userData.role);
      if (userData?.paceTargets) {
        setPaceTargets(userData.paceTargets);
        const rg = userData.paceTargets?.raceGoal as Record<string, unknown> | undefined;
        if (rg?.raceDistanceKm && typeof rg.raceDistanceKm === 'number') {
          const known = RACE_DISTANCES.find(
            (d) => d.km > 0 && Math.abs(d.km - (rg.raceDistanceKm as number)) < 0.1
          );
          setSelectedDistanceKey(known ? known.key : 'CUSTOM');
          if (!known) setCustomDistanceKm(String(rg.raceDistanceKm));
        }
        if (rg?.goalTimeSec && typeof rg.goalTimeSec === 'number') {
          setGoalTimeStr(formatGoalTime(rg.goalTimeSec as number));
        }
      }
      setCoaches(coachData?.coaches || []);
      if (statsData?.totalPlans !== undefined) setStats(statsData);
    });
    void loadPerformanceSnapshot();
  }, [loadPerformanceSnapshot]);

  useEffect(() => {
    const integration = searchParams.get('integration');
    const integrationError = searchParams.get('integrationError');
    const integrationWarning = searchParams.get('integrationWarning');
    if (integration === 'strava_connected') {
      setIntegrationStatus('Strava connected successfully.');
      loadIntegrationStatus();
      void loadPerformanceSnapshot(true);
    }
    if (integrationWarning === 'sync_failed') {
      setIntegrationStatus('Strava connected, but first sync failed. Try sync now.');
    }
    if (integrationError) {
      setIntegrationStatus(`Integration error: ${integrationError}`);
    }
  }, [searchParams, loadPerformanceSnapshot]);

  // ── Derived state ─────────────────────────────────────────────────────────────

  const stravaAccount = useMemo(
    () => integrationAccounts.find((a) => a.provider === 'STRAVA') ?? null,
    [integrationAccounts]
  );

  const resolvedDistKm =
    selectedDistanceKey === 'CUSTOM'
      ? parseFloat(customDistanceKm) || 0
      : (RACE_DISTANCES.find((d) => d.key === selectedDistanceKey)?.km ?? 0);
  const canCalculate = resolvedDistKm > 0 && (parseGoalTimeSec(goalTimeStr) ?? 0) > 0;

  const raceGoalData = useMemo(() => {
    const rg = paceTargets?.raceGoal as Record<string, unknown> | undefined;
    if (!rg || !goalRaceDate) return null;
    const distKm = typeof rg.raceDistanceKm === 'number' ? rg.raceDistanceKm : null;
    const timeSec = typeof rg.goalTimeSec === 'number' ? rg.goalTimeSec : null;
    if (!distKm || !timeSec) return null;
    const raceSecPerKm = timeSec / distKm;
    const targetPace = calcPace(raceSecPerKm, 1.0, units);
    return {
      label: getRaceLabel(distKm),
      time: formatGoalTime(timeSec),
      pace: targetPace,
      countdown: getCountdownLabel(goalRaceDate)
    };
  }, [paceTargets, goalRaceDate, units]);

  // ── Saves ─────────────────────────────────────────────────────────────────────

  async function saveNameOnBlur() {
    await fetch('/api/me', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name })
    });
    setNameSaved(true);
    setTimeout(() => setNameSaved(false), 2000);
  }

  async function saveUnits(newUnits: 'MILES' | 'KM') {
    setUnits(newUnits);
    await fetch('/api/me', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ units: newUnits })
    });
  }

  function calculateZones() {
    if (!resolvedDistKm || resolvedDistKm <= 0) return;
    const timeSec = parseGoalTimeSec(goalTimeStr);
    if (!timeSec || timeSec <= 0) return;
    const raceSecPerKm = timeSec / resolvedDistKm;
    const zones: Partial<PaceTargets> = {};
    for (const [zone, mult] of Object.entries(ZONE_MULTIPLIERS)) {
      zones[zone] = calcPace(raceSecPerKm, mult, units);
    }
    const raceGoal = {
      raceDistanceKm: resolvedDistKm,
      goalTimeSec: timeSec
    };
    setPaceTargets((prev) => ({ ...prev, ...zones, raceGoal }));
  }

  async function savePaceTargets() {
    setPaceStatus('Saving...');
    const zoneKeys = PACE_ZONE_DEFS.map((d) => d.key);
    const sanitized: PaceTargets = { ...paceTargets };
    for (const zone of zoneKeys) {
      const val = typeof paceTargets[zone] === 'string' ? (paceTargets[zone] as string).trim() : '';
      if (val) sanitized[zone] = val;
      else delete sanitized[zone];
    }
    // Also save goalRaceDate together with paceTargets
    await fetch('/api/me', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ paceTargets: sanitized, goalRaceDate: goalRaceDate || null })
    });
    setPaceStatus('Saved');
    setTimeout(() => setPaceStatus(null), 2000);
  }

  async function saveCoach() {
    if (!selectedCoach) return;
    setCoachStatus('Saving...');
    await fetch('/api/coach-link', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ coachId: selectedCoach })
    });
    setCoachStatus('Linked');
    setTimeout(() => setCoachStatus(null), 2000);
  }

  // ── Integration handlers ──────────────────────────────────────────────────────

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
      const s = data?.summary;
      setIntegrationStatus(
        `Sync complete: ${s?.imported ?? 0} imported, ${s?.matched ?? 0} matched, ${s?.workoutsUpdated ?? 0} updated`
      );
      await loadIntegrationStatus();
      await loadPerformanceSnapshot(true);
    } catch {
      setIntegrationStatus('Failed to sync Strava activities');
    } finally {
      setBusyProvider(null);
    }
  }

  async function disconnectStrava() {
    setBusyProvider('STRAVA');
    setIntegrationStatus('Disconnecting Strava...');
    try {
      const res = await fetch('/api/integrations/accounts/STRAVA', { method: 'DELETE' });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setIntegrationStatus(data?.error || 'Failed to disconnect Strava');
        return;
      }
      setIntegrationStatus('Strava disconnected');
      await loadIntegrationStatus();
      setPerformanceStatus('disconnected');
      setPerformanceSnapshot(null);
      setPerformanceCached(false);
      setPerformanceReason('Connect Strava to estimate performance.');
    } catch {
      setIntegrationStatus('Failed to disconnect Strava');
    } finally {
      setBusyProvider(null);
    }
  }

  async function handleWindowChange(days: number) {
    setSnapshotWindowDays(days);
    setSnapshotNeedsSyncDays(null);
    await loadPerformanceSnapshot(false, days);
  }

  async function fetchAndRecompute() {
    if (!snapshotNeedsSyncDays) return;
    setSnapshotFetching(true);
    setIntegrationStatus(`Syncing ${snapshotWindowDays} days of Strava history...`);
    try {
      const res = await fetch('/api/integrations/strava/sync', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ lookbackDays: snapshotWindowDays, forceLookback: true })
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setIntegrationStatus(data?.error || 'Sync failed');
        return;
      }
      setIntegrationStatus(null);
      await loadIntegrationStatus();
      await loadPerformanceSnapshot(true, snapshotWindowDays);
    } catch {
      setIntegrationStatus('Sync failed. Please try again.');
    } finally {
      setSnapshotFetching(false);
    }
  }

  // ── Render ────────────────────────────────────────────────────────────────────

  const initial = name.trim() ? name.trim()[0].toUpperCase() : '?';
  const memberSince = formatMonthYear(createdAt);
  const confidenceClass =
    performanceSnapshot?.confidence.label === 'HIGH'
      ? 'high'
      : performanceSnapshot?.confidence.label === 'MEDIUM'
        ? 'medium'
        : 'low';

  return (
    <main className="dash">
      <div className="dash-grid" style={{ maxWidth: 1000, margin: '0 auto', padding: '1.5rem 1rem' }}>

        {/* Page header */}
        <div className="profile-page-header" style={{ gridColumn: '1 / -1' }}>
          <h1>My Profile</h1>
          <p>Your athlete identity and training preferences.</p>
        </div>

        {/* Two-column grid */}
        <div className="profile-grid" style={{ gridColumn: '1 / -1' }}>

          {/* ── LEFT COLUMN ── */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>

            {/* Avatar card */}
            <div className="dash-card profile-avatar-card">
              <div className="profile-avatar-row">
                <div className="profile-avatar-circle">{initial}</div>
                <div className="profile-avatar-info">
                  <span className="profile-avatar-name">{name || 'Athlete'}</span>
                  {email && (
                    <a className="profile-avatar-email" href={`mailto:${email}`}>{email}</a>
                  )}
                </div>
              </div>
              <div className="profile-avatar-meta">
                {memberSince && <span>Member since {memberSince}</span>}
                <span className="profile-role-badge">
                  {hasBothRoles ? 'Athlete · Coach' : 'Athlete'}
                </span>
              </div>
            </div>

            {/* Race goal card */}
            <div className="dash-card profile-race-card">
              <div className="profile-race-header">
                <h3>Race Goal</h3>
                <button
                  className="profile-race-edit-btn"
                  type="button"
                  onClick={() => paceZonesSectionRef.current?.scrollIntoView({ behavior: 'smooth' })}
                >
                  Edit →
                </button>
              </div>
              {raceGoalData ? (
                <>
                  <span className={`profile-race-countdown ${raceGoalData.countdown.variant}`}>
                    {raceGoalData.countdown.label}
                  </span>
                  <div className="profile-race-details">
                    <div className="profile-race-row">
                      <span>Race</span>
                      <span>{raceGoalData.label}</span>
                    </div>
                    <div className="profile-race-row">
                      <span>Target time</span>
                      <span>{raceGoalData.time}</span>
                    </div>
                    <div className="profile-race-row">
                      <span>Target pace</span>
                      <span>{raceGoalData.pace}</span>
                    </div>
                    <div className="profile-race-row">
                      <span>Race date</span>
                      <span>{formatDate(goalRaceDate) ?? '—'}</span>
                    </div>
                  </div>
                </>
              ) : (
                <p className="profile-race-empty">
                  No race goal set.{' '}
                  <a
                    href="#pace-zones"
                    onClick={(e) => {
                      e.preventDefault();
                      paceZonesSectionRef.current?.scrollIntoView({ behavior: 'smooth' });
                    }}
                  >
                    Set one →
                  </a>
                </p>
              )}
            </div>

            {/* Training stats card */}
            <div className="dash-card profile-stats-card">
              <p className="profile-section-title">Training Summary</p>
              <div className="profile-stat-row">
                <span className="profile-stat-label">Training plans</span>
                {stats ? (
                  <span className="profile-stat-value">{stats.totalPlans}</span>
                ) : (
                  <span className="profile-stat-skeleton" />
                )}
              </div>
              <div className="profile-stat-row">
                <span className="profile-stat-label">Sessions completed</span>
                {stats ? (
                  <span className="profile-stat-value">{stats.completedSessions}</span>
                ) : (
                  <span className="profile-stat-skeleton" />
                )}
              </div>
              <div className="profile-stat-row">
                <span className="profile-stat-label">Active weeks</span>
                {stats ? (
                  <span className="profile-stat-value">{stats.activeWeeks}</span>
                ) : (
                  <span className="profile-stat-skeleton" />
                )}
              </div>
            </div>

            {/* Strava card */}
            <div className="dash-card profile-strava-card">
              <div className="profile-strava-header">
                <h3>Strava</h3>
                <span className={`profile-strava-badge ${stravaAccount?.connected ? 'connected' : 'disconnected'}`}>
                  {stravaAccount?.connected ? 'Connected' : 'Not connected'}
                </span>
              </div>
              {stravaAccount?.connected && (
                <div className="profile-strava-meta">
                  {stravaAccount.providerUsername && <span>@{stravaAccount.providerUsername}</span>}
                  {stravaAccount.lastSyncAt && <span>Last sync: {formatDate(stravaAccount.lastSyncAt)}</span>}
                  {stravaAccount.connectedAt && <span>Connected since: {formatDate(stravaAccount.connectedAt)}</span>}
                </div>
              )}
              <div className="profile-strava-actions">
                {!stravaAccount?.connected ? (
                  <StravaConnectButton
                    className="cta secondary"
                    disabled={busyProvider === 'STRAVA'}
                    onClick={startStravaConnect}
                  />
                ) : (
                  <>
                    <button className="cta secondary" type="button" onClick={syncStravaNow} disabled={busyProvider === 'STRAVA'}>
                      Sync now
                    </button>
                    <button className="cta secondary" type="button" data-action="disconnect" onClick={disconnectStrava} disabled={busyProvider === 'STRAVA'}>
                      Disconnect
                    </button>
                    <button className="cta secondary" type="button" onClick={startStravaConnect} disabled={busyProvider === 'STRAVA'}>
                      Reconnect
                    </button>
                  </>
                )}
              </div>
              {integrationStatus && (
                <p className="profile-integration-status">{integrationStatus}</p>
              )}
            </div>

          </div>

          {/* ── RIGHT COLUMN ── */}
          <div className="profile-settings-col">

            {/* Personal */}
            <div className="dash-card">
              <p className="profile-section-title">Personal</p>
              <div className="profile-personal-grid">
                <label>
                  <span style={{ fontSize: '0.78rem', color: 'var(--d-muted)', display: 'block', marginBottom: '0.3rem' }}>Name</span>
                  <input
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    onBlur={saveNameOnBlur}
                    style={{ width: '100%' }}
                  />
                  {nameSaved && <span className="profile-save-tick">✓ Saved</span>}
                </label>
                <label>
                  <span style={{ fontSize: '0.78rem', color: 'var(--d-muted)', display: 'block', marginBottom: '0.3rem' }}>Units</span>
                  <div className="profile-units-toggle">
                    <button
                      type="button"
                      className={units === 'MILES' ? 'active' : ''}
                      onClick={() => saveUnits('MILES')}
                    >
                      Miles
                    </button>
                    <button
                      type="button"
                      className={units === 'KM' ? 'active' : ''}
                      onClick={() => saveUnits('KM')}
                    >
                      KM
                    </button>
                  </div>
                </label>
              </div>
            </div>

            {/* Performance snapshot card */}
            <div className="dash-card profile-performance-card">
              <div className="profile-performance-header">
                <h3>Performance Snapshot (Estimated)</h3>
                <button
                  type="button"
                  className="profile-performance-refresh-btn"
                  onClick={() => void loadPerformanceSnapshot(true)}
                  disabled={!stravaAccount?.connected || performanceRefreshing || snapshotFetching}
                >
                  {performanceRefreshing ? 'Recalculating...' : 'Recalculate'}
                </button>
              </div>

              {/* Window selector */}
              {stravaAccount?.connected && (
                <div className="profile-snapshot-windows">
                  {SNAPSHOT_WINDOWS.map(({ label, days }) => (
                    <button
                      key={days}
                      type="button"
                      className={`profile-snapshot-window-btn${snapshotWindowDays === days ? ' active' : ''}`}
                      onClick={() => void handleWindowChange(days)}
                      disabled={performanceRefreshing || snapshotFetching}
                    >
                      {label}
                    </button>
                  ))}
                </div>
              )}

              {performanceStatus === 'loading' && (
                <p className="profile-performance-note">Loading estimate...</p>
              )}

              {performanceStatus === 'disconnected' && (
                <p className="profile-performance-note">
                  Connect Strava to estimate likely race performance.
                </p>
              )}

              {performanceStatus === 'insufficient_data' && (
                <div className="profile-performance-empty">
                  <p className="profile-performance-note">
                    {performanceReason || 'Not enough strong run evidence yet. Sync more recent runs.'}
                  </p>
                  <p className="profile-performance-hint">
                    Add a recent sustained run or race-like effort to improve the estimate.
                  </p>
                </div>
              )}

              {performanceStatus === 'needs_sync' && snapshotNeedsSyncDays && (
                <div className="profile-performance-needs-sync">
                  <p className="profile-performance-note">
                    ⚠ Only {snapshotNeedsSyncDays.available} days of runs are synced.
                  </p>
                  <p className="profile-performance-hint">
                    Fetch {Math.round(snapshotNeedsSyncDays.requested / 30)} months from Strava to use this window?
                  </p>
                  <button
                    type="button"
                    className="cta secondary"
                    onClick={() => void fetchAndRecompute()}
                    disabled={snapshotFetching}
                  >
                    {snapshotFetching ? 'Fetching...' : 'Fetch from Strava'}
                  </button>
                </div>
              )}

              {performanceStatus === 'error' && (
                <div className="profile-performance-empty">
                  <p className="profile-performance-note">
                    {performanceReason || 'Unable to load performance snapshot.'}
                  </p>
                  <button
                    type="button"
                    className="cta secondary"
                    onClick={() => void loadPerformanceSnapshot(true)}
                  >
                    Retry
                  </button>
                </div>
              )}

              {performanceStatus === 'ready' && performanceSnapshot && (
                <>
                  <div className="profile-performance-grid">
                    <div className="profile-performance-row">
                      <span>Estimated 5K</span>
                      <strong>{formatGoalTime(performanceSnapshot.estimates.fiveK.timeSec)}</strong>
                    </div>
                    <div className="profile-performance-row">
                      <span>Estimated 10K</span>
                      <strong>{formatGoalTime(performanceSnapshot.estimates.tenK.timeSec)}</strong>
                    </div>
                    <div className="profile-performance-row">
                      <span>Estimated Half Marathon</span>
                      <strong>{formatGoalTime(performanceSnapshot.estimates.halfMarathon.timeSec)}</strong>
                    </div>
                    <div className="profile-performance-row">
                      <span>Estimated Marathon</span>
                      <strong>{formatGoalTime(performanceSnapshot.estimates.marathon.timeSec)}</strong>
                    </div>
                  </div>

                  <div className="profile-performance-confidence">
                    <span>Confidence</span>
                    <span className={`profile-performance-confidence-chip ${confidenceClass}`}>
                      {performanceSnapshot.confidence.label} · {performanceSnapshot.confidence.score}%
                    </span>
                  </div>

                  <p className="profile-performance-basis">{performanceSnapshot.evidenceSummary.basis}</p>

                  {/* Evidence run circles — up to 6 slots */}
                  <div className="profile-evidence-circles">
                    {Array.from({ length: 6 }).map((_, i) => {
                      const run = performanceSnapshot.evidenceSummary.evidenceRuns?.[i];
                      return (
                        <div
                          key={i}
                          className={`profile-evidence-dot${run ? ` level-${run.level.toLowerCase()}` : ' empty'}`}
                          title={run ? `${run.distanceKm}km · ${formatDate(run.dateISO)}` : 'Unused slot'}
                        >
                          {run ? formatDayMonth(run.dateISO) : ''}
                        </div>
                      );
                    })}
                  </div>
                  <p className="profile-evidence-hint">
                    <span className="profile-evidence-legend race">●</span> race-like &nbsp;
                    <span className="profile-evidence-legend effort">●</span> training effort &nbsp;
                    <span className="profile-evidence-legend empty">○</span> unused slot
                  </p>

                  <p className="profile-performance-meta">
                    Updated {formatDate(performanceSnapshot.computedAt) || 'just now'}
                    {performanceCached ? ' · cached' : ' · fresh'}
                  </p>
                </>
              )}
            </div>

            {/* Pace zones */}
            <div className="dash-card" id="pace-zones" ref={paceZonesSectionRef}>
              <p className="profile-section-title">Pace Zones & Race Goal</p>

              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', marginBottom: '0.75rem' }}>
                <label style={{ fontSize: '0.78rem', color: 'var(--d-muted)' }}>Race date</label>
                <input
                  type="date"
                  value={goalRaceDate}
                  onChange={(e) => setGoalRaceDate(e.target.value)}
                  style={{ width: '100%' }}
                />
              </div>

              <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', marginBottom: '0.5rem' }}>
                <select
                  value={selectedDistanceKey}
                  onChange={(e) => setSelectedDistanceKey(e.target.value)}
                  style={{ flex: 1, minWidth: 120 }}
                >
                  <option value="">Distance</option>
                  {RACE_DISTANCES.map((d) => (
                    <option key={d.key} value={d.key}>{d.label}</option>
                  ))}
                </select>
                {selectedDistanceKey === 'CUSTOM' && (
                  <input
                    type="number"
                    placeholder="km"
                    value={customDistanceKm}
                    onChange={(e) => setCustomDistanceKm(e.target.value)}
                    style={{ width: 70 }}
                    min="1"
                  />
                )}
                <input
                  type="text"
                  placeholder="Goal time H:MM:SS"
                  value={goalTimeStr}
                  onChange={(e) => setGoalTimeStr(e.target.value)}
                  style={{ flex: 1, minWidth: 120 }}
                />
              </div>

              <button
                type="button"
                className="cta secondary"
                onClick={calculateZones}
                disabled={!canCalculate}
                style={{ marginBottom: '0.75rem' }}
              >
                Calculate zones
              </button>

              <div style={{ borderTop: '1px solid var(--d-border-light)', paddingTop: '0.75rem', display: 'flex', flexDirection: 'column', gap: '0.4rem' }}>
                {PACE_ZONE_DEFS.map(({ key, label }) => (
                  <div key={key} style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                    <span style={{ fontSize: '0.78rem', color: 'var(--d-muted)', width: 80, flexShrink: 0 }}>{label}</span>
                    <input
                      value={(paceTargets[key] as string) || ''}
                      onChange={(e) => setPaceTargets({ ...paceTargets, [key]: e.target.value })}
                      placeholder={units === 'KM' ? '0:00 /km' : '0:00 /mi'}
                      style={{ flex: 1 }}
                    />
                  </div>
                ))}
              </div>
              <p style={{ fontSize: '0.72rem', color: 'var(--d-muted)', marginTop: '0.5rem' }}>
                Format: M:SS {units === 'KM' ? '/km' : '/mi'}
              </p>
              <div style={{ marginTop: '0.75rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                <button type="button" className="cta" onClick={savePaceTargets}>
                  Save pace zones
                </button>
                {paceStatus && <span className="profile-save-tick">{paceStatus}</span>}
              </div>
            </div>

            {/* Coach */}
            {role === 'ATHLETE' && (
              <div className="dash-card">
                <p className="profile-section-title">Coach</p>
                <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
                  <select
                    value={selectedCoach}
                    onChange={(e) => setSelectedCoach(e.target.value)}
                    style={{ flex: 1 }}
                  >
                    <option value="">Select a coach</option>
                    {coaches.map((c) => (
                      <option key={c.id} value={c.id}>{c.name}</option>
                    ))}
                  </select>
                  <button
                    type="button"
                    className="cta secondary"
                    onClick={saveCoach}
                    disabled={!selectedCoach}
                  >
                    Link
                  </button>
                </div>
                {coachStatus && <span className="profile-save-tick" style={{ marginTop: '0.4rem', display: 'block' }}>{coachStatus}</span>}
              </div>
            )}

            {/* Notifications */}
            <div className="dash-card" style={{ display: 'grid', gap: 8 }}>
              <div>
                <h3 style={{ fontSize: 14, fontWeight: 700, marginBottom: 4 }}>Workout Reminders</h3>
                <p style={{ fontSize: 13, color: 'var(--d-muted)', marginBottom: 10 }}>
                  Get notified the evening before your scheduled workouts.
                </p>
                <NotificationToggle />
              </div>
            </div>

          </div>
        </div>
      </div>
    </main>
  );
}
