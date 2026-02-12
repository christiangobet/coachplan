'use client';

import { SignedIn, SignedOut, useUser } from '@clerk/nextjs';
import { useState } from 'react';

export default function UploadPage() {
  const { user } = useUser();
  const [name, setName] = useState('');
  const [raceDate, setRaceDate] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [status, setStatus] = useState<'idle' | 'saving' | 'error'>('idle');
  const [message, setMessage] = useState('');

  const handleSubmit = async () => {
    if (!name.trim()) {
      setStatus('error');
      setMessage('Please add a plan name.');
      return;
    }
    setStatus('saving');
    setMessage('');
    try {
      const form = new FormData();
      form.append('name', name.trim());
      if (raceDate) form.append('raceDate', raceDate);
      if (file) form.append('file', file);

      const res = await fetch('/api/plans', {
        method: 'POST',
        body: form
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || 'Upload failed');
      if (data?.plan?.id) {
        if (file) {
          window.location.href = `/plans/${data.plan.id}/review`;
        } else {
          window.location.href = `/plans/${data.plan.id}`;
        }
      }
    } catch (err: any) {
      setStatus('error');
      setMessage(err?.message || 'Upload failed');
    } finally {
      setStatus('idle');
    }
  };

  return (
    <main>
      <section className="card white">
        <div className="section-title">
          <h1>Upload training plan</h1>
        </div>
        <p className="muted">
          Upload a PDF and align it to your race weekend. We’ll parse weeks and workouts automatically.
        </p>
      </section>

      <section className="container" style={{ marginTop: 24 }}>
        <SignedOut>
          <div className="card">
            <div className="section-title">
              <h3>Sign in required</h3>
            </div>
            <p className="muted">Please sign in to upload and manage plans.</p>
            <div style={{ marginTop: 12 }}>
              <a className="cta" href="/sign-in">Sign in</a>
            </div>
          </div>
        </SignedOut>

        <SignedIn>
          <div className="grid-2">
            <div className="card">
              <div className="section-title">
                <h3>Plan details</h3>
              </div>
              <div className="form-stack">
                <div className="muted">
                  Signed in as: {user?.primaryEmailAddress?.emailAddress || 'Unknown'}
                </div>
                <label>
                  Plan name
                  <input
                    type="text"
                    placeholder="Half Marathon 2026"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                  />
                </label>
                <label>
                  Race date
                  <input
                    type="date"
                    value={raceDate}
                    onChange={(e) => setRaceDate(e.target.value)}
                  />
                </label>
                <label>
                  Upload PDF
                  <input
                    type="file"
                    accept="application/pdf"
                    onChange={(e) => setFile(e.target.files?.[0] || null)}
                  />
                </label>
              </div>
              <div style={{ marginTop: 12 }}>
                <button className="cta" onClick={handleSubmit} disabled={status === 'saving'}>
                  {status === 'saving' ? 'Uploading…' : 'Upload and parse'}
                </button>
              </div>
              {message && (
                <p className="muted" style={{ marginTop: 10, color: '#b42318' }}>{message}</p>
              )}
            </div>
            <div className="card">
              <div className="section-title">
                <h3>How it works</h3>
              </div>
              <p className="muted">1. Upload PDF</p>
              <p className="muted">2. Review weeks & workouts</p>
              <p className="muted">3. Publish and start logging</p>
            </div>
          </div>
        </SignedIn>
      </section>
    </main>
  );
}
