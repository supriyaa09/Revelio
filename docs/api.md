# API Contract

> **Specification only.** No endpoint is implemented yet.

Base path: `/api`

Authentication: `Authorization: Bearer <Supabase JWT>`

All handlers are **Next.js Route Handlers executing as the signed-in user**, so RLS applies to every query. The service-role key is never used to satisfy a normal user request.

## Universal rules

1. **Validate every input server-side.** Never trust client-supplied shape, type or length.
2. **Authorization is enforced by RLS**, not by handler logic. Handlers add ergonomics and validation, not security.
3. **One error envelope** for every failure (below).
4. Never expose service-role keys, AI API keys or raw stack traces.
5. All list endpoints are paginated (`limit` ≤ 100, default 25, plus `cursor`).

## Fields the client may never set

These are derived or enforced by trusted server logic. Supplying them is a `VALIDATION_ERROR`, not a silent ignore:

| Field | Source of truth |
| --- | --- |
| `owner_id` | JWT subject |
| `uploaded_by` / `author_id` | JWT subject |
| `version_number` | Server-assigned, sequential per document |
| `storage_path` | Server-computed from document id + version |
| `workflow_status` | Only via `POST /transition` |
| `processing_status` | Processing pipeline only |
| Audit actor | Derived inside `SECURITY DEFINER` functions |
| Review actor | Derived inside the transition function |
| `created_at` / `updated_at` | Database defaults and triggers |

---

# Web platform — custodial documents

## `POST /api/documents`

Create a document. Starts in `draft`.

Request:

```json
{
  "title": "Scholarship Eligibility Guidelines",
  "description": "2026 intake criteria",
  "category_id": "uuid",
  "metadata": { "department": "student_affairs" },
  "tags": ["policy", "students"]
}
```

Validation: `title` 1–200 chars, required. `category_id` must exist and be active. `metadata` must be an object, not an array or scalar.

Returns `201` with the document. `owner_id` is the caller; `workflow_status` is forced to `draft`.

## `GET /api/documents`

List documents visible to the caller.

Query parameters: `q`, `category`, `workflow_status`, `owner`, `tag`, `date_from`, `date_to`, `limit`, `cursor`.

Authorization constraints are applied by RLS **before** results are returned. Faculty and HOD users never see another user's drafts.

## `GET /api/documents/{document_id}`

Returns the document, its current version, metadata, tags, and comment/version counts. `404` (not `403`) when the caller cannot see it, so existence is not leaked.

## `PATCH /api/documents/{document_id}`

Update `title`, `description`, `category_id`, `metadata`, `tags`. Permitted only while `draft`, and only for the owner or HOD.

Attempting to change `workflow_status` here returns `VALIDATION_ERROR` — transitions have their own endpoint.

## `POST /api/documents/{document_id}/versions/upload-url`

Issues a short-lived signed upload URL with a **server-computed** storage path. This is how the client uploads without ever holding storage credentials.

Request:

```json
{ "original_filename": "guidelines.pdf", "mime_type": "application/pdf", "file_size": 184320 }
```

Validation: MIME must be `application/pdf`; `file_size` > 0 and ≤ 26214400 (25 MB). Rejected before any URL is issued.

Returns `signed_url`, `storage_path`, `expires_at`.

## `POST /api/documents/{document_id}/versions`

Creates the version record after the storage upload completes.

Request:

```json
{ "storage_path": "…", "original_filename": "guidelines.pdf", "mime_type": "application/pdf", "file_size": 184320, "content_hash": "sha256:…" }
```

`version_number` is **server-assigned** as `max(version_number) + 1` within a transaction. `storage_path` is verified to match the server-computed value for that document and version — a mismatch is `VALIDATION_ERROR`.

Returns `201` with `version_id`, `version_number`, `processing_status`.

Side effects: `documents.current_version_id` advances; an `approved` or `rejected` document returns to `draft` for a new review cycle; `document_version_created` is audited.

A duplicate `version_number` (concurrent uploads) returns `409 DUPLICATE_VERSION`.

## `GET /api/documents/{document_id}/versions`

Version history, newest first. Previous versions always remain listed and readable.

## `POST /api/documents/{document_id}/transition`

Request:

```json
{ "to_state": "faculty_review", "comment": "Ready for verification" }
```

The server:

- determines the current state from the database (never from the client)
- validates the transition against the allowed set
- validates the caller's role for that transition
- enforces separation of duties — the owner cannot approve or reject their own document
- writes a `document_reviews` row and an `audit_logs` row atomically

Errors: `INVALID_WORKFLOW_TRANSITION` (422) for an illegal state pair; `FORBIDDEN` (403) when the role or ownership rule fails.

## `GET /api/documents/{document_id}/comments` · `POST …/comments`

Create and list comments. `author_id` comes from the JWT. Body must be non-empty and ≤ 4000 chars. Comments are visible to anyone who can see the document.

## `GET /api/documents/{document_id}/audit`

Combined workflow and audit history, newest first: action, actor, `from_state`, `to_state`, comment, timestamp. Read-only by construction — no write method exists on this resource at any privilege level.

## `GET /api/categories` · `POST` · `PATCH` · `DELETE`

Read for any authenticated user. Writes are HOD-only, enforced by RLS. `name` is unique; a conflict returns `409 CONFLICT`.

---

# Search

## `GET /api/documents/search`

Query parameters:

| Parameter | Meaning |
| --- | --- |
| `q` | Free text |
| `category`, `workflow_status`, `owner`, `tag`, `author` | Facets |
| `date_from`, `date_to` | Date range |
| `include_paths` | Folder scope — restrict to these prefixes (synced catalog rows) |
| `exclude_paths` | Folder scope — subtract these prefixes |
| `profile` | Saved search profile id, expanded server-side |
| `scope` | `documents` · `catalog` · `all` |

Results: `id`, `title`, `category`, `status`, `owner`, `updated_at`, `matched_snippet`, `score`, `source_type`.

Rules:

- **Authorization constraints are applied before results are returned.** Unauthorized documents never appear, including as counts.
- **`exclude_paths` wins over `include_paths`** for the nested case.
- Ranking uses the fixed field weights: title > file name > keywords > body, with recency and exact-phrase boosts.
- A malformed `q` degrades to a plain term search rather than erroring.

## `POST /api/search/interpret`

AI query understanding. Maps natural language onto structured facets.

```json
{ "query": "show approved policies" }
```

```json
{
  "facets": { "workflow_status": "approved", "category": "policy" },
  "residual_text": "",
  "confidence": "high"
}
```

**Must degrade gracefully.** If the AI provider is unavailable, over quota, or the caller is offline, the client falls back to lexical search with the raw query. This endpoint never blocks search.

## `GET /api/files/{indexed_file_id}/similar`

Lexical nearest-neighbour over the caller's own catalog. Returns `indexed_file_id`, `score`, `method` and the shared signals that produced the match (`category`, `author`, `department`, overlapping keywords) so results are explainable.

`method` is `lexical` in MVP. Vector embeddings are a stretch extension point and would appear as `method: "embedding"` without an API change.

---

# Desktop application — identity and sync

## Authentication

The desktop app uses **PKCE**. It holds no client secret, and the refresh token is stored in the OS keychain (DPAPI / Keychain / libsecret), never in a plaintext file. There is no bespoke login endpoint — Supabase Auth is used directly.

## `POST /api/devices/register`

```json
{ "name": "Sohail-Laptop", "platform": "win32" }
```

Returns `device_id`. Idempotent per `(owner_id, name, platform)`. Audited as `device_registered`.

## `POST /api/sync/push`

One-way push, desktop → cloud. **Metadata, categories and locators only — never file bytes.**

```json
{
  "device_id": "uuid",
  "since": "2026-08-22T06:00:00Z",
  "files": [
    {
      "content_hash": "sha256:…",
      "file_name": "regulations.pdf",
      "title": "Academic Regulations",
      "author": "Registrar",
      "department": "academics",
      "doc_date": "2026-07-01",
      "category": "policy",
      "keywords": ["regulations", "academics"],
      "size_bytes": 184320,
      "mime_type": "application/pdf",
      "updated_at": "2026-08-22T07:10:00Z",
      "deleted": false,
      "locator": { "source_type": "local_fs", "source_ref": "E:/Research/regulations.pdf", "folder_path": "E:/Research/", "mtime": "2026-08-20T12:00:00Z" }
    }
  ]
}
```

Semantics:

- **Idempotent**, keyed on `(owner_id, content_hash)` — safe to replay after a failed batch.
- Batched; `≤ 500` files per request.
- Conflicts resolve **last-writer-wins** by `updated_at`, with `device_id` recorded.
- `deleted: true` writes a tombstone; sync never hard-deletes.
- Only folders with `sync_enabled = true` may be pushed. A push referencing a non-synced folder is rejected with `SYNC_NOT_PERMITTED` rather than partially applied.
- The cloud search index is **re-derived** from pushed metadata; no SQLite blob is transmitted.
- Audited as `sync_pushed` with counts only — never file names.

Returns per-item `accepted` / `skipped` / `conflict` outcomes plus a `server_time` watermark for the next `since`.

## `GET /api/sync/pull`

**Documented, not implemented in MVP.** Reserved for bidirectional sync. MVP is one-way push; see the assumption flagged in `context.md`.

---

# AI enhancement layer

All AI endpoints are **server-side proxies**. This is the only place a provider key exists — never the browser, never the desktop bundle.

| Endpoint | Purpose |
| --- | --- |
| `POST /api/ai/extract-metadata` | Suggest title, author, department, date, keywords |
| `POST /api/ai/categorize` | Suggest a category from the shared vocabulary |
| `POST /api/ai/summarize` | Produce a summary |
| `POST /api/search/interpret` | Query understanding (above) |

Rules for all four:

- Output is written to `ai_insights` / `summary` and marked `source: "ai"`. It **never** overwrites human-entered metadata.
- Failure returns `AI_ENRICHMENT_FAILED` and **must not** destroy already-extracted metadata.
- Rate-limited per user. Only sends the minimum text required for the task.

---

# Deferred endpoints

Documented so the contract is stable, but **not implemented in MVP**:

| Endpoint | Status |
| --- | --- |
| `POST /api/documents/{id}/versions/{version_id}/process` | Minimal OCR/extraction path, Phase 6 |
| `POST /api/documents/{id}/qna` | **Grounded Q&A moved to stretch** |
| `GET /api/sync/pull` | Bidirectional sync, future |
| Google Drive / OneDrive / Dropbox connectors | Interface only — no implementation |

---

# Error shape

```json
{
  "error": {
    "code": "INVALID_WORKFLOW_TRANSITION",
    "message": "This document cannot move from draft to approved.",
    "details": "Human-safe detail"
  }
}
```

`details` is always human-safe. Never expose service-role keys, API keys, connection strings or stack traces.

## Error codes

| Code | HTTP | Meaning |
| --- | --- | --- |
| `VALIDATION_ERROR` | 400 | Input failed server-side validation, or a protected field was supplied |
| `UNAUTHORIZED` | 401 | Missing or invalid JWT |
| `FORBIDDEN` | 403 | Authenticated but not permitted |
| `NOT_FOUND` | 404 | Absent, or not visible to the caller |
| `CONFLICT` | 409 | Uniqueness violation |
| `DUPLICATE_VERSION` | 409 | Concurrent version creation |
| `INVALID_WORKFLOW_TRANSITION` | 422 | Illegal state pair or role for the transition |
| `UNSUPPORTED_FILE_TYPE` | 422 | Not PDF |
| `FILE_TOO_LARGE` | 422 | Over 25 MB |
| `SYNC_NOT_PERMITTED` | 403 | Folder is not opted in to sync |
| `SOURCE_UNREACHABLE` | 409 | Indexed source cannot be read |
| `AI_ENRICHMENT_FAILED` | 502 | Provider error or quota exhaustion |
| `RATE_LIMITED` | 429 | Too many requests |
| `INTERNAL_ERROR` | 500 | Unexpected failure |

Retained for the deferred processing path: `INVALID_PDF`, `PASSWORD_PROTECTED_PDF`, `TEXT_EXTRACTION_FAILED`, `OCR_FAILED`.

**Existence is not leaked:** a resource the caller may not see returns `404`, not `403`.
