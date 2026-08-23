import { LogOut } from 'lucide-react';
import { ROLE_LABELS } from '@/lib/constants';
import type { AppRole } from '@/lib/types';

export function UserMenu({
  fullName,
  email,
  role,
}: {
  fullName: string;
  email: string;
  role: AppRole;
}) {
  const initials =
    fullName
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((p) => p[0]?.toUpperCase())
      .join('') || email[0]?.toUpperCase();

  return (
    <div className="flex items-center gap-3">
      <div className="hidden text-right leading-tight sm:block">
        <div className="text-sm font-semibold text-ink">{fullName || email}</div>
        <div className="text-[10px] font-bold uppercase tracking-wider text-accent-ink">{ROLE_LABELS[role]}</div>
      </div>

      <div
        title={`${fullName || email} (${ROLE_LABELS[role]})`}
        className="relative grid size-9 shrink-0 place-items-center rounded-xl bg-gradient-to-br from-accent-soft to-surface-2
                   font-mono text-xs font-bold text-accent-ink ring-1 ring-accent-line shadow-xs transition-transform hover:scale-105"
      >
        {initials}
      </div>

      <form action="/auth/signout" method="post">
        <button
          type="submit"
          title="Sign out"
          aria-label="Sign out"
          className="group grid size-9 place-items-center rounded-xl border border-line bg-surface text-muted transition-all
                     hover:border-danger-line hover:bg-danger-soft hover:text-danger shadow-xs"
        >
          <LogOut
            className="size-4 transition-transform duration-300
                       group-hover:translate-x-0.5"
          />
        </button>
      </form>
    </div>
  );
}
