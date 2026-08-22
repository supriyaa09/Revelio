import Link from 'next/link';
import { FileQuestion } from 'lucide-react';

export default function NotFound() {
  return (
    <div className="grid min-h-[60vh] place-items-center">
      <div className="text-center">
        <div className="mx-auto grid size-11 place-items-center rounded-full bg-slate-100 text-slate-400">
          <FileQuestion className="size-5" />
        </div>
        <h1 className="mt-3 text-lg font-medium">Document not available</h1>
        <p className="mt-1 max-w-sm text-sm text-slate-500">
          It may not exist, or you may not have permission to view it.
        </p>
        <Link href="/workspace" className="btn-primary mt-4">
          Back to workspace
        </Link>
      </div>
    </div>
  );
}
