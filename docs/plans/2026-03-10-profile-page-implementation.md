# Profile Page Redesign — Implementation Plan

> **Status: COMPLETED** — implemented and merged to main

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Replace the current settings-only profile page with a two-column layout — identity (avatar, race goal, training stats, Strava) on the left; settings (personal, pace zones, coach) on the right.

**Architecture:** Rewrite `src/app/profile/page.tsx` in-place preserving all existing logic (pace calculator, Strava connect/sync/disconnect, coach link). Add a new `GET /api/me/stats` endpoint for training counts. Extract all new styles into `src/app/profile/profile.css`. The right column reuses the existing `AthleteSidebar` is dropped — layout is self-contained.

**Tech Stack:** Next.js 16, React 19, TypeScript, Prisma, existing CSS tokens (`--d-*`).

---

## Task 1: Create `/api/me/stats` endpoint

**Files:**
- Create: `src/app/api/me/stats/route.ts`

**Step 1: Create the route file**

```ts
// src/app/api/me/stats/route.ts
import { NextResponse } from 'next/server';
import { currentUser } from '@clerk/nextjs/server';
import { prisma } from '@/lib/prisma';
import { ensureUserFromAuth } from '@/lib/user-sync';

export async function GET() {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const dbUser = await ensureUserFromAuth(user, {
    defaultRole: 'ATHLETE',
    defaultCurrentRole: 'ATHLETE'
  });

  const [totalPlans, completedSessions, activeWeeks] = await Promise.all([
    prisma.trainingPlan.count({
      where: { athleteId: dbUser.id, isTemplate: false }
    }),
    prisma.planActivity.count({
      where: { plan: { athleteId: dbUser.id }, completed: true }
    }),
    prisma.planWeek.count({
      where: {
        plan: { athleteId: dbUser.id },
        days: { some: { activities: { some: { completed: true } } } }
      }
    })
  ]);

  return NextResponse.json({ totalPlans, completedSessions, activeWeeks });
}
```

**Step 2: Verify typecheck passes**

Run: `npm run typecheck`
Expected: no errors

**Step 3: Commit**

```bash
git add src/app/api/me/stats/route.ts
git commit -m "feat: add /api/me/stats endpoint for profile training counts"
```

---

## Task 2: Create `profile.css`

**Files:**
- Create: `src/app/profile/profile.css`

**Step 1: Create the stylesheet**

```css
/* src/app/profile/profile.css */

/* ── Two-column layout ── */
.profile-grid {
  display: grid;
  grid-template-columns: 320px 1fr;
  gap: 1.25rem;
  align-items: start;
}

@media (max-width: 768px) {
  .profile-grid {
    grid-template-columns: 1fr;
  }
}

/* ── Avatar card ── */
.profile-avatar-card {
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
}

.profile-avatar-row {
  display: flex;
  align-items: center;
  gap: 1rem;
}

.profile-avatar-circle {
  width: 56px;
  height: 56px;
  border-radius: 50%;
  background: var(--d-orange);
  color: #fff;
  font-size: 1.5rem;
  font-weight: 800;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
}

.profile-avatar-info {
  display: flex;
  flex-direction: column;
  gap: 0.15rem;
  min-width: 0;
}

.profile-avatar-name {
  font-size: 1.05rem;
  font-weight: 700;
  color: var(--d-text);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.profile-avatar-email {
  font-size: 0.8rem;
  color: var(--d-muted);
  text-decoration: none;
}

.profile-avatar-email:hover {
  color: var(--d-orange);
}

.profile-avatar-meta {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  font-size: 0.78rem;
  color: var(--d-muted);
}

.profile-role-badge {
  display: inline-block;
  padding: 0.15rem 0.55rem;
  border-radius: 99px;
  background: rgba(252, 76, 2, 0.1);
  color: var(--d-orange);
  font-size: 0.72rem;
  font-weight: 700;
  letter-spacing: 0.02em;
}

/* ── Race goal card ── */
.profile-race-card {
  display: flex;
  flex-direction: column;
  gap: 0.6rem;
}

.profile-race-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.profile-race-header h3 {
  font-size: 0.85rem;
  font-weight: 700;
  color: var(--d-text);
  margin: 0;
}

.profile-race-edit-btn {
  background: none;
  border: none;
  cursor: pointer;
  color: var(--d-muted);
  font-size: 0.78rem;
  padding: 0;
  text-decoration: underline;
}

.profile-race-edit-btn:hover {
  color: var(--d-orange);
}

.profile-race-countdown {
  display: inline-flex;
  align-items: center;
  gap: 0.35rem;
  padding: 0.2rem 0.65rem;
  border-radius: 99px;
  background: rgba(252, 76, 2, 0.1);
  color: var(--d-orange);
  font-size: 0.78rem;
  font-weight: 700;
  width: fit-content;
}

.profile-race-countdown.urgent {
  background: rgba(252, 76, 2, 0.18);
}

.profile-race-countdown.past {
  background: var(--d-border-light);
  color: var(--d-muted);
}

.profile-race-details {
  display: flex;
  flex-direction: column;
  gap: 0.25rem;
}

.profile-race-row {
  display: flex;
  justify-content: space-between;
  align-items: center;
  font-size: 0.82rem;
}

.profile-race-row span:first-child {
  color: var(--d-muted);
}

.profile-race-row span:last-child {
  font-weight: 600;
  color: var(--d-text);
}

.profile-race-empty {
  font-size: 0.82rem;
  color: var(--d-muted);
}

.profile-race-empty a {
  color: var(--d-orange);
  text-decoration: none;
}

.profile-race-empty a:hover {
  text-decoration: underline;
}

/* ── Stats card ── */
.profile-stats-card {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
}

.profile-stat-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0.35rem 0;
  border-bottom: 1px solid var(--d-border-light);
  font-size: 0.82rem;
}

.profile-stat-row:last-child {
  border-bottom: none;
}

.profile-stat-label {
  color: var(--d-muted);
}

.profile-stat-value {
  font-weight: 700;
  color: var(--d-text);
}

.profile-stat-skeleton {
  height: 0.75rem;
  border-radius: 4px;
  background: var(--d-border-light);
  width: 3rem;
  animation: shimmer 1.2s ease-in-out infinite;
}

@keyframes shimmer {
  0%, 100% { opacity: 0.5; }
  50% { opacity: 1; }
}

/* ── Strava card ── */
.profile-strava-card {
  display: flex;
  flex-direction: column;
  gap: 0.6rem;
}

.profile-strava-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.profile-strava-header h3 {
  font-size: 0.85rem;
  font-weight: 700;
  color: var(--d-text);
  margin: 0;
}

.profile-strava-badge {
  font-size: 0.72rem;
  font-weight: 700;
  padding: 0.15rem 0.5rem;
  border-radius: 99px;
}

.profile-strava-badge.connected {
  background: rgba(15, 138, 71, 0.1);
  color: var(--d-green);
}

.profile-strava-badge.disconnected {
  background: var(--d-border-light);
  color: var(--d-muted);
}

.profile-strava-meta {
  display: flex;
  flex-direction: column;
  gap: 0.2rem;
  font-size: 0.78rem;
  color: var(--d-muted);
}

.profile-strava-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 0.5rem;
}

.profile-integration-status {
  font-size: 0.78rem;
  color: var(--d-muted);
  margin-top: 0.25rem;
}

/* ── Right column ── */
.profile-settings-col {
  display: flex;
  flex-direction: column;
  gap: 1.25rem;
}

.profile-section-title {
  font-size: 0.78rem;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  color: var(--d-muted);
  margin: 0 0 0.75rem;
}

/* Personal section */
.profile-personal-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 0.75rem;
}

@media (max-width: 480px) {
  .profile-personal-grid {
    grid-template-columns: 1fr;
  }
}

.profile-units-toggle {
  display: flex;
  border: 1px solid var(--d-border);
  border-radius: 6px;
  overflow: hidden;
}

.profile-units-toggle button {
  flex: 1;
  padding: 0.45rem;
  border: none;
  background: none;
  cursor: pointer;
  font-size: 0.82rem;
  font-weight: 600;
  color: var(--d-muted);
  transition: background 0.15s, color 0.15s;
}

.profile-units-toggle button.active {
  background: var(--d-orange);
  color: #fff;
}

/* Inline save feedback */
.profile-save-tick {
  font-size: 0.75rem;
  color: var(--d-green);
  margin-left: 0.5rem;
}

/* Page header */
.profile-page-header {
  margin-bottom: 0.25rem;
}

.profile-page-header h1 {
  font-size: 1.3rem;
  font-weight: 800;
  color: var(--d-text);
  margin: 0 0 0.25rem;
}

.profile-page-header p {
  font-size: 0.82rem;
  color: var(--d-muted);
  margin: 0;
}
```

**Step 2: Verify no lint errors**

Run: `npm run lint`
Expected: clean

**Step 3: Commit**

```bash
git add src/app/profile/profile.css
git commit -m "feat: add profile.css for two-column layout"
```

---

## Task 3: Rewrite `profile/page.tsx`

**Files:**
- Modify: `src/app/profile/page.tsx` (full rewrite)

This is the main task. The new page preserves all existing logic (pace calculator, Strava connect/sync/disconnect, coach link save) and adds the new left column identity cards.

**Step 1: Replace the file**

```tsx
'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import StravaConnectButton from '@/components/StravaConnectButton';
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

// ── Helpers ────────────────────────────────────────────────────────────────────

function formatDate(value: string | null | undefined) {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
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
    } catch {
      setIntegrationStatus('Failed to disconnect Strava');
    } finally {
      setBusyProvider(null);
    }
  }

  // ── Render ────────────────────────────────────────────────────────────────────

  const initial = name.trim() ? name.trim()[0].toUpperCase() : '?';
  const memberSince = formatMonthYear(createdAt);

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
                    <button className="cta secondary" type="button" onClick={disconnectStrava} disabled={busyProvider === 'STRAVA'}>
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

          </div>
        </div>
      </div>
    </main>
  );
}
```

**Step 2: Verify typecheck passes**

Run: `npm run typecheck`
Expected: no errors

**Step 3: Verify lint passes**

Run: `npm run lint`
Expected: clean

**Step 4: Commit**

```bash
git add src/app/profile/page.tsx
git commit -m "feat: redesign profile page with two-column identity + settings layout

- Left column: avatar card (name, email, member since, role badge),
  race goal card (countdown, distance, target time/pace),
  training stats card (plans, sessions, active weeks — async),
  Strava card (connected since, last sync, connect/sync/disconnect)
- Right column: personal (name on-blur save, units toggle),
  pace zones + race date, coach link
- New /api/me/stats powers the training stats card
- All data loaded in parallel on mount
- No schema changes"
```

---

## Task 4: Verify in browser

**Step 1: Start dev server**

Run: `npm run dev`

**Step 2: Navigate to `/profile`**

Check:
- [ ] Two-column layout renders on desktop
- [ ] Avatar initial shows (first letter of name, orange circle)
- [ ] Email, member since, role badge visible
- [ ] Race goal card: shows countdown and race details if a goal is set, or "Set one →" if not
- [ ] Training stats load with skeleton then real numbers
- [ ] Strava card shows connected/disconnected state correctly, "Connected since" date visible
- [ ] Name saves on blur (tick appears briefly)
- [ ] Units toggle switches and persists on reload
- [ ] Calculate zones + Save pace zones work
- [ ] Coach dropdown works
- [ ] On mobile (≤768px): columns stack correctly

**Step 3: Commit if all good**

```bash
git add -p  # any fixups
git commit -m "fix: profile page browser verification fixups" # only if needed
```

---

## Task 5: Push

```bash
git push origin main
```
