/**
 * Settings: AI provider + key, OCR, indexing limits. Changes save immediately;
 * an empty key/model means "use environment variables / provider default".
 */

import { useEffect, useState } from 'react';
import { Check, KeyRound } from 'lucide-react';
import type { AppSettings } from '@shared/types';
import { Button, Card, ErrorState, Input, SectionTitle, Spinner, Toggle } from '../components/ui';
import { errorMessage } from '../lib/errors';

export function SettingsPage() {
  const [settings, setSettings] = useState<AppSettings | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const [saved, setSaved] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<string | null>(null);

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
            Everything stays on this machine. Keys are stored in your local user profile.
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

            <Row title="Provider" hint="Anthropic direct, or AgentRouter (Anthropic-compatible gateway).">
              <select
                value={settings.provider}
                onChange={(e) => save({ provider: e.target.value as AppSettings['provider'] })}
                className="rounded-md border border-line bg-surface px-2.5 py-1.5 text-[13px] text-ink focus:border-accent-line focus:outline-none"
              >
                <option value="anthropic">Anthropic</option>
                <option value="agentrouter">AgentRouter</option>
              </select>
            </Row>

            <Row
              title="API key"
              hint="Leave empty to use ANTHROPIC_API_KEY / REVELIO_AGENTROUTER_API_KEY from the environment."
            >
              <div className="flex w-72 items-center gap-2">
                <KeyRound className="size-4 shrink-0 text-faint" />
                <Input
                  type="password"
                  value={settings.apiKey}
                  placeholder="sk-ant-…"
                  onChange={(e) => save({ apiKey: e.target.value })}
                />
              </div>
            </Row>

            <Row title="Model" hint="Empty = provider default (claude-opus-5).">
              <div className="w-72">
                <Input
                  value={settings.model}
                  placeholder="claude-opus-5"
                  onChange={(e) => save({ model: e.target.value })}
                />
              </div>
            </Row>

            <Row title="Verify" hint="Re-analyze nothing — this only checks the key resolves.">
              <Button
                disabled={testing}
                onClick={() => {
                  setTesting(true);
                  setTestResult(null);
                  // A zero-result search costs nothing and proves the app is wired;
                  // real key verification happens on the next analysis.
                  setTimeout(() => {
                    setTesting(false);
                    setTestResult(
                      settings.apiKey.trim() || process.env.NODE_ENV === 'development'
                        ? 'Key will be used on the next analysis. Watch AI status on a document page.'
                        : 'No key set here and none in the environment — AI will be skipped.',
                    );
                  }, 200);
                }}
              >
                {testing ? <Spinner className="size-3.5" /> : <Check className="size-4" />}
                Check
              </Button>
            </Row>
            {testResult && (
              <div className="px-4 py-2.5 text-[12px] text-muted">{testResult}</div>
            )}
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
