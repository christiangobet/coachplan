const TABLE_LABEL_ALIASES = {
  WEEK: ['week', 'wk', 'kw', 'sem', 'woche', 'semaine'],
  MONDAY: ['monday', 'mon', 'mo', 'montag', 'lundi', 'lun'],
  TUESDAY: ['tuesday', 'tue', 'tues', 'tu', 'di', 'dienstag', 'mardi', 'mar'],
  WEDNESDAY: ['wednesday', 'wed', 'we', 'mi', 'mittwoch', 'mercredi', 'mer'],
  THURSDAY: ['thursday', 'thu', 'thurs', 'th', 'do', 'donnerstag', 'jeudi', 'jeu'],
  FRIDAY: ['friday', 'fri', 'fr', 'freitag', 'vendredi', 'ven'],
  SATURDAY: ['saturday', 'sat', 'sa', 'samstag', 'samedi', 'sam'],
  SUNDAY: ['sunday', 'sun', 'so', 'sonntag', 'dimanche', 'dim'],
  TWM: ['twm', 'totalweekmiles', 'totalweeklymiles'],
};

const LOCALIZED_TEXT_REPLACEMENTS = [
  [/\bruhetag\b/gi, 'rest day'],
  [/\bjour de repos\b/gi, 'rest day'],
  [/\brepos\b/gi, 'rest day'],
  [/\bkrafttraining\b/gi, 'strength'],
  [/\bkraft\b/gi, 'strength'],
  [/\bmusculation\b/gi, 'strength'],
  [/\brenforcement\b/gi, 'strength'],
  [/\balternativtraining\b/gi, 'cross training'],
  [/\bcrosstraining\b/gi, 'cross training'],
  [/\bentrainement croise\b/gi, 'cross training'],
  [/\berholungslauf\b/gi, 'recovery run'],
  [/\brecuperation\b/gi, 'recovery'],
  [/\bleichter lauf\b/gi, 'easy run'],
  [/\bfooting\b/gi, 'easy run'],
  [/\bberglauf(?:e|en)?\b/gi, 'hills'],
  [/\bcotes?\b/gi, 'hills'],
  [/\bmontees?\b/gi, 'hills'],
  [/\beinlaufen\b/gi, 'warm up'],
  [/\bechauffement\b/gi, 'warm up'],
  [/\bauslaufen\b/gi, 'cool down'],
  [/\bretour au calme\b/gi, 'cool down'],
  [/\bwandern\b/gi, 'hike'],
  [/\brandonnee\b/gi, 'hike'],
  [/\bschwelle\b/gi, 'threshold'],
  [/\bseuil\b/gi, 'threshold'],
  [/\bmeilen?\b/gi, 'miles'],
  [/\bmilles?\b/gi, 'miles'],
  [/\bkilometern?\b/gi, 'km'],
  [/\bkilometers?\b/gi, 'km'],
  [/\bkilometres?\b/gi, 'km'],
  [/\bmetern?\b/gi, 'meters'],
  [/\bmetres?\b/gi, 'meters'],
  [/\bminuten?\b/gi, 'minutes'],
  [/\bsekunden?\b/gi, 'seconds'],
  [/\bsecondes?\b/gi, 'seconds'],
  [/\bstunden?\b/gi, 'hours'],
  [/\bheures?\b/gi, 'hours'],
  [/\bstd\b\.?/gi, 'hours'],
  [/\boder\b/gi, 'or'],
  [/\bou\b/gi, 'or'],
];

const TABLE_ALIAS_TO_CANONICAL = (() => {
  const map = new Map();
  for (const [canonical, aliases] of Object.entries(TABLE_LABEL_ALIASES)) {
    for (const alias of aliases) {
      map.set(alias, canonical);
    }
  }
  return map;
})();

export function stripDiacritics(text) {
  return String(text || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}

function normalizeTableLabelToken(text) {
  return stripDiacritics(text)
    .toLowerCase()
    .replace(/[^a-z]/g, '')
    .trim();
}

export function canonicalizeTableLabel(text) {
  const token = normalizeTableLabelToken(text);
  return token ? (TABLE_ALIAS_TO_CANONICAL.get(token) || null) : null;
}

export function normalizePlanText(rawText) {
  let text = stripDiacritics(rawText);
  for (const [pattern, replacement] of LOCALIZED_TEXT_REPLACEMENTS) {
    text = text.replace(pattern, replacement);
  }
  return text;
}

export function extractWeekNumber(text) {
  const weekMatch = String(text || '').match(/\b(\d{1,2})\b/);
  if (!weekMatch) return null;
  const week = Number(weekMatch[1]);
  return Number.isFinite(week) ? week : null;
}
