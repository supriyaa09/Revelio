/**
 * One file in a list: icon by kind, title, path, category, modified time.
 * Used by the dashboard (recent files) and the search results.
 */

import { FileText, FileImage, FileCode, File, FileType2 } from 'lucide-react';
import type { FileKind, FileRecord } from '@shared/types';
import { Badge } from './ui';
import { Snippet } from './Snippet';
import { formatBytes, shortenPath, timeAgo } from '../lib/format';
import clsx from 'clsx';

export function KindIcon({ kind, className }: { kind: FileKind | null; className?: string }) {
  const cn = clsx('size-4 shrink-0', className);
  switch (kind) {
    case 'pdf':
      return <FileText className={cn} />;
    case 'docx':
      return <FileType2 className={cn} />;
    case 'image':
      return <FileImage className={cn} />;
    case 'md':
    case 'txt':
      return <FileCode className={cn} />;
    default:
      return <File className={cn} />;
  }
}

export function FileRow({
  file,
  snippet,
  active,
  onClick,
}: {
  file: FileRecord;
  snippet?: string | null;
  active?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={clsx(
        'group flex w-full items-start gap-3 rounded-md px-3 py-2.5 text-left transition-colors duration-75 cursor-pointer',
        active ? 'bg-accent-soft' : 'hover:bg-surface-2',
      )}
    >
      <div className="mt-0.5 text-muted group-hover:text-accent-ink">
        <KindIcon kind={file.kind} />
      </div>

      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="truncate text-[13px] font-medium text-ink">
            {file.title ?? file.filename}
          </span>
          {file.category && <Badge tone="accent">{file.category}</Badge>}
          {file.status === 'failed' && <Badge tone="danger">failed</Badge>}
          {file.status === 'processing' && <Badge tone="warn">processing</Badge>}
          {file.status === 'pending' && <Badge tone="neutral">queued</Badge>}
        </div>

        {snippet ? (
          <div className="mt-0.5 line-clamp-2 text-[12px] leading-5 text-muted">
            <Snippet text={snippet} />
          </div>
        ) : (
          <div className="mt-0.5 truncate text-[12px] text-muted">
            {shortenPath(file.path)}
          </div>
        )}
      </div>

      <div className="shrink-0 text-right text-[11px] leading-4 text-faint">
        <div>{timeAgo(file.mtime)}</div>
        <div>{formatBytes(file.size)}</div>
      </div>
    </button>
  );
}
