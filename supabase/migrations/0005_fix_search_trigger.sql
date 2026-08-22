-- ============================================================================
-- 0005_fix_search_trigger.sql — repair trg_refresh_document_search()
--
-- ROOT CAUSE of "Something went wrong. Please try again." on every upload.
--
-- The function body was:
--
--   perform refresh_document_search(
--     case when tg_table_name = 'documents' then new.id else new.document_id end
--   );
--
-- That is a SINGLE SQL expression. plpgsql resolves and binds every parameter
-- of an expression BEFORE the executor evaluates it, so `new.document_id` was
-- looked up even when the trigger fired on `documents`, where no such field
-- exists. Every INSERT into documents therefore raised:
--
--   record "new" has no field "document_id"   (SQLSTATE 42703)
--
-- Because trg_documents_search is AFTER INSERT OR UPDATE OF ... on documents,
-- this broke:
--   * every documents INSERT  -> uploadDocument() died at the insert step,
--                                before storage was ever touched
--   * every UPDATE of current_version_id -> create_document_version() too
--   * document_search was never populated for any document
--
-- FIX: branch with IF/ELSE so each PERFORM is its own statement. plpgsql only
-- plans and executes the branch actually taken, so the field that does not
-- exist on this table is never resolved.
--
-- No RLS, policy, grant, bucket or workflow logic is touched.
-- ============================================================================

begin;

create or replace function trg_refresh_document_search()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  -- Two separate statements, deliberately NOT one CASE expression.
  if tg_table_name = 'documents' then
    perform refresh_document_search(new.id);
  else
    -- document_insights and any future per-version table
    perform refresh_document_search(new.document_id);
  end if;
  return new;
end;
$$;

commit;

-- ── Backfill ────────────────────────────────────────────────────────────────
-- document_search was never written while the trigger was broken. Rebuild it
-- for any document that predates the fix. Safe and idempotent: the function
-- upserts on document_id.
select refresh_document_search(d.id) from documents d;

-- ============================================================================
-- Verification
--
-- 1. Trigger function no longer references a non-existent field:
--      select prosrc from pg_proc where proname = 'trg_refresh_document_search';
--
-- 2. Search rows now exist, one per document:
--      select (select count(*) from documents)       as documents,
--             (select count(*) from document_search) as search_rows;
--
-- 3. End-to-end: upload a PDF as a student, then
--      select d.id, d.title, d.workflow_status, d.current_version_id,
--             v.version_number, v.storage_path, v.processing_status
--        from documents d
--        left join document_versions v on v.id = d.current_version_id
--       order by d.created_at desc limit 1;
--
--      select action, from_state, to_state, created_at
--        from audit_logs order by created_at desc limit 5;
-- ============================================================================
