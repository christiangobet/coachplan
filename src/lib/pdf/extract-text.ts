// Server-side only — never import from client components.
// Uses pdf-parse (CommonJS); import from the internal path to avoid Next.js
// module-init issues with test fixture file access.
// eslint-disable-next-line @typescript-eslint/no-require-imports
const pdfParse = require('pdf-parse/lib/pdf-parse') as (
  data: Buffer,
  options?: any // pdf-parse options are not typed
) => Promise<{ text: string; numpages: number }>;

export type PdfExtractResult = {
  fullText: string;
  pages: string[];
};

/**
 * Extracts plain text from a PDF buffer.
 * Returns the full concatenated text and a best-effort per-page array.
 * Throws on parse failure — callers should wrap in try/catch.
 */
export async function extractPdfText(buffer: Buffer): Promise<PdfExtractResult> {
  const pages: string[] = [];

  const result = await pdfParse(buffer, {
    pagerender: async (pageData: any) => {
      const content = await pageData.getTextContent();
      const pageText = content.items.map((item: any) => item.str ?? '').join(' ').trim();
      pages.push(pageText);
      return pageText;
    }
  });

  const fullText = result.text.trim();

  return { fullText, pages };
}
