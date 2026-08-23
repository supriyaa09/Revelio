'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  ArrowRight,
  CornerDownLeft,
  FileText,
  Inbox,
  LayoutDashboard,
  Loader2,
  LogOut,
  MoonStar,
  Search,
  Sparkles,
  Upload,
  FolderTree,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { createClient } from '@/lib/supabase/client';
import { WORKFLOW_LABELS, canReview } from '@/lib/constants';
import type { AppRole, WorkflowState } from '@/lib/types';

interface Item {
  id: string;
  label: string;
  hint?: string;
  icon: LucideIcon;
  group: string;
  run: () => void;
}

interface DocHit {
  id: string;
  title: string;
  workflow_status: WorkflowState;
  category: { name: string } | null;
}

function score(query: string, text: string): number {
  if (!query) return 0;
  const q = query.toLowerCase();
  const t = text.toLowerCase();

  const at = t.indexOf(q);
  if (at === 0) return 1000;
  if (at > 0) {
    const boundary = at === 0 || /[\s\-_/]/.test(t[at - 1]!);
    return (boundary ? 800 : 600) - at;
  }

  let ti = 0;
  let hits = 0;
  let streak = 0;
  for (const ch of q) {
    const found = t.indexOf(ch, ti);
    if (found === -1) return -1;
    streak = found === ti ? streak + 1 : 0;
    hits += 1 + streak;
    ti = found + 1;
  }
  return 200 + hits - t.length * 0.1;
}

export function CommandPalette({ role }: { role: AppRole }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [leaving, setLeaving] = useState(false);
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const [docs, setDocs] = useState<DocHit[] | null>(null);
  const [loading, setLoading] = useState(false);

  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const signOutRef = useRef<HTMLFormElement>(null);

  const close = useCallback(() => {
    setLeaving(true);
    setTimeout(() => {
      setOpen(false);
      setLeaving(false);
      setQuery('');
      setActive(0);
    }, 150);
  }, []);

  const go = useCallback(
    (href: string) => {
      close();
      router.push(href);
    },
    [close, router],
  );

  // Global hotkey
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'k' && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        setOpen((v) => !v);
        return;
      }
      if (e.key === '/' && !open) {
        const el = document.activeElement;
        const typing =
          el instanceof HTMLElement &&
          (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable);
        if (!typing) {
          e.preventDefault();
          setOpen(true);
        }
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);

  // Open side effects
  useEffect(() => {
    if (!open) return;

    inputRef.current?.focus();

    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    if (docs === null) {
      setLoading(true);
      const supabase = createClient();
      supabase
        .from('documents')
        .select('id, title, workflow_status, category:categories!documents_category_id_fkey (name)')
        .order('updated_at', { ascending: false })
        .limit(50)
        .then(({ data }) => {
          setDocs((data ?? []) as unknown as DocHit[]);
          setLoading(false);
        });
    }

    return () => {
      document.body.style.overflow = prev;
    };
  }, [open, docs]);

  const items = useMemo<Item[]>(() => {
    const nav: Item[] = [
      {
        id: 'nav-overview',
        label: 'Overview',
        hint: 'Headline figures & recent activity',
        icon: LayoutDashboard,
        group: 'Navigate',
        run: () => go('/overview'),
      },
      {
        id: 'nav-workspace',
        label: 'Documents',
        hint: 'Folder tree & file explorer',
        icon: FolderTree,
        group: 'Navigate',
        run: () => go('/workspace'),
      },
      {
        id: 'nav-search',
        label: 'Search',
        hint: 'Full-text AI search & filters',
        icon: Search,
        group: 'Navigate',
        run: () => go('/search'),
      },
      {
        id: 'nav-upload',
        label: 'Upload document',
        hint: 'PDF, PNG or JPEG with auto-filing',
        icon: Upload,
        group: 'Navigate',
        run: () => go('/upload'),
      },
    ];

    if (canReview(role)) {
      nav.push({
        id: 'nav-review',
        label: 'Review queue',
        hint: 'Awaiting institutional approval',
        icon: Inbox,
        group: 'Navigate',
        run: () => go('/review'),
      });
    }

    const documents: Item[] = (docs ?? []).map((d) => ({
      id: `doc-${d.id}`,
      label: d.title,
      hint: [d.category?.name, WORKFLOW_LABELS[d.workflow_status]].filter(Boolean).join(' · '),
      icon: FileText,
      group: 'Documents',
      run: () => go(`/documents/${d.id}`),
    }));

    const actions: Item[] = [
      {
        id: 'act-theme',
        label: 'Toggle theme',
        hint: 'Light / Dark mode',
        icon: MoonStar,
        group: 'Actions',
        run: () => {
          const next = !document.documentElement.classList.contains('dark');
          document.documentElement.classList.toggle('dark', next);
          try {
            localStorage.setItem('revelio-theme', next ? 'dark' : 'light');
          } catch {}
          close();
        },
      },
      {
        id: 'act-signout',
        label: 'Sign out',
        icon: LogOut,
        group: 'Actions',
        run: () => signOutRef.current?.requestSubmit(),
      },
    ];

    return [...nav, ...documents, ...actions];
  }, [role, docs, go, close]);

  const results = useMemo(() => {
    const q = query.trim();
    if (!q) return items;

    return items
      .map((item) => ({
        item,
        s: Math.max(score(q, item.label), score(q, item.hint ?? '') - 150),
      }))
      .filter((r) => r.s >= 0)
      .sort((a, b) => b.s - a.s)
      .map((r) => r.item);
  }, [items, query]);

  useEffect(() => setActive(0), [query]);

  useEffect(() => {
    listRef.current
      ?.querySelector<HTMLElement>('[data-active="true"]')
      ?.scrollIntoView({ block: 'nearest' });
  }, [active, results.length]);

  function onKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'Escape') {
      e.preventDefault();
      close();
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActive((i) => (results.length ? (i + 1) % results.length : 0));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActive((i) => (results.length ? (i - 1 + results.length) % results.length : 0));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      results[active]?.run();
    }
  }

  let lastGroup = '';

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="group flex h-9.5 items-center gap-2.5 rounded-xl border border-line bg-surface/80 px-3
                   text-sm text-faint transition-all duration-200 hover:border-accent-line hover:bg-surface
                   hover:text-muted hover:shadow-xs sm:w-60 sm:justify-between"
      >
        <span className="flex items-center gap-2">
          <Search className="size-4 text-faint transition-transform duration-300 group-hover:scale-110 group-hover:text-accent-ink" />
          <span className="hidden text-xs sm:inline">Search or jump to…</span>
        </span>
        <kbd
          className="hidden rounded-md border border-line bg-surface-2 px-1.5 py-0.5 font-mono
                     text-[10px] font-semibold text-muted sm:block group-hover:border-accent-line/60"
        >
          ⌘K
        </kbd>
      </button>

      <form ref={signOutRef} action="/auth/signout" method="post" className="hidden" />

      {open && (
        <div
          className="fixed inset-0 z-50 flex items-start justify-center px-4 pt-[10vh]"
          role="dialog"
          aria-modal="true"
          aria-label="Command palette"
        >
          <div
            onClick={close}
            className={`absolute inset-0 bg-ink/50 transition-opacity duration-200
                        ${leaving ? 'opacity-0' : 'animate-[fade_0.2s_var(--ease-smooth)_both]'}`}
          />

          <div
            onKeyDown={onKeyDown}
            className={`relative w-full max-w-xl overflow-hidden rounded-2xl border border-line
                        bg-surface shadow-e3 transition-all duration-150
                        ${
                          leaving
                            ? 'translate-y-1 scale-[0.98] opacity-0'
                            : 'animate-[pop_0.24s_var(--ease-spring)_both]'
                        }`}
          >
            {/* Ambient inner glow */}
            <div
              aria-hidden
              className="pointer-events-none absolute -right-20 -top-20 size-48 rounded-full bg-accent/15 blur-3xl"
            />

            <div className="flex items-center gap-3 border-b border-line px-4.5">
              {loading ? (
                <Loader2 className="size-4 shrink-0 animate-spin text-accent" />
              ) : (
                <Search className="size-4 shrink-0 text-accent-ink" />
              )}
              <input
                ref={inputRef}
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search documents, jump to a page, execute actions…"
                aria-label="Search documents and pages"
                className="h-14 w-full bg-transparent text-[0.95rem] text-ink font-medium
                           placeholder:text-faint focus-visible:outline-none"
              />
              <button
                type="button"
                onClick={close}
                className="shrink-0 rounded-md border border-line bg-surface-2 px-1.5 py-0.5
                           font-mono text-[10px] font-semibold text-muted transition-colors hover:text-ink"
              >
                ESC
              </button>
            </div>

            <div ref={listRef} className="max-h-[55vh] overflow-y-auto overscroll-contain p-2">
              {results.length === 0 ? (
                <div className="px-4 py-12 text-center text-sm text-muted">
                  <p>No matches for <span className="font-semibold text-ink">“{query}”</span></p>
                  <p className="mt-1 text-xs text-faint">Try searching by title, category, or workflow status.</p>
                </div>
              ) : (
                results.map((item, i) => {
                  const header = item.group !== lastGroup ? item.group : null;
                  lastGroup = item.group;
                  const isActive = i === active;

                  return (
                    <div key={item.id}>
                      {header && (
                        <div
                          className="flex items-center gap-2 px-3 pb-1 pt-3 text-[10px] font-bold uppercase
                                     tracking-wider text-faint"
                        >
                          <Sparkles className="size-2.5 text-accent" />
                          {header}
                        </div>
                      )}
                      <button
                        type="button"
                        data-active={isActive}
                        onMouseMove={() => setActive(i)}
                        onClick={item.run}
                        className={`flex w-full items-center gap-3 rounded-xl px-3.5 py-2.5 text-left
                                    transition-all duration-150
                                    ${isActive ? 'bg-accent-soft text-ink ring-1 ring-inset ring-accent-line shadow-xs' : 'text-ink-2 hover:bg-surface-2'}`}
                      >
                        <div
                          className={`grid size-7 shrink-0 place-items-center rounded-lg transition-colors
                                      ${isActive ? 'bg-surface text-accent-ink shadow-xs' : 'bg-surface-2 text-faint'}`}
                        >
                          <item.icon className="size-4" />
                        </div>
                        <span className="min-w-0 flex-1">
                          <span
                            className={`block truncate text-sm ${
                              isActive ? 'font-semibold text-ink' : 'font-medium text-ink-2'
                            }`}
                          >
                            {item.label}
                          </span>
                          {item.hint && (
                            <span className="block truncate text-xs text-muted">{item.hint}</span>
                          )}
                        </span>
                        {isActive && (
                          <ArrowRight
                            className="size-4 shrink-0 text-accent-ink
                                       animate-[slide-in_0.2s_var(--ease-smooth)_both]"
                          />
                        )}
                      </button>
                    </div>
                  );
                })
              )}
            </div>

            <div
              className="flex items-center gap-4 border-t border-line bg-surface-2/70 px-4 py-2.5
                         text-[11px] text-muted"
            >
              <span className="flex items-center gap-1.5">
                <kbd className="rounded border border-line bg-surface px-1 py-0.5 font-mono text-[10px]">↑↓</kbd>
                navigate
              </span>
              <span className="flex items-center gap-1.5">
                <kbd className="rounded border border-line bg-surface px-1 py-0.5 font-mono text-[10px]">
                  <CornerDownLeft className="size-2.5" />
                </kbd>
                select
              </span>
              <span className="ml-auto font-mono text-[10px] tabular-nums font-semibold">
                {results.length} {results.length === 1 ? 'match' : 'matches'}
              </span>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
