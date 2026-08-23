'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import clsx from 'clsx';
import { FolderTree, Inbox, LayoutDashboard, Plus, Search, Upload } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { ROLE_LABELS, canReview } from '@/lib/constants';
import { Logo } from '@/components/logo';
import type { AppRole } from '@/lib/types';

interface NavItem {
  href: string;
  label: string;
  short: string;
  icon: LucideIcon;
  /** Sidebar heading this item files under. */
  group: string;
}

function navFor(role: AppRole): NavItem[] {
  const items: NavItem[] = [
    {
      href: '/overview',
      label: 'Overview',
      short: 'Home',
      icon: LayoutDashboard,
      group: 'Workspace',
    },
    { href: '/workspace', label: 'Documents', short: 'Files', icon: FolderTree, group: 'Workspace' },
    { href: '/search', label: 'Search', short: 'Search', icon: Search, group: 'Workspace' },
    { href: '/upload', label: 'Upload', short: 'Upload', icon: Upload, group: 'Workspace' },
  ];

  if (canReview(role)) {
    items.push({
      href: '/review',
      label: 'Review queue',
      short: 'Review',
      icon: Inbox,
      group: 'Workflow',
    });
  }
  return items;
}

function isActive(pathname: string, href: string): boolean {
  return pathname === href || pathname.startsWith(`${href}/`);
}

/** Distinct group headings in the order their first item appears. */
function groupsOf(items: NavItem[]): string[] {
  return items.reduce<string[]>((acc, i) => (acc.includes(i.group) ? acc : [...acc, i.group]), []);
}

/**
 * The deep-forest navigation pane.
 *
 * It is the only dark surface in the light theme, so it draws entirely from the
 * `--nav-*` tokens rather than from `--surface` and `--ink`: those two invert
 * between themes, and the pane must stay dark in both.
 */
export function AppSidebar({ role }: { role: AppRole }) {
  const pathname = usePathname();
  const items = navFor(role);

  return (
    <aside
      className="hidden w-[15rem] shrink-0 flex-col border-r border-nav-line bg-nav md:flex"
      style={{ color: 'var(--nav-ink)' }}
    >
      <Link
        href="/workspace"
        className="flex h-16 shrink-0 items-center border-b border-nav-line px-5 transition-opacity hover:opacity-85"
      >
        <Logo size="sm" />
      </Link>

      <nav className="flex flex-1 flex-col gap-0.5 overflow-y-auto p-3">
        {groupsOf(items).map((group) => (
          <div key={group} className="mt-2 first:mt-0">
            <p
              className="px-3 pb-1.5 pt-1 text-[10px] font-bold uppercase"
              style={{ color: 'var(--nav-muted)', letterSpacing: '0.16em' }}
            >
              {group}
            </p>

            {items
              .filter((i) => i.group === group)
              .map(({ href, label, icon: Icon }, i) => {
                const active = isActive(pathname, href);
                return (
                  <Link
                    key={href}
                    href={href}
                    aria-current={active ? 'page' : undefined}
                    style={{ '--i': i } as React.CSSProperties}
                    className={clsx(
                      'group relative flex animate-slide-in items-center gap-3 rounded-md px-3 py-2.5',
                      'text-sm transition-all duration-200',
                      active ? 'font-semibold' : 'font-medium hover:translate-x-0.5',
                    )}
                  >
                    {/* Active field and rail, both scaled rather than toggled,
                        so the indicator reads as sliding into place. */}
                    <span
                      aria-hidden
                      className={clsx(
                        'absolute inset-0 origin-left rounded-md transition-transform duration-300',
                        'ease-[var(--ease-paper)]',
                        active ? 'scale-x-100' : 'scale-x-0',
                      )}
                      style={{ backgroundColor: 'var(--nav-active)' }}
                    />
                    <span
                      aria-hidden
                      className={clsx(
                        'absolute left-0 top-1/2 h-5 w-[2.5px] -translate-y-1/2 origin-center rounded-r-full',
                        'transition-transform duration-300 ease-[var(--ease-spring)]',
                        active ? 'scale-y-100' : 'scale-y-0',
                      )}
                      style={{ backgroundColor: 'var(--accent-line)' }}
                    />

                    <Icon
                      className="relative size-4 shrink-0 transition-transform duration-300 group-hover:scale-110"
                      style={{ color: active ? 'var(--accent-line)' : 'var(--nav-muted)' }}
                    />
                    <span
                      className="relative truncate"
                      style={{ color: active ? 'var(--nav-ink)' : 'var(--nav-muted)' }}
                    >
                      {label}
                    </span>
                  </Link>
                );
              })}
          </div>
        ))}
      </nav>

      {/* ── Access level ─────────────────────────────────────────────────── */}
      <div className="shrink-0 border-t border-nav-line p-3">
        <div
          className="rounded-md p-3"
          style={{ backgroundColor: 'var(--nav-active)' }}
        >
          <div className="flex items-center justify-between">
            <p
              className="text-[9px] font-bold uppercase"
              style={{ color: 'var(--nav-muted)', letterSpacing: '0.16em' }}
            >
              Access level
            </p>
            <span
              className="size-1.5 animate-pulse rounded-full"
              style={{ backgroundColor: 'var(--accent-line)' }}
            />
          </div>
          <p className="mt-1.5 text-xs font-semibold" style={{ color: 'var(--nav-ink)' }}>
            {ROLE_LABELS[role]}
          </p>
        </div>
      </div>
    </aside>
  );
}

/**
 * Mobile navigation.
 *
 * Upload is lifted out of the row into a raised centre action: it is the one
 * thing a person on a phone is most likely here to do, and giving it the same
 * 44px tab as everything else buries the product's entry point.
 */
export function MobileNav({ role }: { role: AppRole }) {
  const pathname = usePathname();
  const items = navFor(role);

  const upload = items.find((i) => i.href === '/upload');
  const rest = items.filter((i) => i.href !== '/upload');
  const mid = Math.ceil(rest.length / 2);

  return (
    <nav
      className="sticky bottom-0 z-20 flex items-stretch border-t border-line bg-surface/95
                 shadow-e3 backdrop-blur-xl md:hidden"
      style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}
    >
      {rest.slice(0, mid).map((item) => (
        <Tab key={item.href} item={item} pathname={pathname} />
      ))}

      {upload && (
        <div className="flex w-16 shrink-0 items-start justify-center">
          <Link
            href={upload.href}
            aria-label="Upload document"
            aria-current={isActive(pathname, upload.href) ? 'page' : undefined}
            className="btn-primary -mt-5 size-12 rounded-full p-0 shadow-e2 ring-4 ring-paper"
          >
            <Plus className="size-5" strokeWidth={2.5} />
          </Link>
        </div>
      )}

      {rest.slice(mid).map((item) => (
        <Tab key={item.href} item={item} pathname={pathname} />
      ))}
    </nav>
  );
}

function Tab({ item, pathname }: { item: NavItem; pathname: string }) {
  const active = isActive(pathname, item.href);
  const Icon = item.icon;

  return (
    <Link
      href={item.href}
      aria-current={active ? 'page' : undefined}
      className={clsx(
        'relative flex min-h-[3.25rem] flex-1 flex-col items-center justify-center gap-1',
        'text-[10px] font-semibold transition-colors duration-200',
        active ? 'text-accent-ink' : 'text-muted hover:text-ink',
      )}
    >
      <span
        aria-hidden
        className={clsx(
          'absolute top-0 h-[2.5px] w-9 rounded-b-full bg-accent origin-center',
          'transition-transform duration-300 ease-[var(--ease-spring)]',
          active ? 'scale-x-100' : 'scale-x-0',
        )}
      />
      <Icon className={clsx('size-[1.15rem] transition-transform duration-300', active && 'scale-110')} />
      {item.short}
    </Link>
  );
}
