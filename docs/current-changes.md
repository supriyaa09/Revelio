# Current Changes

> **Rule:** Update this document after every meaningful project change, decision, addition, removal, architecture change, feature change, bug fix, or scope change.

## Current Project Status

- Last updated: 2026-08-22 13:30 IST
- Current phase: **Implementation started** — Phase 1 (foundation) and Phase 2 (core documents)
- Overall status: Web app builds and typechecks; runtime blocked on Supabase credentials
- Selected problem: FS-05 Document Management
- Product shape: **ONE web application** (intelligent workspace + institutional governance)
- Desktop application: **cancelled** — see the entry below
- Deployment status: Not deployed
- Blocker: no Supabase project connected. Docker, Supabase CLI and `psql` are not installed locally.

---

## Change Log

### 2026-08-22 13:30 IST — Direction change to one web app; foundation implemented

#### Change

**Product direction**

- Removed: the separate Electron desktop application, in full. No desktop code was ever written, so nothing was discarded.
- Added: a single web application containing both the intelligent document workspace and institutional governance.
- Restored to MVP: OCR fallback, AI summaries, document Q&A, and similar-document discovery — all previously cut or deferred, now in scope inside the one web app.
- Added: `changes_requested` as a first-class workflow state, giving `under_review → changes_requested → submitted`.
- Added: automatic folder organization over a controlled two-level taxonomy (department → category), replacing free-form folders.

**Implemented — database (`supabase/migrations/`)**

- `0001_init.sql`: 6 enums; `profiles`, `departments`, `categories`, `documents`, `document_versions`, `document_insights`, `document_chunks`, `document_comments`, `document_reviews`, `audit_logs`, `document_search`; 20 indexes; `updated_at` triggers; `handle_new_user` trigger creating a profile on signup; weighted `tsvector` maintenance; version-immutability trigger; audit append-only triggers blocking `UPDATE`/`DELETE` at every privilege level.
- `0002_security.sql`: RLS enabled on all 11 tables with 24 policies; `SECURITY DEFINER` role helpers (`current_app_role`, `is_admin`, `can_review`, `can_approve`, `document_is_visible`); `is_valid_transition` as the single source of truth for legal transitions; `guard_workflow_transition` trigger rejecting illegal state pairs even via direct SQL; `transition_document`, `create_document_version` and `log_audit_event` RPCs.
- `0003_storage.sql`: private `documents` bucket (25 MB cap, PDF/PNG/JPEG allowlist) with object policies joining the leading path segment back to document visibility. No client `UPDATE`/`DELETE`, so stored files are immutable per version.
- `seed/seed.sql`: 5 departments, 15 categories, each with classifier keywords. Idempotent.

**Implemented — web application (`frontend/`)**

- Next.js 15.5 App Router, React 19, TypeScript strict, Tailwind v4.
- Auth: cookie-based sessions via `@supabase/ssr`; login, signup, signout; middleware that revalidates the token with `getUser()` on every request and gates protected routes.
- Role foundations: `staff` / `reviewer` / `approver` / `admin`, resolved server-side; role-driven navigation and a role-gated review queue.
- Upload pipeline: server-side validation → private storage upload under the document's own prefix → `create_document_version` RPC (server-assigned version number) → audit event. Rolls back the draft row and the stored object if any step fails.
- Automatic organization: deterministic keyword classifier scoring category keywords against title and filename, storing `category_source` and `category_confidence` so the UI can show why a document was filed where it was.
- Screens: workspace with folder tree, upload, search with filters, document detail (metadata, preview, comments, versions, review history, audit trail), review queue, not-found.
- Workflow UI: only offers transitions the user could plausibly perform; every rule is re-checked in the database.

#### Reason

The two-application split doubled the surface area against a fixed 24-hour budget and separated the intelligence features from the governance features that make them valuable institutionally. One web app keeps a single identity model, a single data model and a single demo narrative.

#### Impact

- Phases 1 and 2 of the implementation plan are code-complete.
- Phase 3 (extraction, OCR, metadata, summaries) is the next slice. `document_versions.processing_status`, `document_insights` and `document_chunks` already exist to receive it.
- Search currently covers title and description only. `document_search` and its weighted `tsvector` are in place, so full-text search over extracted text is a query change, not a schema change.

#### Verification status

| Item | Status |
| --- | --- |
| `npx tsc --noEmit` | **Passes**, zero errors |
| `npx next build` | **Passes**, 10 routes compiled |
| Dev server boots | **Yes** |
| Login / upload / storage / workflow at runtime | **NOT VERIFIED** — no Supabase project connected |
| Migrations applied | **NO** — Docker and Supabase CLI are not installed |
| Automated tests | **None written yet** |

Nothing above is claimed to work end-to-end. The code paths call real Supabase APIs with no mocks and no placeholder data, but they have not been executed against a live database.

#### Status

- [x] Planned
- [x] Implemented — Phases 1 and 2
- [ ] Tested — blocked on a Supabase project
- [ ] Deployed


### 2026-08-22 12:00 IST — Product direction revised: two-application platform, search as hero feature

#### Change

Documentation-only synchronization across nine files. **No code, migrations or database objects were created.**

**Added**

- **Two-application product shape.** Web platform (institutional workflow, satisfies FS-05) plus a **desktop application** (intelligent organization and search) as a first-class product and the primary demo.
- **The custody model** as the core architectural principle: files stay where they live; the platform owns only derived data. Custodial mode (web, platform storage) vs non-custodial mode (desktop, files on disk; cloud drives later).
- **Primary Product Differentiator: Intelligent Metadata-Driven Search.** Recorded verbatim, with the binding statement that MVP success depends more on search quality than OCR quality, and that search wins design trade-offs.
- **Folder-scoped search** as a core feature: index-time vs query-time scope, include/exclude lists, **exclude wins over include**, saved search profiles, shipped default exclusion list, normalized prefix-searchable paths.
- **Ranking as a specified artifact**: title > file name > keywords > body, plus recency and exact-phrase boosts, identical across both engines.
- **Golden query set** (~20 queries with expected results) as a committed test artifact so search quality is measured, not asserted.
- **Automatic organization recommendations** via deterministic, explainable facet grouping — with the hard rule that recommendations are **non-destructive**.
- **Synchronization model**: local files local by default; metadata/categories/indexes may sync; cloud index re-derived from synced metadata rather than shipping SQLite blobs; opt-in per folder; tombstones; last-writer-wins by content hash.
- **Personal catalog domain** in the schema: `indexed_files`, `file_locators`, `devices`, `indexed_folders`, `search_profiles`, `similarity_links`.
- **`document_comments`** table — comments are now a first-class capability.
- **SHA-256 content hash** as source-independent document identity, plus a staleness/re-index subsystem (`present` / `missing` / `unreachable`).
- **Storage/source provider extension point**: `local_fs` and `platform_storage` implemented; `google_drive`, `onedrive`, `dropbox` defined but unimplemented.
- **Future Google Drive mode** documented: authenticate with Google, files remain in Drive, read metadata and index in place with no migration; Drive ACLs remain authoritative.
- Local schema specification for SQLite + FTS5.
- ADR-008 through ADR-020 covering the new decisions.
- Nine new/expanded API endpoints: signed upload URLs, comments, sync push, device registration, query interpretation, similarity.

**Modified**

- Desktop framework decided: **Electron + TypeScript** (over Tauri and Python/Qt).
- Demo spine decided: **desktop app is the hero**; web platform narrowed to FS-05 requirements.
- Similarity decided: **lexical now, embeddings as a reserved stretch extension point** via a `method` discriminator.
- Search became **dual-engine** — SQLite FTS5 (local, offline) plus PostgreSQL FTS (cloud) with shared field weights.
- Implementation order rewritten into seven phases, with the web governance spine at Phase 2 so the FS-05 answer exists early despite desktop being the hero.
- Security model extended: no secrets in any client bundle, desktop PKCE + OS keychain, AI calls server-proxied only.
- Success criteria and critical acceptance criteria rewritten around search, folder scope, offline operation and privacy.
- Root `README.md` de-staled — it previously claimed no product had been chosen, contradicting every other document.
- Removed corrupted citation artifacts from `context.md`.

**Removed / Deferred / Rejected**

- **Grounded document Q&A** — moved to stretch (ADR-017). It was the strongest demo moment; the trade is deliberate.
- **`workflows` table** (states/transitions as data) — superseded by a fixed database-enforced state machine (ADR-012), since complex workflow builders are out of scope.
- **Python/FastAPI processing service** — superseded (ADR-002/ADR-010). Its justification was OCR/PyMuPDF; extraction now runs locally in the desktop app and server-side in Route Handlers.
- **OCR demoted** from hero/critical-path to a minimal web-app capability retained only for FS-05 compliance (ADR-004), scheduled last.
- `document_chunks`, per-chunk `search_vector`, `embedding` columns — deferred with Q&A and pgvector.
- `document_deadlines` — dropped as over-modeling; deadline extraction is not in the revised MVP.
- Cloud-drive connector implementations, full-drive indexing, bidirectional sync, file backup — future only.

#### Reason

The product direction changed after the original planning documents were written. Search/discovery replaced OCR as the differentiator, the desktop application was promoted to a first-class product, and the index-in-place custody model became the organizing architectural principle. The existing documentation described a single always-online web app with OCR and Q&A on the critical path, which no longer matched the intended product.

#### Impact

- `context.md` is again the accurate source of truth.
- Implementation can begin from Phase 0 without re-deriving decisions.
- **Zero implementation rework was incurred** — no code existed when the direction changed, making this the cheapest possible moment for the pivot.
- Scope roughly doubled (second application, second data store, second search engine, sync subsystem) against an unchanged 24-hour runway. This is the dominant project risk.

#### Open assumption requiring confirmation

MVP sync is documented as **one-way push (desktop → cloud)**. Bidirectional sync is recorded as future. Override if two-way sync is required in MVP — it is the largest schedule risk in the sync subsystem.

#### Status

- [x] Planned
- [x] Implemented — *documentation only; no application code exists*
- [ ] Tested
- [ ] Deployed


### 2026-08-22 11:15 IST — Task 01 implementation handoff finalized

#### Change

- Added: implementation-ready coding-agent handoff for the secure application foundation.
- Added: explicit database, storage, RLS, authentication, workflow, versioning, audit, seed-data and testing requirements.
- Added: hard scope boundary preventing OCR, Gemini, Elasticsearch, pgvector and complex workflow-engine work from entering Task 01.
- Modified: project context now records the Task 01 implementation plan.

#### Reason

The project has moved from architecture planning into controlled implementation. The first task must establish trustworthy security and data foundations before AI/OCR/search features are layered on top.

#### Impact

- Coding agent should execute `coding-agent-task-01.md`.
- Subsequent tasks depend on the resulting schema, APIs and security model.
- Documentation must be synchronized with actual implementation results before Task 02 begins.

#### Status

- [x] Planned
- [ ] Implemented
- [ ] Tested
- [ ] Deployed


### 2026-08-22 10:55 IST — Selected FS-05 and established product direction

#### Added
- Selected problem statement **FS-05 Document Management**.
- Recorded the organizer requirements: secure upload, organization, search, review/approval, OCR text extraction, metadata, configurable workflows, role-based access, versioning and audit history.
- Established the working product direction as an **AI-powered document intelligence / knowledge platform**, rather than a basic document CRUD application.
- Added the initial MVP feature set and prioritization.
- Added a normal-PDF text extraction path and OCR fallback path.
- Added AI use cases: summarization, metadata/entity extraction, Q&A, deadline extraction and cross-document intelligence.
- Added demo strategy focused on visible intelligence and workflow value.
- Added security principles for institutional documents.

#### Modified
- Project context moved from generic pre-hackathon scaffold to an actual selected problem and product plan.
- Supabase moved from a generic likely candidate to the current preferred backend/data platform, while remaining non-mandatory.
- Gemini moved from a generic AI placeholder to a preferred candidate pending verification of free-tier quotas and model availability.
- Search strategy changed from assuming Elasticsearch to an evaluation approach: PostgreSQL full-text search first, pgvector if useful, Elasticsearch only if justified by the 24-hour constraint.
- Frontend planning assumes the separate coding agent can handle a complex polished implementation, so frontend scope is not artificially constrained by simplicity.

#### Removed / Rejected
- Basic "Google Drive clone" positioning.
- Basic "PDF manager" positioning.
- Treating OCR as the only document-ingestion path.
- Blindly sending entire large PDFs to an LLM for every question.
- Premature commitment to Elasticsearch.
- Premature commitment to a separate backend service.
- Unnecessary enterprise-grade features in the 24-hour MVP.

#### Reason
The selected problem has strong demo potential if implemented as document intelligence rather than ordinary CRUD. We need a product that is working, technically credible, visually polished and compelling enough to stand out among likely generic solutions.

#### Impact
- `context.md` must now be treated as the current product source of truth.
- Architecture, database and API designs still need to be derived from the finalized MVP.
- Coding agent should not begin substantial implementation until the planning documents and acceptance criteria are finalized.

#### Status
- [x] Planned
- [ ] Implemented
- [ ] Tested
- [ ] Deployed

---

### 2026-08-22 — Pre-hackathon workspace initialized

#### Added
- Reusable `hackathon-project/` documentation scaffold.
- `context.md`, `current-changes.md`, `decisions.md`, `architecture.md`, `database.md`, `api.md`, `testing.md`, `pitch.md`.
- Placeholder directories for frontend, backend, Supabase migrations/seed and tests.
- `.env.example`, `.gitignore`, `README.md`, `TODO.md`.

#### Reason
Prepare a documentation-first workspace so planning time is not lost after the problem statement is announced.

#### Impact
No application functionality or project-specific stack was locked in at this stage.

#### Status
- [x] Planned
- [x] Implemented
- [ ] Tested
- [ ] Deployed

## 2026-08-22 11:10 IST — Architecture and MVP scope finalized

### Added
- Finalized product positioning as an AI-powered institutional document intelligence platform.
- Defined three primary personas: Staff/Uploader, Reviewer/Approver, Administrator.
- Split MVP into Critical Path, Stretch Path and Explicitly Out of Scope.
- Defined four core user flows: Upload -> Intelligence, Search -> Understand, Review -> Approval, New Version.
- Defined default workflow states: Draft -> Submitted -> Under Review -> Approved, with Rejected -> Draft.
- Defined MVP role/action policy.
- Finalized architecture: Next.js frontend + Supabase Auth/Storage/Postgres/RLS + Python/FastAPI processing service + Gemini.
- Finalized PDF extraction strategy: PyMuPDF first, Tesseract OCR fallback.
- Finalized MVP search strategy: PostgreSQL full-text search; pgvector only after critical path is stable; Elasticsearch rejected for MVP.
- Defined grounded Q&A retrieval flow using stored document chunks.
- Defined initial database model and API/security direction.
- Added current free-tier constraints and deployment caveats.
- Added synthetic demo dataset recommendations.
- Added concrete MVP success criteria and acceptance criteria.

### Modified
- Backend direction changed from "Supabase preferred candidate" to a concrete hybrid architecture where Supabase owns core application state and a small FastAPI service handles document processing/AI orchestration.
- AI direction changed from a generic Gemini preference to `gemini-3.1-flash-lite` as the current default target, subject to account-level access/quota verification.
- OCR direction changed from "Tesseract or vision model to evaluate" to Tesseract as the critical-path fallback, with vision OCR retained as a stretch fallback.
- Search direction changed from open evaluation to PostgreSQL FTS as the committed MVP baseline.
- Workflow direction changed from illustrative states to an explicit MVP state machine and role policy.

### Rejected / Deferred
- Elasticsearch in the 24-hour MVP.
- Full workflow-builder UI.
- Multi-organization enterprise tenancy.
- Knowledge graph visualization.
- Advanced analytics.
- Cross-document semantic Q&A before the critical path is stable.

### External Verification
- Supabase current Free plan limits and Storage constraints verified from official Supabase documentation.
- Supabase PostgreSQL FTS and pgvector capabilities verified from official Supabase documentation.
- Current Gemini free-tier model/pricing availability verified from official Google AI documentation.
- Render free web-service/Docker support and spin-down behavior verified from official Render documentation.

### Status
- [x] Planned
- [ ] Implemented
- [ ] Tested
- [ ] Deployed
