'use client';

import { useEffect, useMemo, useState } from 'react';
import StravaConnectButton from '@/components/StravaConnectButton';

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
  return date.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric'
  });
}

export default function StravaSyncPanel({ compact = false }: { compact?: boolean }) {
  const [accounts, setAccounts] = useState<IntegrationAccount[]>([]);
  const [capability, setCapability] = useState<IntegrationCapability>({
    stravaConfigured: false,
    garminConfigured: false
  });
  const [status, setStatus] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const strava = useMemo(
    () => accounts.find((account) => account.provider === 'STRAVA') || null,
    [accounts]
  );

  async function load() {
    try {
      const res = await fetch('/api/integrations/accounts');
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setStatus(data?.error || 'Failed to load sync status');
        return;
      }
      setAccounts(data.accounts || []);
      setCapability({
        stravaConfigured: Boolean(data?.capability?.stravaConfigured),
        garminConfigured: Boolean(data?.capability?.garminConfigured)
      });
    } catch {
      setStatus('Failed to load sync status');
    }
  }

  useEffect(() => {
    load();
  }, []);

  async function connectStrava() {
    if (!capability.stravaConfigured) {
      setStatus('Strava is not configured on this server');
      return;
    }
    setBusy(true);
    setStatus('Redirecting to Strava...');
    try {
      const res = await fetch('/api/integrations/strava/connect', { method: 'POST' });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data?.url) {
        setStatus(data?.error || 'Failed to start Strava connect');
        setBusy(false);
        return;
      }
      window.location.href = data.url;
    } catch {
      setStatus('Failed to start Strava connect');
      setBusy(false);
    }
  }

  async function syncNow() {
    setBusy(true);
    setStatus('Syncing Strava from plan start to today...');
    try {
      const res = await fetch('/api/integrations/strava/sync', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ syncFromPlanStart: true })
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setStatus(data?.error || 'Sync failed');
        return;
      }
      const summary = data?.summary;
      const truncatedNote = summary?.truncated ? ' (partial window; rerun sync)' : '';
      setStatus(
        `Synced: ${summary?.imported ?? 0} imported, ${summary?.matched ?? 0} matched, ${summary?.workoutsUpdated ?? 0} updated${truncatedNote}`
      );
      await load();
    } catch {
      setStatus('Sync failed');
    } finally {
      setBusy(false);
    }
  }

  async function disconnectStrava() {
    setBusy(true);
    setStatus('Disconnecting Strava...');
    try {
      const res = await fetch('/api/integrations/accounts/STRAVA', { method: 'DELETE' });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setStatus(data?.error || 'Disconnect failed');
        return;
      }
      if (data?.revokedAtStrava === false) {
        setStatus('Disconnected locally. Strava revoke may need retry.');
      } else {
        setStatus('Strava disconnected');
      }
      await load();
    } catch {
      setStatus('Disconnect failed');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className={`dash-card dash-sync-card${compact ? ' compact' : ''}`}>
      <div className="dash-card-header">
        <span className="dash-card-title">Strava Sync</span>
        <span className={`dash-sync-state ${strava?.connected ? 'connected' : 'disconnected'}`}>
          {strava?.connected ? 'Connected' : 'Not connected'}
        </span>
      </div>

      <div className="dash-sync-meta">
        <span>Athlete: {strava?.providerUsername || 'Not linked'}</span>
        <span>Last sync: {formatDate(strava?.lastSyncAt)}</span>
      </div>

      <div className="dash-sync-actions">
        <StravaConnectButton
          className="dash-sync-btn"
          onClick={connectStrava}
          disabled={busy}
          reconnect={Boolean(strava?.connected)}
        />
        <button
          className="dash-sync-btn"
          type="button"
          onClick={syncNow}
          disabled={!strava?.connected || busy}
        >
          Sync now
        </button>
        <button
          className="dash-sync-btn"
          type="button"
          onClick={disconnectStrava}
          disabled={!strava?.connected || busy}
        >
          Disconnect
        </button>
      </div>

      {!capability.stravaConfigured && (
        <p className="dash-sync-note">Set STRAVA_CLIENT_ID and STRAVA_CLIENT_SECRET in .env</p>
      )}
      {status && <p className="dash-sync-note">{status}</p>}
    </div>
  );
}
