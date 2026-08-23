'use client';

import { usePathname } from 'next/navigation';

/**
 * Replays an entrance animation on every route change.
 *
 * Keyed on the pathname so the wrapper element is torn down and rebuilt when
 * the route changes — a CSS animation only runs on mount, so without a key
 * change the second navigation would arrive with no transition at all.
 *
 * Deliberately opacity-only. Page content already stages itself in (the header
 * rises, list rows stagger); adding a translate here as well would double the
 * movement and make navigation feel heavy.
 */
export function PageTransition({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();

  return (
    <div key={pathname} className="animate-[fade_0.28s_var(--ease-smooth)_both]">
      {children}
    </div>
  );
}
