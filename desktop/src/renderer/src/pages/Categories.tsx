/**
 * Categories: the analyzer-suggested shelves of the library, with counts.
 * No hardcoded taxonomy — everything here was coined by the local analyzer
 * from the user's own documents. Clicking one opens a filtered search.
 */

import { useEffect, useState } from 'react';
import { Tags } from 'lucide-react';
import type { Stats } from '@shared/types';
import { Card, EmptyState, ErrorState } from '../components/ui';
import { errorMessage } from '../lib/errors';
import type { View } from '../lib/nav';

export function Categories({
  dataVersion,
  onNavigate,
}: {
  dataVersion: number;
  onNavigate: (view: View) => void;
}) {
  const [stats, setStats] = useState<Stats | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setError(null);
    window.api
      .getStats()
      .then((s) => {
        if (!cancelled) setStats(s);
      })
      .catch((e: unknown) => {
        if (!cancelled) setError(errorMessage(e));
      });
    return () => {
      cancelled = true;
    };
  }, [dataVersion, reloadKey]);

  if (error) {
    return (
      <div className="flex h-full items-center justify-center p-8">
        <ErrorState message={error} onRetry={() => setReloadKey((k) => k + 1)} />
      </div>
    );
  }

  if (!stats) return null;

  return (
    <div className="h-full overflow-y-auto p-8 fade-up">
      <header className="mb-6">
        <h1 className="text-xl font-semibold tracking-tight text-ink">Categories</h1>
        <p className="mt-0.5 text-[13px] text-muted">
          Suggested automatically from your documents — no fixed taxonomy.
        </p>
      </header>

      {stats.categories.length === 0 ? (
        <EmptyState
          icon={<Tags className="size-8" />}
          title="No categories yet"
          hint="Categories appear once documents are analyzed. Add an API key in Settings and index a folder to get started."
        />
      ) : (
        <div className="grid grid-cols-3 gap-3">
          {stats.categories.map((c) => (
            <button
              key={c.name}
              onClick={() => onNavigate({ name: 'search', query: `category:"${c.name}"` })}
              className="cursor-pointer rounded-lg border border-line bg-surface px-4 py-3 text-left shadow-elev-1 transition-all hover:border-accent-line hover:shadow-elev-2"
            >
              <div className="truncate text-[14px] font-medium text-ink">{c.name}</div>
              <div className="mt-0.5 text-[12px] tabular-nums text-muted">
                {c.count} {c.count === 1 ? 'file' : 'files'}
              </div>
            </button>
          ))}
        </div>
      )}

      {stats.categories.length > 0 && (
        <Card className="mt-6 px-4 py-3 text-[12px] leading-5 text-muted">
          Category names are suggested during on-device analysis and stabilise over time: the
          analyzer sees the existing list and reuses names where documents clearly fit.
        </Card>
      )}
    </div>
  );
}
