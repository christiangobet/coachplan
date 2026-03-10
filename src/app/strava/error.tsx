'use client';

export default function Error({ error, reset }: { error: Error; reset: () => void }) {
  return (
    <main className="dash">
      <div className="dash-grid">
        <div className="dash-center">
          <div className="dash-card" style={{ padding: '2rem', textAlign: 'center' }}>
            <h2 style={{ marginBottom: '0.5rem' }}>Something went wrong</h2>
            <p style={{ color: 'var(--d-muted)', marginBottom: '1.5rem' }}>{error.message}</p>
            <button className="btn-primary" onClick={reset}>Try again</button>
          </div>
        </div>
      </div>
    </main>
  );
}
