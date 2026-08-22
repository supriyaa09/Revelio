'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import clsx from 'clsx';
import { FileText, FolderTree, Inbox, Search, Upload } from 'lucide-react';
import { canReview } from '@/lib/constants';
import type { AppRole } from '@/lib/types';

export function AppSidebar({ role }: { role: AppRole }) {
  const pathname = usePathname();

  const items = [
    { href: '/workspace', label: 'Workspace', icon: FolderTree },
    { href: '/search', label: 'Search', icon: Search },
    { href: '/upload', label: 'Upload', icon: Upload },
  ];

  // The review queue only exists for roles that can act on it.
  if (canReview(role)) {
    items.push({ href: '/review', label: 'Review queue', icon: Inbox });
  }

  return (
    <aside className="hidden w-60 shrink-0 flex-col border-r border-slate-200 bg-white md:flex">
      <div className="flex h-14 items-center gap-2.5 border-b border-slate-200 px-5">
        <div className="grid size-7 place-items-center rounded-lg bg-brand-600 text-white">
          <FileText className="size-4" />
        </div>
        <span className="font-semibold tracking-tight">DocIntel</span>
      </div>

      <nav className="flex flex-col gap-1 p-3">
        {items.map(({ href, label, icon: Icon }) => {
          const active = pathname === href || pathname.startsWith(`${href}/`);
          return (
            <Link
              key={href}
              href={href}
              className={clsx(
                'flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm font-medium transition',
                active
                  ? 'bg-brand-50 text-brand-700'
                  : 'text-slate-600 hover:bg-slate-50 hover:text-slate-900',
              )}
            >
              <Icon className="size-4" />
              {label}
            </Link>
          );
        })}
      </nav>
    </aside>
  );
}
