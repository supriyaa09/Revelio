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
      <div className="hidden text-right sm:block">
        <div className="text-sm font-medium leading-tight">{fullName || email}</div>
        <div className="text-xs text-slate-500">{ROLE_LABELS[role]}</div>
      </div>
      <div className="grid size-8 place-items-center rounded-full bg-slate-200 text-xs font-semibold text-slate-700">
        {initials}
      </div>
      <form action="/auth/signout" method="post">
        <button
          type="submit"
          title="Sign out"
          aria-label="Sign out"
          className="grid size-8 place-items-center rounded-lg text-slate-500 transition hover:bg-slate-100 hover:text-slate-900"
        >
          <LogOut className="size-4" />
        </button>
      </form>
    </div>
  );
}
