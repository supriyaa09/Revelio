import Link from 'next/link';
import clsx from 'clsx';
import type { LucideIcon } from 'lucide-react';
import { CountUp, type NumberFormat } from './metrics';

export type MetricTone = 'accent' | 'ok' | 'warn' | 'info' | 'tier1' | 'tier2';

const TONES: Record<MetricTone, string> = {
  accent: 'text-accent-ink bg-accent-soft ring-accent-line',
  ok: 'text-ok bg-ok-soft ring-ok-line',
  warn: 'text-warn bg-warn-soft ring-warn-line',
  info: 'text-info bg-info-soft ring-info-line',
  tier1: 'text-tier1 bg-tier1-soft ring-tier1-line',
  tier2: 'text-tier2 bg-tier2-soft ring-tier2-line',
};

/**
 * One headline figure.
 *
 * Deliberately NOT a Client Component, though it sits beside them. It takes a
 * `LucideIcon` as a prop, and a component reference cannot cross the
 * server/client boundary — React can only serialize plain data, so an icon
 * passed from a Server Component arrives as `{$$typeof, render}` and throws.
 * Rendering `<Icon />` on this side keeps the icon out of the payload and sends
 * plain markup down. Only `CountUp`, which genuinely needs hooks, is a Client
 * Component.
 *
 * Becomes a link when `href` is given, because a number a reader wants to act on
 * should be the thing they click — not a number beside a button.
 */
export function KpiCard({
  label,
  value,
  format,
  detail,
  icon: Icon,
  tone = 'accent',
  href,
  index = 0,
}: {
  label: string;
  value: number;
  format?: NumberFormat;
  detail?: string;
  icon: LucideIcon;
  tone?: MetricTone;
  href?: string;
  index?: number;
}) {
  const body = (
    <>
      <div className="flex items-start justify-between gap-3">
        <p className="record-label">{label}</p>
        <span
          className={clsx(
            'grid size-7 shrink-0 place-items-center rounded-sm ring-1 ring-inset',
            TONES[tone],
          )}
        >
          <Icon className="size-3.5" />
        </span>
      </div>

      <p className="display mt-3 text-3xl leading-none text-ink">
        <CountUp value={value} format={format} />
      </p>
      {detail && <p className="mt-2 text-[11px] leading-tight text-muted">{detail}</p>}
    </>
  );

  const shell = clsx(
    'card settle-in block p-4 transition-all duration-200',
    href && 'hover:-translate-y-0.5 hover:border-line-2 hover:shadow-e2',
  );

  return href ? (
    <Link href={href} className={shell} style={{ '--i': index } as React.CSSProperties}>
      {body}
    </Link>
  ) : (
    <div className={shell} style={{ '--i': index } as React.CSSProperties}>
      {body}
    </div>
  );
}
