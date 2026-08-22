# Project Context

> **Rule:** This is the single source of truth for what we are building and why. Update it whenever requirements, architecture, features, constraints, or product direction changes.

## Project Overview

| Field | Current Value |
| --- | --- |
| Project name | TBD |
| Problem Statement ID | FS-05 |
| Problem category | FULL-STACK DEVELOPMENT |
| Problem title | Document Management |
| Selected | Yes |
| Hackathon duration | 24 hours |
| Team size | 3 |
| Tooling budget | Free services/free tiers preferred; no paid dependency required for MVP |
| Product shape | **Two connected applications**: a web platform and a desktop application |
| Web platform | Next.js (App Router) / TypeScript / Tailwind |
| Desktop application | **Electron + TypeScript**, local index on SQLite + FTS5 |
| Backend/data | Supabase PostgreSQL + Auth + Storage + RLS |
| Identity | Supabase Auth is the single identity provider for **both** applications |
| Search | SQLite FTS5 (local, desktop) + PostgreSQL FTS (cloud). No Elasticsearch. No pgvector in MVP. |
| Similarity | Lexical (BM25/TF-IDF) in MVP; vector embeddings reserved as a stretch extension point |
| AI provider | Gemini API, server-side only; default model target `gemini-3.1-flash-lite` subject to quota/access checks |
| Deployment | Web: free static/SSR hosting (Vercel/Render); data/auth/storage: Supabase Free; desktop: local dev run for demo |
| Current phase | Direction revised. Documentation synchronized; implementation not started. |

## Official Problem Statement

> Develop a secure document-management platform for uploading, organizing, searching, reviewing and approving institutional documents. The system should support OCR-based text extraction, metadata and configurable document workflows.

## Key Functional Requirements From Organizer

- Upload and categorize documents with metadata.
- Extract searchable text from scanned documents using OCR.
- Provide full-text search and filtering.
- Support role-based review, approval, versioning and audit history.

---

# Product Direction

We are building:

> **An AI-Powered Document Workflow & Knowledge Organization Platform.**

The product consists of **two connected applications** that share one identity system and one metadata vocabulary.

## Primary Product Differentiator: Intelligent Metadata-Driven Search

**The success of the MVP depends more on search quality than on OCR quality.**

**Search is treated as the hero feature during architecture and implementation decisions.** When a design choice trades search quality against any other capability, search wins.

## AI Positioning

**AI is NOT the product. AI is an enhancement layer.**

AI is responsible for:

- Metadata extraction
- Categorization
- Similarity detection
- Search enhancement
- Summaries

AI outputs are suggestions, never authoritative source data, and never silently overwrite human-entered metadata.

---

# The Custody Model

The single most important architectural principle:

> **Files stay where they live. The platform owns only *derived* data — metadata, indexes, categories, similarity links and pointers.**

This gives one coherent platform with two custody modes.

| | Custodial mode | Non-custodial mode |
| --- | --- | --- |
| Where files live | Platform storage (Supabase private bucket) | User's own disk today; Google Drive / OneDrive / Dropbox later |
| Used by | Web platform | Desktop application |
| Platform stores | Files **and** derived data | **Derived data only** |
| Access governed by | Our RLS + workflow | **The source system's own permissions** |
| Migration required | Yes, by definition | **Never** |

Consequences designed in from the start:

1. **Identity is source-independent.** Local paths differ per machine and Drive has its own file IDs, so canonical document identity is a **SHA-256 content hash**, with per-source locator records attached to it.
2. **Staleness is a first-class subsystem.** Files move, get renamed and change outside the platform. Non-custodial mode requires change detection (mtime + size, hash confirm), a re-index path, and explicit `missing` / `unreachable` states.
3. **Source permissions are authoritative in non-custodial mode.** In future Drive mode, Drive's ACLs govern; the platform must never surface content the source would not.

---

# Application 1 — Web Platform

**Purpose:** institutional document workflow management. This is the part that satisfies FS-05.

**Custody:** custodial. Files are uploaded into platform storage.

**Target users:** universities, colleges, government departments, NGOs, companies.

## Capabilities

- Authentication
- Upload
- Metadata
- Categorization
- Approval workflow
- Rejection workflow
- Comments
- Versioning
- Audit logs
- Search

## Core workflow

```text
Draft -> Submitted -> Under Review -> Approved / Rejected
```

with the resubmission path:

```text
Rejected -> Draft
```

## Roles

`staff`, `reviewer`, `approver`, `admin`.

| Action | Staff | Reviewer | Approver | Admin |
| --- | --- | --- | --- | --- |
| Upload | Yes | Yes | Yes | Yes |
| Edit draft metadata | Own docs | Own docs | Own docs | Yes |
| Submit | Own docs | Own docs | Own docs | Yes |
| Comment | Yes | Yes | Yes | Yes |
| Move to Under Review | No | Yes | Yes | Yes |
| Approve | No | No | Yes | Yes |
| Reject | No | Yes | Yes | Yes |
| Manage users/roles | No | No | No | Yes |
| Manage categories | No | No | No | Yes |
| View audit logs | Own + own documents | Documents they can review | Documents they can approve | All |
| View another user's personal desktop catalog | No | No | No | **No** |

**Separation of duties:** a user may never approve or reject their own document, regardless of role.

---

# Application 2 — Desktop Application (Hero)

**Purpose:** intelligent document organization and search over files the user already has.

**Custody:** non-custodial. Indexed files never leave the machine unless the user explicitly enables cloud backup (future).

**Target users:** students, researchers, professionals, small teams.

**Status:** the desktop application is a **first-class product**, not a secondary feature. It is the primary demo.

## Capabilities

- User selects folders to index
- Metadata extraction
- Categorization
- Similar-document grouping
- Intelligent search
- **Automatic organization recommendations**

## Offline / Online model

| Offline | Online |
| --- | --- |
| Local indexing | Login (Supabase Auth) |
| Local search | Metadata synchronization |
| Local categorization | Category synchronization |
| Full core functionality | Search synchronization |
| | Cloud backup of files (**future, optional**) |

The desktop application must be fully usable with no network connection. Online features are additive.

## Automatic organization recommendations

Documents sharing **topic, category, keywords, author or department** are grouped automatically.

MVP approach is **deterministic facet grouping** — grouping on shared category / author / department / keyword overlap — because it is cheap and, critically, *explainable*: "these 12 documents share department = Finance and keyword = budget."

Future versions may support **suggested folder structures**.

> **Hard rule: recommendations are non-destructive.** The application never moves, renames, deletes or writes to a user's files. It recommends; the user acts.

---

# Search Specification (Hero Feature)

## Searchable dimensions

- File name
- Metadata
- Content
- Category
- Tags
- Author
- Date
- Folder scope

## Representative queries

- `Show scholarship documents`
- `Show approved policies`
- `Find AI-related files`
- `Find files similar to this document`

## Folder-scoped search

Folder scope is a **core feature**, not a filter afterthought. Users can:

- Search **all indexed folders**
- Search **only selected folders**

Example: search only `Research` and `Policies`; exclude `Downloads` and `Temporary Files`.

Scope operates at two distinct levels:

| Level | Meaning |
| --- | --- |
| **Index-time scope** | Which roots are indexed at all, plus global exclusions so junk never enters the index |
| **Query-time scope** | Within the indexed corpus, restrict to a subset or subtract folders |

Rules:

- **Exclude wins over include.** Required for the nested case: include `/Research`, exclude `/Research/Temp`.
- Folder paths are stored normalized and prefix-searchable so scope filters use an index rather than a scan.
- **Saved scopes ("Search Profiles")** are first-class, because users reuse "only Research + Policies" constantly.
- A **default exclusion list** ships with the app (Downloads, Temporary Files, AppData, caches, `node_modules`) so first-run indexing does not drown in junk.

## Ranking

Ranking is a specified artifact, not emergent behaviour:

- Field weights: **title > file name > keywords > body**
- Recency boost on document date / mtime
- Exact-phrase boost
- **Identical weights in both engines** (SQLite FTS5 and PostgreSQL FTS) so results feel consistent across applications

## Query understanding (AI enhancement)

Natural-language queries map onto structured facets:

| Query | Facets |
| --- | --- |
| "Show approved policies" | `workflow_status = approved`, `category = policy` |
| "Show scholarship documents" | keyword/topic = scholarship |
| "Find AI-related files" | keyword/topic = AI |

This is where AI genuinely earns its place: it improves the query, it is not the product. Query understanding must degrade gracefully to plain lexical search when AI is unavailable or offline.

## Search quality is measured

A committed **golden query set** (~20 queries with expected results) is a test artifact. This is the only way to avoid discovering at hour 20 that search "feels bad", and it directly serves the hero-feature claim.

## Similarity

- **MVP:** lexical similarity — BM25 / TF-IDF nearest-neighbour over the local FTS index.
- **Stretch:** vector embeddings. The schema reserves an extension point; no vector column or dependency is created in MVP.
- Excluded: pgvector in MVP, Elasticsearch entirely.

---

# Synchronization Model

- **Local files remain local by default.**
- When online, the following **may** sync: metadata, search indexes, categories.
- **Future:** users may optionally sync actual files to cloud storage.

## Design

| Concern | Decision |
| --- | --- |
| Identity across devices/sources | SHA-256 content hash |
| Direction in MVP | **One-way push, desktop → cloud** (see assumption below) |
| Index sync method | Sync **metadata + categories**; the cloud index is **re-derived** from them rather than shipping SQLite blobs |
| Conflict policy | Last-writer-wins per content hash, using per-row `updated_at` + `device_id` |
| Deletions | Tombstones, never hard deletes during sync |
| Consent | **Opt-in per indexed folder** |

> **Assumption flagged for confirmation:** MVP sync is one-way (desktop → cloud). Bidirectional sync is documented as a future step. Override this if you want two-way sync in MVP — it is the single largest schedule risk in the sync subsystem.

**Privacy note:** enabling metadata sync means **file names, folder paths and keywords leave the machine**. A file name alone can be sensitive. This is stated plainly in-product and is opt-in per folder.

---

# Cloud Strategy

Roadmap:

1. Managed cloud storage
2. Bring-your-own-storage

Future integrations: Google Drive, OneDrive, Dropbox.

## Future Google Drive mode

The user authenticates with Google. **Files remain inside Google Drive.** The platform:

- Reads metadata
- Creates indexes
- Organizes files
- Applies categorization
- Provides search

…**without requiring migration of files into platform storage.**

**For MVP: do NOT implement these integrations.** Only prepare architecture extension points — a storage/source provider interface with `local_fs` and `platform_storage` implemented, and `google_drive` / `onedrive` / `dropbox` defined but unimplemented.

---

# Updated MVP

## Web app

- Auth
- Upload
- Metadata
- Workflow
- Approval / Rejection
- Versioning
- Audit logs
- Search
- Comments
- Minimal OCR (non-hero, retained for FS-05 compliance)

## Desktop app

- Folder selection (include / exclude)
- Metadata extraction
- Categorization
- Similarity grouping (lexical)
- Intelligent search (faceted, folder-scoped)
- Automatic organization recommendations
- Offline operation

## AI

- Metadata extraction
- Categorization
- Search enhancement (query understanding)
- Summaries

## Not in MVP

- Elasticsearch
- Multi-cloud implementation
- Google Drive implementation
- Dropbox implementation
- OneDrive implementation
- Full-drive indexing
- Complex workflow builders
- Enterprise permissions matrix
- pgvector / vector embeddings
- Grounded document Q&A (**moved to stretch**)
- Configurable workflow editor
- Analytics beyond basic operational counts
- Enterprise SSO / SAML
- Multi-region deployment
- Knowledge-graph visualization

## Stretch (only after the critical path is stable)

- Vector-embedding similarity
- Grounded Q&A with citations
- Google Drive mode
- Bidirectional sync
- Optional file backup to cloud
- Suggested folder structures

---

# Core User Flows

## Flow A — Desktop: select folders → indexed knowledge (hero)

1. User launches the desktop app; no login required for local use.
2. User selects folders to index and reviews the default exclusion list.
3. App walks the selected roots, honouring excludes.
4. For each file: hash, read metadata, extract text where cheap, derive keywords.
5. Rows land in the local SQLite index; FTS5 is populated.
6. Categorization assigns a category; similar documents are grouped.
7. User sees an organized library with recommendations, entirely offline.

## Flow B — Desktop: intelligent search

1. User types a query, optionally in natural language.
2. Query understanding maps it to facets where possible; otherwise plain lexical.
3. User picks scope: all indexed folders, or only selected folders, with exclusions.
4. Local FTS5 ranks results using the specified field weights.
5. User opens a result, or asks for "files similar to this".

## Flow C — Web: upload → governed record

1. Staff signs in.
2. Uploads a PDF into private platform storage.
3. Adds category and metadata.
4. A `document` and immutable `document_version` are created.
5. Document starts in `draft`.

## Flow D — Web: review → approval

1. Staff submits a draft.
2. Reviewer moves it to Under Review.
3. Reviewer or approver reads metadata, comments and version history.
4. Approver approves or rejects; the owner can never approve their own document.
5. Every transition is validated server-side and written to the audit log.

## Flow E — Web: new version

1. Staff uploads a newer file against an existing document.
2. An immutable new `document_version` row is created with a server-assigned version number.
3. The current-version pointer moves only after the version row is committed.
4. Previous versions remain intact and readable.
5. An approved or rejected document returns to `draft`, starting a new review cycle.

## Flow F — Sync (online, opt-in)

1. User signs in on the desktop app.
2. Device registers itself.
3. For folders with sync enabled, metadata and categories are pushed to the cloud.
4. Cloud search index is re-derived from the synced metadata.
5. File bytes are **not** transmitted.

---

# Security Model

- Supabase Auth required for all cloud data access.
- **RLS is the primary authorization boundary.** Application code and UI are conveniences, never the enforcement point. UI hiding an action is not authorization.
- Private Storage bucket for custodial files; no public objects; reads via short-lived signed URLs.
- **The browser and the desktop binary never receive the service-role key or any AI API key.**
- A desktop application cannot hold a secret. All AI calls are **proxied through an authenticated server endpoint**; the alternative is a user-supplied key. No provider key is ever shipped in the desktop bundle.
- Desktop auth uses **PKCE**; refresh tokens live in the OS keychain (DPAPI / Keychain / libsecret), never a plaintext config file.
- Personal desktop catalogs are **strictly owner-scoped**. Institutional admins have no access to any user's personal index — an important privacy property, and a deliberate departure from "admin sees all".
- Workflow transitions are validated in the database, not only in the API.
- Audit logs are append-only and written only by trusted server-side functions, so the actor cannot be spoofed.
- Upload allowlist: PDF only for MVP. Maximum 25 MB at application level, below Supabase Free's 50 MB per-file limit.
- Reject malformed or password-protected PDFs with a user-facing error.
- Never execute or render active content from uploaded files.
- Local indexing requires **explicit per-folder consent**; the app never reads outside selected roots.
- Recommendations never mutate the user's filesystem.

---

# Operational Limits and Cost Guardrails

Platform facts verified against official documentation during planning:

- Supabase Free provides 500 MB database, 1 GB file storage, and a 50 MB maximum file-upload size.
- Supabase PostgreSQL supports built-in full-text search and pgvector (pgvector unused in MVP).
- Gemini API offers free-tier access to selected models, including `gemini-3.1-flash-lite` on its standard tier at time of planning.
- Render offers free web services supporting Python and Docker, but free services spin down after 15 minutes of inactivity, so any demo service must be warmed before judging.

Application guardrails:

- 25 MB per PDF; roughly ≤ 100 pages for demo files.
- AI requests only after successful extraction; batched where possible.
- Avoid duplicate processing for unchanged content (hash-keyed).
- Local indexing is incremental and resumable.
- Indexing must handle permission-denied files, locked files, very large folders and symlink loops without crashing.
- Show processing state and offer retry.

---

# Demo Data

Use synthetic documents only. No real personal or institutional data.

Recommended demo set:

1. University Academic Regulations / Student Handbook
2. Procurement Policy / Tender Guidelines
3. HR Leave & Attendance Policy
4. Scholarship Eligibility Guidelines
5. Internship / Placement Policy

Plus, for the desktop demo, a synthetic folder tree containing `Research/`, `Policies/`, `Downloads/` and `Temporary Files/` so folder scoping and exclusions are demonstrable.

---

# Success Criteria

The MVP is complete when a judge can:

1. Launch the desktop app and select folders to index.
2. See files indexed, categorized and grouped — with no network connection.
3. Search by content, metadata, category, tag, author and date.
4. Restrict a search to only selected folders, and exclude others.
5. Ask for documents similar to a selected document and get sensible results.
6. See automatic organization recommendations with a stated reason.
7. Sign in, and see metadata sync to the cloud without file bytes leaving the machine.
8. In the web app, upload a document, categorize it and submit it for review.
9. Move it through Under Review to Approved or Rejected as the appropriate role.
10. Be refused when attempting an invalid transition or approving their own document.
11. Open version history and see previous versions intact.
12. Open the audit trail and see who changed what and when.

# Critical Acceptance Criteria

- Search returns correct results for the committed golden query set.
- Folder-scope include/exclude behaves correctly, with exclude winning over include.
- Desktop search and indexing work fully offline.
- A user's indexed files are never transmitted while cloud backup is off.
- Recommendations never modify the user's filesystem.
- Unauthorized users cannot access another user's documents or personal catalog.
- Search results are limited to what the current user is allowed to see.
- Invalid workflow transitions are rejected by the database, not just the UI.
- A user cannot approve or reject their own document.
- An approved document cannot be silently modified without creating a new version.
- Every workflow mutation creates an audit event, and audit rows cannot be edited or deleted.
- Renaming or moving an indexed file is detected without creating a duplicate entry.
- A scanned PDF in the web app produces searchable text via the minimal OCR path.

---

# Open Questions / Non-Blocking Decisions

- Product name can be selected once the first working flow exists.
- Final deployment hostname is a deployment detail.
- Sync direction in MVP is assumed one-way; confirm or override.
- Vector-embedding similarity can be added later without changing core identity or schema shape.
- Desktop code signing is out of scope; the demo runs from a dev build.

---

# Current Status

**Phase:** direction revised; documentation synchronized.

**Implementation:** **Not started.** No application code, migrations, or database objects exist.

**Architecture:** revised for the two-application custody model and finalized.

**Database:** designed at logical level in `database.md`; SQL implementation not started.

**API:** contract specified in `api.md`; not implemented.

**Web app:** not started.

**Desktop app:** not started.

**AI layer:** not started, and intentionally last.

**Deployment:** target selected; not configured.

**Local tooling gap:** Docker, the Supabase CLI and `psql` are **not installed** on the current development machine. Node 22.20.0, npm 11.19.0 and Python 3.13.7 are present. Migrations cannot be applied and database tests cannot be executed until Docker + the Supabase CLI are installed, or a hosted Supabase project is provided.

## Recommended Implementation Order

| Phase | Scope |
| --- | --- |
| **0 — Shared foundation** | Supabase project, cloud schema, RLS, Auth, private bucket, shared category/tag vocabulary, error envelope, seed data |
| **1 — Desktop core (hero)** | Electron shell, folder selection with include/exclude, SQLite + FTS5 index, extraction, faceted folder-scoped search, ranking. Fully offline. |
| **2 — Web governance spine (FS-05)** | Upload, metadata, categorization, workflow transitions, comments, versioning, audit, cloud search |
| **3 — Search quality + organization** | Ranking tuned against the golden query set, lexical similarity, facet grouping recommendations, saved search profiles |
| **4 — Identity + sync** | Desktop PKCE login, keychain token storage, device registry, opt-in metadata/category push, cloud search over synced catalog |
| **5 — AI enhancement layer** | Metadata extraction, categorization, query understanding, summaries — all server-proxied |
| **6 — Minimal OCR + polish + deploy** | FS-05 OCR path, empty/error/loading states, deployment, demo hardening |

Phase 2 is deliberately placed before search polish so the FS-05 rubric answer exists early, even though the desktop app is the hero demo.
