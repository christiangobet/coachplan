export function getFirstName(name: string | null | undefined, fallback = 'Athlete') {
  const normalized = (name || '').trim().replace(/\s+/g, ' ');
  if (!normalized) return fallback;
  const first = normalized.split(' ')[0]?.trim();
  return first || fallback;
}
