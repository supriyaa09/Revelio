/**
 * UI primitives. Minimal, dense, token-driven — no hard-coded colours.
 */

import clsx from 'clsx';
import { AlertTriangle, RefreshCw } from 'lucide-react';
import type { ButtonHTMLAttributes, InputHTMLAttributes, ReactNode } from 'react';

type ButtonVariant = 'primary' | 'default' | 'ghost' | 'danger';

export function Button({
  variant = 'default',
  className,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: ButtonVariant }) {
  return (
    <button
      className={clsx(
        'inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-[13px] font-medium',
        'transition-colors duration-100 disabled:opacity-50 disabled:pointer-events-none',
        'focus-visible:outline-2 focus-visible:outline-accent-line cursor-pointer',
        variant === 'primary' && 'bg-accent text-accent-on hover:bg-accent-hover shadow-elev-1',
        variant === 'default' && 'bg-surface border border-line text-ink hover:bg-surface-2',
        variant === 'ghost' && 'text-muted hover:text-ink hover:bg-surface-2',
        variant === 'danger' && 'bg-danger-soft border border-danger-line text-danger hover:opacity-80',
        className,
      )}
      {...props}
    />
  );
}

export function Input({ className, ...props }: InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      className={clsx(
        'w-full rounded-md border border-line bg-surface px-3 py-1.5 text-[13px] text-ink',
        'placeholder:text-faint focus:outline-none focus:border-accent-line',
        className,
      )}
      {...props}
    />
  );
}

type BadgeTone = 'neutral' | 'accent' | 'ok' | 'info' | 'warn' | 'danger';

export function Badge({
  tone = 'neutral',
  className,
  children,
}: {
  tone?: BadgeTone;
  className?: string;
  children: ReactNode;
}) {
  return (
    <span
      className={clsx(
        'inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[11px] font-medium leading-4 whitespace-nowrap',
        tone === 'neutral' && 'bg-neutral-soft text-muted border border-neutral-line',
        tone === 'accent' && 'bg-accent-soft text-accent-ink border border-accent-line',
        tone === 'ok' && 'bg-ok-soft text-ok border border-ok-line',
        tone === 'info' && 'bg-info-soft text-info border border-info-line',
        tone === 'warn' && 'bg-warn-soft text-warn border border-warn-line',
        tone === 'danger' && 'bg-danger-soft text-danger border border-danger-line',
        className,
      )}
    >
      {children}
    </span>
  );
}

export function Card({ className, children }: { className?: string; children: ReactNode }) {
  return (
    <div className={clsx('rounded-lg border border-line bg-surface shadow-elev-1', className)}>
      {children}
    </div>
  );
}

export function EmptyState({
  icon,
  title,
  hint,
  action,
}: {
  icon?: ReactNode;
  title: string;
  hint?: string;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 py-16 text-center fade-up">
      {icon && <div className="text-faint mb-1">{icon}</div>}
      <div className="text-[15px] font-semibold text-ink-2">{title}</div>
      {hint && <div className="max-w-sm text-[13px] text-muted">{hint}</div>}
      {action && <div className="mt-3">{action}</div>}
    </div>
  );
}

export function ErrorState({
  message,
  onRetry,
}: {
  message: string;
  onRetry?: () => void;
}) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 py-16 text-center fade-up">
      <div className="mb-1 text-danger">
        <AlertTriangle className="size-8" />
      </div>
      <div className="text-[15px] font-semibold text-ink-2">Something went wrong</div>
      <div className="max-w-md break-words text-[13px] text-muted">{message}</div>
      {onRetry && (
        <div className="mt-3">
          <Button onClick={onRetry}>
            <RefreshCw className="size-3.5" />
            Try again
          </Button>
        </div>
      )}
    </div>
  );
}

export function Spinner({ className }: { className?: string }) {
  return (
    <span
      className={clsx(
        'inline-block size-4 animate-spin rounded-full border-2 border-line-2 border-t-accent',
        className,
      )}
    />
  );
}

export function ProgressBar({ value, className }: { value: number; className?: string }) {
  const pct = Math.max(0, Math.min(100, Math.round(value * 100)));
  return (
    <div className={clsx('h-1.5 w-full overflow-hidden rounded-full bg-surface-3', className)}>
      <div
        className="h-full rounded-full bg-accent transition-[width] duration-300"
        style={{ width: `${pct}%` }}
      />
    </div>
  );
}

export function Kbd({ children }: { children: ReactNode }) {
  return (
    <kbd className="rounded border border-line bg-surface-2 px-1.5 py-0.5 font-mono text-[10px] text-muted">
      {children}
    </kbd>
  );
}

export function Toggle({
  checked,
  onChange,
  disabled,
}: {
  checked: boolean;
  onChange: (next: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={clsx(
        'relative h-5 w-9 rounded-full transition-colors duration-150 cursor-pointer',
        'focus-visible:outline-2 focus-visible:outline-accent-line disabled:opacity-50',
        checked ? 'bg-accent' : 'bg-surface-3',
      )}
    >
      <span
        className={clsx(
          'absolute top-0.5 size-4 rounded-full bg-surface shadow-elev-1 transition-all duration-150',
          checked ? 'left-[18px]' : 'left-0.5',
        )}
      />
    </button>
  );
}

export function SectionTitle({ children, right }: { children: ReactNode; right?: ReactNode }) {
  return (
    <div className="mb-3 flex items-center justify-between">
      <h2 className="text-[11px] font-semibold uppercase tracking-[0.08em] text-faint">{children}</h2>
      {right}
    </div>
  );
}
