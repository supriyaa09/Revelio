import React from 'react';

/**
 * The Revelio mark: the letter R, a document page, and a folded corner, drawn as
 * one object.
 *
 * Every colour is a token and the wordmark inherits `currentColor`, so the same
 * component sits correctly on ivory, on cream, and on the deep-forest sidebar
 * without a variant prop — which is what stops three near-identical logos from
 * accumulating in the codebase.
 */
export function RevelioIcon({
  className = 'size-8',
  style,
}: {
  className?: string;
  style?: React.CSSProperties;
}) {
  return (
    <svg
      viewBox="0 0 52 64"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      style={style}
      aria-hidden="true"
    >
      {/* The sheet, with its top-right corner turned down. */}
      <path
        d="M5 4H33L47 18V60H5Z"
        fill="var(--surface)"
        stroke="var(--line-2)"
        strokeWidth="2"
        strokeLinejoin="round"
      />
      {/* The underside of the fold — a shade darker, as paper is. */}
      <path d="M33 4V18H47Z" fill="var(--accent-line)" stroke="none" />
      <path
        d="M33 4V18H47"
        stroke="var(--line-2)"
        strokeWidth="2"
        strokeLinejoin="round"
        fill="none"
      />

      {/* The R, cut geometrically so it reads as printed rather than typeset. */}
      <path
        d="M16 45V17H27A7.5 7.5 0 0 1 27 32H16"
        stroke="var(--accent-ink)"
        strokeWidth="5"
        strokeLinecap="round"
        strokeLinejoin="round"
        fill="none"
      />
      <path
        d="M26.5 32L35 45"
        stroke="var(--accent-ink)"
        strokeWidth="5"
        strokeLinecap="round"
        fill="none"
      />

      {/* Two rules of body copy. At small sizes they read as texture, which is
          exactly the intent — the mark should feel like a page of something. */}
      <path
        d="M14 52H31M14 56.5H25"
        stroke="var(--line-2)"
        strokeWidth="2.5"
        strokeLinecap="round"
      />
    </svg>
  );
}

const ICON_SIZES = { sm: 'size-7', md: 'size-9', lg: 'size-12' } as const;
const TITLE_SIZES = { sm: 'text-base', md: 'text-xl', lg: 'text-3xl' } as const;
/* Inline, because the `display` utility also sets letter-spacing and utility
   ordering between the two is not something to rely on. */
const TRACKING = { sm: '0.16em', md: '0.2em', lg: '0.24em' } as const;

/**
 * Mark plus wordmark.
 *
 * The wordmark is set in the display serif at wide tracking and takes its colour
 * from the parent, so placing it on the forest sidebar is a matter of setting a
 * text colour there rather than passing a theme down.
 */
export function Logo({
  showSubtitle = true,
  className = '',
  size = 'md',
}: {
  showSubtitle?: boolean;
  className?: string;
  size?: 'sm' | 'md' | 'lg';
}) {
  return (
    <div className={`flex items-center gap-2.5 ${className}`}>
      <RevelioIcon className={`${ICON_SIZES[size]} shrink-0`} />
      <div className="flex min-w-0 flex-col justify-center">
        <span
          className={`display font-semibold leading-none ${TITLE_SIZES[size]}`}
          style={{ letterSpacing: TRACKING[size] }}
        >
          REVELIO
        </span>
        {showSubtitle && (
          <span
            className="mt-1.5 truncate text-[9px] font-bold uppercase opacity-65"
            style={{ letterSpacing: '0.14em' }}
          >
            Reveal. Organize. Intelligently.
          </span>
        )}
      </div>
    </div>
  );
}
