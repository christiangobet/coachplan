const DAY_DONE_TAG = '[DAY_DONE]';
const DAY_MISSED_TAG = '[DAY_MISSED]';
const DAY_MISSED_REASON_PREFIX = '[DAY_MISSED_REASON]';
const DAY_OPEN_TAG = '[DAY_OPEN]'; // explicit reopen — overrides auto-done
const DAY_PARTIAL_TAG = '[DAY_PARTIAL]';

export type DayStatus = 'OPEN' | 'DONE' | 'MISSED' | 'PARTIAL';

function splitNoteLines(notes: string | null | undefined) {
  return String(notes || '')
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);
}

function stripStatusLines(notes: string | null | undefined) {
  const next = splitNoteLines(notes)
    .filter((line) =>
      line !== DAY_DONE_TAG
      && line !== DAY_MISSED_TAG
      && line !== DAY_OPEN_TAG
      && line !== DAY_PARTIAL_TAG
      && !line.startsWith(DAY_MISSED_REASON_PREFIX)
    )
    .join('\n')
    .trim();
  return next || null;
}

export function getDayStatus(notes: string | null | undefined): DayStatus {
  const lines = splitNoteLines(notes);
  // Explicit open tag takes priority (user clicked "Reopen Day")
  if (lines.includes(DAY_OPEN_TAG)) return 'OPEN';
  if (lines.includes(DAY_DONE_TAG)) return 'DONE';
  if (lines.includes(DAY_MISSED_TAG)) return 'MISSED';
  if (lines.includes(DAY_PARTIAL_TAG)) return 'PARTIAL';
  return 'OPEN';
}

/** True only when the day was explicitly reopened by the user (overrides auto-done). */
export function isDayExplicitlyOpen(notes: string | null | undefined) {
  return splitNoteLines(notes).includes(DAY_OPEN_TAG);
}

export function isDayMarkedDone(notes: string | null | undefined) {
  return getDayStatus(notes) === 'DONE';
}

export function isDayMarkedMissed(notes: string | null | undefined) {
  return getDayStatus(notes) === 'MISSED';
}

export function isDayClosed(notes: string | null | undefined) {
  const status = getDayStatus(notes);
  return status === 'DONE' || status === 'MISSED' || status === 'PARTIAL';
}

export function getDayMissedReason(notes: string | null | undefined) {
  const line = splitNoteLines(notes).find((entry) => entry.startsWith(DAY_MISSED_REASON_PREFIX));
  if (!line) return null;
  const value = line.slice(DAY_MISSED_REASON_PREFIX.length).trim();
  return value || null;
}

export function setDayStatus(
  notes: string | null | undefined,
  status: DayStatus,
  missedReason?: string | null
) {
  const base = stripStatusLines(notes);

  const entries: string[] = [];
  if (base) entries.push(base);

  if (status === 'OPEN') {
    // Explicit open tag so auto-done cannot override this choice
    entries.push(DAY_OPEN_TAG);
    return entries.join('\n').trim();
  }

  if (status === 'DONE') {
    entries.push(DAY_DONE_TAG);
    return entries.join('\n').trim();
  }

  if (status === 'PARTIAL') {
    entries.push(DAY_PARTIAL_TAG);
    return entries.join('\n').trim();
  }

  entries.push(DAY_MISSED_TAG);
  const reason = String(missedReason || '').trim();
  if (reason) {
    entries.push(`${DAY_MISSED_REASON_PREFIX} ${reason}`);
  }

  return entries.join('\n').trim();
}

export function setDayMarkedDone(notes: string | null | undefined, completed: boolean) {
  return setDayStatus(notes, completed ? 'DONE' : 'OPEN');
}
