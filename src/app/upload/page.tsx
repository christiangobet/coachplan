'use client';

import Link from 'next/link';
import { SignedIn, SignedOut, useUser } from '@clerk/nextjs';
import { useEffect, useMemo, useState } from 'react';
import AthleteSidebar from '@/components/AthleteSidebar';
import '../dashboard/dashboard.css';
import '../athlete-pages.css';

const UPLOAD_STAGES = [
  {
    afterMs: 0,
    title: 'Uploading plan file',
    detail: 'Sending your PDF securely.'
  },
  {
    afterMs: 4000,
    title: 'Extracting workout text',
    detail: 'Reading page structure and week labels.'
  },
  {
    afterMs: 12000,
    title: 'Structuring weeks and sessions',
    detail: 'Converting text into training days and activities.'
  },
  {
    afterMs: 22000,
    title: 'Scoring parse quality',
    detail: 'Checking confidence and preparing fallback if needed.'
  },
  {
    afterMs: 35000,
    title: 'Finalizing review workspace',
    detail: 'Preparing editable plan details before activation.'
  }
] as const;

export default function UploadPage() {
  const { user } = useUser();
  const [name, setName] = useState('');
  const [raceName, setRaceName] = useState('');
  const [raceDate, setRaceDate] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [status, setStatus] = useState<'idle' | 'saving' | 'error'>('idle');
  const [message, setMessage] = useState('');
  const [uploadStartedAt, setUploadStartedAt] = useState<number | null>(null);
  const [elapsedSec, setElapsedSec] = useState(0);
  const [stageIndex, setStageIndex] = useState(0);

  const deriveNameFromFile = (filename: string) =>
    filename.replace(/\.[^.]+$/, '').replace(/[_-]+/g, ' ').replace(/\s+/g, ' ').trim();

  useEffect(() => {
    if (status !== 'saving') {
      setStageIndex(0);
      return;
    }
    setStageIndex(0);
    const timers = UPLOAD_STAGES.slice(1).map((stage, index) => (
      window.setTimeout(() => setStageIndex(index + 1), stage.afterMs)
    ));
    return () => timers.forEach((timer) => window.clearTimeout(timer));
  }, [status]);

  useEffect(() => {
    if (status !== 'saving' || !uploadStartedAt) {
      setElapsedSec(0);
      return;
    }
    const interval = window.setInterval(() => {
      setElapsedSec(Math.floor((Date.now() - uploadStartedAt) / 1000));
    }, 1000);
    return () => window.clearInterval(interval);
  }, [status, uploadStartedAt]);

  const stage = UPLOAD_STAGES[Math.min(stageIndex, UPLOAD_STAGES.length - 1)];
  const stageProgress = Math.min(92, Math.round(((stageIndex + 1) / UPLOAD_STAGES.length) * 100));
  const timeHint = useMemo(() => {
    if (elapsedSec >= 90) return 'Still working. Complex PDFs can take up to 4 minutes.';
    if (elapsedSec >= 30) return 'Still parsing. Thanks for waiting.';
    return 'Most plans finish in under a minute.';
  }, [elapsedSec]);

  const handleSubmit = async () => {
    if (!name.trim()) {
      setStatus('error');
      setMessage('Please add a plan name.');
      return;
    }
    setStatus('saving');
    setMessage('');
    setUploadStartedAt(Date.now());
    setElapsedSec(0);
    try {
      const controller = new AbortController();
      const timeoutId = window.setTimeout(() => controller.abort(), 240000);
      const form = new FormData();
      form.append('name', name.trim());
      if (raceName.trim()) form.append('raceName', raceName.trim());
      if (raceDate) form.append('raceDate', raceDate);
      if (file) form.append('file', file);

      const res = await fetch('/api/plans', {
        method: 'POST',
        body: form,
        signal: controller.signal
      });
      window.clearTimeout(timeoutId);
      const data = await res.json();
      if (!res.ok) {
        const details = data?.details ? `: ${data.details}` : '';
        throw new Error((data?.error || 'Upload failed') + details);
      }
      if (data?.plan?.id) {
        if (file) {
          const parseWarning = typeof data?.parseWarning === 'string' ? data.parseWarning : '';
          const parseParams = parseWarning
            ? `&parseWarning=1&parseWarningMsg=${encodeURIComponent(parseWarning.slice(0, 220))}`
            : '';
          window.location.href = `/plans/${data.plan.id}/review?fromUpload=1${parseParams}`;
        } else {
          window.location.href = `/plans/${data.plan.id}`;
        }
      }
    } catch (err: unknown) {
      setStatus('error');
      if (err instanceof DOMException && err.name === 'AbortError') {
        setMessage('Upload timed out. Please try again or use a smaller/simpler PDF.');
      } else {
        setMessage(err instanceof Error ? err.message : 'Upload failed');
      }
    } finally {
      setStatus('idle');
      setUploadStartedAt(null);
    }
  };

  const sidebarName = user?.fullName || user?.firstName || 'Athlete';

  return (
    <main className="dash athlete-page-shell">
      <div className="dash-grid">
        <AthleteSidebar active="upload" name={sidebarName} />

        <section className="dash-center">
          <section className="dash-card athlete-page-header upload-header">
            <h1>Upload Training Plan</h1>
            <p className="muted">
              Upload a PDF and align it to your race weekend. We&apos;ll parse weeks and workouts automatically.
            </p>
          </section>

          <SignedOut>
            <div className="dash-card athlete-page-card">
              <div className="section-title">
                <h3>Sign in required</h3>
              </div>
              <p className="muted">Please sign in to upload and manage plans.</p>
              <div style={{ marginTop: 12 }}>
                <Link className="cta" href="/sign-in">Sign in</Link>
              </div>
            </div>
          </SignedOut>

          <SignedIn>
            <div className="grid-2 athlete-form-grid upload-form-grid">
              <div className="dash-card athlete-page-card upload-main-card">
                <div className="section-title">
                  <h3>Plan Details</h3>
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
                    Race name
                    <input
                      type="text"
                      placeholder="New York City Marathon"
                      value={raceName}
                      onChange={(e) => setRaceName(e.target.value)}
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
                    <div className="upload-dropzone">
                      <p>Drag and drop your PDF here, or click to browse.</p>
                      <input
                        type="file"
                        accept="application/pdf"
                        onChange={(e) => {
                          const picked = e.target.files?.[0] || null;
                          setFile(picked);
                          if (picked?.name) {
                            const fileBasedName = deriveNameFromFile(picked.name);
                            if (fileBasedName) setName(fileBasedName);
                          }
                        }}
                      />
                    </div>
                    {file?.name && <span className="upload-file-name">{file.name}</span>}
                  </label>
                </div>
                <div style={{ marginTop: 12 }}>
                  <button className="cta" onClick={handleSubmit} disabled={status === 'saving'}>
                    {status === 'saving' ? 'Uploading…' : 'Upload and parse'}
                  </button>
                </div>
                {status === 'saving' && (
                  <div className="upload-progress-card" role="status" aria-live="polite">
                    <div className="upload-progress-head">
                      <strong>{stage.title}</strong>
                      <span>{stageProgress}%</span>
                    </div>
                    <p>{stage.detail}</p>
                    <div className="upload-progress-track" aria-hidden="true">
                      <div className="upload-progress-fill" style={{ width: `${stageProgress}%` }} />
                    </div>
                    <p className="upload-progress-meta">
                      Elapsed: {elapsedSec}s · {timeHint}
                    </p>
                  </div>
                )}
                {message && (
                  <p className="muted" style={{ marginTop: 10, color: status === 'error' ? '#b42318' : undefined }}>
                    {message}
                  </p>
                )}
              </div>

              <div className="dash-card athlete-page-card">
                <div className="section-title">
                  <h3>How it works</h3>
                </div>
                <p className="muted">1. Upload PDF</p>
                <p className="muted">2. Review weeks and workouts</p>
                <p className="muted">3. Publish and start logging</p>
              </div>
            </div>
          </SignedIn>
        </section>

        <aside className="dash-right">
          <div className="dash-card athlete-right-card">
            <div className="dash-card-header">
              <span className="dash-card-title">Next Steps</span>
            </div>
            <div className="athlete-link-list">
              <Link href="/plans">Review assigned plans</Link>
              <Link href="/dashboard">Start today workout</Link>
              <Link href="/profile">Set pace targets</Link>
            </div>
          </div>

          <div className="dash-card athlete-right-card">
            <div className="dash-card-header">
              <span className="dash-card-title">File Tips</span>
            </div>
            <div className="athlete-summary-list">
              <div>
                <strong>Format</strong>
                <span>Use a clear PDF export from your coach or platform.</span>
              </div>
              <div>
                <strong>Week labels</strong>
                <span>Include week/day headings for better parsing accuracy.</span>
              </div>
              <div>
                <strong>After upload</strong>
                <span>Review and confirm parsed workouts before publishing.</span>
              </div>
            </div>
          </div>
        </aside>
      </div>
    </main>
  );
}
