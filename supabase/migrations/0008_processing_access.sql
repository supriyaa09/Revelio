-- ============================================================================
-- 0008_processing_access.sql — align processing authority with read visibility
--
-- PROBLEM 1 (functional). can_process_version() permitted only the document
-- owner or the HOD. Faculty are the reviewer tier, so a faculty member opening
-- a student's submitted document could read it but could not process it — no
-- summary, no entities, no extracted text — which is precisely the information
-- a reviewer needs in order to review. The UI gate matched the database, so the
-- Process button simply did not render and the document appeared permanently
-- stuck at "Uploaded".
--
-- PROBLEM 2 (consistency). `or is_hod()` was also *broader* than RLS in one
-- direction: an HOD could process a draft they are not permitted to read,
-- because documents_select restricts the reviewer tier to non-draft documents.
-- Authorization that disagrees with visibility in both directions is a bug in
-- both directions.
--
-- FIX. Both are resolved by reusing the one predicate every read path already
-- uses — document_is_visible(): owner, or reviewer tier once the document has
-- left draft. Processing authority now equals read authority across documents,
-- document_versions, document_insights, document_chunks and storage.objects.
-- A faculty member still cannot touch another user's private draft, because
-- that document is not visible to them.
--
-- PROBLEM 3 (hardening). 0007 revoked EXECUTE from public/anon on its four
-- write RPCs but omitted can_process_version, which therefore kept PostgreSQL's
-- default of EXECUTE TO PUBLIC. It is SECURITY DEFINER, so anon could call it.
-- The information returned is negligible — auth.uid() is null for anon, so it
-- always returned false — but it was an unintended grant on a definer function
-- and it is corrected here.
--
-- No enum, table, column, policy, workflow rule or transition is changed.
-- No service-role key is introduced. Nothing is granted to anon.
-- ============================================================================

begin;

-- ── 1. Processing authority == read visibility ───────────────────────────────
-- Signature is unchanged, so the four RPCs from 0007 that call this function
-- pick up the new rule without being rewritten.
create or replace function can_process_version(p_version_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
      from document_versions v
     where v.id = p_version_id
       -- owner, or reviewer tier on a document that has left draft
       and document_is_visible(v.document_id)
  );
$$;

comment on function can_process_version(uuid) is
  'True when the caller may run the processing pipeline for this version. Deliberately identical to document_is_visible() on the parent document, so processing authority never diverges from read authority.';

-- can_process_version is SECURITY DEFINER and was left at the default
-- EXECUTE TO PUBLIC by 0007. Match the other four processing functions.
revoke all on function can_process_version(uuid) from public, anon;
grant execute on function can_process_version(uuid) to authenticated;

-- ── 2. apply_ai_metadata: same widening, or processing breaks mid-run ────────
-- This function carries its own inline owner-or-HOD check because it is keyed
-- by document rather than by version. Left unchanged it would raise FORBIDDEN
-- for a faculty-triggered run *after* extraction and AI analysis had already
-- succeeded and been persisted — a partial pipeline, which is worse than a
-- clean refusal. Recreated in full because plpgsql bodies are not patchable.
--
-- Blast radius is unchanged and remains bounded to derived fields: a category
-- the user chose themselves is still never overwritten, document_type and
-- document_date still yield to any existing value, and tags are still unioned
-- rather than replaced. A reviewer cannot destroy a user's own metadata here.
create or replace function apply_ai_metadata(
  p_document_id   uuid,
  p_document_type text default null,
  p_category_id   uuid default null,
  p_department_id uuid default null,
  p_confidence    real default null,
  p_tags          text[] default null,
  p_document_date date default null,
  p_matched_terms jsonb default '[]'::jsonb,
  p_source        metadata_source default 'ai'
)
returns documents
language plpgsql
security definer
set search_path = public
as $$
declare
  v_doc documents;
begin
  if auth.uid() is null then
    raise exception 'UNAUTHORIZED' using errcode = 'insufficient_privilege';
  end if;
  -- A client must not be able to launder a user-entered value as AI output.
  if p_source not in ('ai', 'system') then
    raise exception 'VALIDATION_ERROR: p_source must be ai or system'
      using errcode = 'check_violation';
  end if;

  select * into v_doc from documents where id = p_document_id for update;
  if not found then
    raise exception 'NOT_FOUND' using errcode = 'no_data_found';
  end if;
  -- Widened from (owner or is_hod) to the shared visibility predicate, so this
  -- agrees with can_process_version() and cannot fail halfway through a run.
  if not document_is_visible(p_document_id) then
    raise exception 'FORBIDDEN' using errcode = 'insufficient_privilege';
  end if;

  update documents
     set -- Never override a folder the user chose themselves.
         category_id   = case when v_doc.category_source = 'user' then v_doc.category_id
                              else coalesce(p_category_id, v_doc.category_id) end,
         department_id = case when v_doc.category_source = 'user' then v_doc.department_id
                              else coalesce(p_department_id, v_doc.department_id) end,
         category_source = case
             when v_doc.category_source = 'user' then 'user'
             when p_category_id is not null      then p_source
             else v_doc.category_source end,
         category_confidence = case when v_doc.category_source = 'user'
                                    then v_doc.category_confidence
                                    else coalesce(p_confidence, v_doc.category_confidence) end,
         document_type = coalesce(v_doc.document_type, p_document_type),
         document_date = coalesce(v_doc.document_date, p_document_date),
         -- Union of existing and suggested tags; never drops a user's tag.
         tags = case
             when p_tags is null then v_doc.tags
             else (select array(select distinct unnest(v_doc.tags || p_tags))) end,
         system_metadata = v_doc.system_metadata || jsonb_build_object(
             'classification', jsonb_build_object(
               'method', case when p_source = 'ai' then 'ai_model' else 'content_keyword' end,
               'basis', 'extracted_text',
               'matched_terms', coalesce(p_matched_terms, '[]'::jsonb),
               'confidence', p_confidence),
             'suggested_by', p_source::text,
             'suggested', jsonb_strip_nulls(jsonb_build_object(
               'document_type', p_document_type,
               'document_date', p_document_date,
               'tags', to_jsonb(p_tags))))
   where id = p_document_id
  returning * into v_doc;

  insert into audit_logs (actor_id, document_id, action, metadata)
  values (auth.uid(), p_document_id, 'document_metadata_updated',
          jsonb_build_object('source', p_source::text, 'confidence', p_confidence));

  return v_doc;
end;
$$;

revoke all on function apply_ai_metadata(uuid, text, uuid, uuid, real, text[], date, jsonb, metadata_source) from public, anon;
grant execute on function apply_ai_metadata(uuid, text, uuid, uuid, real, text[], date, jsonb, metadata_source) to authenticated;

commit;

-- ============================================================================
-- Verification
--
-- 1. All five processing functions still exist:
--   select proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
--    where n.nspname = 'public'
--      and proname in ('can_process_version','set_version_processing',
--                      'save_document_insights','save_document_chunks',
--                      'apply_ai_metadata');
--   -- expect 5
--
-- 2. anon holds no EXECUTE on any of them (expect 0 rows):
--   select p.proname, a.privilege_type
--     from information_schema.role_routine_grants a
--     join pg_proc p on p.proname = a.routine_name
--    where a.grantee in ('anon','PUBLIC')
--      and p.proname in ('can_process_version','set_version_processing',
--                        'save_document_insights','save_document_chunks',
--                        'apply_ai_metadata');
--
-- 3. Faculty can process a submitted document but NOT another user's draft.
--    Run as a faculty session:
--   select can_process_version('<version id of a submitted document>');  -- expect true
--   select can_process_version('<version id of someone else''s draft>'); -- expect false
--
-- 4. The owner can still process their own draft (the main upload path):
--   select can_process_version('<version id of your own draft>');        -- expect true
-- ============================================================================
