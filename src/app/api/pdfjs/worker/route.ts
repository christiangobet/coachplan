import { promises as fs } from 'node:fs';
import path from 'node:path';

export const runtime = 'nodejs';

const WORKER_FILE_PATH = path.join(
  process.cwd(),
  'node_modules',
  'pdfjs-dist',
  'legacy',
  'build',
  'pdf.worker.min.mjs'
);

export async function GET() {
  try {
    const source = await fs.readFile(WORKER_FILE_PATH, 'utf8');
    return new Response(source, {
      status: 200,
      headers: {
        'content-type': 'text/javascript; charset=utf-8',
        'cache-control': 'public, max-age=31536000, immutable'
      }
    });
  } catch {
    return Response.json(
      { error: 'PDF worker is unavailable.' },
      { status: 500 }
    );
  }
}
