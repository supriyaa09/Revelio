-- ============================================================================
-- 0003_storage.sql — private document bucket + object-level policies
-- Files live in Storage. The database stores only metadata and the path.
-- ============================================================================

-- Private bucket. Type and size limits are enforced at the bucket level, so a
-- crafted client request cannot bypass them even if it skips our API.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'documents',
  'documents',
  false,
  26214400,                                     -- 25 MB
  array['application/pdf', 'image/png', 'image/jpeg']
)
on conflict (id) do update
  set public             = false,
      file_size_limit    = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

-- Object key layout: {document_id}/v{n}/{safe_filename}
-- The leading path segment is the document id, which is what lets us join an
-- object back to its document and reuse the same visibility rule.
create or replace function storage_document_id(p_name text)
returns uuid
language plpgsql
immutable
as $$
begin
  return (split_part(p_name, '/', 1))::uuid;
exception when others then
  return null;                                  -- malformed key: deny by returning null
end;
$$;

-- Read: anyone who can see the document can read its objects.
create policy "documents_read" on storage.objects
  for select to authenticated
  using (
    bucket_id = 'documents'
    and storage_document_id(name) is not null
    and public.document_is_visible(storage_document_id(name))
  );

-- Write: only the document owner (or an admin) may add objects, and only under
-- their own document's prefix.
create policy "documents_insert" on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'documents'
    and storage_document_id(name) is not null
    and exists (
      select 1 from public.documents d
      where d.id = storage_document_id(name)
        and (d.owner_id = auth.uid() or public.is_admin())
    )
  );

-- No UPDATE or DELETE policy for clients: stored files are immutable per
-- version. Replacing a file means uploading a new version at a new path.
