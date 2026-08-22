-- ============================================================================
-- 0006_table_grants.sql — restore table-level privileges for `authenticated`
--
-- ROOT CAUSE of "permission denied for table categories".
--
-- SQLSTATE 42501 "permission denied for table X" is a GRANT failure, NOT an RLS
-- failure. PostgreSQL checks table privileges BEFORE it evaluates row-level
-- security, so `categories_select ... using (true)` was never even reached.
-- The policies were correct the whole time; the roles simply had no privileges.
--
-- A live probe with the anon key confirmed all 11 application tables return
-- 42501, with Postgres itself emitting the remedy as a hint. This is the
-- expected consequence of `DROP SCHEMA public CASCADE; CREATE SCHEMA public;`
-- without restoring the default-privileges block afterwards — and note that
-- ALTER DEFAULT PRIVILEGES only affects objects created AFTER it runs, so
-- issuing it once the tables already existed would also leave them ungranted.
--
-- WHY IT LOOKED PARTLY WORKING: requireSession() discarded the error from its
-- `profiles` SELECT and silently fell through to ensure_profile(), which is
-- SECURITY DEFINER and therefore bypasses grants. Every request was quietly
-- papering over the missing privilege. That masking is fixed in lib/auth.ts.
--
-- DESIGN: grants are deliberately NARROWER than the Supabase default. Nothing
-- is granted to `anon` at all — no application table needs anonymous access,
-- and every policy is already scoped `to authenticated`. Where RLS has no
-- policy for a write (immutable versions, append-only audit, definer-written
-- reviews), the privilege is withheld too, so the two layers reinforce rather
-- than duplicate each other.
--
-- RLS remains enabled on all 11 tables. Row visibility is still decided
-- entirely by the policies in 0002_security.sql. No data is modified.
-- ============================================================================

begin;

-- Required before any table in the schema is reachable at all.
grant usage on schema public to authenticated, service_role;

-- ── Identity ────────────────────────────────────────────────────────────────
-- RLS: read any profile (attribution UI), update only your own, HOD manages.
-- No DELETE: profiles are removed by the auth.users cascade, not by clients.
grant select, insert, update on public.profiles to authenticated;

-- ── Institutional taxonomy ──────────────────────────────────────────────────
-- Readable by every signed-in user because the folder tree, upload form and
-- classifier all need it. Writes are gated to the HOD by
-- departments_manage_hod / categories_manage_hod.
grant select, insert, update, delete on public.departments to authenticated;
grant select, insert, update, delete on public.categories  to authenticated;

-- ── Documents ───────────────────────────────────────────────────────────────
-- RLS: owner, or review tier once the document leaves draft, or HOD.
grant select, insert, update, delete on public.documents to authenticated;

-- Versions are immutable. RLS has no UPDATE/DELETE policy, and the privilege is
-- withheld as well, so immutability holds even if a policy is added by mistake.
grant select, insert on public.document_versions to authenticated;

-- ── Derived intelligence: read-only to clients ──────────────────────────────
-- Written by the processing pipeline under service_role in a later phase.
grant select on public.document_insights to authenticated;
grant select on public.document_chunks   to authenticated;

-- Maintained by the refresh_document_search() trigger, never by a client.
grant select on public.document_search to authenticated;

-- ── Collaboration ───────────────────────────────────────────────────────────
grant select, insert, delete on public.document_comments to authenticated;

-- ── Attributable records: read-only to clients ──────────────────────────────
-- document_reviews rows are written only inside transition_document().
grant select on public.document_reviews to authenticated;

-- audit_logs is append-only. INSERT happens only inside SECURITY DEFINER
-- functions, so the actor cannot be spoofed; UPDATE/DELETE are additionally
-- blocked by trigger.
grant select on public.audit_logs to authenticated;

-- ── service_role: trusted backend, still needs privileges ───────────────────
-- Bypasses RLS by design. Key is server-side only and never shipped to a
-- client. Needed by the Phase 3 processing pipeline.
grant all on all tables in schema public to service_role;

-- ── Future tables ───────────────────────────────────────────────────────────
-- Applies only to tables created AFTER this statement, which is precisely why
-- the original reset left the existing tables ungranted.
alter default privileges in schema public
  grant select, insert, update, delete on tables to authenticated;
alter default privileges in schema public
  grant all on tables to service_role;

-- Deliberately NOT granted: anon has no privilege on any application table.

commit;

-- ============================================================================
-- Verification
--
-- 1. Effective grants for authenticated (expect one row per table/privilege):
--      select table_name, privilege_type
--        from information_schema.role_table_grants
--       where grantee = 'authenticated' and table_schema = 'public'
--       order by table_name, privilege_type;
--
-- 2. anon must have NOTHING (expect 0 rows):
--      select count(*) as anon_grants
--        from information_schema.role_table_grants
--       where grantee = 'anon' and table_schema = 'public';
--
-- 3. RLS still enabled on all 11 tables (expect all true):
--      select relname, relrowsecurity
--        from pg_class c join pg_namespace n on n.oid = c.relnamespace
--       where n.nspname = 'public' and c.relkind = 'r'
--       order by relname;
--
-- 4. Role model is the final one (expect student, faculty, hod):
--      select unnest(enum_range(null::app_role))::text;
--
-- 5. Helpers are the final set (expect current_app_role, is_hod, can_review,
--    document_is_visible — and NOT is_admin or can_approve):
--      select proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
--       where n.nspname = 'public'
--         and proname in ('current_app_role','is_hod','can_review',
--                         'document_is_visible','is_admin','can_approve');
--
-- 6. Taxonomy is readable by a signed-in user, and still row-filtered:
--      -- as an authenticated student in the app: the upload form's folder
--      -- dropdown should populate once seed.sql has been run.
-- ============================================================================
