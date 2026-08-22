-- ============================================================================
-- 0001_init.sql — core schema for the document intelligence platform
-- One web application: intelligent workspace + institutional governance.
-- ============================================================================

create extension if not exists "pgcrypto";

-- ── Enums ───────────────────────────────────────────────────────────────────
create type app_role as enum ('staff', 'reviewer', 'approver', 'admin');

create type workflow_state as enum (
  'draft', 'submitted', 'under_review', 'approved', 'rejected', 'changes_requested'
);

create type processing_state as enum ('pending', 'processing', 'completed', 'failed');

create type extraction_method as enum ('text', 'ocr', 'mixed');

create type metadata_source as enum ('ai', 'user', 'system');

create type review_action as enum (
  'review_started', 'approved', 'rejected', 'changes_requested', 'commented'
);

-- ── Profiles ────────────────────────────────────────────────────────────────
create table profiles (
  id          uuid primary key references auth.users (id) on delete cascade,
  full_name   text not null default '',
  role        app_role not null default 'staff',
  department_id uuid,                              -- FK added after departments
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

-- ── Controlled two-level taxonomy: department → category ────────────────────
-- Deliberately fixed depth. Prevents the "uncontrolled folder explosion"
-- while still giving the Institution/Department/Category tree.
create table departments (
  id         uuid primary key default gen_random_uuid(),
  name       text not null,
  slug       text not null,
  sort_order int  not null default 0,
  created_at timestamptz not null default now(),
  constraint departments_slug_key unique (slug)
);

create table categories (
  id            uuid primary key default gen_random_uuid(),
  department_id uuid not null references departments (id) on delete cascade,
  name          text not null,
  slug          text not null,
  description   text,
  -- Terms that let the classifier map extracted text onto this category.
  match_keywords text[] not null default '{}',
  is_active     boolean not null default true,
  sort_order    int not null default 0,
  created_at    timestamptz not null default now(),
  constraint categories_dept_slug_key unique (department_id, slug)
);

alter table profiles
  add constraint profiles_department_fk
  foreign key (department_id) references departments (id) on delete set null;

-- ── Documents ───────────────────────────────────────────────────────────────
create table documents (
  id            uuid primary key default gen_random_uuid(),
  title         text not null check (length(btrim(title)) between 1 and 300),
  description   text,
  owner_id      uuid not null references profiles (id) on delete restrict,

  department_id uuid references departments (id) on delete set null,
  category_id   uuid references categories (id) on delete set null,
  -- How the document landed in its category, so the UI can show provenance.
  category_source metadata_source not null default 'system',
  category_confidence real check (category_confidence between 0 and 1),

  workflow_status workflow_state not null default 'draft',
  current_version_id uuid,                          -- FK added after versions

  document_type text,
  document_date date,
  tags          text[] not null default '{}',
  user_metadata  jsonb not null default '{}'::jsonb, -- human-entered
  system_metadata jsonb not null default '{}'::jsonb,-- derived by the platform

  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

-- ── Immutable versions ──────────────────────────────────────────────────────
create table document_versions (
  id               uuid primary key default gen_random_uuid(),
  document_id      uuid not null references documents (id) on delete cascade,
  version_number   int  not null check (version_number > 0),
  storage_path     text not null,
  original_filename text not null,
  mime_type        text not null,
  file_size        bigint not null check (file_size > 0 and file_size <= 26214400),
  content_hash     text,
  uploaded_by      uuid not null references profiles (id) on delete restrict,
  change_note      text,

  processing_status processing_state not null default 'pending',
  processing_error  text,
  extraction_method extraction_method,
  extracted_text    text,
  page_count        int,
  char_count        int not null default 0,

  created_at       timestamptz not null default now(),
  processed_at     timestamptz,

  constraint document_versions_unique_number unique (document_id, version_number),
  constraint document_versions_storage_path_key unique (storage_path)
);

alter table documents
  add constraint documents_current_version_fk
  foreign key (current_version_id) references document_versions (id) on delete set null;

-- ── AI-derived intelligence, kept separate from human metadata ──────────────
create table document_insights (
  id                  uuid primary key default gen_random_uuid(),
  document_id         uuid not null references documents (id) on delete cascade,
  document_version_id uuid not null references document_versions (id) on delete cascade,
  summary             text,
  key_points          jsonb not null default '[]'::jsonb,
  entities            jsonb not null default '[]'::jsonb,
  important_dates     jsonb not null default '[]'::jsonb,
  model               text,
  generated_at        timestamptz not null default now(),
  constraint document_insights_version_key unique (document_version_id)
);

-- ── Retrieval chunks (grounded Q&A + full-text search) ──────────────────────
create table document_chunks (
  id                  uuid primary key default gen_random_uuid(),
  document_id         uuid not null references documents (id) on delete cascade,
  document_version_id uuid not null references document_versions (id) on delete cascade,
  chunk_index         int  not null,
  page_start          int,
  page_end            int,
  content             text not null,
  search_vector       tsvector generated always as (to_tsvector('english', content)) stored,
  created_at          timestamptz not null default now(),
  constraint document_chunks_unique unique (document_version_id, chunk_index)
);

-- ── Comments ────────────────────────────────────────────────────────────────
create table document_comments (
  id                  uuid primary key default gen_random_uuid(),
  document_id         uuid not null references documents (id) on delete cascade,
  document_version_id uuid references document_versions (id) on delete set null,
  author_id           uuid not null references profiles (id) on delete restrict,
  body                text not null check (length(btrim(body)) between 1 and 4000),
  created_at          timestamptz not null default now()
);

-- ── Review records ──────────────────────────────────────────────────────────
create table document_reviews (
  id                  uuid primary key default gen_random_uuid(),
  document_id         uuid not null references documents (id) on delete cascade,
  document_version_id uuid references document_versions (id) on delete set null,
  reviewer_id         uuid not null references profiles (id) on delete restrict,
  action              review_action not null,
  from_state          workflow_state,
  to_state            workflow_state,
  comment             text,
  created_at          timestamptz not null default now()
);

-- ── Append-only audit log ───────────────────────────────────────────────────
create table audit_logs (
  id                  uuid primary key default gen_random_uuid(),
  actor_id            uuid references profiles (id) on delete set null,
  document_id         uuid references documents (id) on delete set null,
  document_version_id uuid references document_versions (id) on delete set null,
  action              text not null,
  from_state          workflow_state,
  to_state            workflow_state,
  metadata            jsonb not null default '{}'::jsonb,
  created_at          timestamptz not null default now()
);

-- ── Full-text search over the document surface ──────────────────────────────
-- Maintained by trigger: title/type/tags weighted above body text.
create table document_search (
  document_id   uuid primary key references documents (id) on delete cascade,
  search_vector tsvector,
  updated_at    timestamptz not null default now()
);

-- ── Indexes ─────────────────────────────────────────────────────────────────
create index idx_profiles_role            on profiles (role);
create index idx_categories_department    on categories (department_id) where is_active;

create index idx_documents_owner          on documents (owner_id);
create index idx_documents_status         on documents (workflow_status);
create index idx_documents_category       on documents (category_id);
create index idx_documents_department     on documents (department_id);
create index idx_documents_updated        on documents (updated_at desc);
create index idx_documents_doc_date       on documents (document_date) where document_date is not null;
create index idx_documents_tags           on documents using gin (tags);

create index idx_versions_document        on document_versions (document_id, version_number desc);
create index idx_versions_processing      on document_versions (processing_status)
  where processing_status in ('pending', 'processing');
create index idx_versions_hash            on document_versions (content_hash) where content_hash is not null;

create index idx_chunks_version           on document_chunks (document_version_id, chunk_index);
create index idx_chunks_search            on document_chunks using gin (search_vector);

create index idx_comments_document        on document_comments (document_id, created_at desc);
create index idx_reviews_document         on document_reviews (document_id, created_at desc);
create index idx_audit_document           on audit_logs (document_id, created_at desc);
create index idx_audit_actor              on audit_logs (actor_id, created_at desc);

create index idx_document_search_vector   on document_search using gin (search_vector);

-- ── updated_at maintenance ──────────────────────────────────────────────────
create or replace function set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

create trigger trg_profiles_updated  before update on profiles
  for each row execute function set_updated_at();
create trigger trg_documents_updated before update on documents
  for each row execute function set_updated_at();

-- ── New auth user → profile ─────────────────────────────────────────────────
-- Runs as definer so signup can create the profile row before RLS applies.
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
    coalesce(new.raw_user_meta_data ->> 'full_name', split_part(new.email, '@', 1)),
    -- Role is never taken from client-supplied metadata; staff is the floor.
    'staff'
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function handle_new_user();

-- ── Search vector maintenance ───────────────────────────────────────────────
create or replace function refresh_document_search(p_document_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_vector tsvector;
begin
  select
      setweight(to_tsvector('english', coalesce(d.title, '')), 'A')
   || setweight(to_tsvector('english', coalesce(d.document_type, '')), 'B')
   || setweight(to_tsvector('english', coalesce(array_to_string(d.tags, ' '), '')), 'B')
   || setweight(to_tsvector('english', coalesce(c.name, '')), 'B')
   || setweight(to_tsvector('english', coalesce(i.summary, '')), 'C')
   || setweight(to_tsvector('english', left(coalesce(v.extracted_text, ''), 500000)), 'D')
    into v_vector
  from documents d
  left join categories c          on c.id = d.category_id
  left join document_versions v   on v.id = d.current_version_id
  left join document_insights i   on i.document_version_id = d.current_version_id
  where d.id = p_document_id;

  insert into document_search (document_id, search_vector, updated_at)
  values (p_document_id, v_vector, now())
  on conflict (document_id)
  do update set search_vector = excluded.search_vector, updated_at = now();
end;
$$;

create or replace function trg_refresh_document_search()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  perform refresh_document_search(
    case when tg_table_name = 'documents' then new.id else new.document_id end
  );
  return new;
end;
$$;

create trigger trg_documents_search
  after insert or update of title, document_type, tags, category_id, current_version_id
  on documents
  for each row execute function trg_refresh_document_search();

create trigger trg_insights_search
  after insert or update on document_insights
  for each row execute function trg_refresh_document_search();

-- ── Version immutability ────────────────────────────────────────────────────
-- Processing may fill in results exactly once; uploaded content never changes.
create or replace function enforce_version_immutability()
returns trigger
language plpgsql
as $$
begin
  if new.document_id     <> old.document_id
     or new.version_number <> old.version_number
     or new.storage_path    <> old.storage_path
     or new.original_filename <> old.original_filename
     or new.mime_type       <> old.mime_type
     or new.file_size       <> old.file_size
     or new.uploaded_by     <> old.uploaded_by
  then
    raise exception 'document_versions rows are immutable (attempted change to identity or file columns)'
      using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

create trigger trg_versions_immutable
  before update on document_versions
  for each row execute function enforce_version_immutability();

-- ── Audit is append-only, at every privilege level ──────────────────────────
create or replace function block_audit_mutation()
returns trigger
language plpgsql
as $$
begin
  raise exception 'audit_logs is append-only'
    using errcode = 'insufficient_privilege';
end;
$$;

create trigger trg_audit_no_update before update on audit_logs
  for each row execute function block_audit_mutation();
create trigger trg_audit_no_delete before delete on audit_logs
  for each row execute function block_audit_mutation();
