'use client';

import { useEffect, useState } from 'react';
import { Moon, Sun } from 'lucide-react';

const KEY = 'revelio-theme';

/**
 * Light/dark switch with smooth orbital rotation and spring physics.
 */
export function ThemeToggle() {
  const [dark, setDark] = useState<boolean | null>(null);

  useEffect(() => {
    setDark(document.documentElement.classList.contains('dark'));
    document.documentElement.classList.add('theme-ready');
  }, []);

  function toggle() {
    const next = !document.documentElement.classList.contains('dark');
    document.documentElement.classList.toggle('dark', next);
    setDark(next);
    try {
      localStorage.setItem(KEY, next ? 'dark' : 'light');
    } catch {
      // Storage unavailable fallback
    }
  }

  return (
    <button
      type="button"
      onClick={toggle}
      aria-label={dark ? 'Switch to light theme' : 'Switch to dark theme'}
      title={dark ? 'Light theme' : 'Dark theme'}
      className="group relative grid size-9 place-items-center rounded-md border border-line bg-surface text-muted
                 shadow-e1 transition-all hover:border-accent-line hover:bg-surface-2 hover:text-ink"
    >
      {/* Tokens, not stock amber and indigo: those two hues are the only ones
          this palette deliberately excludes. */}
      <Sun
        className={`absolute size-4 text-tier2 transition-all duration-400 ease-[var(--ease-spring)]
                    ${dark === false ? 'rotate-0 scale-100 opacity-100' : '-rotate-90 scale-40 opacity-0'}`}
      />
      <Moon
        className={`absolute size-4 text-accent-ink transition-all duration-400 ease-[var(--ease-spring)]
                    ${dark === true ? 'rotate-0 scale-100 opacity-100' : 'rotate-90 scale-40 opacity-0'}`}
      />
    </button>
  );
}
