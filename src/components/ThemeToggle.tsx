'use client';
import { useEffect, useState } from 'react';

export default function ThemeToggle() {
  const [mounted, setMounted] = useState(false);
  const [dark, setDark] = useState(false);

  useEffect(() => {
    const isDark = localStorage.getItem('theme') === 'dark';
    if (isDark !== dark) setDark(isDark);
    setMounted(true);
    document.documentElement.classList.add('theme-ready');
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function toggle() {
    const next = !dark;
    setDark(next);
    const value = next ? 'dark' : 'light';
    localStorage.setItem('theme', value);
    document.documentElement.setAttribute('data-theme', value);
  }

  // Render placeholder until mounted to avoid SSR icon mismatch
  if (!mounted) return <div style={{ width: 32, height: 32 }} />;

  return (
    <button onClick={toggle} className="theme-toggle-btn" aria-label="Toggle dark mode">
      {dark ? '☀️' : '🌙'}
    </button>
  );
}
