'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Loader2 } from 'lucide-react';
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

  return (
    <form onSubmit={onSubmit} className="space-y-2">
      <textarea
        rows={2}
        className="input resize-none text-sm"
        placeholder="Add a comment…"
        value={body}
        onChange={(e) => setBody(e.target.value)}
      />
      {error && <p className="text-sm text-red-700">{error}</p>}
      <button type="submit" disabled={saving || !body.trim()} className="btn-secondary">
        {saving && <Loader2 className="size-4 animate-spin" />}
        Comment
      </button>
    </form>
  );
}
