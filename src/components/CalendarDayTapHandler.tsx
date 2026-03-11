'use client';

/**
 * CalendarDayTapHandler
 *
 * On iOS, full-cell <Link> elements inside a horizontal-scroll container
 * conflict with the swipe gesture — iOS won't fire a click on an interactive
 * element until it confirms the touch isn't a scroll, causing ~300ms delay or
 * silent drop. All previous approaches (touch-action, pointer-events, etc.)
 * either broke horizontal scrolling or failed silently on real devices.
 *
 * Architecture:
 *  - The server-rendered `.cal-day` divs carry `data-day-href` attributes.
 *  - CSS disables `pointer-events` on `.cal-day-hit` at mobile widths so the
 *    <Link> does not intercept touches — letting this handler see them.
 *  - This component mounts a single native `touchend` listener on the grid
 *    wrapper. It distinguishes a tap (dx<10, dy<10) from a swipe and pushes
 *    the href on tap. Native touchend is reliably fired on iOS before any
 *    scroll-detection threshold is reached.
 */

import { useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';

export default function CalendarDayTapHandler() {
  const router = useRouter();
  const startRef = useRef<{ x: number; y: number } | null>(null);

  useEffect(() => {
    const onTouchStart = (e: TouchEvent) => {
      const t = e.touches[0];
      startRef.current = { x: t.clientX, y: t.clientY };
    };

    const onTouchEnd = (e: TouchEvent) => {
      const start = startRef.current;
      if (!start) return;
      const t = e.changedTouches[0];
      const dx = Math.abs(t.clientX - start.x);
      const dy = Math.abs(t.clientY - start.y);
      startRef.current = null;

      // Ignore swipes — only act on taps (movement < 10px in each axis)
      if (dx > 10 || dy > 10) return;

      const day = (e.target as Element)?.closest<HTMLElement>('.cal-day[data-day-href]');
      if (!day) return;

      const href = day.getAttribute('data-day-href');
      if (!href) return;

      e.preventDefault();
      router.push(href);
    };

    // Attach to document so it works regardless of scroll position
    document.addEventListener('touchstart', onTouchStart, { passive: true });
    document.addEventListener('touchend', onTouchEnd, { passive: false });

    return () => {
      document.removeEventListener('touchstart', onTouchStart);
      document.removeEventListener('touchend', onTouchEnd);
    };
  }, [router]);

  return null;
}
