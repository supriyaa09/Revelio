import { requireSession } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';
import { UploadForm } from '@/components/upload-form';

export default async function UploadPage() {
  await requireSession();
  const supabase = await createClient();

  const [{ data: departments }, { data: categories }] = await Promise.all([
    supabase.from('departments').select('id, name, slug, sort_order').order('sort_order'),
    supabase
      .from('categories')
      .select('id, department_id, name, slug, sort_order')
      .eq('is_active', true)
      .order('sort_order'),
  ]);

  return (
    <div className="mx-auto max-w-2xl">
      <h1 className="text-2xl font-semibold tracking-tight">Upload document</h1>
      <p className="mt-1 text-sm text-slate-500">
        The file is stored privately and filed automatically. You can override the folder if the
        suggestion is wrong.
      </p>

      <div className="mt-6">
        <UploadForm departments={departments ?? []} categories={categories ?? []} />
      </div>
    </div>
  );
}
