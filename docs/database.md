# Database Specification

> **Design documentation only.** No migrations, tables or database objects exist yet. This document describes the intended schema so implementation can proceed without re-deriving decisions.

The data model spans **two stores**:

| Store | Engine | Purpose |
| --- | --- | --- |
| **Cloud** | Supabase PostgreSQL | Identity, shared vocabulary, custodial documents + governance, synced personal catalog |
| **Local** | SQLite + FTS5 (desktop) | Offline index, local metadata, categories, similarity, sync queue |

Enum-style values use PostgreSQL enums or `CHECK` constraints — never unvalidated free text.

---

# Part 1 — Cloud schema (PostgreSQL)

## Domain 1: Identity and shared vocabulary

### `profiles`

| Column | Type | Notes |
| --- | --- | --- |
| `id` | uuid PK | References `auth.users(id)` ON DELETE CASCADE |
| `full_name` | text | |
| `role` | `app_role` | NOT NULL, default `student` |
| `created_at` | timestamptz | default `now()` |
| `updated_at` | timestamptz | maintained by trigger |

`app_role` ∈ `student` · `faculty` · `hod`

### `categories`

Shared vocabulary used by **both** applications.

| Column | Type | Notes |
| --- | --- | --- |
| `id` | uuid PK | |
| `name` | text | **UNIQUE**, NOT NULL |
| `description` | text | |
| `is_active` | boolean | default `true` |
| `created_at` / `updated_at` | timestamptz | |

### `tags`

Tags are a first-class search dimension, so they are relational rather than a JSON array.

| Column | Type | Notes |
| --- | --- | --- |
| `id` | uuid PK | |
| `name` | text | **UNIQUE**, NOT NULL, normalized lowercase |
| `created_at` | timestamptz | |

Join tables: `document_tags(document_id, tag_id)` and `indexed_file_tags(indexed_file_id, tag_id)`, each with a composite PK.

---

## Domain 2: Custodial documents (web platform, FS-05)

### `documents`

| Column | Type | Notes |
| --- | --- | --- |
| `id` | uuid PK | |
| `title` | text | NOT NULL, length-checked |
| `description` | text | |
| `category_id` | uuid FK → `categories` | ON DELETE RESTRICT |
| `owner_id` | uuid FK → `profiles` | NOT NULL, **server-assigned from JWT** |
| `workflow_status` | `workflow_state` | NOT NULL, default `draft` |
| `current_version_id` | uuid FK → `document_versions` | nullable; set only after the version row commits |
| `metadata` | jsonb | **human-entered**, default `{}` |
| `created_at` / `updated_at` | timestamptz | |

`workflow_state` ∈ `draft` · `submitted` · `faculty_review` · `hod_review` · `approved` · `rejected` · `changes_requested`

### `document_versions`

**Immutable.** Once written, content columns never change.

| Column | Type | Notes |
| --- | --- | --- |
| `id` | uuid PK | |
| `document_id` | uuid FK → `documents` | ON DELETE CASCADE |
| `version_number` | integer | NOT NULL, `CHECK > 0`, **server-assigned** |
| `storage_path` | text | NOT NULL, UNIQUE, **server-computed** |
| `original_filename` | text | NOT NULL |
| `mime_type` | text | `CHECK IN ('application/pdf')` for MVP |
| `file_size` | bigint | `CHECK > 0 AND <= 26214400` (25 MB) |
| `content_hash` | text | SHA-256; enables dedupe and cross-store identity |
| `uploaded_by` | uuid FK → `profiles` | NOT NULL, from JWT |
| `processing_status` | `processing_state` | NOT NULL, default `pending` |
| `extraction_method` | text | nullable, `CHECK IN ('text','ocr')` |
| `extracted_text` | text | nullable; populated by the minimal OCR/extraction path |
| `processing_error` | text | nullable |
| `created_at` | timestamptz | |

`processing_state` ∈ `pending` · `processing` · `completed` · `failed`

Constraints: **`UNIQUE(document_id, version_number)`**; a trigger blocks `UPDATE` of content columns; no client `DELETE`.

### `document_metadata`

Keeps human and AI-derived metadata distinguishable, per version.

| Column | Type | Notes |
| --- | --- | --- |
| `id` | uuid PK | |
| `document_id` | uuid FK → `documents` | |
| `document_version_id` | uuid FK → `document_versions` | **UNIQUE** — metadata derives from a specific version |
| `summary` | text | nullable |
| `ai_insights` | jsonb | default `{}` — flexible AI-derived fields only |
| `source` | `metadata_source` | `human` · `ai` |
| `created_at` / `updated_at` | timestamptz | |

Structured, queryable fields live as real columns. `ai_insights` holds only flexible AI output, so the product never depends on a JSON blob for core behaviour.

### `document_comments`

First-class capability in the revised direction.

| Column | Type | Notes |
| --- | --- | --- |
| `id` | uuid PK | |
| `document_id` | uuid FK → `documents` | ON DELETE CASCADE |
| `document_version_id` | uuid FK → `document_versions` | nullable — comment may target a version |
| `author_id` | uuid FK → `profiles` | NOT NULL, from JWT |
| `body` | text | NOT NULL, non-empty, length-checked |
| `created_at` / `updated_at` | timestamptz | |

### `document_reviews`

Minimal relational workflow record. Makes every review-tier action attributable. **Not a workflow engine.**

| Column | Type | Notes |
| --- | --- | --- |
| `id` | uuid PK | |
| `document_id` | uuid FK → `documents` | |
| `document_version_id` | uuid FK → `document_versions` | version under review |
| `reviewer_id` | uuid FK → `profiles` | **derived from JWT inside the transition function** |
| `action` | `review_action` | `review_started` · `approved` · `rejected` |
| `from_state` / `to_state` | `workflow_state` | |
| `comment` | text | nullable |
| `created_at` | timestamptz | |

### `audit_logs`

**Append-only.**

| Column | Type | Notes |
| --- | --- | --- |
| `id` | uuid PK | |
| `actor_id` | uuid FK → `profiles` | ON DELETE SET NULL |
| `document_id` | uuid | nullable, ON DELETE SET NULL |
| `document_version_id` | uuid | nullable |
| `action` | text | constrained to a known action list |
| `from_state` / `to_state` | `workflow_state` | nullable |
| `metadata` | jsonb | default `{}` |
| `created_at` | timestamptz | default `now()` |

Actions: `document_created`, `document_uploaded`, `document_version_created`, `document_submitted`, `document_review_started`, `document_approved`, `document_rejected`, `document_metadata_updated`, `document_commented`, `document_deleted`, `role_changed`, `category_created`, `device_registered`, `sync_pushed`.

Enforcement: **no client `INSERT`** — rows are written only inside `SECURITY DEFINER` functions and triggers, so the actor cannot be spoofed. `UPDATE` and `DELETE` are revoked and additionally blocked by a trigger.

---

## Domain 3: Personal catalog (desktop, non-custodial — synced)

This domain stores **derived data only**. It never stores file bytes in MVP.

### `indexed_files`

| Column | Type | Notes |
| --- | --- | --- |
| `id` | uuid PK | |
| `owner_id` | uuid FK → `profiles` | NOT NULL |
| `content_hash` | text | SHA-256, NOT NULL — canonical identity |
| `file_name` | text | |
| `title` | text | nullable |
| `author` | text | nullable — search facet |
| `department` | text | nullable — search facet and grouping key |
| `doc_date` | date | nullable — search facet, recency boost |
| `category_id` | uuid FK → `categories` | nullable |
| `size_bytes` | bigint | |
| `mime_type` | text | |
| `keywords` | text[] | derived; drives grouping and ranking |
| `summary` | text | nullable, AI-derived |
| `ai_insights` | jsonb | default `{}` |
| `first_indexed_at` | timestamptz | |
| `updated_at` | timestamptz | sync conflict resolution |
| `deleted_at` | timestamptz | nullable — **tombstone**, never hard-deleted by sync |

Constraint: **`UNIQUE(owner_id, content_hash)`** — the same file on two devices converges to one catalog row.

### `file_locators`

One catalog row can exist in several places, devices and sources. This is what makes index-in-place work across machines and future Drive mode.

| Column | Type | Notes |
| --- | --- | --- |
| `id` | uuid PK | |
| `indexed_file_id` | uuid FK → `indexed_files` | ON DELETE CASCADE |
| `device_id` | uuid FK → `devices` | nullable (null for cloud sources) |
| `source_type` | `source_type` | `local_fs` · `platform_storage` · `google_drive` · `onedrive` · `dropbox` |
| `source_ref` | text | absolute path, or provider file ID |
| `folder_path` | text | **normalized, prefix-searchable** — powers folder scope |
| `mtime` | timestamptz | change detection |
| `state` | `locator_state` | `present` · `missing` · `unreachable` |
| `last_seen_at` | timestamptz | |

Constraint: `UNIQUE(device_id, source_type, source_ref)`.

Only `local_fs` and `platform_storage` are implemented in MVP; the remaining values exist as **extension points**.

### `devices`

| Column | Type | Notes |
| --- | --- | --- |
| `id` | uuid PK | |
| `owner_id` | uuid FK → `profiles` | NOT NULL |
| `name` | text | user-visible device label |
| `platform` | text | `win32` · `darwin` · `linux` |
| `last_sync_at` | timestamptz | nullable |
| `created_at` | timestamptz | |

### `indexed_folders`

Index-time scope. Include roots and exclude rules.

| Column | Type | Notes |
| --- | --- | --- |
| `id` | uuid PK | |
| `owner_id` | uuid FK → `profiles` | NOT NULL |
| `device_id` | uuid FK → `devices` | |
| `root_path` | text | normalized |
| `mode` | `folder_scope_mode` | `include` · `exclude` |
| `sync_enabled` | boolean | default `false` — **opt-in metadata sync, per folder** |
| `is_active` | boolean | default `true` |
| `created_at` | timestamptz | |

### `search_profiles`

Saved query-time scopes, because users reuse "only Research + Policies" constantly.

| Column | Type | Notes |
| --- | --- | --- |
| `id` | uuid PK | |
| `owner_id` | uuid FK → `profiles` | NOT NULL |
| `name` | text | NOT NULL |
| `include_paths` | text[] | |
| `exclude_paths` | text[] | |
| `created_at` | timestamptz | |

Constraint: `UNIQUE(owner_id, name)`.

### `similarity_links`

| Column | Type | Notes |
| --- | --- | --- |
| `id` | uuid PK | |
| `source_file_id` | uuid FK → `indexed_files` | ON DELETE CASCADE |
| `target_file_id` | uuid FK → `indexed_files` | ON DELETE CASCADE |
| `score` | real | `CHECK` between 0 and 1 |
| `method` | `similarity_method` | `lexical` in MVP; `embedding` reserved |
| `computed_at` | timestamptz | |

Constraints: `UNIQUE(source_file_id, target_file_id, method)`, `CHECK (source_file_id <> target_file_id)`.

The `method` discriminator **is** the embeddings extension point: adding vector similarity later inserts rows with `method = 'embedding'` and requires no schema change to this table.

---

## Relationships

```text
auth.users 1──1 profiles
profiles   1──* documents            (owner)
profiles   1──* indexed_files        (owner)
profiles   1──* devices
categories 1──* documents
categories 1──* indexed_files
documents  1──* document_versions    (immutable)
documents  1──1 document_versions    (current_version_id pointer)
documents  1──* document_comments
documents  1──* document_reviews
documents  1──* audit_logs           (nullable)
document_versions 1──1 document_metadata
indexed_files 1──* file_locators     (per device / per source)
indexed_files *──* tags              (via indexed_file_tags)
documents     *──* tags              (via document_tags)
indexed_files *──* indexed_files     (via similarity_links)
devices    1──* indexed_folders
devices    1──* file_locators
```

## Indexes

| Table | Index |
| --- | --- |
| `profiles` | `(role)` |
| `documents` | `(owner_id)`, `(workflow_status)`, `(category_id)`, `(updated_at DESC)` |
| `document_versions` | `UNIQUE(document_id, version_number)`, `(document_id, created_at DESC)`, `(content_hash)` |
| `document_comments` | `(document_id, created_at DESC)` |
| `document_reviews` | `(document_id, created_at DESC)`, `(reviewer_id)` |
| `audit_logs` | `(document_id, created_at DESC)`, `(actor_id, created_at DESC)` |
| `indexed_files` | `UNIQUE(owner_id, content_hash)`, `(owner_id, updated_at DESC)`, `(category_id)`, `(author)`, `(department)`, `(doc_date)`, GIN on `keywords` |
| `file_locators` | `UNIQUE(device_id, source_type, source_ref)`, **`(folder_path text_pattern_ops)`** for prefix scope matching, `(state)` |
| `similarity_links` | `(source_file_id, score DESC)` |
| Cloud FTS | GIN on a generated `tsvector` over title, file name, keywords and extracted text |

`text_pattern_ops` on `folder_path` is what makes folder-scope filters use an index instead of scanning.

---

# Part 2 — Local schema (SQLite + FTS5, desktop)

Mirrors the personal-catalog domain so the app is fully functional offline.

| Table | Purpose |
| --- | --- |
| `files` | `id`, `content_hash`, `path`, `folder_path`, `file_name`, `ext`, `size_bytes`, `mtime`, `indexed_at`, `state` |
| `file_metadata` | `file_id`, `title`, `author`, `department`, `doc_date`, `category`, `summary`, `keywords` |
| `files_fts` | **FTS5 virtual table** over `file_name`, `title`, `author`, `keywords`, `content`; ranked with `bm25()` using the specified field weights |
| `folders` | `root_path`, `mode` (`include`/`exclude`), `sync_enabled`, `is_active` |
| `search_profiles` | `name`, `include_paths`, `exclude_paths` |
| `similarity` | `source_id`, `target_id`, `score`, `method` |
| `sync_queue` | `row_type`, `row_id`, `op`, `updated_at`, `synced_at` — drives one-way push |
| `settings` | key/value: sync opt-in, default exclusions, index preferences |

Reserved and **not created in MVP:** an `embeddings` table for stretch vector similarity.

Local identity is `content_hash`, matching the cloud, so sync is a hash-keyed upsert rather than an ID reconciliation problem.

---

# Part 3 — RLS strategy

**RLS is the primary authorization boundary.** UI hiding an action is not authorization. RLS is enabled on **every** application table — none left open.

## Helper functions

`current_app_role()`, `is_hod()`, `can_review()` and `document_is_visible()` use `SECURITY DEFINER`, `STABLE`, with a pinned `search_path`. `SECURITY DEFINER` is required to avoid recursive RLS evaluation when a `profiles` policy needs to read `profiles`.

## Custodial domain

| Table | SELECT | INSERT | UPDATE | DELETE |
| --- | --- | --- | --- | --- |
| `profiles` | Any authenticated user (id, name, role — needed for attribution UI) | Self on signup | Self, `full_name` only; **role changes admin-only** | Admin |
| `categories` | Any authenticated user | Admin | Admin | Admin |
| `documents` | Owner, **or** review-capable when status ∈ {submitted, under_review, approved, rejected}, **or** admin | Authenticated, with `owner_id = auth.uid()` and `workflow_status = 'draft'` enforced by `WITH CHECK` | Owner while `draft` (non-status fields only), or admin | Owner while `draft`, or admin |
| `document_versions` | Follows parent document visibility | Owner of parent document; `version_number`, `storage_path`, `uploaded_by` server-assigned | **None** (immutable) | **None** |
| `document_metadata` | Follows document visibility | Owner while draft, or admin | Owner while draft, or admin | Admin |
| `document_comments` | Follows document visibility | Author must equal `auth.uid()` | Own comments only | Own comments, or admin |
| `document_reviews` | Follows document visibility | **None** — written only by the transition function | **None** | **None** |
| `audit_logs` | Own actions, **or** rows for documents the user can see, **or** admin (all) | **None** — function-written only | **None** (revoked + trigger-blocked) | **None** |

Faculty and HOD users deliberately cannot see other users' **drafts** — only documents that have entered the workflow.

## Personal catalog domain

Every table is **strictly owner-scoped**: `owner_id = auth.uid()` for `SELECT`, `INSERT`, `UPDATE` and `DELETE`.

> Institutional management has no access to any user's personal catalog. This remains a deliberate privacy boundary for any future personal-index feature.

Applies to: `indexed_files`, `file_locators`, `devices`, `indexed_folders`, `search_profiles`, `similarity_links`, `indexed_file_tags`.

Future Drive mode adds a further rule: **source ACLs are authoritative**, and the platform must never surface content the source would refuse.

---

# Part 4 — Storage strategy

Private bucket: **`documents`** (`public = false`).

Object key (the bucket name is not repeated in the key):

```text
{document_id}/v{version_number}/{safe_filename}.pdf
```

Files are **immutable per version**. A replacement is always a new version at a new path.

| Control | Mechanism |
| --- | --- |
| Privacy | Bucket is private; no public URLs ever issued |
| Read access | Short-lived signed URLs generated **server-side** |
| Write access | Server-issued signed upload URL with a **server-computed** path |
| Cross-user access | `storage.objects` policies join the leading path segment to `documents` visibility |
| Immutability | No client `UPDATE` or `DELETE` on `storage.objects` |
| Type restriction | Bucket `allowed_mime_types = ['application/pdf']` **+** DB `CHECK` **+** route validation |
| Size restriction | Bucket `file_size_limit = 26214400` **+** DB `CHECK` **+** route validation |
| Credentials | Service-role key server-side only; never in the browser or the desktop bundle |

Three independent enforcement layers exist deliberately: a client cannot weaken any of them.

**Desktop app:** stores nothing in this bucket in MVP. Optional file backup is a future feature and would use a separate per-user prefix with its own policies.

---

# Part 5 — Workflow state machine

## User-initiated transitions

| From | To | Permitted roles |
| --- | --- | --- |
| `draft` | `submitted` | Owner |
| `submitted` | `draft` | Owner (withdraw) |
| `submitted` | `faculty_review` / `hod_review` | Faculty or HOD |
| `faculty_review` | `approved` / `rejected` / `changes_requested` | Faculty or HOD — **never the owner** |
| `faculty_review` | `hod_review` | Faculty or HOD (routing) |
| `hod_review` | `approved` / `rejected` / `changes_requested` | HOD — **never the owner** |
| `changes_requested` | `submitted` | Owner |
| `rejected` | `draft` | Owner |

## System-initiated transition

| From | To | Trigger |
| --- | --- | --- |
| `approved` or `rejected` | `draft` | A new version is created, starting a new review cycle |

This is recorded explicitly because it is the one legal path out of a terminal state, and it is initiated by the system rather than a user action.

## Explicitly rejected transitions

- `draft` → `approved`
- `draft` → `faculty_review`
- `submitted` → `approved`
- `approved` → `faculty_review`
- `rejected` → `approved` (approval requires resubmission first)
- Any state → itself

## Enforcement

A single `SECURITY DEFINER` function — `transition_document(document_id, to_state, comment)` — performs the whole operation atomically:

1. Resolve the actor from `auth.uid()`.
2. Lock the document row `FOR UPDATE`.
3. Read the current state.
4. Validate the `(from, to)` pair against the allowed set.
5. Validate the actor's role for that specific transition.
6. Enforce **separation of duties**: the owner cannot approve or reject their own document.
7. Update `workflow_status`.
8. Insert a `document_reviews` row for review actions.
9. Insert an `audit_logs` row with `from_state` and `to_state`.

**Defence in depth:** a `BEFORE UPDATE OF workflow_status` trigger on `documents` independently validates the state pair, so even direct SQL or a service-role connection cannot perform `draft → approved`.

This is a fixed state machine held in constraints and functions. It is **not** a configurable workflow engine.

---

# Part 6 — Concerns and tradeoffs

1. **Two stores mean two sources of truth for the catalog.** Mitigated by hash-keyed identity and one-way MVP sync, but genuine divergence is possible if bidirectional sync is added later.
2. **`document_reviews` partially overlaps `audit_logs`.** Kept separate deliberately: audit is a generic append-only security log; reviews are a queryable domain record powering the review queue. The cost is writing two rows per transition.
3. **Folder-scope prefix matching depends on path normalization.** Case sensitivity, trailing separators, UNC paths and drive letters on Windows must be normalized consistently at index time, or scope filters will silently miss files.
4. **Lexical similarity may look weak on a small or homogeneous corpus.** The `method` discriminator keeps the upgrade path open, but demo corpus selection matters.
5. **`keywords` as `text[]` with GIN is fast but unranked.** Term-frequency weighting lives in the FTS index, not the array, so the two must be kept consistent.
6. **Personal catalogs excluded from institutional-management visibility** is the right privacy call but means an institution cannot audit personal indexes at all. That is intentional and should be stated to stakeholders rather than discovered.
7. **Tombstones grow unbounded.** No retention policy is defined for MVP; this needs one before any real deployment.
8. **`content_hash` collisions are ignored.** SHA-256 collision risk is negligible, but two genuinely identical files in different folders correctly collapse to one catalog row with two locators — which is intended behaviour, though it may surprise users who expect two entries.
9. **Removed from the earlier design:** the `workflows` table (states/transitions as data) — superseded by the fixed state machine, per the "no complex workflow builders" constraint; `document_chunks`, `search_vector` per chunk and `embedding` columns — deferred with Q&A and pgvector; `document_deadlines` — dropped as over-modeling, since deadline extraction is not in the revised MVP.
