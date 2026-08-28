/**
 * Settings: on-device analysis, OCR, indexing limits. Changes save
 * immediately. Analysis needs no configuration — it runs entirely on this
 * machine.
 */

import { useEffect, useState } from 'react';
import { Check } from 'lucide-react';
import type { AppSettings } from '@shared/types';
import { Card, ErrorState, Input, SectionTitle, Toggle } from '../components/ui';
import { errorMessage } from '../lib/errors';

export function SettingsPage() {
  const [settings, setSettings] = useState<AppSettings | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setError(null);
    window.api
      .getSettings()
      .then((s) => {
        if (!cancelled) setSettings(s);
      })
      .catch((e: unknown) => {
        if (!cancelled) setError(errorMessage(e));
      });
    return () => {
      cancelled = true;
    };
  }, [reloadKey]);

  if (error) {
    return (
      <div className="flex h-full items-center justify-center p-8">
        <ErrorState message={error} onRetry={() => setReloadKey((k) => k + 1)} />
      </div>
    );
  }

  if (!settings) return null;

  const save = (patch: Partial<AppSettings>) => {
    const next = { ...settings, ...patch };
    setSettings(next);
    setSaved(false);
    void window.api.setSettings(patch).then(() => {
      setSaved(true);
      setTimeout(() => setSaved(false), 1500);
    });
  };

  return (
    <div className="h-full overflow-y-auto p-8 fade-up">
      <header className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold tracking-tight text-ink">Settings</h1>
          <p className="mt-0.5 text-[13px] text-muted">
            Everything stays on this machine — indexing and analysis run entirely on this device.
          </p>
        </div>
        {saved && (
          <span className="flex items-center gap-1 text-[12px] font-medium text-ok">
            <Check className="size-3.5" /> Saved
          </span>
        )}
      </header>

      <div className="flex max-w-2xl flex-col gap-6">
        {/* AI */}
        <section>
          <SectionTitle>AI analysis</SectionTitle>
          <Card className="divide-y divide-line">
            <Row
              title="Enable AI enrichment"
              hint="Summaries, keywords, entities, dates, and auto-categorization. Search and OCR work without it."
            >
              <Toggle checked={settings.aiEnabled} onChange={(v) => save({ aiEnabled: v })} />
            </Row>

            <div className="px-4 py-2.5 text-[12px] leading-5 text-muted">
              Analysis runs entirely on this machine with Revelio's built-in engine — no API keys,
              no accounts, and your documents never leave this device.
            </div>
          </Card>
        </section>

        {/* Indexing */}
        <section>
          <SectionTitle>Indexing</SectionTitle>
          <Card className="divide-y divide-line">
            <Row title="OCR for scans and images" hint="Tesseract runs locally and offline.">
              <Toggle checked={settings.ocrEnabled} onChange={(v) => save({ ocrEnabled: v })} />
            </Row>

            <Row title="Max file size (MB)" hint="Larger files are skipped during walks.">
              <div className="w-24">
                <Input
                  type="number"
                  min={1}
                  max={500}
                  value={settings.maxFileSizeMB}
                  onChange={(e) => {
                    const n = parseInt(e.target.value, 10);
                    if (!isNaN(n) && n > 0) save({ maxFileSizeMB: n });
                  }}
                />
              </div>
            </Row>

            <Row
              title="Excluded patterns"
              hint="Folder names to skip anywhere, and *.ext rules. Comma-separated."
            >
              <div className="w-72">
                <Input
                  value={settings.excludePatterns.join(', ')}
                  onChange={(e) =>
                    save({
                      excludePatterns: e.target.value
                        .split(',')
                        .map((s) => s.trim())
                        .filter(Boolean),
                    })
                  }
                />
              </div>
            </Row>
          </Card>
        </section>

        <p className="text-[11px] leading-4 text-faint">
          Revelio is non-custodial: it never copies, moves, or modifies your files. Disconnecting a
          folder deletes only the derived index data.
        </p>
      </div>
    </div>
  );
}

function Row({
  title,
  hint,
  children,
}: {
  title: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex items-center justify-between gap-6 px-4 py-3">
      <div className="min-w-0">
        <div className="text-[13px] font-medium text-ink">{title}</div>
        {hint && <div className="mt-0.5 text-[12px] leading-4 text-muted">{hint}</div>}
      </div>
      <div className="shrink-0">{children}</div>
    </div>
  );
}
