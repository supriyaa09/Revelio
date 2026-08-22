'use client';

import { useRef, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { FileUp, Loader2, X } from 'lucide-react';
import { uploadDocument } from '@/lib/actions/documents';
import { ALLOWED_MIME_TYPES, MAX_FILE_BYTES } from '@/lib/constants';
import { deriveTitle } from '@/lib/classify';
import { formatBytes } from '@/components/ui';

interface Option {
  id: string;
  name: string;
  department_id?: string;
}

export function UploadForm({
  departments,
  categories,
}: {
  departments: Option[];
  categories: Option[];
}) {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [title, setTitle] = useState('');
  const [titleEdited, setTitleEdited] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const [pending, startTransition] = useTransition();

  function acceptFile(next: File | null) {
    setError(null);
    if (!next) return;

    if (next.size > MAX_FILE_BYTES) {
      setError(`"${next.name}" is ${formatBytes(next.size)}. The limit is 25 MB.`);
      return;
    }
    if (!ALLOWED_MIME_TYPES.includes(next.type as (typeof ALLOWED_MIME_TYPES)[number])) {
      setError('Only PDF, PNG and JPEG files are accepted.');
      return;
    }

    setFile(next);
    // Prefill the title from the filename until the user types their own.
    if (!titleEdited) setTitle(deriveTitle(next.name));
  }

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);

    if (!file) {
      setError('Choose a file to upload.');
      return;
    }

    const formData = new FormData(event.currentTarget);
    formData.set('file', file);

    const result = await uploadDocument(formData);

    if (!result.ok) {
      setError(result.message);
      return;
    }
    startTransition(() => {
      router.push(`/documents/${result.data.id}`);
      router.refresh();
    });
  }

  const busy = pending;

  return (
    <form onSubmit={onSubmit} className="card space-y-5 p-6">
      {/* Drop zone */}
      <div
        onDragOver={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragging(false);
          acceptFile(e.dataTransfer.files[0] ?? null);
        }}
        className={`rounded-xl border-2 border-dashed px-6 py-8 text-center transition ${
          dragging ? 'border-brand-500 bg-brand-50' : 'border-slate-300 bg-slate-50'
        }`}
      >
        {file ? (
          <div className="flex items-center justify-center gap-3">
            <div className="text-left">
              <div className="text-sm font-medium">{file.name}</div>
              <div className="text-xs text-slate-500">
                {formatBytes(file.size)} · {file.type}
              </div>
            </div>
            <button
              type="button"
              onClick={() => {
                setFile(null);
                if (inputRef.current) inputRef.current.value = '';
              }}
              className="grid size-7 place-items-center rounded-lg text-slate-500 hover:bg-slate-200"
              aria-label="Remove file"
            >
              <X className="size-4" />
            </button>
          </div>
        ) : (
          <>
            <FileUp className="mx-auto size-6 text-slate-400" />
            <p className="mt-2 text-sm text-slate-600">
              Drag a file here, or{' '}
              <button
                type="button"
                onClick={() => inputRef.current?.click()}
                className="font-medium text-brand-600 hover:underline"
              >
                browse
              </button>
            </p>
            <p className="mt-1 text-xs text-slate-500">PDF, PNG or JPEG · up to 25 MB</p>
          </>
        )}

        <input
          ref={inputRef}
          type="file"
          name="file_input"
          accept=".pdf,.png,.jpg,.jpeg,application/pdf,image/png,image/jpeg"
          className="sr-only"
          onChange={(e) => acceptFile(e.target.files?.[0] ?? null)}
        />
      </div>

      <div className="space-y-1.5">
        <label htmlFor="title" className="label">
          Title
        </label>
        <input
          id="title"
          name="title"
          className="input"
          value={title}
          onChange={(e) => {
            setTitle(e.target.value);
            setTitleEdited(true);
          }}
          placeholder="Annual Budget Proposal 2026"
        />
      </div>

      <div className="space-y-1.5">
        <label htmlFor="description" className="label">
          Description <span className="font-normal text-slate-400">(optional)</span>
        </label>
        <textarea id="description" name="description" rows={2} className="input resize-none" />
      </div>

      <div className="space-y-1.5">
        <label htmlFor="category_id" className="label">
          Folder <span className="font-normal text-slate-400">(optional)</span>
        </label>
        <select id="category_id" name="category_id" className="input" defaultValue="">
          <option value="">Decide automatically from content</option>
          {departments.map((d) => (
            <optgroup key={d.id} label={d.name}>
              {categories
                .filter((c) => c.department_id === d.id)
                .map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
            </optgroup>
          ))}
        </select>
        <p className="text-xs text-slate-500">
          Left automatic, the document is filed by matching its title and filename against category
          keywords. Text-based classification runs once extraction is enabled.
        </p>
      </div>

      {error && (
        <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
        </p>
      )}

      <div className="flex items-center gap-3">
        <button type="submit" disabled={busy || !file} className="btn-primary">
          {busy && <Loader2 className="size-4 animate-spin" />}
          {busy ? 'Uploading…' : 'Upload'}
        </button>
        <span className="text-xs text-slate-500">
          Stored privately. Only you and authorized reviewers can open it.
        </span>
      </div>
    </form>
  );
}
