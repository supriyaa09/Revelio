/**
 * Search: the hero screen. One big input, debounced queries against the local
 * FTS index, filter chips, keyboard-first results, and category/kind facets.
 *
 * Keyboard: ↑/↓ moves through results, Enter opens, Esc clears the query.
 * ⌘K / Ctrl+K focuses the input from anywhere (handled in App).
 */

import { useCallback, useEffect, useMemo, useRef, useState, type RefObject } from 'react';
import { SearchX, Search as SearchIcon } from 'lucide-react';
import type { SearchResponse } from '@shared/types';
import { Card, EmptyState, Kbd } from '../components/ui';
import { FileRow } from '../components/FileRow';
import { errorMessage } from '../lib/errors';
import type { View } from '../lib/nav';

const HINTS = [
  'machine learning notes from last semester',
  'resume where I mentioned Next.js',
  'invoice from Amazon in 2024',
  'type:pdf modified:this-month',
  'documents mentioning transformers',
];

export function SearchPage({
  initialQuery,
  onNavigate,
  inputRef,
}: {
  initialQuery?: string;
  onNavigate: (view: View) => void;
  inputRef: RefObject<HTMLInputElement | null>;
}) {
  const [query, setQuery] = useState(initialQuery ?? '');
  const [response, setResponse] = useState<SearchResponse | null>(null);
  const [selected, setSelected] = useState(0);
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const runSearch = useCallback((raw: string) => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      setSearching(true);
      setSearchError(null);
      window.api
        .search(raw)
        .then((res) => {
          setResponse(res);
          setSelected(0);
          setSearching(false);
        })
        .catch((e: unknown) => {
          setSearchError(errorMessage(e));
          setSearching(false);
        });
    }, 150);
  }, []);

  useEffect(() => {
    runSearch(query);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [query, runSearch]);

  const hits = response?.hits ?? [];
  const parsed = response?.parsed ?? null;

  const chips = useMemo(() => {
    if (!parsed) return [];
    const out: { label: string; key: string }[] = [];
    const f = parsed.filters;
    if (f.kind) out.push({ label: `Type: ${f.kind}`, key: 'kind' });
    if (f.extension) out.push({ label: `Type: .${f.extension}`, key: 'extension' });
    if (f.category) out.push({ label: `Category: ${f.category}`, key: 'category' });
    if (f.pathPrefix) out.push({ label: `In: ${f.pathPrefix}`, key: 'in' });
    if (f.dateFrom && f.dateTo) out.push({ label: `${f.dateFrom} → ${f.dateTo}`, key: 'range' });
    else if (f.dateFrom) out.push({ label: `After ${f.dateFrom}`, key: 'dateFrom' });
    else if (f.dateTo) out.push({ label: `Before ${f.dateTo}`, key: 'dateTo' });
    for (const tag of f.tags) out.push({ label: `#${tag}`, key: `tag:${tag}` });
    if (parsed.phrase) out.push({ label: `"${parsed.phrase}"`, key: 'phrase' });
    return out;
  }, [parsed]);

  const openHit = (index: number) => {
    const hit = hits[index];
    if (hit) {
      onNavigate({ name: 'document', id: hit.file.id, from: { name: 'search', query } });
    }
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setSelected((s) => Math.min(s + 1, hits.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setSelected((s) => Math.max(s - 1, 0));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      openHit(selected);
    } else if (e.key === 'Escape') {
      setQuery('');
    }
  };

  useEffect(() => {
    const el = listRef.current?.querySelector<HTMLElement>(`[data-index="${selected}"]`);
    el?.scrollIntoView({ block: 'nearest' });
  }, [selected]);

  const hint = HINTS[Math.floor(Math.random() * HINTS.length)];

  return (
    <div className="flex h-full">
      <div className="flex min-w-0 flex-1 flex-col p-8">
        {/* Query box */}
        <div className="relative mb-3">
          <SearchIcon className="pointer-events-none absolute left-3.5 top-1/2 size-4 -translate-y-1/2 text-faint" />
          <input
            ref={inputRef}
            autoFocus
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={onKeyDown}
            placeholder={`Try "${hint}"`}
            className="w-full rounded-lg border border-line bg-surface py-3 pl-10 pr-16 text-[15px] text-ink shadow-elev-1 placeholder:text-faint focus:border-accent-line focus:outline-none"
          />
          <div className="absolute right-3 top-1/2 flex -translate-y-1/2 items-center gap-1">
            <Kbd>↑↓</Kbd>
            <Kbd>↵</Kbd>
          </div>
        </div>

        {/* Active filter chips */}
        {searchError && (
          <Card className="mb-3 border-danger-line bg-danger-soft px-4 py-2.5 text-[13px] text-danger">
            Search failed: {searchError}
          </Card>
        )}

        {chips.length > 0 && (
          <div className="mb-3 flex flex-wrap items-center gap-1.5">
            {chips.map((chip) => (
              <span
                key={chip.key}
                className="rounded-md border border-accent-line bg-accent-soft px-2 py-0.5 text-[11px] font-medium text-accent-ink"
              >
                {chip.label}
              </span>
            ))}
            {response && (
              <span className="ml-auto text-[11px] tabular-nums text-faint">
                {response.total} results · {response.tookMs} ms
              </span>
            )}
          </div>
        )}

        {/* Results */}
        <div ref={listRef} className="min-h-0 flex-1 overflow-y-auto">
          {searching && !response && (
            <div className="py-10 text-center text-[13px] text-muted">Searching…</div>
          )}

          {response && hits.length === 0 && (
            <EmptyState
              icon={<SearchX className="size-8" />}
              title={query.trim() ? 'No matches' : 'Search your files'}
              hint={
                query.trim()
                  ? 'Try fewer words, a broader filter, or check that the folder containing the file is connected.'
                  : 'Type naturally — "notes about transformers" — or use filters like type:pdf, category:Finance, modified:this-month, in:College.'
              }
            />
          )}

          {hits.length > 0 && (
            <Card className="p-1.5">
              {hits.map((hit, i) => (
                <div key={hit.file.id} data-index={i}>
                  <FileRow
                    file={hit.file}
                    snippet={hit.snippet}
                    active={i === selected}
                    onClick={() => openHit(i)}
                  />
                </div>
              ))}
            </Card>
          )}
        </div>
      </div>

      {/* Facets */}
      {response && response.facets.categories.length > 0 && (
        <aside className="w-56 shrink-0 overflow-y-auto border-l border-line p-5">
          <h3 className="mb-2 text-[11px] font-semibold uppercase tracking-[0.08em] text-faint">
            Categories
          </h3>
          <div className="flex flex-col gap-0.5">
            {response.facets.categories.map((c) => (
              <button
                key={c.name}
                onClick={() => setQuery(`category:"${c.name}"`)}
                className="flex cursor-pointer items-center justify-between rounded px-2 py-1 text-left text-[12px] text-ink-2 transition-colors hover:bg-surface-2"
              >
                <span className="truncate">{c.name}</span>
                <span className="ml-2 shrink-0 tabular-nums text-faint">{c.count}</span>
              </button>
            ))}
          </div>

          <h3 className="mb-2 mt-5 text-[11px] font-semibold uppercase tracking-[0.08em] text-faint">
            Types
          </h3>
          <div className="flex flex-col gap-0.5">
            {response.facets.kinds.map((k) => (
              <button
                key={k.name}
                onClick={() => setQuery(`type:${k.name}`)}
                className="flex cursor-pointer items-center justify-between rounded px-2 py-1 text-left text-[12px] text-ink-2 transition-colors hover:bg-surface-2"
              >
                <span className="truncate">{k.name}</span>
                <span className="ml-2 shrink-0 tabular-nums text-faint">{k.count}</span>
              </button>
            ))}
          </div>
        </aside>
      )}
    </div>
  );
}
