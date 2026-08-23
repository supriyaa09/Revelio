import { requireSession } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';
import { UploadForm } from '@/components/upload-form';
import { PageHeader } from '@/components/ui';

export default async function UploadPage() {
  const supabase = await createClient();

  // Session and taxonomy in one round trip. The dropdown contents do not depend
  // on who is asking — RLS already scopes them — so serialising these was pure
  // added latency.
  const [, { data: departments }, { data: categories }] = await Promise.all([
    requireSession(),
    supabase.from('departments').select('id, name, slug, sort_order').order('sort_order'),
    supabase
      .from('categories')
      .select('id, department_id, name, slug, sort_order')
      .eq('is_active', true)
      .order('sort_order'),
  ]);

  return (
    <div className="mx-auto max-w-2xl">
      <PageHeader
        title="Upload document"
        description="The file is stored privately and filed automatically. You can override the folder if the suggestion is wrong."
      />
      <UploadForm departments={departments ?? []} categories={categories ?? []} />
    </div>
  );
}
