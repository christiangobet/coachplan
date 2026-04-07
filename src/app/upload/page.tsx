'use client';

import Link from 'next/link';
import { SignedIn, SignedOut, useUser } from '@clerk/nextjs';
import { useEffect, useMemo, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

import AthleteSidebar from '@/components/AthleteSidebar';
import UploadFlowStepper from '@/components/UploadFlowStepper';
import { getFirstName } from '@/lib/display-name';
import '../dashboard/dashboard.css';
import '../athlete-pages.css';

const CLIENT_UPLOAD_START_TIMEOUT_MS = 30000;
const UPLOAD_FLOW_STEPS = [
  {
    title: 'Upload PDF',
    detail: 'Submit your source plan file to create a draft.'
  },
  {
    title: 'Parse Draft',
    detail: 'MyTrainingPlan extracts weeks, days, and sessions.'
  },
  {
    title: 'Review and Correct',
    detail: 'Validate details and adjust activities before activation.'
  },
  {
    title: 'Activate Schedule',
    detail: 'Choose race-date alignment or a training start date (Week 1).'
  },
  {
    title: 'Start Logging',
    detail: 'Calendar dates are applied and day-by-day tracking starts.'
  }
] as const;

const UPLOAD_STAGE_META = {
  queued: {
    title: 'Upload queued',
    detail: 'Creating your draft plan and preparing the background parser.',
    progress: 10,
  },
  extracting_markdown: {
    title: 'Extracting markdown',
    detail: 'Reading the PDF and turning it into structured markdown.',
    progress: 35,
  },
  markdown_available: {
    title: 'Markdown ready',
    detail: 'The extracted markdown is available below while final parsing continues.',
    progress: 55,
  },
  parsing_markdown: {
    title: 'Parsing markdown into plan data',
    detail: 'Building weeks, days, and activities from the extracted markdown.',
    progress: 78,
  },
  persisting_plan: {
    title: 'Saving review workspace',
    detail: 'Writing the parsed plan into your editable draft.',
    progress: 92,
  },
  completed: {
    title: 'Plan ready',
    detail: 'Opening the review workspace now.',
    progress: 100,
  },
  failed: {
    title: 'Parsing paused',
    detail: 'The markdown preview is preserved below even though final plan persistence failed.',
    progress: 100,
  },
} as const;

type UploadStage = keyof typeof UPLOAD_STAGE_META;
type UploadViewStatus = 'idle' | 'starting' | 'processing' | 'completed' | 'failed';

const STAGE_ORDER: Exclude<UploadStage, 'failed'>[] = [
  'queued',
  'extracting_markdown',
  'markdown_available',
  'parsing_markdown',
  'persisting_plan',
  'completed',
];

const STAGE_CHECKLIST_LABELS: Record<Exclude<UploadStage, 'failed'>, string> = {
  queued: 'Creating draft plan',
  extracting_markdown: 'Reading PDF and extracting markdown',
  markdown_available: 'Markdown extracted',
  parsing_markdown: 'Parsing weeks, days, and sessions',
  persisting_plan: 'Saving parsed plan',
  completed: 'Ready to review',
};

type UploadStatusResponse = {
  uploadId: string;
  planId: string | null;
  status: 'processing' | 'completed' | 'failed';
  stage: UploadStage;
  failureReason: string | null;
  hasExtractedMd: boolean;
  extractedMdAvailable: boolean;
  extractedMdPreview: string | null;
  completedPlanId: string | null;
  weekCount: number | null;
  sessionCount: number | null;
};

function humanizeFailureReason(reason: string | null) {
  switch (reason) {
    case 'markdown_program_missing':
      return 'The markdown was extracted, but the structured plan could not be completed yet.';
    case 'markdown_program_invalid':
      return 'The markdown parse returned invalid plan data.';
    case 'extracted_md_missing':
      return 'The parser never produced extracted markdown for this upload.';
    case 'vision_not_enabled':
      return 'Vision extraction is not enabled for this environment.';
    case 'extracted_md_not_attempted':
      return 'Markdown extraction was not attempted for this upload.';
    case 'source_document_missing':
      return 'The uploaded PDF could not be found for background processing.';
    default:
      return reason ? reason.replace(/_/g, ' ') : 'Upload failed';
  }
}

export default function UploadPage() {
  const router = useRouter();
  const { user } = useUser();
  const searchParams = useSearchParams();
  const debugMode = searchParams?.get('debug') === '1';
  const [name, setName] = useState('');
  const [raceName, setRaceName] = useState('');
  const [raceDate, setRaceDate] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [status, setStatus] = useState<UploadViewStatus>('idle');
  const [message, setMessage] = useState('');
  const [uploadStartedAt, setUploadStartedAt] = useState<number | null>(null);
  const [elapsedSec, setElapsedSec] = useState(0);
  const [uploadId, setUploadId] = useState<string | null>(null);
  const [planId, setPlanId] = useState<string | null>(null);
  const [uploadStage, setUploadStage] = useState<UploadStage>('queued');
  const [failureReason, setFailureReason] = useState<string | null>(null);
  const [extractedMdAvailable, setExtractedMdAvailable] = useState(false);
  const [extractedMd, setExtractedMd] = useState<string | null>(null);
  const [extractedMdLoading, setExtractedMdLoading] = useState(false);
  const [weekCount, setWeekCount] = useState<number | null>(null);
  const [sessionCount, setSessionCount] = useState<number | null>(null);

  const deriveNameFromFile = (filename: string) =>
    filename.replace(/\.[^.]+$/, '').replace(/[_-]+/g, ' ').replace(/\s+/g, ' ').trim();

  // Resume polling if the page is refreshed mid-upload
  useEffect(() => {
    const saved = sessionStorage.getItem('coachplan_upload_id');
    if (saved) {
      setUploadId(saved);
      setStatus('processing');
    }
  }, []);

  useEffect(() => {
    if (!uploadStartedAt || (status !== 'starting' && status !== 'processing')) {
      setElapsedSec(0);
      return;
    }
    const interval = window.setInterval(() => {
      setElapsedSec(Math.floor((Date.now() - uploadStartedAt) / 1000));
    }, 1000);
    return () => window.clearInterval(interval);
  }, [status, uploadStartedAt]);

  useEffect(() => {
    if (!uploadId || (status !== 'starting' && status !== 'processing')) {
      return;
    }

    let cancelled = false;
    let nextPoll: number | null = null;

    const poll = async () => {
      try {
        const res = await fetch(`/api/plans/uploads/${uploadId}/status`, { cache: 'no-store' });
        const data = await res.json() as Partial<UploadStatusResponse> & { error?: string };
        if (!res.ok) {
          throw new Error(data?.error || 'Failed to load upload progress');
        }
        if (cancelled) return;

        const nextStage = (data.stage || 'queued') as UploadStage;
        setPlanId(data.planId || planId || null);
        setUploadStage(nextStage);
        setFailureReason(data.failureReason || null);
        setExtractedMdAvailable(Boolean(data.extractedMdAvailable));
        if (data.weekCount != null) setWeekCount(data.weekCount);
        if (data.sessionCount != null) setSessionCount(data.sessionCount);

        if (data.status === 'completed') {
          sessionStorage.removeItem('coachplan_upload_id');
          setStatus('completed');
          const completedPlanId = data.completedPlanId || data.planId;
          if (completedPlanId) {
            router.push(`/plans/${completedPlanId}/review?fromUpload=1${debugMode ? '&debug=1' : ''}`);
          }
          return;
        }

        if (data.status === 'failed') {
          sessionStorage.removeItem('coachplan_upload_id');
          setStatus('failed');
          setMessage(humanizeFailureReason(data.failureReason || null));
          return;
        }

        setStatus('processing');
        nextPoll = window.setTimeout(poll, nextStage === 'queued' ? 1500 : 3000);
      } catch (err) {
        if (cancelled) return;
        sessionStorage.removeItem('coachplan_upload_id');
        setStatus('failed');
        setMessage(err instanceof Error ? err.message : 'Failed to monitor upload progress');
      }
    };

    void poll();

    return () => {
      cancelled = true;
      if (nextPoll) window.clearTimeout(nextPoll);
    };
  }, [debugMode, planId, status, uploadId]);

  useEffect(() => {
    if (!uploadId || !extractedMdAvailable || extractedMd || extractedMdLoading) return;

    let cancelled = false;
    setExtractedMdLoading(true);

    void fetch(`/api/plans/uploads/${uploadId}/extracted-md`, { cache: 'no-store' })
      .then(async (res) => {
        const data = await res.json();
        if (!res.ok) {
          throw new Error(data?.error || 'Failed to load extracted markdown');
        }
        if (!cancelled) {
          setExtractedMd(typeof data?.extractedMd === 'string' ? data.extractedMd : null);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setExtractedMd(null);
        }
      })
      .finally(() => {
        if (!cancelled) {
          setExtractedMdLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [extractedMd, extractedMdAvailable, extractedMdLoading, uploadId]);

  const stageMeta = UPLOAD_STAGE_META[uploadStage];
  const stageProgress = stageMeta.progress;
  const isWorking = status === 'starting' || status === 'processing';
  const flowActiveStep = isWorking || status === 'completed' || status === 'failed' ? 2 : 1;
  const timeHint = useMemo(() => {
    if (uploadStage === 'extracting_markdown') return 'Vision extraction can take a couple of minutes on long PDFs.';
    if (uploadStage === 'parsing_markdown') return 'The parser is now turning the markdown into weeks, days, and activities.';
    if (uploadStage === 'markdown_available') return 'You can already inspect the extracted markdown below while parsing continues.';
    if (elapsedSec >= 30) return 'Still parsing. Thanks for waiting.';
    return 'The draft is processing in the background.';
  }, [elapsedSec, uploadStage]);

  const handleSubmit = async () => {
    if (!name.trim()) {
      setStatus('failed');
      setMessage('Please add a plan name.');
      return;
    }
    if (!file) {
      setStatus('failed');
      setMessage('Please choose a PDF to upload.');
      return;
    }

    setStatus('starting');
    setMessage('');
    setUploadStartedAt(Date.now());
    setElapsedSec(0);
    setUploadId(null);
    setPlanId(null);
    setUploadStage('queued');
    setFailureReason(null);
    setExtractedMdAvailable(false);
    setExtractedMd(null);
    setWeekCount(null);
    setSessionCount(null);

    let timeoutId: number | null = null;
    try {
      const controller = new AbortController();
      timeoutId = window.setTimeout(() => controller.abort(), CLIENT_UPLOAD_START_TIMEOUT_MS);
      const form = new FormData();
      form.append('name', name.trim());
      if (raceName.trim()) form.append('raceName', raceName.trim());
      if (raceDate) form.append('raceDate', raceDate);
      form.append('file', file);

      const res = await fetch('/api/plans/upload-start', {
        method: 'POST',
        body: form,
        signal: controller.signal
      });
      const data = await res.json();
      if (!res.ok) {
        const details = data?.details ? `: ${data.details}` : '';
        throw new Error((data?.error || 'Upload failed') + details);
      }
      if (!data?.uploadId || !data?.planId) {
        throw new Error('Upload started but no upload tracking info was returned. Please retry.');
      }

      const newUploadId = String(data.uploadId);
      sessionStorage.setItem('coachplan_upload_id', newUploadId);
      setUploadId(newUploadId);
      setPlanId(String(data.planId));
      setUploadStage((data.stage || 'queued') as UploadStage);
      setStatus('processing');
    } catch (err: unknown) {
      setStatus('failed');
      if (err instanceof DOMException && err.name === 'AbortError') {
        setMessage('Upload start timed out before background processing was queued. Please retry.');
      } else {
        setMessage(err instanceof Error ? err.message : 'Upload failed');
      }
    } finally {
      if (timeoutId) window.clearTimeout(timeoutId);
    }
  };

  const sidebarName = getFirstName(user?.fullName || user?.firstName || 'Athlete');

  return (
    <main className="dash athlete-page-shell">
      <div className="dash-grid">
        <AthleteSidebar active="plans" name={sidebarName} />

        <section className="dash-center">
          <section className="dash-card athlete-page-header upload-header">
            <h1>Upload Training Plan</h1>
            <p className="muted">
              Upload a PDF to create a draft. You will choose scheduling mode at activation:
              race date alignment or training start date (Week 1).
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
                    <span>Race date (optional)</span>
                    <input
                      type="date"
                      value={raceDate}
                      onChange={(e) => setRaceDate(e.target.value)}
                    />
                    <span className="upload-field-hint">
                      Used to prefill activation scheduling if you choose race-date alignment.
                    </span>
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
                    Plan name
                    <input
                      type="text"
                      placeholder="Half Marathon 2026"
                      value={name}
                      onChange={(e) => setName(e.target.value)}
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
                  <button className="cta" onClick={handleSubmit} disabled={isWorking}>
                    {isWorking ? 'Uploading…' : 'Upload and parse'}
                  </button>
                </div>
                {(isWorking || status === 'failed') && (
                  <div className="upload-progress-card" role="status" aria-live="polite">
                    <div className="upload-progress-head">
                      <strong>{stageMeta.title}</strong>
                      <span>{status === 'failed' ? 'Paused' : `${stageProgress}%`}</span>
                    </div>
                    <div className="upload-progress-track" aria-hidden="true">
                      <div
                        className={`upload-progress-fill${isWorking && uploadStage !== 'completed' ? ' indeterminate' : ''}`}
                        style={uploadStage === 'completed' ? { width: '100%' } : undefined}
                      />
                    </div>

                    {/* Stage checklist */}
                    <ol className="upload-stage-list">
                      {STAGE_ORDER.map((stage) => {
                        const currentIdx = STAGE_ORDER.indexOf(uploadStage === 'failed' ? 'queued' : uploadStage as Exclude<UploadStage, 'failed'>);
                        const stageIdx = STAGE_ORDER.indexOf(stage);
                        const isDone = stageIdx < currentIdx || uploadStage === 'completed';
                        const isActive = stageIdx === currentIdx && uploadStage !== 'completed' && uploadStage !== 'failed';
                        const showStats = isDone && stage === 'parsing_markdown' && weekCount != null;
                        return (
                          <li key={stage} className={`upload-stage-item${isDone ? ' done' : isActive ? ' active' : ' pending'}`}>
                            <span className="upload-stage-icon" aria-hidden="true">
                              {isDone ? '✓' : isActive ? '…' : '○'}
                            </span>
                            <span className="upload-stage-label">{STAGE_CHECKLIST_LABELS[stage]}</span>
                            {showStats && (
                              <span className="upload-stage-stat">{weekCount}w · {sessionCount ?? 0}s</span>
                            )}
                          </li>
                        );
                      })}
                    </ol>

                    <p className="upload-progress-meta">
                      Elapsed: {elapsedSec}s · {timeHint}
                    </p>
                    {failureReason && (
                      <p className="upload-progress-meta upload-progress-meta-strong">
                        {humanizeFailureReason(failureReason)}
                      </p>
                    )}
                    {extractedMdAvailable && (
                      <p className="upload-progress-meta upload-progress-meta-strong">
                        Extracted markdown is ready below.
                      </p>
                    )}
                  </div>
                )}
                {message && (
                  <p className="muted" style={{ marginTop: 10, color: status === 'failed' ? '#b42318' : undefined }}>
                    {message}
                  </p>
                )}
              </div>

              <div className="dash-card athlete-page-card">
                <div className="section-title">
                  <h3>How it works</h3>
                </div>
                <UploadFlowStepper steps={UPLOAD_FLOW_STEPS} activeStep={flowActiveStep} />
              </div>
            </div>

            {(uploadId || extractedMd || extractedMdAvailable) && (
              <div className="dash-card athlete-page-card upload-preview-card">
                <div className="section-title">
                  <h3>Extracted Training Plan Markdown</h3>
                </div>
                {!extractedMdAvailable && (
                  <p className="muted">Waiting for markdown extraction to finish.</p>
                )}
                {extractedMdAvailable && extractedMdLoading && (
                  <p className="muted">Loading extracted markdown preview…</p>
                )}
                {extractedMdAvailable && !extractedMdLoading && !extractedMd && (
                  <p className="muted">The markdown exists, but the preview is not available yet. Keep this tab open.</p>
                )}
                {extractedMd && (
                  <div className="upload-markdown-preview">
                    <ReactMarkdown remarkPlugins={[remarkGfm]}>
                      {extractedMd}
                    </ReactMarkdown>
                  </div>
                )}
                {status === 'failed' && planId && (
                  <div className="upload-preview-actions">
                    <Link className="cta secondary" href={`/plans/${planId}/review?fromUpload=1`}>
                      Open review draft
                    </Link>
                  </div>
                )}
              </div>
            )}
          </SignedIn>
        </section>

        <aside className="dash-right">
          <div className="dash-card athlete-right-card">
            <div className="dash-card-header">
              <span className="dash-card-title">Next Steps</span>
            </div>
            <div className="athlete-link-list">
              <Link href="/plans"><span>Open parsed drafts</span><span className="athlete-link-arrow">→</span></Link>
              <Link href="/plans"><span>Activate and set schedule mode</span><span className="athlete-link-arrow">→</span></Link>
              <Link href="/dashboard"><span>Start today workout</span><span className="athlete-link-arrow">→</span></Link>
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
                <span>Review and correct the draft, then activate to apply calendar dates.</span>
              </div>
            </div>
          </div>
        </aside>
      </div>
    </main>
  );
}
