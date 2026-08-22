# Coding Agent Task 01 — Foundation

You are the implementation agent for a 24-hour hackathon project.

## First: understand the project

Before changing code:

1. Read `docs/context.md`
2. Read `docs/architecture.md`
3. Read `docs/database.md`
4. Read `docs/api.md`
5. Read `docs/decisions.md`
6. Read `docs/current-changes.md`
7. Read `README.md`

Treat those documents as the project source of truth.

Do NOT restart the project or replace the existing architecture with a different one unless there is a concrete technical blocker. If you believe a change is necessary, document the reason in `docs/decisions.md`, update `docs/context.md`, and add an entry to `docs/current-changes.md`.

## Goal

Implement the secure application foundation for the AI document-intelligence platform.

The required product direction is:

> An AI-powered institutional document intelligence platform that transforms institutional documents into searchable, queryable and actionable knowledge.

For this task, DO NOT implement OCR, LLM processing, semantic search, document Q&A, advanced analytics, or a polished end-to-end dashboard.

The goal is to make the application foundation trustworthy and ready for those features.

---

# Architecture for this task

Use:

- Frontend: use the frontend framework already established in the repository. Do not replace it without a documented reason.
- Supabase/PostgreSQL for database
- Supabase Auth for authentication
- Supabase Storage for private document files
- Row Level Security for authorization
- Backend service only where required by the architecture documents
- Keep secrets server-side

The browser must NEVER receive a Supabase service-role key or any AI/API secret.

---

# Implement

## 1. Repository structure

Turn the current scaffold into a clean working structure while preserving the existing documentation layout.

Create the minimum necessary project files for:

- frontend
- backend/processing service placeholder if the architecture calls for it
- Supabase migrations
- Supabase seed/demo data
- tests

Do not add unnecessary dependencies.

For every dependency you add, make sure it is actually required for this task.

---

# 2. Database schema

Implement the core schema described in `docs/database.md`.

At minimum the schema should support:

### Profiles / users

Store the application profile associated with the authenticated user.

Suggested fields:

- `id` UUID, matching `auth.users.id`
- `full_name`
- `role`
- `created_at`
- `updated_at`

Roles for MVP:

- `admin`
- `staff`
- `reviewer`
- `approver`

Use a database constraint/enum rather than trusting arbitrary strings.

---

### Categories

Support document categorization.

Fields should include:

- `id`
- `name`
- `description`
- timestamps

Category names should be unique.

---

### Documents

Represent the logical document, independent of a particular uploaded file version.

Minimum fields:

- `id`
- `title`
- `description`
- `category_id`
- `owner_id`
- `status`
- `current_version_id` or an equivalent safe mechanism
- `created_at`
- `updated_at`

MVP status values:

- `draft`
- `submitted`
- `under_review`
- `approved`
- `rejected`

Add database constraints for valid states.

---

### Document versions

Every uploaded version must be immutable.

Minimum fields:

- `id`
- `document_id`
- `version_number`
- `storage_path`
- `original_filename`
- `mime_type`
- `file_size`
- `uploaded_by`
- `extracted_text` or the documented equivalent placeholder
- processing status
- created timestamp

Processing status should support at least:

- `pending`
- `processing`
- `completed`
- `failed`

Enforce uniqueness of `(document_id, version_number)`.

Do not allow existing version content to be casually overwritten.

---

### Document metadata

Design this according to `docs/database.md`.

The schema must leave room for AI-generated metadata without making the entire product depend on a JSON blob.

Store important structured fields explicitly where appropriate and use JSON only for flexible AI-derived metadata.

At minimum support:

- summary
- extracted entities/metadata
- important dates/deadlines

Do not over-model fields we do not need yet.

---

### Audit logs

Create an audit table for security-sensitive and workflow actions.

Minimum fields:

- `id`
- `actor_id`
- `document_id` nullable when appropriate
- `action`
- `metadata`
- `created_at`

Audit events should be append-only from the application perspective.

Examples:

- document_created
- document_uploaded
- document_version_created
- document_submitted
- document_review_started
- document_approved
- document_rejected
- document_metadata_updated
- document_deleted

Do not expose unrestricted audit-log modification to ordinary users.

---

### Workflow / review records

Create the minimum relational structure necessary to support:

Draft
→ Submitted
→ Under Review
→ Approved / Rejected

The reviewer/approver action must be attributable to a user.

Do NOT build a complicated generic workflow engine.

---

# 3. Supabase Storage

Create a private document bucket.

Requirements:

- Documents are NOT public.
- File access requires authenticated authorization.
- Use predictable storage paths that are scoped to the document/version.
- Enforce the application's file-size/type restrictions server-side.
- Do not expose raw storage credentials to the browser.

For MVP, accepted document types should be PDF-first.

If the frontend uploads directly to Supabase Storage, make sure storage policies prevent cross-user access.

---

# 4. Row Level Security

Enable RLS for all application tables containing user/document data.

Design policies based on roles and ownership.

Minimum behavior:

### Staff

Can:
- create documents
- view documents they are authorized to access
- upload new versions for their own documents
- submit their own documents for review
- view their own audit/workflow history

Cannot:
- approve their own document
- arbitrarily edit another user's document
- directly modify audit logs

### Reviewer

Can:
- view submitted/under-review documents they are authorized to review
- record review actions
- move workflow state according to the allowed transition

Cannot:
- bypass approval permissions

### Approver

Can:
- review
- approve
- reject

### Admin

Can:
- manage users/roles
- view/manage documents
- manage categories
- view audit history

Keep the MVP policy model understandable.

Do not create an enormous permission matrix.

---

# 5. Workflow transition integrity

Do not rely only on the frontend for workflow rules.

The backend/database layer must prevent invalid transitions such as:

- draft → approved
- approved → under_review
- rejected → approved without resubmission

Define the allowed transitions clearly.

For example:

- draft → submitted
- submitted → under_review
- under_review → approved
- under_review → rejected
- rejected → draft

A future iteration may add richer workflow configuration, but not now.

---

# 6. Authentication

Implement basic authentication using Supabase Auth.

Required:

- sign up
- sign in
- sign out
- session handling
- protected application routes
- authenticated API/database access

Do not build fancy account-management UI yet.

Ensure unauthorized users cannot access protected document data.

---

# 7. Initial document API/data-access foundation

Create clean server-side functions/API routes for:

- create document
- fetch document
- list documents
- create document version
- submit document
- get version history
- get workflow/audit history

Follow the API conventions in `docs/api.md`.

Use one consistent error format.

Validate input server-side.

Do not allow clients to directly set protected fields such as:

- owner_id for arbitrary users
- audit actor
- approval actor
- arbitrary workflow status
- version number

Those values must be derived/enforced by trusted server logic.

---

# 8. Seed/demo data

Create synthetic seed data for:

- one admin
- one staff user
- one reviewer
- one approver
- several categories
- a small number of synthetic documents
- sample workflow/audit records

Do not use real personal or institutional data.

Do not hard-code real credentials into committed source files.

If auth-user seeding requires manual setup, document the exact safe setup process.

---

# 9. Tests

Add meaningful automated tests for the foundation.

At minimum cover:

### Database/security

- unauthenticated access is denied
- users cannot access another user's private document data without permission
- staff cannot approve documents
- reviewer/approver permissions work
- audit logs cannot be modified arbitrarily
- storage objects are private

### Workflow

- valid transitions succeed
- invalid transitions fail
- approval cannot happen from draft
- rejected documents require resubmission before approval

### Versioning

- new version increments version number
- duplicate version number is rejected
- previous version remains intact

Do not aim for 100% coverage. Test the security boundaries and business rules.

---

# 10. Documentation synchronization

After implementation, update:

### `docs/context.md`

Reflect:

- finalized MVP foundation
- chosen stack
- roles
- workflow states
- storage strategy
- security model
- implementation status

### `docs/architecture.md`

Document the actual implemented architecture, not the original intention.

### `docs/database.md`

Document:

- tables
- columns
- constraints
- indexes
- RLS policies
- storage bucket
- storage policy behavior

### `docs/api.md`

Document the implemented endpoints/functions and validation/error behavior.

### `docs/decisions.md`

Add ADRs for the important finalized choices, especially:

- Supabase as core platform
- private storage
- role model
- simple fixed MVP workflow
- immutable document versions

### `docs/current-changes.md`

Add a new timestamped entry describing everything implemented in this task.

Mark each change as:

- Planned
- Implemented
- Tested
- Deployed

Only mark what is actually true.

---

# Hard constraints

1. Do NOT implement OCR yet.
2. Do NOT implement Gemini yet.
3. Do NOT implement Elasticsearch.
4. Do NOT add pgvector yet.
5. Do NOT build a complex workflow engine.
6. Do NOT create fake AI functionality.
7. Do NOT put secrets into source code.
8. Do NOT weaken RLS to make the frontend easier.
9. Do NOT silently rewrite the project architecture.
10. Do NOT claim a feature is implemented unless it actually works.

---

# Definition of Done

Task 01 is complete only when:

- the app has working authentication
- core database migrations apply successfully
- RLS policies are enabled and tested
- private document storage exists
- document + version + workflow + audit models work
- valid workflow transitions work
- invalid transitions are rejected
- seed/demo setup is documented
- foundation tests pass
- documentation matches the actual implementation
- the repository can be handed to the next agent/task without hidden assumptions

At the end, report:

1. Files created/changed
2. Dependencies added
3. Database migrations created
4. RLS/security rules implemented
5. Tests run and results
6. Known limitations
7. Anything blocked or requiring manual setup
8. Exact command(s) needed to run the project locally

Do not start Task 02 in this task.
