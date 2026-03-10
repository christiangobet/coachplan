import Link from 'next/link';

export default function NotFound() {
  return (
    <main className="dash">
      <div className="dash-grid">
        <div className="dash-center">
          <div className="dash-card" style={{ padding: '3rem 2rem', textAlign: 'center' }}>
            <div style={{ fontSize: '3rem', fontWeight: 800, color: 'var(--d-orange)', marginBottom: '0.5rem' }}>
              404
            </div>
            <h2 style={{ marginBottom: '0.5rem' }}>Page not found</h2>
            <p style={{ color: 'var(--d-muted)', marginBottom: '1.5rem' }}>
              The page you&apos;re looking for doesn&apos;t exist or has been moved.
            </p>
            <Link href="/dashboard" className="btn-primary">
              Go to dashboard
            </Link>
          </div>
        </div>
      </div>
    </main>
  );
}
