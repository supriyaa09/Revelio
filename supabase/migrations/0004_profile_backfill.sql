-- ============================================================================
-- 0004_profile_backfill.sql — repair orphaned auth users, harden the trigger
--
-- Root cause of the reported failure: `on_auth_user_created` is an AFTER INSERT
-- trigger, so it only fires for NEW signups. Any auth user that already existed
-- when 0001 was applied never received a profiles row, and requireSession()
-- throws for those accounts. User 7c7eb4fa-8983-42f5-817f-69aa5787f76f was
-- repaired by hand; this migration removes the need to ever do that again.
--
-- Fully idempotent: safe to run more than once, and it will NOT overwrite or
-- demote any existing profile — including roles assigned by hand.
-- ============================================================================

begin;

-- ── 1. Harden the trigger function ──────────────────────────────────────────
-- Unchanged behaviour, one fixed failure mode: the previous fallback chain
-- could yield NULL (empty full_name metadata, or a null email on phone/OAuth
-- identities). Since profiles.full_name is NOT NULL and this trigger runs
-- inside the signup transaction, that violation aborted the whole signup and
-- appeared as "Database error saving new user" with no auth user created.
create or replace function handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, full_name, role)
  values (
    new.id,
    coalesce(
      nullif(btrim(new.raw_user_meta_data ->> 'full_name'), ''),
      nullif(split_part(coalesce(new.email, ''), '@', 1), ''),
      'User'
    ),
    -- Role is NEVER read from raw_user_meta_data. A client can put
    -- {"role":"hod"} in signup metadata and it is ignored: every new profile
    -- starts as student. Faculty and HOD are granted separately by an HOD.
    'student'
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

-- ── 2. Guarantee the trigger exists ─────────────────────────────────────────
-- Recreated unconditionally, so this also repairs a database where the trigger
-- was never created or was dropped.
drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function handle_new_user();

-- ── 3. Backfill every auth user that has no profile ─────────────────────────
-- The LEFT JOIN plus ON CONFLICT means existing profiles are untouched: the
-- manually repaired account keeps its row, and nobody already set to faculty
-- or hod is demoted to student.
insert into public.profiles (id, full_name, role)
select u.id,
       coalesce(
         nullif(btrim(u.raw_user_meta_data ->> 'full_name'), ''),
         nullif(split_part(coalesce(u.email, ''), '@', 1), ''),
         'User'
       ),
       'student'
  from auth.users u
  left join public.profiles p on p.id = u.id
 where p.id is null
on conflict (id) do nothing;

-- ── 4. Self-healing safety net for the application ──────────────────────────
-- Called by requireSession() when a profile is missing, so a session can
-- recover without manual SQL.
--
-- Security properties:
--   * Acts on auth.uid() only — a caller cannot create or alter another user's
--     profile, so this is not an impersonation primitive.
--   * Role is hard-coded to 'student'; never inferred from metadata.
--   * SECURITY DEFINER is required to read auth.users and to insert before the
--     profiles RLS policies would allow it. search_path is pinned.
--   * Idempotent: returns the existing row when one is already present.
create or replace function ensure_profile()
returns public.profiles
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid     uuid := auth.uid();
  v_profile public.profiles;
begin
  if v_uid is null then
    raise exception 'UNAUTHORIZED' using errcode = 'insufficient_privilege';
  end if;

  select * into v_profile from public.profiles where id = v_uid;
  if found then
    return v_profile;
  end if;

  insert into public.profiles (id, full_name, role)
  select u.id,
         coalesce(
           nullif(btrim(u.raw_user_meta_data ->> 'full_name'), ''),
           nullif(split_part(coalesce(u.email, ''), '@', 1), ''),
           'User'
         ),
         'student'
    from auth.users u
   where u.id = v_uid
  on conflict (id) do nothing;

  select * into v_profile from public.profiles where id = v_uid;
  return v_profile;
end;
$$;

revoke all on function ensure_profile() from public, anon;
grant execute on function ensure_profile() to authenticated;

commit;

-- ============================================================================
-- Verification — run after applying
--
-- 1. Trigger exists and points at the right function:
--      select t.tgname, p.proname, pg_get_triggerdef(t.oid)
--        from pg_trigger t
--        join pg_class c  on c.oid = t.tgrelid
--        join pg_namespace n on n.oid = c.relnamespace
--        join pg_proc p   on p.oid = t.tgfoid
--       where n.nspname = 'auth' and c.relname = 'users' and not t.tgisinternal;
--      -- expect on_auth_user_created → handle_new_user
--
-- 2. No orphaned auth users remain:
--      select count(*) as orphans
--        from auth.users u left join public.profiles p on p.id = u.id
--       where p.id is null;
--      -- expect 0
--
-- 3. Role default and enum:
--      select column_default from information_schema.columns
--       where table_schema='public' and table_name='profiles' and column_name='role';
--      -- expect 'student'::app_role
--      select unnest(enum_range(null::app_role))::text;
--      -- expect student, faculty, hod
--
-- 4. The repaired account is intact and not demoted:
--      select id, full_name, role from public.profiles
--       where id = '7c7eb4fa-8983-42f5-817f-69aa5787f76f';
--
-- 5. Role elevation cannot come from client metadata (see test in
--    docs/current-changes.md — sign up with {"role":"hod"} and confirm student).
-- ============================================================================
