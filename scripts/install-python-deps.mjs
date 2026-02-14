import { spawnSync } from 'node:child_process';
import path from 'node:path';

const isVercel = Boolean(process.env.VERCEL);
if (!isVercel) {
  console.log('Skipping Python dependency install (not running on Vercel).');
  process.exit(0);
}

const target = path.join(process.cwd(), '.python_packages');
console.log(`Installing Python deps into ${target}`);

const result = spawnSync(
  'python3',
  [
    '-m',
    'pip',
    'install',
    '--disable-pip-version-check',
    '--no-cache-dir',
    '--target',
    target,
    'pdfplumber==0.11.5'
  ],
  { stdio: 'inherit' }
);

if (result.status !== 0) {
  console.error('Failed to install Python dependencies for PDF parsing on Vercel.');
  process.exit(result.status ?? 1);
}

console.log('Python PDF dependencies installed.');
