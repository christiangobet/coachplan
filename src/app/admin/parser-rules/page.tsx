import Link from 'next/link';
import { redirect } from 'next/navigation';
import { requireAdminAccess } from '@/lib/admin';
import { readdirSync, readFileSync, existsSync } from 'fs';
import path from 'path';
import '../admin.css';
import ParserRulesClient from './ParserRulesClient';

export const dynamic = 'force-dynamic';

const ROOT      = process.cwd();
const PLANS_DIR = path.join(ROOT, 'scripts', 'fixtures', 'plans');
const OUT_DIR   = path.join(ROOT, 'scripts', 'parser-analysis');

export default async function ParserRulesPage() {
  const access = await requireAdminAccess();
  if (!access.ok) {
    if (access.reason === 'unauthorized') redirect('/sign-in');
    redirect('/auth/resolve-role');
  }

  const files = existsSync(PLANS_DIR)
    ? readdirSync(PLANS_DIR).filter(f => f.toLowerCase().endsWith('.pdf'))
    : [];

  const aggregatePath = path.join(OUT_DIR, 'aggregate.json');
  const aggregate = existsSync(aggregatePath)
    ? JSON.parse(readFileSync(aggregatePath, 'utf8'))
    : null;

  const perPlan: Record<string, unknown> = {};
  if (existsSync(OUT_DIR)) {
    for (const f of readdirSync(OUT_DIR).filter(f => f.endsWith('.json') && f !== 'aggregate.json')) {
      try {
        perPlan[f.replace('.json', '.pdf')] = JSON.parse(
          readFileSync(path.join(OUT_DIR, f), 'utf8')
        );
      } catch { /* skip malformed */ }
    }
  }

  return (
    <main className="admin-page">
      <section className="admin-hero">
        <div>
          <h1>Parser Rule Finder</h1>
          <p>
            Batch-analyse training plan PDFs with a local LLM to surface patterns
            the V4 parser misses and generate prompt improvements.
          </p>
        </div>
        <Link href="/admin" className="admin-hero-badge" style={{ textDecoration: 'none' }}>
          ← Admin
        </Link>
      </section>

      <div className="admin-card" style={{ fontSize: 13, color: '#5e6f8c', lineHeight: 1.6 }}>
        <strong style={{ color: '#1a2a44' }}>Prerequisites</strong>
        <ol style={{ margin: '6px 0 0', paddingLeft: 20, display: 'grid', gap: 4 }}>
          <li>
            Put training plan PDFs in{' '}
            <code style={codeStyle}>scripts/fixtures/plans/</code>
          </li>
          <li>Select <strong style={{ color: '#1a2a44' }}>Cloud (OpenAI)</strong> mode (default) — or switch to Local LLM and run <code style={codeStyle}>npm run llm</code> first.</li>
          <li>Click <strong style={{ color: '#1a2a44' }}>Run Analysis</strong> below.</li>
        </ol>
        <p style={{ margin: '8px 0 0' }}>
          Results are saved to <code style={codeStyle}>scripts/parser-analysis/</code> and persist between page loads.
          Use <strong style={{ color: '#1a2a44' }}>Suggest Patches</strong> to generate prompt improvements, then save via the{' '}
          <Link href="/admin/parser-prompts" style={{ color: '#fc4c02', fontWeight: 600 }}>Prompt Manager</Link>.
        </p>
      </div>

      <ParserRulesClient
        initialFiles={files}
        initialAggregate={aggregate}
        initialPerPlan={perPlan as Record<string, { analysis: { layout_type: string; source_units: string; total_weeks_detected: number | null; unhandled_patterns: Array<{ pattern: string; issue: string; suggested_rule: string }>; new_abbreviations: Array<{ abbr: string; meaning: string }>; prompt_improvements: string[]; anomalies: string[] } }>}
      />
    </main>
  );
}

const codeStyle: React.CSSProperties = {
  fontFamily:   'monospace',
  fontSize:     12,
  background:   '#f0f4ff',
  border:       '1px solid #d5ddf5',
  borderRadius: 4,
  padding:      '1px 5px',
  color:        '#3730a3',
};
