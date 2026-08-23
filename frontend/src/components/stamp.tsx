import clsx from 'clsx';
import { Check, X } from 'lucide-react';

export type StampTone = 'seal' | 'approved' | 'changes' | 'rejected';

/*
 * Impression colours. Terracotta seals access, sage seals approval, and refusal
 * is a muted clay — never a warning red, which on a warm ground reads as an
 * error in the software rather than a decision by a person.
 */
const TONES: Record<StampTone, { color: string; icon: typeof Check | null }> = {
  seal: { color: 'var(--seal-ink)', icon: Check },
  approved: { color: 'var(--ok)', icon: Check },
  changes: { color: 'var(--warn)', icon: null },
  rejected: { color: 'var(--danger)', icon: X },
};

/**
 * A rubber-stamp impression.
 *
 * Rotation is a prop rather than a fixed value so two stamps on one page never
 * land at the same angle — the giveaway that they were printed, not stamped.
 */
export function Stamp({
  label,
  tone = 'approved',
  sublabel,
  rotate = -8,
  animate = true,
  className,
}: {
  label: string;
  tone?: StampTone;
  /** Small line under the label — a date, an authority, a document id. */
  sublabel?: string;
  rotate?: number;
  animate?: boolean;
  className?: string;
}) {
  const { color, icon: Icon } = TONES[tone];

  return (
    <span
      role="img"
      aria-label={`${label}${sublabel ? `, ${sublabel}` : ''}`}
      className={clsx('inline-flex select-none', className)}
      style={{ color, transform: `rotate(${rotate}deg)` }}
    >
      {/* The impression scales in; the tilt lives on the wrapper so both can be
          set independently. */}
      <span
        className={clsx('stamp flex-col items-center gap-0 px-3 py-1.5', animate && 'animate-stamp')}
      >
        <span className="flex items-center gap-1.5">
          {Icon && <Icon className="size-3.5" strokeWidth={3} />}
          {label}
        </span>
        {sublabel && (
          <span className="mt-0.5 text-[8px] font-semibold tracking-[0.18em] opacity-80">
            {sublabel}
          </span>
        )}
      </span>
    </span>
  );
}
