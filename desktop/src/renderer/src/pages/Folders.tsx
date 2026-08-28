/**
 * Connected Folders: the roots Revelio indexes and watches. Files never move —
 * connecting a folder only creates derived data in the local index.
 */

import { useCallback, useEffect, useState } from 'react';
import { Eye, EyeOff, FolderOpen, FolderPlus, RefreshCw, Sparkles, Trash2 } from 'lucide-react';
import type { FolderRecord } from '@shared/types';
import { Badge, Button, Card, EmptyState, SectionTitle, Toggle } from '../components/ui';
import { errorMessage } from '../lib/errors';
import { timeAgo } from '../lib/format';

export function Folders({ dataVersion }: { dataVersion: number }) {
  const [folders, setFolders] = useState<FolderRecord[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<number | null>(null);

  const load = useCallback(() => {
    window.api
      .listFolders()
      .then(setFolders)
      .catch((e: unknown) => setError(errorMessage(e)));
  }, []);

  useEffect(() => {
    load();
  }, [load, dataVersion]);

  const addFolder = async () => {
    setError(null);
    const path = await window.api.pickFolder();
    if (!path) return;
    try {
      await window.api.addFolder(path);
      load();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  const removeFolder = async (folder: FolderRecord) => {
    const ok = window.confirm(
      `Disconnect "${folder.label ?? folder.path}"?\n\nThis removes its entries from the index. Your files are not touched.`,
    );
    if (!ok) return;
    await window.api.removeFolder(folder.id);
    load();
  };

  return (
    <div className="h-full overflow-y-auto p-8 fade-up">
      <header className="mb-6 flex items-end justify-between">
        <div>
          <h1 className="text-xl font-semibold tracking-tight text-ink">Connected folders</h1>
          <p className="mt-0.5 text-[13px] text-muted">
            Indexed in place, watched for changes. Files never leave your disk.
          </p>
        </div>
        <Button variant="primary" onClick={() => void addFolder()}>
          <FolderPlus className="size-4" />
          Connect folder
        </Button>
      </header>

      {error && (
        <Card className="mb-4 border-danger-line bg-danger-soft px-4 py-2.5 text-[13px] text-danger">
          {error}
        </Card>
      )}

      {folders.length === 0 ? (
        <EmptyState
          icon={<FolderOpen className="size-8" />}
          title="Nothing connected yet"
          hint="Connect Documents, Downloads, college notes — any folder you want to search. New files that appear are picked up automatically."
          action={
            <Button variant="primary" onClick={() => void addFolder()}>
              <FolderPlus className="size-4" />
              Connect your first folder
            </Button>
          }
        />
      ) : (
        <div className="flex flex-col gap-3">
          {folders.map((folder) => (
            <Card key={folder.id} className="px-4 py-3">
              <div className="flex items-center gap-3">
                <FolderOpen className="size-5 shrink-0 text-muted" />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="text-[14px] font-medium text-ink">
                      {folder.label ?? folder.path}
                    </span>
                    <Badge tone="ok">{folder.ready_count} indexed</Badge>
                    {folder.failed_count > 0 && <Badge tone="danger">{folder.failed_count} failed</Badge>}
                  </div>
                  <div className="mt-0.5 truncate font-mono text-[11px] text-faint">{folder.path}</div>
                  <div className="mt-0.5 text-[11px] text-faint">
                    Last indexed {timeAgo(folder.last_indexed_at)}
                  </div>
                </div>

                <div className="flex shrink-0 items-center gap-4">
                  <label className="flex items-center gap-2 text-[12px] text-muted">
                    <Sparkles className="size-3.5" />
                    AI
                    <Toggle
                      checked={folder.ai_enabled}
                      onChange={(next) => void window.api.setFolderAi(folder.id, next).then(load)}
                    />
                  </label>
                  <label className="flex items-center gap-2 text-[12px] text-muted">
                    {folder.watch ? <Eye className="size-3.5" /> : <EyeOff className="size-3.5" />}
                    Watch
                    <Toggle
                      checked={folder.watch}
                      onChange={(next) => void window.api.setFolderWatch(folder.id, next).then(load)}
                    />
                  </label>

                  <Button
                    variant="ghost"
                    disabled={busyId === folder.id}
                    onClick={() => {
                      setBusyId(folder.id);
                      window.api.reindexFolder(folder.id).finally(() => setBusyId(null));
                    }}
                    title="Re-index this folder"
                  >
                    <RefreshCw className="size-4" />
                  </Button>
                  <Button variant="ghost" onClick={() => void removeFolder(folder)} title="Disconnect">
                    <Trash2 className="size-4 text-danger" />
                  </Button>
                </div>
              </div>
            </Card>
          ))}
        </div>
      )}

      <SectionTitle>
        <span className="mt-8 inline-block">How indexing works</span>
      </SectionTitle>
      <Card className="px-4 py-3 text-[12px] leading-5 text-muted">
        Revelio reads each file where it lives, extracts text (with OCR for scans), and stores only
        derived data — text, metadata, search index — in a local database. Exclusions like
        node_modules and hidden files are skipped; limits and patterns can be adjusted in Settings.
      </Card>
    </div>
  );
}
