import Link from 'next/link';
import { ArrowLeft, FileQuestion } from 'lucide-react';

export default function NotFound() {
  return (
    <div className="grid min-h-[60vh] place-items-center px-4">
      <div className="animate-pop flex flex-col items-center text-center">
        <div className="relative grid size-14 place-items-center">
          <span className="absolute inset-0 rounded-full bg-accent-soft" />
          <span className="absolute inset-2 rounded-full bg-surface ring-1 ring-accent-line" />
          <FileQuestion className="relative size-5 text-accent-ink" />
        </div>
        <h1 className="display mt-4 text-2xl text-ink">Document not available</h1>
        <p className="mt-2 max-w-sm text-sm leading-relaxed text-muted">
          It may not exist, or you may not have permission to view it.
        </p>
        <Link href="/workspace" className="btn-primary group mt-5">
          <ArrowLeft className="size-4 transition-transform duration-300 group-hover:-translate-x-0.5" />
          Back to workspace
        </Link>
      </div>
    </div>
  );
}
