'use client';

import { useEffect } from 'react';

const MOBILE_MAX_WIDTH = 768;
const DOUBLE_TAP_WINDOW_MS = 360;
const TAP_MOVE_THRESHOLD_PX = 14;
const TOUCH_CLICK_DEDUP_MS = 700;

export default function CalendarMobileDoubleTap() {
  useEffect(() => {
    if (typeof window === 'undefined') return;

    let lastTapHref: string | null = null;
    let lastTapAt = 0;
    let touchStartX = 0;
    let touchStartY = 0;
    let touchMoved = false;
    let lastTouchEventAt = 0;

    const isMobile = () => window.innerWidth <= MOBILE_MAX_WIDTH;

    const getCell = (target: EventTarget | null) => {
      if (!(target instanceof HTMLElement)) return null;
      return target.closest<HTMLElement>('.cal-day[data-day-href]');
    };

    const queueOrNavigate = (cell: HTMLElement) => {
      const href = cell.dataset.dayHref;
      if (!href) return;

      const now = Date.now();
      const isDoubleTap = lastTapHref === href && now - lastTapAt <= DOUBLE_TAP_WINDOW_MS;

      if (isDoubleTap) {
        lastTapHref = null;
        lastTapAt = 0;
        window.location.assign(href);
        return;
      }

      lastTapHref = href;
      lastTapAt = now;
    };

    const onTouchStart: EventListener = (event) => {
      if (!isMobile()) return;
      const touchEvent = event as TouchEvent;
      const cell = getCell(touchEvent.target);
      if (!cell || touchEvent.touches.length === 0) return;
      touchMoved = false;
      touchStartX = touchEvent.touches[0].clientX;
      touchStartY = touchEvent.touches[0].clientY;
    };

    const onTouchMove: EventListener = (event) => {
      const touchEvent = event as TouchEvent;
      if (!isMobile() || touchEvent.touches.length === 0) return;
      const dx = Math.abs(touchEvent.touches[0].clientX - touchStartX);
      const dy = Math.abs(touchEvent.touches[0].clientY - touchStartY);
      if (dx > TAP_MOVE_THRESHOLD_PX || dy > TAP_MOVE_THRESHOLD_PX) {
        touchMoved = true;
      }
    };

    const onTouchEnd: EventListener = (event) => {
      if (!isMobile()) return;
      const touchEvent = event as TouchEvent;
      const cell = getCell(touchEvent.target);
      if (!cell || touchMoved) return;
      lastTouchEventAt = Date.now();
      queueOrNavigate(cell);
    };

    const onClick: EventListener = (event) => {
      const mouseEvent = event as MouseEvent;
      if (!isMobile()) return;

      const now = Date.now();
      if (now - lastTouchEventAt <= TOUCH_CLICK_DEDUP_MS) {
        mouseEvent.preventDefault();
        return;
      }

      const cell = getCell(mouseEvent.target);
      if (!cell) return;

      mouseEvent.preventDefault();
      queueOrNavigate(cell);
    };

    const root = document.querySelector('.cal-page .cal-grid');
    if (!root) return;

    root.addEventListener('touchstart', onTouchStart, { passive: true });
    root.addEventListener('touchmove', onTouchMove, { passive: true });
    root.addEventListener('touchend', onTouchEnd, { passive: true });
    root.addEventListener('click', onClick);

    return () => {
      root.removeEventListener('touchstart', onTouchStart);
      root.removeEventListener('touchmove', onTouchMove);
      root.removeEventListener('touchend', onTouchEnd);
      root.removeEventListener('click', onClick);
    };
  }, []);

  return null;
}
