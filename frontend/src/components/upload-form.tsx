'use client';

import { useRef, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { CheckCircle2, FileUp, Loader2, Repeat2, Sparkles, X, Shield, FileCheck, Upload } from 'lucide-react';
import { uploadDocument } from '@/lib/actions/documents';
import { ALLOWED_MIME_TYPES, MAX_FILE_BYTES } from '@/lib/constants';
import { deriveTitle } from '@/lib/classify';
import { ErrorNote, formatBytes } from '@/components/ui';

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
  const [submitting, setSubmitting] = useState(false);

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

    setSubmitting(true);
    const result = await uploadDocument(formData);

    if (!result.ok) {
      setSubmitting(false);
      setError(result.message);
      return;
    }
    startTransition(() => {
      router.push(`/documents/${result.data.id}`);
      router.refresh();
    });
  }

  const busy = pending || submitting;

  return (
    <form onSubmit={onSubmit} className="glass-card animate-rise space-y-6 p-6 sm:p-7 shadow-e2">
      {/* ── Drop zone with laser scanner animation ─────────────────────── */}
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
        className={`relative overflow-hidden rounded-2xl border-2 border-dashed transition-all duration-300
                    ease-[var(--ease-smooth)] ${
                      dragging
                        ? 'scale-[1.01] border-accent bg-accent-soft shadow-glow'
                        : file
                          ? 'border-ok-line bg-ok-soft/30 shadow-xs'
                          : 'border-line-2 bg-surface-2/60 hover:border-accent-line hover:bg-surface-2'
                    }`}
      >
        {/* Animated Laser Scanning Line */}
        {(dragging || busy) && (
          <div
            aria-hidden
            className="pointer-events-none absolute left-0 right-0 h-0.5 bg-accent
                       animate-scan z-10"
          />
        )}

        {file ? (
          <div className="animate-pop flex flex-wrap items-center gap-4 p-5">
            <span className="grid size-12 shrink-0 place-items-center rounded-xl bg-ok-soft text-ok ring-1 ring-ok-line shadow-xs">
              <FileCheck className="size-6" />
            </span>
            <div className="min-w-0 flex-1">
              <div className="truncate text-sm font-semibold text-ink">{file.name}</div>
              <div className="mt-1 flex items-center gap-2 font-mono text-xs text-muted">
                <span className="chip bg-surface px-1.5 py-0.5 text-[10px] ring-1 ring-line">
                  {file.type.replace('application/', '').toUpperCase()}
                </span>
                <span>{formatBytes(file.size)}</span>
              </div>
            </div>
            <div className="flex shrink-0 items-center gap-1.5">
              <button
                type="button"
                onClick={() => inputRef.current?.click()}
                className="btn-secondary group px-3 py-1.5 text-xs font-semibold"
              >
                <Repeat2 className="size-3.5 transition-transform duration-500 group-hover:rotate-180" />
                Replace
              </button>
              <button
                type="button"
                onClick={() => {
                  setFile(null);
                  if (inputRef.current) inputRef.current.value = '';
                }}
                aria-label="Remove file"
                className="group grid size-8.5 place-items-center rounded-xl border border-line bg-surface text-muted
                           transition-colors hover:border-danger-line hover:bg-danger-soft hover:text-danger"
              >
                <X className="size-4 transition-transform duration-300 group-hover:rotate-90" />
              </button>
            </div>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => inputRef.current?.click()}
            className="group flex w-full flex-col items-center gap-3 px-6 py-12 text-center cursor-pointer"
          >
            <div
              className={`relative grid size-14 place-items-center rounded-2xl transition-all duration-300
                          ease-[var(--ease-spring)] ${
                            dragging
                              ? '-translate-y-1.5 scale-110 bg-accent text-accent-on shadow-glow'
                              : 'bg-surface text-muted ring-1 ring-line group-hover:-translate-y-1 group-hover:text-accent-ink group-hover:border-accent-line shadow-xs'
                          }`}
            >
              <FileUp className="size-6 transition-transform duration-300 group-hover:scale-110" />
            </div>
            <div>
              <p className="text-sm font-semibold text-ink">
                {dragging ? (
                  <span className="text-accent-ink">Release to attach file</span>
                ) : (
                  <>
                    <span className="text-accent-ink underline underline-offset-4 decoration-accent/40 group-hover:decoration-accent">Click to browse</span> or drag and drop
                  </>
                )}
              </p>
              <p className="mt-1 font-mono text-xs text-faint">
                Institutional documents in PDF, PNG or JPEG (up to 25 MB)
              </p>
            </div>
          </button>
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

      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <label htmlFor="title" className="label font-semibold">
            Document Title
          </label>
          {file && !titleEdited && (
            <span className="chip bg-accent-soft text-[10px] font-semibold text-accent-ink ring-1 ring-accent-line">
              <Sparkles className="size-2.5" />
              Auto-derived
            </span>
          )}
        </div>
        <input
          id="title"
          name="title"
          className="input"
          value={title}
          onChange={(e) => {
            setTitle(e.target.value);
            setTitleEdited(true);
          }}
          placeholder="Annual Institutional Budget Report 2026"
        />
      </div>

      <div className="space-y-2">
        <label htmlFor="description" className="label font-semibold">
          Description <span className="font-normal text-faint">(optional)</span>
        </label>
        <textarea
          id="description"
          name="description"
          rows={2}
          className="input resize-none"
          placeholder="Context, summary notes, or reference numbers..."
        />
      </div>

      <div className="space-y-2">
        <label htmlFor="category_id" className="label font-semibold">
          Folder Taxonomy <span className="font-normal text-faint">(optional)</span>
        </label>
        <select id="category_id" name="category_id" className="input" defaultValue="">
          <option value="">Decide automatically with AI classification</option>
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
        <div className="flex items-start gap-2 rounded-xl bg-surface-2/80 p-3 text-xs leading-relaxed text-muted border border-line">
          <Sparkles className="mt-0.5 size-3.5 shrink-0 text-accent-ink" />
          <span>
            If left automatic, the system automatically analyzes extracted text, title keywords, and OCR tokens to file the document into the right department.
          </span>
        </div>
      </div>

      {error && <ErrorNote>{error}</ErrorNote>}

      <div className="flex flex-wrap items-center justify-between gap-4 border-t border-line pt-5">
        <button type="submit" disabled={busy || !file} className="btn-primary py-2.5 px-6 shadow-e1">
          {busy ? <Loader2 className="size-4 animate-spin" /> : <Upload className="size-4" />}
          {busy ? 'Processing & Uploading…' : 'Upload Document'}
        </button>
        <p className="flex items-center gap-1.5 text-xs text-muted">
          <Shield className="size-3.5 text-ok" />
          Encrypted & stored privately with auditable trail.
        </p>
      </div>
    </form>
  );
}
