'use client';

export function isCoarsePointerDevice() {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return false;
  return window.matchMedia('(pointer: coarse)').matches;
}

export function isPhoneViewport() {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return false;
  return window.matchMedia('(max-width: 767px)').matches;
}

export function isTabletViewport() {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return false;
  return window.matchMedia('(min-width: 768px) and (max-width: 1024px)').matches;
}

export function isAppleTouchDevice() {
  if (typeof navigator === 'undefined') return false;

  const userAgent = navigator.userAgent || '';
  const platform = navigator.platform || '';
  const maxTouchPoints = navigator.maxTouchPoints || 0;

  return (
    /iP(hone|ad|od)/i.test(userAgent) ||
    /iP(hone|ad|od)/i.test(platform) ||
    (platform === 'MacIntel' && maxTouchPoints > 1)
  );
}

export function emitCoachplanAnalytics(detail: Record<string, unknown>) {
  if (typeof window === 'undefined') return;

  window.dispatchEvent(
    new CustomEvent('coachplan:analytics', {
      detail
    })
  );

  try {
    if (window.localStorage.getItem('cp-debug') === '1') {
      console.debug('[coachplan:analytics]', detail);
    }
  } catch {
    // Ignore localStorage access failures in private browsing or restricted contexts.
  }
}

export function scheduleIdleTask(callback: () => void, timeout = 1200) {
  if (typeof window === 'undefined') return () => {};

  const requestIdle = window.requestIdleCallback;
  if (typeof requestIdle === 'function') {
    const id = requestIdle(() => callback(), { timeout });
    return () => window.cancelIdleCallback?.(id);
  }

  const fallbackId = window.setTimeout(callback, 180);
  return () => window.clearTimeout(fallbackId);
}
