-- ============================================================================
-- 0002_security.sql — RLS, role helpers, and server-enforced workflow
-- RLS is the authorization boundary. Hiding a button is not authorization.
-- ============================================================================

-- ── Role helpers ────────────────────────────────────────────────────────────
-- SECURITY DEFINER + pinned search_path: required so a policy on `profiles`
-- can read `profiles` without triggering recursive RLS evaluation.
create or replace function current_app_role()
returns app_role
language sql
stable
security definer
set search_path = public
as $$
  select role from profiles where id = auth.uid();
$$;

create or replace function is_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce(current_app_role() = 'admin', false);
$$;

-- Reviewer, approver and admin can all act on documents in review.
create or replace function can_review() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce(current_app_role() in ('reviewer', 'approver', 'admin'), false);
$$;

-- Final approval is restricted to approver and admin.
create or replace function can_approve() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce(current_app_role() in ('approver', 'admin'), false);
$$;

-- A document is visible to reviewers only once it has left draft.
create or replace function document_is_visible(p_document_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from documents d
    where d.id = p_document_id
      and (
        d.owner_id = auth.uid()
        or is_admin()
        or (can_review() and d.workflow_status <> 'draft')
      )
  );
$$;

-- ── Enable RLS everywhere ───────────────────────────────────────────────────
alter table profiles           enable row level security;
alter table departments        enable row level security;
alter table categories         enable row level security;
alter table documents          enable row level security;
alter table document_versions  enable row level security;
alter table document_insights  enable row level security;
alter table document_chunks    enable row level security;
alter table document_comments  enable row level security;
alter table document_reviews   enable row level security;
alter table audit_logs         enable row level security;
alter table document_search    enable row level security;

-- ── Profiles ────────────────────────────────────────────────────────────────
-- Names/roles are readable by signed-in users so the UI can attribute actions.
create policy profiles_select on profiles
  for select to authenticated using (true);

create policy profiles_update_self on profiles
  for update to authenticated
  using (id = auth.uid())
  with check (id = auth.uid() and role = (select role from profiles where id = auth.uid()));

create policy profiles_admin_all on profiles
  for all to authenticated using (is_admin()) with check (is_admin());

-- ── Taxonomy: readable by all, writable by admin ────────────────────────────
create policy departments_select on departments
  for select to authenticated using (true);
create policy departments_admin on departments
  for all to authenticated using (is_admin()) with check (is_admin());

create policy categories_select on categories
  for select to authenticated using (true);
create policy categories_admin on categories
  for all to authenticated using (is_admin()) with check (is_admin());

-- ── Documents ───────────────────────────────────────────────────────────────
create policy documents_select on documents
  for select to authenticated
  using (
    owner_id = auth.uid()
    or is_admin()
    or (can_review() and workflow_status <> 'draft')
  );

-- Clients may only create their own documents, and only in draft.
create policy documents_insert on documents
  for insert to authenticated
  with check (owner_id = auth.uid() and workflow_status = 'draft');

-- Owners edit their own drafts and change-requested docs. Status changes are
-- blocked here and must go through transition_document().
create policy documents_update_owner on documents
  for update to authenticated
  using (owner_id = auth.uid() and workflow_status in ('draft', 'changes_requested'))
  with check (owner_id = auth.uid());

create policy documents_admin on documents
  for all to authenticated using (is_admin()) with check (is_admin());

create policy documents_delete_owner on documents
  for delete to authenticated
  using (owner_id = auth.uid() and workflow_status = 'draft');

-- ── Versions: readable with the parent, insertable by owner, never mutable ──
create policy versions_select on document_versions
  for select to authenticated using (document_is_visible(document_id));

create policy versions_insert on document_versions
  for insert to authenticated
  with check (
    uploaded_by = auth.uid()
    and exists (
      select 1 from documents d
      where d.id = document_id
        and (d.owner_id = auth.uid() or is_admin())
    )
  );
-- No UPDATE or DELETE policy: uploaded versions are immutable to clients.
-- Processing results are written by the service role, which bypasses RLS.

-- ── Insights and chunks: readable with the document, written server-side ────
create policy insights_select on document_insights
  for select to authenticated using (document_is_visible(document_id));

create policy chunks_select on document_chunks
  for select to authenticated using (document_is_visible(document_id));

-- ── Comments ────────────────────────────────────────────────────────────────
create policy comments_select on document_comments
  for select to authenticated using (document_is_visible(document_id));

create policy comments_insert on document_comments
  for insert to authenticated
  with check (author_id = auth.uid() and document_is_visible(document_id));

create policy comments_delete_own on document_comments
  for delete to authenticated using (author_id = auth.uid() or is_admin());

-- ── Reviews and audit: read-only to clients ─────────────────────────────────
-- Both are written exclusively inside SECURITY DEFINER functions, so the
-- acting user cannot be spoofed by a crafted insert.
create policy reviews_select on document_reviews
  for select to authenticated using (document_is_visible(document_id));

create policy audit_select on audit_logs
  for select to authenticated
  using (
    is_admin()
    or actor_id = auth.uid()
    or (document_id is not null and document_is_visible(document_id))
  );

create policy document_search_select on document_search
  for select to authenticated using (document_is_visible(document_id));

-- ============================================================================
-- Workflow state machine
-- ============================================================================

-- Single source of truth for legal transitions.
create or replace function is_valid_transition(p_from workflow_state, p_to workflow_state)
returns boolean
language sql
immutable
as $$
  select (p_from, p_to) in (
    ('draft',             'submitted'),
    ('submitted',         'under_review'),
    ('submitted',         'draft'),              -- withdraw before review starts
    ('under_review',      'approved'),
    ('under_review',      'rejected'),
    ('under_review',      'changes_requested'),
    ('changes_requested', 'submitted'),          -- resubmit after revision
    ('rejected',          'draft')               -- rejected must restart as draft
  );
$$;

-- Defence in depth: rejects an illegal state pair even if the change arrives
-- via direct SQL or a service-role connection that bypasses RLS entirely.
create or replace function guard_workflow_transition()
returns trigger
language plpgsql
as $$
begin
  if new.workflow_status is distinct from old.workflow_status then
    if not is_valid_transition(old.workflow_status, new.workflow_status) then
      raise exception 'Illegal workflow transition: % -> %', old.workflow_status, new.workflow_status
        using errcode = 'check_violation';
    end if;
  end if;
  return new;
end;
$$;

create trigger trg_documents_workflow_guard
  before update of workflow_status on documents
  for each row execute function guard_workflow_transition();

-- The only supported way for a client to move a document.
create or replace function transition_document(
  p_document_id uuid,
  p_to_state    workflow_state,
  p_comment     text default null
)
returns documents
language plpgsql
security definer
set search_path = public
as $$
declare
  v_doc     documents;
  v_actor   uuid := auth.uid();
  v_from    workflow_state;
  v_action  review_action;
begin
  if v_actor is null then
    raise exception 'UNAUTHORIZED' using errcode = 'insufficient_privilege';
  end if;

  -- Lock the row so two concurrent transitions cannot both read the same state.
  select * into v_doc from documents where id = p_document_id for update;
  if not found then
    raise exception 'NOT_FOUND' using errcode = 'no_data_found';
  end if;

  v_from := v_doc.workflow_status;

  if not is_valid_transition(v_from, p_to_state) then
    raise exception 'INVALID_WORKFLOW_TRANSITION: % -> %', v_from, p_to_state
      using errcode = 'check_violation';
  end if;

  -- Role and ownership rules, per transition.
  if p_to_state = 'submitted' then
    if not (v_doc.owner_id = v_actor or is_admin()) then
      raise exception 'FORBIDDEN: only the owner may submit' using errcode = 'insufficient_privilege';
    end if;
    -- Cannot submit an empty document.
    if v_doc.current_version_id is null then
      raise exception 'NO_VERSION: upload a file before submitting' using errcode = 'check_violation';
    end if;

  elsif p_to_state = 'draft' then
    if not (v_doc.owner_id = v_actor or is_admin()) then
      raise exception 'FORBIDDEN' using errcode = 'insufficient_privilege';
    end if;

  elsif p_to_state = 'under_review' then
    if not can_review() then
      raise exception 'FORBIDDEN: reviewer role required' using errcode = 'insufficient_privilege';
    end if;

  elsif p_to_state in ('approved', 'rejected', 'changes_requested') then
    if p_to_state = 'approved' and not can_approve() then
      raise exception 'FORBIDDEN: approver role required' using errcode = 'insufficient_privilege';
    end if;
    if p_to_state <> 'approved' and not can_review() then
      raise exception 'FORBIDDEN: reviewer role required' using errcode = 'insufficient_privilege';
    end if;
    -- Separation of duties: never decide on your own document, whatever the role.
    if v_doc.owner_id = v_actor then
      raise exception 'FORBIDDEN: you cannot review your own document'
        using errcode = 'insufficient_privilege';
    end if;
  end if;

  update documents
     set workflow_status = p_to_state
   where id = p_document_id
  returning * into v_doc;

  v_action := case p_to_state
                when 'under_review'      then 'review_started'
                when 'approved'          then 'approved'
                when 'rejected'          then 'rejected'
                when 'changes_requested' then 'changes_requested'
                else null
              end;

  if v_action is not null then
    insert into document_reviews
      (document_id, document_version_id, reviewer_id, action, from_state, to_state, comment)
    values
      (p_document_id, v_doc.current_version_id, v_actor, v_action, v_from, p_to_state, p_comment);
  end if;

  insert into audit_logs
    (actor_id, document_id, document_version_id, action, from_state, to_state, metadata)
  values
    (v_actor, p_document_id, v_doc.current_version_id,
     'document_' || p_to_state::text, v_from, p_to_state,
     case when p_comment is null then '{}'::jsonb else jsonb_build_object('comment', p_comment) end);

  return v_doc;
end;
$$;

revoke all on function transition_document(uuid, workflow_state, text) from public;
grant execute on function transition_document(uuid, workflow_state, text) to authenticated;

-- ============================================================================
-- Version creation: server assigns the version number, atomically
-- ============================================================================
create or replace function create_document_version(
  p_document_id       uuid,
  p_storage_path      text,
  p_original_filename text,
  p_mime_type         text,
  p_file_size         bigint,
  p_change_note       text default null
)
returns document_versions
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor   uuid := auth.uid();
  v_doc     documents;
  v_next    int;
  v_version document_versions;
begin
  if v_actor is null then
    raise exception 'UNAUTHORIZED' using errcode = 'insufficient_privilege';
  end if;

  if p_mime_type not in ('application/pdf', 'image/png', 'image/jpeg') then
    raise exception 'UNSUPPORTED_FILE_TYPE: %', p_mime_type using errcode = 'check_violation';
  end if;
  if p_file_size <= 0 or p_file_size > 26214400 then
    raise exception 'FILE_TOO_LARGE' using errcode = 'check_violation';
  end if;

  select * into v_doc from documents where id = p_document_id for update;
  if not found then
    raise exception 'NOT_FOUND' using errcode = 'no_data_found';
  end if;
  if not (v_doc.owner_id = v_actor or is_admin()) then
    raise exception 'FORBIDDEN' using errcode = 'insufficient_privilege';
  end if;

  select coalesce(max(version_number), 0) + 1 into v_next
    from document_versions where document_id = p_document_id;

  insert into document_versions
    (document_id, version_number, storage_path, original_filename,
     mime_type, file_size, uploaded_by, change_note)
  values
    (p_document_id, v_next, p_storage_path, p_original_filename,
     p_mime_type, p_file_size, v_actor, p_change_note)
  returning * into v_version;

  -- The pointer advances only after the version row is committed.
  update documents
     set current_version_id = v_version.id,
         -- A revision on a decided document restarts the review cycle.
         workflow_status = case
           when v_doc.workflow_status in ('approved', 'rejected') then 'draft'
           else v_doc.workflow_status
         end
   where id = p_document_id;

  insert into audit_logs (actor_id, document_id, document_version_id, action, metadata)
  values (v_actor, p_document_id, v_version.id, 'document_version_created',
          jsonb_build_object('version_number', v_next, 'filename', p_original_filename));

  return v_version;
end;
$$;

revoke all on function create_document_version(uuid, text, text, text, bigint, text) from public;
grant execute on function create_document_version(uuid, text, text, text, bigint, text) to authenticated;

-- ============================================================================
-- Audit helper for non-workflow events (upload, metadata edits, views)
-- ============================================================================
create or replace function log_audit_event(
  p_document_id uuid,
  p_action      text,
  p_metadata    jsonb default '{}'::jsonb
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    raise exception 'UNAUTHORIZED' using errcode = 'insufficient_privilege';
  end if;
  -- Only log against documents the caller can actually see.
  if p_document_id is not null and not document_is_visible(p_document_id) then
    raise exception 'FORBIDDEN' using errcode = 'insufficient_privilege';
  end if;

  insert into audit_logs (actor_id, document_id, action, metadata)
  values (auth.uid(), p_document_id, p_action, coalesce(p_metadata, '{}'::jsonb));
end;
$$;

revoke all on function log_audit_event(uuid, text, jsonb) from public;
grant execute on function log_audit_event(uuid, text, jsonb) to authenticated;
