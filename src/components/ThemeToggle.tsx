'use client';
import { useEffect, useState } from 'react';

export default function ThemeToggle() {
  const [mounted, setMounted] = useState(false);
  const [dark, setDark] = useState(false);

  useEffect(() => {
    const saved = localStorage.getItem('theme');
    const isDark = saved === 'dark';
    setDark(isDark);
    setMounted(true);
    document.documentElement.classList.add('theme-ready');
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
