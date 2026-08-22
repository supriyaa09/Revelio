-- ============================================================================
-- 0007_processing.sql — Phase 3 document-processing support
--
-- Adds the fine-grained stage column the UI needs, plus SECURITY DEFINER RPCs
-- that let the processing pipeline persist its results.
--
-- WHY DEFINER RPCS RATHER THAN A SERVICE-ROLE CLIENT: clients have no UPDATE
-- privilege or policy on document_versions (versions are immutable to clients,
-- by design in 0002/0006), and there is no service-role key in this deployment.
-- These functions run as the table owner but re-check authorization themselves —
-- the caller must own the parent document or be the HOD — so the immutability
-- rule for *file* columns is preserved while processing results can be written.
--
-- No workflow logic, no approval logic, no policy and no enum is changed.
-- ============================================================================

begin;

-- ── Stage column for the processing UX ──────────────────────────────────────
-- Kept as a constrained text column rather than a new enum value: altering an
-- enum in place is disruptive (see ADR-026) and this is a presentation detail
-- layered on top of processing_status, not a replacement for it.
alter table document_versions
  add column if not exists processing_stage text
    check (processing_stage in
      ('uploaded', 'extracting', 'analyzing', 'indexing', 'ready', 'failed'));

comment on column document_versions.processing_stage is
  'Fine-grained pipeline stage for UI display. processing_status remains the authoritative coarse state.';

-- ── Shared authorization check ──────────────────────────────────────────────
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
      join documents d on d.id = v.document_id
     where v.id = p_version_id
       and (d.owner_id = auth.uid() or is_hod())
  );
$$;

-- ── 1. Persist extraction results ───────────────────────────────────────────
create or replace function set_version_processing(
  p_version_id  uuid,
  p_status      processing_state,
  p_stage       text default null,
  p_error       text default null,
  p_method      extraction_method default null,
  p_text        text default null,
  p_page_count  int default null,
  p_char_count  int default null
)
returns document_versions
language plpgsql
security definer
set search_path = public
as $$
declare
  v_version document_versions;
begin
  if auth.uid() is null then
    raise exception 'UNAUTHORIZED' using errcode = 'insufficient_privilege';
  end if;
  if not can_process_version(p_version_id) then
    raise exception 'FORBIDDEN: you may not process this document'
      using errcode = 'insufficient_privilege';
  end if;

  update document_versions
     set processing_status = p_status,
         processing_stage  = coalesce(p_stage, processing_stage),
         -- A successful pass clears any error from a previous failed attempt.
         processing_error  = case when p_status = 'failed' then p_error else null end,
         extraction_method = coalesce(p_method, extraction_method),
         extracted_text    = coalesce(p_text, extracted_text),
         page_count        = coalesce(p_page_count, page_count),
         char_count        = coalesce(p_char_count, char_count),
         processed_at      = case when p_status in ('completed', 'failed')
                                  then now() else processed_at end
   where id = p_version_id
  returning * into v_version;

  if not found then
    raise exception 'NOT_FOUND' using errcode = 'no_data_found';
  end if;

  -- Keep the document's search vector in step with newly extracted text.
  perform refresh_document_search(v_version.document_id);

  insert into audit_logs (actor_id, document_id, document_version_id, action, metadata)
  values (auth.uid(), v_version.document_id, p_version_id,
          'document_processing_' || p_status::text,
          jsonb_strip_nulls(jsonb_build_object(
            'stage', p_stage, 'method', p_method::text,
            'page_count', p_page_count, 'char_count', p_char_count,
            'error', case when p_status = 'failed' then p_error else null end)));

  return v_version;
end;
$$;

revoke all on function set_version_processing(uuid, processing_state, text, text, extraction_method, text, int, int) from public, anon;
grant execute on function set_version_processing(uuid, processing_state, text, text, extraction_method, text, int, int) to authenticated;

-- ── 2. Persist AI insights ──────────────────────────────────────────────────
-- One row per version (unique constraint), so re-running processing replaces
-- the previous analysis rather than accumulating duplicates.
create or replace function save_document_insights(
  p_version_id      uuid,
  p_summary         text,
  p_key_points      jsonb default '[]'::jsonb,
  p_entities        jsonb default '[]'::jsonb,
  p_important_dates jsonb default '[]'::jsonb,
  p_model           text default null
)
returns document_insights
language plpgsql
security definer
set search_path = public
as $$
declare
  v_doc_id  uuid;
  v_insight document_insights;
begin
  if auth.uid() is null then
    raise exception 'UNAUTHORIZED' using errcode = 'insufficient_privilege';
  end if;
  if not can_process_version(p_version_id) then
    raise exception 'FORBIDDEN' using errcode = 'insufficient_privilege';
  end if;

  select document_id into v_doc_id from document_versions where id = p_version_id;

  insert into document_insights
    (document_id, document_version_id, summary, key_points, entities, important_dates, model)
  values
    (v_doc_id, p_version_id, p_summary,
     coalesce(p_key_points, '[]'::jsonb),
     coalesce(p_entities, '[]'::jsonb),
     coalesce(p_important_dates, '[]'::jsonb),
     p_model)
  on conflict (document_version_id) do update
     set summary         = excluded.summary,
         key_points      = excluded.key_points,
         entities        = excluded.entities,
         important_dates = excluded.important_dates,
         model           = excluded.model,
         generated_at    = now()
  returning * into v_insight;

  return v_insight;
end;
$$;

revoke all on function save_document_insights(uuid, text, jsonb, jsonb, jsonb, text) from public, anon;
grant execute on function save_document_insights(uuid, text, jsonb, jsonb, jsonb, text) to authenticated;

-- ── 3. Persist retrieval chunks ─────────────────────────────────────────────
create or replace function save_document_chunks(
  p_version_id uuid,
  p_chunks     jsonb
)
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  v_doc_id uuid;
  v_count  int;
begin
  if auth.uid() is null then
    raise exception 'UNAUTHORIZED' using errcode = 'insufficient_privilege';
  end if;
  if not can_process_version(p_version_id) then
    raise exception 'FORBIDDEN' using errcode = 'insufficient_privilege';
  end if;
  if jsonb_typeof(p_chunks) <> 'array' then
    raise exception 'VALIDATION_ERROR: p_chunks must be a JSON array'
      using errcode = 'check_violation';
  end if;

  select document_id into v_doc_id from document_versions where id = p_version_id;

  -- Replace wholesale: chunking is deterministic per version, so a re-run
  -- should not leave stale chunks behind.
  delete from document_chunks where document_version_id = p_version_id;

  insert into document_chunks
    (document_id, document_version_id, chunk_index, page_start, page_end, content)
  select v_doc_id,
         p_version_id,
         (c ->> 'chunk_index')::int,
         nullif(c ->> 'page_start', '')::int,
         nullif(c ->> 'page_end', '')::int,
         c ->> 'content'
    from jsonb_array_elements(p_chunks) as c
   where coalesce(btrim(c ->> 'content'), '') <> '';

  select count(*) into v_count from document_chunks where document_version_id = p_version_id;
  return v_count;
end;
$$;

revoke all on function save_document_chunks(uuid, jsonb) from public, anon;
grant execute on function save_document_chunks(uuid, jsonb) to authenticated;

-- ── 4. Apply derived metadata, preserving provenance ────────────────────────
-- Human choices always win: a category the user picked is never overwritten.
--
-- p_source records WHICH engine produced the suggestion. It must be supplied by
-- the caller, because two different engines call this function: Gemini ('ai')
-- and the deterministic keyword classifier ('system'). Hardcoding 'ai' would
-- label keyword matching as model output in both the UI badge and the audit
-- trail — a provenance lie, and exactly what the "no fabricated AI output" rule
-- forbids.
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
  if not (v_doc.owner_id = auth.uid() or is_hod()) then
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

-- Drop the previous 8-argument signature so the old, provenance-blind version
-- cannot linger and be resolved by an out-of-date caller.
drop function if exists apply_ai_metadata(uuid, text, uuid, uuid, real, text[], date, jsonb);

revoke all on function apply_ai_metadata(uuid, text, uuid, uuid, real, text[], date, jsonb, metadata_source) from public, anon;
grant execute on function apply_ai_metadata(uuid, text, uuid, uuid, real, text[], date, jsonb, metadata_source) to authenticated;

commit;

-- ============================================================================
-- Verification
--   select column_name from information_schema.columns
--    where table_name = 'document_versions' and column_name = 'processing_stage';
--
--   select proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
--    where n.nspname = 'public'
--      and proname in ('set_version_processing','save_document_insights',
--                      'save_document_chunks','apply_ai_metadata','can_process_version');
--   -- expect all five
-- ============================================================================
