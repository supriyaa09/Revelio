'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Loader2, MessageSquarePlus, Send } from 'lucide-react';
import { addComment } from '@/lib/actions/documents';

export function CommentForm({ documentId }: { documentId: string }) {
  const router = useRouter();
  const [body, setBody] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [, startTransition] = useTransition();

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!body.trim()) return;

    setError(null);
    setSaving(true);
    const result = await addComment(documentId, body);
    setSaving(false);

    if (!result.ok) {
      setError(result.message);
      return;
    }
    setBody('');
    startTransition(() => router.refresh());
  }

  const ready = body.trim().length > 0;

  return (
    <form onSubmit={onSubmit} className="space-y-2">
      <textarea
        rows={2}
        className="input resize-none text-sm"
        placeholder="Add a review note, question, or comment for the audit thread…"
        value={body}
        onChange={(e) => setBody(e.target.value)}
      />

      <div
        className={`grid overflow-hidden transition-all duration-300 ease-[var(--ease-smooth)] ${
          ready || error ? 'max-h-24 opacity-100' : 'max-h-0 opacity-0'
        }`}
      >
        <div className="flex items-center justify-between gap-3 pt-1">
          <button type="submit" disabled={saving || !ready} className="btn-primary px-4 py-1.5 text-xs font-semibold shadow-xs">
            {saving ? (
              <Loader2 className="size-3.5 animate-spin" />
            ) : (
              <Send className="size-3.5" />
            )}
            Post Comment
          </button>
          {error && (
            <p role="alert" className="text-xs font-medium text-danger">
              {error}
            </p>
          )}
        </div>
      </div>
    </form>
  );
}
