/**
 * Splits an enriched plan.md document into chunks bounded by ## Week N headers.
 * Supplementary sections (Glossary, Strength & Conditioning, Trainer Notes)
 * are prepended to every chunk so the parser always has full context.
 */

export interface MdChunk {
  /** The MD text for this chunk (supplementary prefix + week sections). */
  text: string;
  /** Which week numbers are included in this chunk. */
  weekNumbers: number[];
}

const SUPPLEMENTARY_HEADERS = ['## Glossary', '## Strength & Conditioning', '## Trainer Notes'];

/**
 * Extract the supplementary sections from the MD (everything before the first ## Week N).
 * Returns them as a single string to be prepended to every chunk.
 */
export function extractSupplementary(md: string): string {
  const firstWeekIdx = md.search(/^## Week \d+/m);
  if (firstWeekIdx === -1) return md.trim();

  const before = md.slice(0, firstWeekIdx);

  // Keep only lines that belong to a supplementary section
  const lines = before.split('\n');
  const kept: string[] = [];
  let inSection = false;

  for (const line of lines) {
    const isSupHeader = SUPPLEMENTARY_HEADERS.some((h) => line.startsWith(h));
    if (isSupHeader) { inSection = true; }
    if (inSection) kept.push(line);
  }

  return kept.join('\n').trim();
}

/**
 * Split the MD into chunks of `chunkSize` weeks each.
 * Each chunk is prefixed with the supplementary sections.
 *
 * @param md        Full plan.md content.
 * @param chunkSize Maximum number of weeks per chunk (default: 5).
 */
export function chunkMd(md: string, chunkSize = 5): MdChunk[] {
  const supplementary = extractSupplementary(md);

  // Split into week sections
  const weekSections: Array<{ weekNumber: number; text: string }> = [];
  const weekRegex = /^(## Week (\d+)[\s\S]*?)(?=^## Week \d+|\s*$)/gm;

  let match: RegExpExecArray | null;
  while ((match = weekRegex.exec(md)) !== null) {
    weekSections.push({
      weekNumber: parseInt(match[2], 10),
      text: match[1].trimEnd()
    });
  }

  if (weekSections.length === 0) {
    // No week sections found — return the whole thing as one chunk
    return [{ text: md, weekNumbers: [] }];
  }

  // Group into chunks of chunkSize
  const chunks: MdChunk[] = [];
  for (let i = 0; i < weekSections.length; i += chunkSize) {
    const slice = weekSections.slice(i, i + chunkSize);
    const weekText = slice.map((s) => s.text).join('\n\n');
    const text = supplementary
      ? `${supplementary}\n\n${weekText}`
      : weekText;
    chunks.push({
      text,
      weekNumbers: slice.map((s) => s.weekNumber)
    });
  }

  return chunks;
}
