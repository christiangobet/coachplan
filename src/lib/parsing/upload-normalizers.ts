import { normalizePlanText } from '@/lib/plan-parser-i18n.mjs';

export const ACTIVITY_ABBREVIATION_REPLACEMENTS: Array<[RegExp, string]> = [
  [/\bwu\b/gi, 'warm up'],
  [/\bcd\b/gi, 'cool down'],
  [/\blrl\b/gi, 'long run'],
  [/\blr\b/gi, 'long run'],
  [/\bstr\b/gi, 'strength'],
  [/\bstre\b/gi, 'strength'],
  [/\brst\b/gi, 'rest'],
  [/\bxt\b/gi, 'cross training'],
  [/\bx[-\s]?train(?:ing)?\b/gi, 'cross training'],
  [/\bcross[-\s]?train\b/gi, 'cross training'],
  [/\bmob\b/gi, 'mobility'],
  [/\byog\b/gi, 'yoga'],
  [/\bhik\b/gi, 'hike'],
  [/\brec\b/gi, 'recovery'],
  [/\bff\b/gi, 'fast finish'],
  [/\bmp\b/gi, 'marathon pace'],
  [/\brp\b/gi, 'race pace'],
  [/\be(?=\s*\d)/gi, 'easy run'],
  [/\bt(?=\s*\d)/gi, 'tempo'],
  [/\bi(?=\s*\d)/gi, 'interval']
];

export function stripSuperscriptFootnotes(text: string) {
  return text
    // Superscript/subscript unicode blocks commonly used for footnote markers in PDFs.
    .replace(/[\u00B9\u00B2\u00B3\u2070-\u209F]/g, '')
    // Common standalone footnote symbols.
    .replace(/[†‡§¶‖※]/g, ' ')
    // Keep symbol markers (key/optional), but drop attached index digits like ★4, ♥8.
    .replace(/([★♥])\d{1,2}\b/g, '$1')
    // Drop attached footnote indices like RP9, CD5, finish11, NS10.
    .replace(/\b([A-Za-z]{2,})(\d{1,2})(?=[:;,.!?)]|\s|$)/g, '$1')
    // Bracketed/parenthesized footnote ids, e.g. [1], (2), (iv).
    .replace(/\s*(?:\[\s*(?:\d{1,3}|[ivx]{1,6})\s*\]|\(\s*(?:\d{1,3}|[ivx]{1,6})\s*\))(?=\s|$)/gi, ' ')
    // Stray reference arrows used in some exports.
    .replace(/\s*[>›](?=\s|$)/g, ' ');
}

export function normalizeWhitespace(text: string) {
  return stripSuperscriptFootnotes(text)
    .replace(/\s+/g, ' ')
    .replace(/\s*-\s*/g, '-')
    .replace(/\s+\+\s+/g, ' + ')
    .trim();
}

export function titleCase(text: string) {
  return text
    .replace(/-/g, ' ')
    .split(' ')
    .map((w) => (w ? w[0].toUpperCase() + w.slice(1) : ''))
    .join(' ')
    .trim();
}

export function planNameFromFilename(filename: string) {
  const withoutExt = filename.replace(/\.[^.]+$/, '');
  const normalized = withoutExt.replace(/[_-]+/g, ' ').replace(/\s+/g, ' ').trim();
  return normalized || 'Uploaded Plan';
}

export function decodeActivityText(rawText: string) {
  let decoded = normalizePlanText(rawText);
  for (const [pattern, replacement] of ACTIVITY_ABBREVIATION_REPLACEMENTS) {
    decoded = decoded.replace(pattern, replacement);
  }
  return normalizeWhitespace(decoded);
}

export function normalizeMatchText(text: string | null | undefined) {
  return String(text || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

export function countAbbreviationTokens(text: string) {
  return (text.match(/\b(?:wu|cd|lr|lrl|xt|str|rst|mob|yog|hik|rp|mp|ns|ff|rec)\b/gi) || []).length;
}

export function chooseActivityRawText(baseRaw: string | null | undefined, aiRaw: string | null | undefined) {
  const base = normalizeWhitespace(String(baseRaw || ''));
  const ai = normalizeWhitespace(String(aiRaw || ''));

  if (!ai) return base || null;
  if (!base) return ai;

  const baseAbbrCount = countAbbreviationTokens(base);
  const aiAbbrCount = countAbbreviationTokens(ai);

  if (aiAbbrCount < baseAbbrCount) return ai;
  if (ai.length >= base.length + 6) return ai;
  return base;
}

export function expandAlternatives(text: string) {
  const normalized = normalizePlanText(text);
  const restOr = normalized.match(/rest day or (.+)/i) || normalized.match(/rest or (.+)/i);
  if (restOr) {
    return ['Rest day', restOr[1]];
  }
  return [text];
}

export function splitCombinedActivities(text: string) {
  const source = normalizeWhitespace(text);
  if (!source) return [];
  const normalized = normalizePlanText(source).toLowerCase();
  const hasWu = /\b(?:wu|warm[\s-]?up)\b/.test(normalized);
  const hasTempo = /\btempo\b/.test(normalized) || /\bt(?=[:\s]*\d)/i.test(source);
  const hasCd = /\b(?:cd|cool[\s-]?down)\b/.test(normalized);
  const hasNonRunMarker = /\b(?:strength|rest|cross|xt|mobility|yoga|hike)\b/.test(normalized);

  // Structured run phases (WU/T/CD) belong to one run activity, not separate activities.
  if (!hasNonRunMarker && ((hasWu && hasTempo) || (hasTempo && hasCd) || (hasWu && hasCd))) {
    return [source];
  }

  const parts: string[] = [];
  let depth = 0;
  let current = '';

  const flush = () => {
    const trimmed = normalizeWhitespace(current);
    if (trimmed) parts.push(trimmed);
    current = '';
  };

  for (let i = 0; i < source.length; i += 1) {
    const char = source[i];
    if (char === '(' || char === '[' || char === '{') {
      depth += 1;
      current += char;
      continue;
    }
    if (char === ')' || char === ']' || char === '}') {
      depth = Math.max(0, depth - 1);
      current += char;
      continue;
    }

    if (depth === 0) {
      if (char === '+' && source[i - 1] !== '+' && source[i + 1] !== '+') {
        flush();
        continue;
      }
      if (char === ';' || char === '|') {
        flush();
        continue;
      }
      if (char === '/' && /\s/.test(source[i - 1] || '') && /\s/.test(source[i + 1] || '')) {
        flush();
        continue;
      }
    }

    current += char;
  }

  flush();
  return parts.length ? parts : [source];
}
