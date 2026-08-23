'use client';

import { useState } from 'react';
import { Check, Copy } from 'lucide-react';

export function CopyButton({
  text,
  label = 'Copy',
  className = '',
}: {
  text: string;
  label?: string;
  className?: string;
}) {
  const [copied, setCopied] = useState(false);

  async function handleCopy(e: React.MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      // Fallback
    }
  }

  return (
    <button
      type="button"
      onClick={handleCopy}
      title={copied ? 'Copied to clipboard' : `Copy ${label}`}
      className={`inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-xs font-medium transition-all ${
        copied
          ? 'bg-ok-soft text-ok ring-1 ring-ok-line'
          : 'bg-surface-2 text-muted hover:bg-surface-3 hover:text-ink'
      } ${className}`}
    >
      {copied ? (
        <>
          <Check className="size-3 text-ok animate-pop" />
          <span className="text-[11px]">Copied</span>
        </>
      ) : (
        <>
          <Copy className="size-3 text-faint" />
          <span className="text-[11px]">{label}</span>
        </>
      )}
    </button>
  );
}

export function ClickableTag({
  text,
  href,
}: {
  text: string;
  href: string;
}) {
  return (
    <a
      href={href}
      className="chip bg-surface-2 text-xs font-medium text-ink-2 ring-1 ring-line
                 transition-all hover:bg-accent-soft hover:text-accent-ink hover:ring-accent-line"
    >
      {text}
    </a>
  );
}
