'use client';

import { useEffect, useState } from 'react';

type Coach = { id: string; name: string; email: string };

type PaceTargets = {
  easy?: string;
  tempo?: string;
};

export default function ProfilePage() {
  const [name, setName] = useState('');
  const [units, setUnits] = useState<'MILES' | 'KM'>('MILES');
  const [goalRaceDate, setGoalRaceDate] = useState('');
  const [paceTargets, setPaceTargets] = useState<PaceTargets>({});
  const [role, setRole] = useState<'ATHLETE' | 'COACH'>('ATHLETE');
  const [coaches, setCoaches] = useState<Coach[]>([]);
  const [selectedCoach, setSelectedCoach] = useState('');
  const [status, setStatus] = useState<string | null>(null);

  useEffect(() => {
    fetch('/api/me')
      .then((res) => res.json())
      .then((data) => {
        if (data?.name) setName(data.name);
        if (data?.units) setUnits(data.units);
        if (data?.goalRaceDate) setGoalRaceDate(data.goalRaceDate.slice(0, 10));
        if (data?.paceTargets) setPaceTargets(data.paceTargets);
        if (data?.role) setRole(data.role);
      });

    fetch('/api/coaches')
      .then((res) => res.json())
      .then((data) => setCoaches(data.coaches || []));
  }, []);

  async function saveProfile() {
    setStatus('Saving...');
    await fetch('/api/me', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, units, goalRaceDate, paceTargets, role })
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

  return (
    <main>
      <section className="card white">
        <div className="section-title">
          <h1>Profile setup</h1>
        </div>
        <p className="muted">Tell us how you train so we can personalize your plan.</p>
      </section>

      <section className="container" style={{ marginTop: 24 }}>
        <div className="grid-2">
          <div className="card">
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
                Goal race date
                <input type="date" value={goalRaceDate} onChange={(e) => setGoalRaceDate(e.target.value)} />
              </label>
            </div>
          </div>

          <div className="card">
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
        </div>

        {role === 'ATHLETE' && (
          <div className="card">
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
          </div>
        )}

        <div style={{ marginTop: 16, display: 'flex', gap: 12, alignItems: 'center' }}>
          <button className="cta" onClick={saveProfile}>Save profile</button>
          {status && <span className="muted">{status}</span>}
        </div>
      </section>
    </main>
  );
}
