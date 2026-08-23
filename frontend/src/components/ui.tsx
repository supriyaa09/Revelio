import type { LucideIcon } from 'lucide-react';
import { Sparkles } from 'lucide-react';

/**
 * Delay token for staggered entrance animations. Pair with the `rise-in` or
 * `fade-in` utility, which reads `--i` to derive its own `animation-delay`.
 */
export function stagger(i: number): React.CSSProperties {
  return { '--i': i } as React.CSSProperties;
}

/**
 * Page title block.
 *
 * The title is set in the display serif and the eyebrow in the record register,
 * so every page opens the way a document opens: a classification line, a title,
 * then the body. `meta` takes the small caps-and-tracking facts that belong to
 * the page itself — a count, a document id, a date range.
 */
export function PageHeader({
  title,
  description,
  action,
  eyebrow,
  meta,
}: {
  title: string;
  description?: React.ReactNode;
  action?: React.ReactNode;
  eyebrow?: string;
  meta?: React.ReactNode;
}) {
  return (
    <div className="relative mb-7 flex flex-wrap items-end justify-between gap-x-6 gap-y-4">
      <div className="min-w-0">
        {eyebrow && (
          <div className="mb-2.5 flex items-center gap-1.5">
            <span className="record-label flex items-center gap-1.5 text-accent-ink">
              <Sparkles className="size-3" />
              {eyebrow}
            </span>
          </div>
        )}
        <h1 className="display text-[1.75rem] leading-tight text-ink sm:text-4xl">{title}</h1>
        {description && (
          <p className="mt-2 max-w-prose text-sm leading-relaxed text-muted">{description}</p>
        )}
        {meta && (
          <div className="mt-3 flex flex-wrap items-center gap-x-5 gap-y-1">{meta}</div>
        )}
      </div>
      {action && <div className="shrink-0">{action}</div>}
    </div>
  );
}

/** One small caps-and-tracking fact for `PageHeader`'s `meta` row. */
export function HeaderFact({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <span className="flex items-baseline gap-1.5">
      <span className="record-label">{label}</span>
      <span className="font-mono text-xs font-semibold tabular-nums text-ink-2">{value}</span>
    </span>
  );
}

/**
 * Metric summary card for dashboards and workspaces.
 */
export function MetricCard({
  label,
  value,
  icon: Icon,
  trend,
  tone = 'accent',
}: {
  label: string;
  value: string | number;
  icon: LucideIcon;
  trend?: string;
  tone?: 'accent' | 'ok' | 'info' | 'tier1' | 'tier2' | 'warn';
}) {
  const toneMap = {
    accent: 'bg-accent-soft text-accent-ink ring-accent-line',
    ok: 'bg-ok-soft text-ok ring-ok-line',
    info: 'bg-info-soft text-info ring-info-line',
    tier1: 'bg-tier1-soft text-tier1 ring-tier1-line',
    tier2: 'bg-tier2-soft text-tier2 ring-tier2-line',
    warn: 'bg-warn-soft text-warn ring-warn-line',
  };

  return (
    <div className="card-interactive relative flex items-center justify-between overflow-hidden p-4 sm:p-5">
      <div>
        <p className="text-xs font-medium uppercase tracking-wider text-faint">{label}</p>
        <p className="mt-1 font-mono text-2xl font-bold tracking-tight text-ink sm:text-3xl">
          {value}
        </p>
        {trend && <p className="mt-1 text-xs text-muted">{trend}</p>}
      </div>
      <div className={`grid size-12 shrink-0 place-items-center rounded-2xl ring-1 ring-inset ${toneMap[tone]}`}>
        <Icon className="size-6 transition-transform duration-300 group-hover:scale-110" />
      </div>
    </div>
  );
}

/**
 * Empty state.
 *
 * Never "no data": the illustration is a blank sheet with its corner turned,
 * which says the same thing while staying inside the product's own vocabulary.
 */
export function EmptyState({
  icon: Icon,
  title,
  description,
  action,
}: {
  icon: LucideIcon;
  title: string;
  description: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="card flex animate-pop flex-col items-center gap-5 px-6 py-16 text-center">
      {/* A blank sheet, dog-eared, with two ruled lines and the caller's glyph
          resting on it. */}
      <div aria-hidden className="relative animate-float">
        <span className="absolute -left-2 top-1.5 h-16 w-12 rotate-[-7deg] rounded-sm border border-line bg-surface-2" />
        <span className="relative grid h-16 w-12 place-items-center rounded-sm border border-line-2 bg-surface shadow-e1">
          <span className="absolute right-0 top-0 size-3.5 border-b border-l border-line-2 bg-surface-2" />
          <span className="absolute inset-x-2.5 top-6 h-px bg-line" />
          <span className="absolute inset-x-2.5 top-9 h-px bg-line" />
          <Icon className="relative mb-1 size-4 text-accent-ink" />
        </span>
      </div>

      <div className="max-w-sm">
        <h3 className="display text-lg text-ink">{title}</h3>
        <p className="mt-2 text-sm leading-relaxed text-muted">{description}</p>
      </div>
      {action && <div className="mt-1">{action}</div>}
    </div>
  );
}

/** Inline error surface with high-contrast alert styling. */
export function ErrorNote({ children }: { children: React.ReactNode }) {
  return (
    <p
      role="alert"
      className="animate-pop rounded-xl border border-danger-line bg-danger-soft px-4 py-3
                 text-sm font-medium text-danger shadow-e1"
    >
      {children}
    </p>
  );
}

/** Small key/value pair used in metadata grids. */
export function Field({
  label,
  value,
  badge,
}: {
  label: string;
  value: string | null | undefined;
  badge?: string;
}) {
  return (
    <div className="rounded-lg p-2 transition-colors hover:bg-surface-2/60">
      <dt className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-faint">
        {label}
        {badge && value && (
          <span className="rounded-md bg-accent-soft px-1.5 py-px text-[10px] font-medium normal-case tracking-normal text-accent-ink ring-1 ring-accent-line">
            {badge}
          </span>
        )}
      </dt>
      <dd className="mt-1 text-sm font-medium text-ink">
        {value || <span className="text-faint font-normal">Not set</span>}
      </dd>
    </div>
  );
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
}

export function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString(undefined, {
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });
}

/** "3 days ago" for recency, falling back to an absolute date past a month. */
export function formatRelative(iso: string): string {
  const then = new Date(iso).getTime();
  const mins = Math.round((Date.now() - then) / 60000);

  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  if (mins < 1440) return `${Math.round(mins / 60)}h ago`;
  if (mins < 43200) return `${Math.round(mins / 1440)}d ago`;
  return formatDate(iso);
}
