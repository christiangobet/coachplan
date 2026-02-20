// Server-side only — never import from client components.
// Uses pdfjs-dist (already configured in next.config for Vercel output tracing).
import * as pdfjsLib from 'pdfjs-dist/legacy/build/pdf.mjs';
import { pathToFileURL } from 'url';
import path from 'path';

export type PdfExtractResult = {
  fullText: string;
  pages: string[];
};

/**
 * Extracts plain text from a PDF buffer using pdfjs-dist.
 * Compatible with Vercel serverless — pdfjs-dist is already traced via next.config.
 * Throws on parse failure — callers should wrap in try/catch.
 */
export async function extractPdfText(buffer: Buffer): Promise<PdfExtractResult> {
  const workerPath = path.join(
    process.cwd(),
    'node_modules',
    'pdfjs-dist',
    'legacy',
    'build',
    'pdf.worker.mjs'
  );
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (pdfjsLib as any).GlobalWorkerOptions.workerSrc = pathToFileURL(workerPath).href;

  const loadingTask = (pdfjsLib as any).getDocument({
    data: new Uint8Array(buffer),
    disableWorker: true
  });
  const pdf = await loadingTask.promise;

  const pages: string[] = [];

  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i);
    const content = await page.getTextContent();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const pageText = (content.items as any[])
      .map((item) => item.str ?? '')
      .join(' ')
      .trim();
    pages.push(pageText);
  }

  const fullText = pages.join('\n\n');
  return { fullText, pages };
}
