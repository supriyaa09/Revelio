-- ============================================================================
-- 0002_security.sql — RLS, final role model, and server-enforced workflow
-- RLS is the authorization boundary. Hiding a button is not authorization.
-- ============================================================================

-- SECURITY DEFINER + pinned search_path prevents recursive RLS on profiles.
create or replace function current_app_role()
returns app_role language sql stable security definer set search_path = public as $$
  select role from profiles where id = auth.uid();
$$;

-- The final model has no administrator role; the HOD manages the institution.
create or replace function is_hod() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce(current_app_role() = 'hod', false);
$$;

-- Faculty and HOD form the reviewer tier. Students never review.
create or replace function can_review() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce(current_app_role() in ('faculty', 'hod'), false);
$$;

-- Reviewer-tier users can see documents after they leave draft.
create or replace function document_is_visible(p_document_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from documents d
    where d.id = p_document_id
      and (d.owner_id = auth.uid()
           or (can_review() and d.workflow_status <> 'draft'))
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

-- ── Profiles and taxonomy ───────────────────────────────────────────────────
create policy profiles_select on profiles
  for select to authenticated using (true);

-- A user can update their profile but cannot promote their own role.
create policy profiles_update_self on profiles
  for update to authenticated
  using (id = auth.uid())
  with check (id = auth.uid() and role = current_app_role());

create policy profiles_manage_hod on profiles
  for all to authenticated using (is_hod()) with check (is_hod());

create policy departments_select on departments
  for select to authenticated using (true);
create policy departments_manage_hod on departments
  for all to authenticated using (is_hod()) with check (is_hod());

create policy categories_select on categories
  for select to authenticated using (true);
create policy categories_manage_hod on categories
  for all to authenticated using (is_hod()) with check (is_hod());

-- ── Documents ───────────────────────────────────────────────────────────────
create policy documents_select on documents
  for select to authenticated
  using (owner_id = auth.uid() or (can_review() and workflow_status <> 'draft'));

create policy documents_insert on documents
  for insert to authenticated
  with check (owner_id = auth.uid() and workflow_status = 'draft');

-- Owners edit drafts and change-requested documents. The workflow trigger
-- remains the database-level validator for any state pair.
create policy documents_update_owner on documents
  for update to authenticated
  using (owner_id = auth.uid() and workflow_status in ('draft', 'changes_requested'))
  with check (owner_id = auth.uid());

create policy documents_manage_hod on documents
  for all to authenticated using (is_hod()) with check (is_hod());

create policy documents_delete_owner on documents
  for delete to authenticated
  using (owner_id = auth.uid() and workflow_status = 'draft');

-- ── Versions: readable with parent, insertable by owner/HOD, never mutable ──
create policy versions_select on document_versions
  for select to authenticated using (document_is_visible(document_id));

create policy versions_insert on document_versions
  for insert to authenticated
  with check (
    uploaded_by = auth.uid()
    and exists (
      select 1 from documents d
      where d.id = document_id
        and (d.owner_id = auth.uid() or is_hod())
    )
  );
-- No UPDATE or DELETE policy: uploaded versions are immutable to clients.

-- ── Intelligence, comments, reviews and audit ───────────────────────────────
create policy insights_select on document_insights
  for select to authenticated using (document_is_visible(document_id));
create policy chunks_select on document_chunks
  for select to authenticated using (document_is_visible(document_id));

create policy comments_select on document_comments
  for select to authenticated using (document_is_visible(document_id));
create policy comments_insert on document_comments
  for insert to authenticated
  with check (author_id = auth.uid() and document_is_visible(document_id));
create policy comments_delete_own on document_comments
  for delete to authenticated using (author_id = auth.uid() or is_hod());

-- Reviews and audit rows are written only by security-definer functions.
create policy reviews_select on document_reviews
  for select to authenticated using (document_is_visible(document_id));
create policy audit_select on audit_logs
  for select to authenticated
  using (
    is_hod()
    or actor_id = auth.uid()
    or (document_id is not null and document_is_visible(document_id))
  );
create policy document_search_select on document_search
  for select to authenticated using (document_is_visible(document_id));

-- ============================================================================
-- Workflow state machine
-- ============================================================================
-- Tier is stored in the state. Faculty can decide directly or route to HOD;
-- only HOD can decide a document held at hod_review.
create or replace function is_valid_transition(p_from workflow_state, p_to workflow_state)
returns boolean language sql immutable as $$
  select (p_from, p_to) in (
    ('draft',             'submitted'),
    ('submitted',         'draft'),
    ('submitted',         'faculty_review'),
    ('submitted',         'hod_review'),
    ('faculty_review',    'approved'),
    ('faculty_review',    'rejected'),
    ('faculty_review',    'changes_requested'),
    ('faculty_review',    'hod_review'),
    ('hod_review',        'approved'),
    ('hod_review',        'rejected'),
    ('hod_review',        'changes_requested'),
    ('changes_requested', 'submitted'),
    ('rejected',          'draft')
  );
$$;

-- Defence in depth: direct SQL and service-role clients also get pair checks.
create or replace function guard_workflow_transition()
returns trigger language plpgsql as $$
begin
  if new.workflow_status is distinct from old.workflow_status
     and not is_valid_transition(old.workflow_status, new.workflow_status) then
    raise exception 'Illegal workflow transition: % -> %', old.workflow_status, new.workflow_status
      using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

create trigger trg_documents_workflow_guard
  before update of workflow_status on documents
  for each row execute function guard_workflow_transition();

-- The only supported client path for workflow movement.
create or replace function transition_document(
  p_document_id uuid,
  p_to_state    workflow_state,
  p_comment     text default null
)
returns documents
language plpgsql security definer set search_path = public as $$
declare
  v_doc    documents;
  v_actor  uuid := auth.uid();
  v_from   workflow_state;
  v_action review_action;
begin
  if v_actor is null then
    raise exception 'UNAUTHORIZED' using errcode = 'insufficient_privilege';
  end if;

  select * into v_doc from documents where id = p_document_id for update;
  if not found then
    raise exception 'NOT_FOUND' using errcode = 'no_data_found';
  end if;
  v_from := v_doc.workflow_status;

  if not is_valid_transition(v_from, p_to_state) then
    raise exception 'INVALID_WORKFLOW_TRANSITION: % -> %', v_from, p_to_state
      using errcode = 'check_violation';
  end if;

  -- Owner-only: submit, withdraw, resubmit, and restart after rejection.
  if p_to_state in ('submitted', 'draft') then
    if v_doc.owner_id <> v_actor then
      raise exception 'FORBIDDEN: only the document owner may do that'
        using errcode = 'insufficient_privilege';
    end if;
    if p_to_state = 'submitted' and v_doc.current_version_id is null then
      raise exception 'NO_VERSION: upload a file before submitting'
        using errcode = 'check_violation';
    end if;

  -- Faculty/HOD may pick up or route work. Routing is a hand-off, not a decision.
  elsif p_to_state in ('faculty_review', 'hod_review') then
    if not can_review() then
      raise exception 'FORBIDDEN: faculty or HOD role required'
        using errcode = 'insufficient_privilege';
    end if;

  -- Decisions depend on the tier holding the document.
  elsif p_to_state in ('approved', 'rejected', 'changes_requested') then
    if v_from = 'hod_review' then
      if not is_hod() then
        raise exception 'FORBIDDEN: only the HOD may decide a document under HOD review'
          using errcode = 'insufficient_privilege';
      end if;
    elsif not can_review() then
      raise exception 'FORBIDDEN: faculty or HOD role required'
        using errcode = 'insufficient_privilege';
    end if;

    if v_doc.owner_id = v_actor then
      raise exception 'FORBIDDEN: you cannot decide on your own document'
        using errcode = 'insufficient_privilege';
    end if;
  end if;

  update documents set workflow_status = p_to_state
   where id = p_document_id
  returning * into v_doc;

  v_action := case p_to_state
                when 'faculty_review'    then 'review_started'
                when 'hod_review'        then 'routed_to_hod'
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
     case when p_comment is null then '{}'::jsonb
          else jsonb_build_object('comment', p_comment) end);

  return v_doc;
end;
$$;

revoke all on function transition_document(uuid, workflow_state, text) from public;
grant execute on function transition_document(uuid, workflow_state, text) to authenticated;

-- ============================================================================
-- Version creation: server assigns the version number atomically
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
language plpgsql security definer set search_path = public as $$
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
  if not (v_doc.owner_id = v_actor or is_hod()) then
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

  update documents
     set current_version_id = v_version.id,
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

-- ── Audit helper for non-workflow events ────────────────────────────────────
create or replace function log_audit_event(
  p_document_id uuid,
  p_action      text,
  p_metadata    jsonb default '{}'::jsonb
)
returns void
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then
    raise exception 'UNAUTHORIZED' using errcode = 'insufficient_privilege';
  end if;
  if p_document_id is not null and not document_is_visible(p_document_id) then
    raise exception 'FORBIDDEN' using errcode = 'insufficient_privilege';
  end if;

  insert into audit_logs (actor_id, document_id, action, metadata)
  values (auth.uid(), p_document_id, p_action, coalesce(p_metadata, '{}'::jsonb));
end;
$$;

revoke all on function log_audit_event(uuid, text, jsonb) from public;
grant execute on function log_audit_event(uuid, text, jsonb) to authenticated;
