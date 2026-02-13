const DAY_DONE_TAG = '[DAY_DONE]';

export function isDayMarkedDone(notes: string | null | undefined) {
  return typeof notes === 'string' && notes.includes(DAY_DONE_TAG);
}

export function setDayMarkedDone(notes: string | null | undefined, completed: boolean) {
  const current = (notes || '').trim();
  const hasTag = current.includes(DAY_DONE_TAG);

  if (completed) {
    if (hasTag) return current;
    return current ? `${current}\n${DAY_DONE_TAG}` : DAY_DONE_TAG;
  }

  if (!hasTag) return current || null;

  const next = current
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line && line !== DAY_DONE_TAG)
    .join('\n')
    .trim();

  return next || null;
}
