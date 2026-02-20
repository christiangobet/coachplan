import { redirect } from 'next/navigation';
import Link from 'next/link';
import { requireAdminAccess } from '@/lib/admin';
import { prisma } from '@/lib/prisma';
import '../admin.css';

export const dynamic = 'force-dynamic';

type QualityChecks = {
  weeks_detected?: number;
  missing_days?: unknown[];
  anomalies?: unknown[];
};

type Week = {
  week_number?: number;
  sessions?: unknown[];
};

function extractSummary(json: unknown): {
  weeksDetected: number | null;
  weekNumbers: number[];
  sessionCount: number;
  qc: QualityChecks | null;
  truncated: boolean;
} {
  if (!json || typeof json !== 'object') {
    return { weeksDetected: null, weekNumbers: [], sessionCount: 0, qc: null, truncated: false };
  }

  const obj = json as Record<string, unknown>;

  // Detect truncation artifact
  if (obj._truncated === true) {
    return { weeksDetected: null, weekNumbers: [], sessionCount: 0, qc: null, truncated: true };
  }

  const qc = (obj.quality_checks ?? null) as QualityChecks | null;
  const weeks = Array.isArray(obj.weeks) ? (obj.weeks as Week[]) : [];
  const weekNumbers = weeks
    .map((w) => w.week_number)
    .filter((n): n is number => typeof n === 'number')
    .sort((a, b) => a - b);
  const sessionCount = weeks.reduce(
    (sum, w) => sum + (Array.isArray(w.sessions) ? w.sessions.length : 0),
    0
  );

  return {
    weeksDetected: typeof qc?.weeks_detected === 'number' ? qc.weeks_detected : weeks.length,
    weekNumbers,
    sessionCount,
    qc,
    truncated: false
  };
}

export default async function ParseDebugPage() {
  const access = await requireAdminAccess();
  if (!access.ok) {
    if (access.reason === 'unauthorized') redirect('/sign-in');
    redirect('/auth/resolve-role');
  }

  const jobs = await prisma.parseJob.findMany({
    orderBy: { createdAt: 'desc' },
    take: 50,
    include: {
      artifacts: {
        orderBy: { createdAt: 'desc' }
      },
      plan: {
        select: { id: true, name: true }
      }
    }
  });

  return (
    <main className="admin-page">
      <section className="admin-hero">
        <div>
          <h1>Parse Debug</h1>
          <p>
            Recent Parser V4 jobs and their artifacts. Flag: <code>PARSER_V4=true</code>
          </p>
        </div>
        <Link href="/admin" className="admin-hero-badge" style={{ textDecoration: 'none' }}>
          ← Admin
        </Link>
      </section>

      {jobs.length === 0 && (
        <div className="admin-card" style={{ padding: 24, color: '#666' }}>
          No parse jobs yet. Enable <code>PARSER_V4=true</code> and upload a PDF.
        </div>
      )}

      {jobs.map((job) => (
        <article key={job.id} className="admin-card" style={{ display: 'grid', gap: 12 }}>
          {/* Job header */}
          <div
            style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12 }}
          >
            <div>
              <div style={{ fontWeight: 700, fontSize: 15 }}>
                Job <code style={{ fontSize: 12 }}>{job.id}</code>
              </div>
              <div style={{ fontSize: 13, color: '#555', marginTop: 2 }}>
                Version: {job.parserVersion}
                {job.model ? ` · Model: ${job.model}` : ''}
                {job.plan ? (
                  <>
                    {' · Plan: '}
                    <Link href={`/plans/${job.plan.id}`}>{job.plan.name}</Link>
                  </>
                ) : (
                  ' · No plan linked'
                )}
              </div>
              <div style={{ fontSize: 12, color: '#888', marginTop: 2 }}>
                {new Date(job.createdAt).toLocaleString()}
              </div>
              {job.errorMessage && (
                <div style={{ fontSize: 12, color: '#991b1b', marginTop: 4, fontFamily: 'monospace' }}>
                  {job.errorMessage}
                </div>
              )}
            </div>
            <StatusBadge status={job.status} />
          </div>

          {job.artifacts.length === 0 && (
            <div style={{ fontSize: 13, color: '#999' }}>No artifacts saved.</div>
          )}

          {job.artifacts.map((artifact) => {
            const summary = extractSummary(artifact.json);

            return (
              <section
                key={artifact.id}
                style={{ borderTop: '1px solid #e8ecf0', paddingTop: 10 }}
              >
                {/* Artifact header */}
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    gap: 8,
                    marginBottom: 8
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <span style={{ fontWeight: 600, fontSize: 13 }}>
                      {artifact.artifactType}{' '}
                      <span style={{ color: '#888', fontWeight: 400 }}>
                        schema:{artifact.schemaVersion}
                      </span>
                    </span>
                    <ValidationBadge ok={artifact.validationOk} />
                    {summary.truncated && (
                      <span
                        style={{
                          background: '#fef3c7',
                          color: '#92400e',
                          fontSize: 11,
                          fontWeight: 600,
                          padding: '1px 6px',
                          borderRadius: 999
                        }}
                      >
                        TRUNCATED
                      </span>
                    )}
                  </div>
                </div>

                {/* Quality summary row */}
                {!summary.truncated && (
                  <div
                    style={{
                      display: 'flex',
                      gap: 16,
                      flexWrap: 'wrap',
                      fontSize: 12,
                      marginBottom: 8,
                      padding: '6px 10px',
                      background: '#f8fafc',
                      borderRadius: 6,
                      border: '1px solid #e2e8f0'
                    }}
                  >
                    <span>
                      <strong>Weeks in output:</strong> {summary.weekNumbers.length}
                      {summary.weekNumbers.length > 0 && (
                        <> [{summary.weekNumbers.join(', ')}]</>
                      )}
                    </span>
                    <span>
                      <strong>weeks_detected (QC):</strong>{' '}
                      {summary.weeksDetected ?? '—'}
                    </span>
                    <span>
                      <strong>Sessions:</strong> {summary.sessionCount}
                    </span>
                    {summary.qc?.anomalies && summary.qc.anomalies.length > 0 && (
                      <span style={{ color: '#b45309' }}>
                        <strong>⚠ Anomalies:</strong> {summary.qc.anomalies.length}
                      </span>
                    )}
                    {summary.qc?.missing_days && summary.qc.missing_days.length > 0 && (
                      <span style={{ color: '#b45309' }}>
                        <strong>Missing days:</strong> {summary.qc.missing_days.length}
                      </span>
                    )}
                  </div>
                )}

                {/* Anomalies detail */}
                {!summary.truncated &&
                  summary.qc?.anomalies &&
                  summary.qc.anomalies.length > 0 && (
                    <div
                      style={{
                        marginBottom: 8,
                        fontSize: 11,
                        background: '#fffbeb',
                        border: '1px solid #fde68a',
                        borderRadius: 6,
                        padding: '6px 10px'
                      }}
                    >
                      <strong>Anomalies:</strong>{' '}
                      {JSON.stringify(summary.qc.anomalies)}
                    </div>
                  )}

                {/* Raw JSON viewer */}
                <pre
                  style={{
                    background: '#f3f6f9',
                    borderRadius: 8,
                    padding: '10px 12px',
                    fontSize: 11,
                    lineHeight: 1.5,
                    overflowX: 'auto',
                    maxHeight: 400,
                    overflowY: 'auto',
                    whiteSpace: 'pre-wrap',
                    wordBreak: 'break-word',
                    margin: 0
                  }}
                >
                  {JSON.stringify(artifact.json, null, 2)}
                </pre>
              </section>
            );
          })}
        </article>
      ))}
    </main>
  );
}

function StatusBadge({ status }: { status: string }) {
  const colors: Record<string, { bg: string; color: string }> = {
    SUCCESS: { bg: '#d1fae5', color: '#065f46' },
    FAILED: { bg: '#fee2e2', color: '#991b1b' },
    RUNNING: { bg: '#dbeafe', color: '#1e40af' },
    PENDING: { bg: '#f3f4f6', color: '#374151' }
  };
  const style = colors[status] || colors.PENDING;
  return (
    <span
      style={{
        background: style.bg,
        color: style.color,
        fontSize: 11,
        fontWeight: 700,
        padding: '2px 8px',
        borderRadius: 999,
        whiteSpace: 'nowrap',
        letterSpacing: '0.04em',
        textTransform: 'uppercase'
      }}
    >
      {status}
    </span>
  );
}

function ValidationBadge({ ok }: { ok: boolean }) {
  return (
    <span
      style={{
        background: ok ? '#d1fae5' : '#fee2e2',
        color: ok ? '#065f46' : '#991b1b',
        fontSize: 11,
        fontWeight: 600,
        padding: '1px 6px',
        borderRadius: 999
      }}
    >
      {ok ? 'valid' : 'invalid'}
    </span>
  );
}
