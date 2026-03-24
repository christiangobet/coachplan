'use client';

import { useEffect, useRef } from 'react';
import { emitCoachplanAnalytics } from '@/lib/client-runtime';

type ScreenPerfProbeProps = {
  screen: string;
  actionSelector?: string;
  suppressesMobilePrefetch?: boolean;
};

export default function ScreenPerfProbe({
  screen,
  actionSelector,
  suppressesMobilePrefetch = false,
}: ScreenPerfProbeProps) {
  const firstActionCapturedRef = useRef(false);

  useEffect(() => {
    if (typeof window === 'undefined') return;

    const mountStartedAt = performance.now();
    let longTaskCount = 0;
    let observer: PerformanceObserver | null = null;
    let finished = false;

    if (typeof PerformanceObserver !== 'undefined') {
      try {
        observer = new PerformanceObserver((list) => {
          longTaskCount += list.getEntries().length;
        });
        observer.observe({ entryTypes: ['longtask'] });
      } catch {
        observer = null;
      }
    }

    const interactiveFrame = window.requestAnimationFrame(() => {
      window.requestAnimationFrame(() => {
        emitCoachplanAnalytics({
          event: 'screen_mount_interactive',
          screen,
          durationMs: Math.round(performance.now() - mountStartedAt),
          suppressesMobilePrefetch,
        });
      });
    });

    const longTaskTimer = window.setTimeout(() => {
      if (finished) return;
      emitCoachplanAnalytics({
        event: 'screen_longtasks_window',
        screen,
        longTaskCount,
        windowMs: 5000,
        suppressesMobilePrefetch,
      });
      observer?.disconnect();
      finished = true;
    }, 5000);

    const handleFirstAction = (event: Event) => {
      if (firstActionCapturedRef.current) return;
      if (actionSelector) {
        const target = event.target as Element | null;
        if (!target?.closest(actionSelector)) return;
      }
      firstActionCapturedRef.current = true;
      const actionStartedAt = performance.now();
      window.requestAnimationFrame(() => {
        emitCoachplanAnalytics({
          event: 'screen_first_action_latency',
          screen,
          durationMs: Math.round(performance.now() - actionStartedAt),
          actionType: event.type,
          suppressesMobilePrefetch,
        });
      });
    };

    document.addEventListener('pointerdown', handleFirstAction, true);
    document.addEventListener('click', handleFirstAction, true);

    return () => {
      window.cancelAnimationFrame(interactiveFrame);
      window.clearTimeout(longTaskTimer);
      document.removeEventListener('pointerdown', handleFirstAction, true);
      document.removeEventListener('click', handleFirstAction, true);
      observer?.disconnect();
    };
  }, [actionSelector, screen, suppressesMobilePrefetch]);

  return null;
}
