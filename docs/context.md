# Project Context

> **Rule:** This is the single source of truth for what we are building and why. Update it whenever requirements, architecture, features, constraints, or product direction changes.

## Project Overview


| Field | Current Value |
| --- | --- |
| Project name | **Revelio** |
| Problem Statement ID | FS-05 |
| Problem category | FULL-STACK DEVELOPMENT |
| Problem title | Document Management |
| Hackathon duration | 24 hours |
| Team size | 3 |
| Product shape | **ONE web application** |
| Frontend | Next.js 15.5 (App Router) · React 19 · TypeScript (strict) · Tailwind v4 |
| Server layer | Next.js Server Actions + Route Handlers, executing as the signed-in user |
| Database | Supabase PostgreSQL |
| Auth | Supabase Auth (cookie sessions via `@supabase/ssr`) |
| Storage | Supabase Storage, private `documents` bucket |
| Authorization | PostgreSQL Row Level Security |
| Search | PostgreSQL full-text search (weighted `tsvector`) |
| AI | **Anthropic Claude**, server-side only, from Phase 3 |
| OCR | `tesseract.js` fallback, for scanned/image documents only |
| PDF text | `unpdf` (bundled pdfjs), per page |
| Current phase | **Phase 3 implemented** (extraction, OCR, AI, chunks). Phase 4 (search) is next. |

## Official Problem Statement

> Develop a secure document-management platform for uploading, organizing, searching, reviewing and approving institutional documents. The system should support OCR-based text extraction, metadata and configurable document workflows.

## Key Functional Requirements From Organizer

- Upload and categorize documents with metadata.
- Extract searchable text from scanned documents using OCR.
- Provide full-text search and filtering.
- Support role-based review, approval, versioning and audit history.

---

# Product Direction

We are building **an AI-powered institutional document intelligence and management platform**: one web application in which every uploaded document enters a centralized cloud workspace, is processed automatically, and becomes searchable, queryable and governable.

## One application, two experiences

There is **one codebase, one database, one identity model**. The interface adapts to role:

- **Student experience** prioritizes productivity and document intelligence.
- **HOD / faculty experience** prioritizes the review and approval queue.

> **Superseded decision:** an earlier plan made a separate Electron desktop application the hero interface. That is **cancelled**. No desktop code was written, so nothing was discarded. Its intelligent-organization and search capabilities now live inside the web app.

## AI positioning

AI is an **enhancement layer**, not the product. It extracts metadata, classifies documents, summarizes, answers questions grounded in retrieved chunks, and assists similarity. It never overwrites human-entered metadata, and every AI-derived value is labelled as such in the UI.

---

# Capabilities

## Implemented (Phases 1–3)

| Area | State |
| --- | --- |
| Authentication | Sign up, sign in, sign out, cookie sessions, protected routes |
| Roles | `student`, `faculty`, `hod` — resolved server-side |
| Upload | Server-validated, into a private bucket, immutable per version |
| Document records | Title, description, owner, folder, status, tags, metadata, versions |
| **PDF text extraction** | `unpdf`, per page, with page count and char count |
| **OCR fallback** | `tesseract.js` on rasterised pages; `text` / `ocr` / `mixed` recorded |
| **AI analysis** | Claude, JSON-only: summary, key points, entities, dates, deadlines |
| **Automatic organization** | Content-based classification with confidence and matched terms |
| **Retrieval chunks** | `document_chunks` with page ranges and per-chunk `tsvector` |
| **Processing UX** | Real stages polled from the database, with retry |
| Folder browsing | Two-level department → category tree |
| Document detail | Metadata, insights, preview, comments, versions, review history, audit |
| Workflow | Full state machine enforced in the database |
| Versioning | Server-assigned numbers, previous versions retained |
| Audit | Real rows written by database functions |
| Comments | First-class, attributable |
| Search | Title and description, plus status and folder filters |

## Not yet implemented

| Area | Phase |
| --- | --- |
| Full-text search over extracted text (chunks exist; search UI still title/description only) | 4 |
| Similar-document discovery | 4 |
| Document Q&A with source citations | 5 |
| Cross-document questions | 5 |

Anything in this second table is **absent, not stubbed**. The UI states plainly that intelligence features are not enabled rather than showing placeholder output.

---

# Document Processing Pipeline (Phase 3)

Runs in the Next.js Node runtime. **No Python service** — `PyMuPDF` was considered, but ADR-002 retired the FastAPI service and a second runtime and deploy target costs more than it buys in a 24-hour build. See ADR-029.

| Concern | Implementation |
| --- | --- |
| PDF text | `unpdf` (bundled pdfjs), extracted **per page** so chunks carry real page ranges |
| OCR | `tesseract.js`, English traineddata |
| Rasterisation | `unpdf.renderPageAsImage` with an injected `@napi-rs/canvas` |
| AI | Claude via `@anthropic-ai/sdk`, JSON-only with a structured-output schema |
| Trigger | `POST /api/documents/:id/process`, runs as the signed-in user |
| Persistence | `SECURITY DEFINER` RPCs in `0007_processing.sql` |

## Why definer RPCs rather than a service-role client

Clients have no `UPDATE` privilege or policy on `document_versions` — versions are immutable to clients by design — and this deployment has no service-role key. The RPCs run as the table owner but re-check authorization themselves (`can_process_version`: caller owns the document, or is the HOD), so processing results can be written without weakening the immutability rule for *file* columns.

## Extraction and OCR

```text
download → direct text layer per page
             │
             ├─ page has ≥ 100 chars  → keep it
             └─ page is thin/empty    → rasterise that page → OCR
                                         accept only if confidence ≥ 30
                                         and it beats the text layer
```

`extraction_method` records what actually happened: `text` (no OCR needed), `ocr` (no usable text layer anywhere), `mixed` (some pages from the text layer, some from OCR). **OCR is a fallback, never the default** — a PDF with a good text layer never loads the OCR or canvas modules at all. OCR is capped at 15 pages per document to bound worst-case time.

Uploaded images (PNG/JPEG) have no text layer by definition, so they go straight to OCR.

## AI analysis

Claude is called with `output_config.format` set to a `json_schema` (structured outputs, GA — no beta header), so the output is structured by construction rather than parsed out of prose. It extracts `document_type`, `department`, `category`, `tags`, `summary`, `key_points`, `entities`, `important_dates` (with a `is_deadline` flag) and `document_date`.

Model is `claude-opus-5`, overridable with `ANTHROPIC_MODEL`. Adaptive thinking is on with `effort: 'medium'`; `max_tokens` is 16,000 because thinking tokens are spent before the JSON is emitted. **No `temperature`** — sampling parameters are rejected on Opus 5.

Four anti-hallucination measures:

1. The model may only choose a **department/category slug from the actual seeded taxonomy**, enforced twice: the schema constrains the field to an `enum` of the real slugs plus `null`, so an invented slug cannot be emitted; and `pipeline.ts` still resolves the slug against the database, so the guarantee survives even if the enum is dropped.
2. **Every key is `required`**, with `null` as the explicit "unknown" value. An optional field could be omitted silently, which is indistinguishable from "the document said nothing".
3. The parsed response is re-validated and clamped in `coerce()` — dates must match `YYYY-MM-DD`, arrays are bounded, confidence is clamped to 0–1 and rejected if non-finite.
4. Every failure path returns `ok: false` with a machine-readable reason (`NO_API_KEY`, `NO_TEXT`, `API_ERROR`, `MALFORMED_OUTPUT`, `REFUSED`). **Nothing is displayed as AI output unless it was really generated and stored.**

`REFUSED` exists because a safety refusal (`stop_reason: 'refusal'`) is a real outcome, not a malformed one. `max_tokens` truncation is likewise named rather than surfacing as a JSON syntax error at some byte offset.

`ANTHROPIC_BASE_URL` is honoured silently by the SDK, which on a document platform would mean routing institutional text to a third party without anyone choosing it in code. `analyze.ts` logs a warning once per process when it is set. The override is respected; it is just never invisible.

## Automatic organization

The classifier now runs over **extracted content plus metadata**, not just title and filename. `system_metadata.classification.basis` moves from `title_and_filename` to `extracted_text`, and matched terms and confidence are recorded either way so the UI can always explain the filing.

Two rules: a category the **user** chose is never overwritten (`category_source = 'user'` wins in `apply_ai_metadata`), and a weak deterministic match (confidence < 0.35) is **not applied at all** rather than fabricating a folder.

## Processing states

`uploaded → extracting → analyzing → indexing → ready`, or `failed`. The stage lives in `document_versions.processing_stage`; `processing_status` remains the authoritative coarse state. The UI polls the real column — the progress display is not a timed animation.

## Failure guarantee

**A processing failure never destroys the uploaded document, its stored file, or any prior version.** Every failure path records a specific reason (`INVALID_PDF`, `PASSWORD_PROTECTED_PDF`, `OCR_FAILED`, `DOWNLOAD_FAILED`, `UNSUPPORTED_FILE_TYPE`, `NO_TEXT_EXTRACTED`), marks the version `failed`, and leaves it retryable. A document with no readable text is recorded as *completed with zero characters*, not as a failure — it is still stored, versioned and findable by title and metadata.

---

# Upload Pipeline

Target pipeline. Steps 1–4 and 8 are implemented; steps 5–7 arrive in Phase 3.

```text
1. User uploads a file
2. Server-side validation      (type allowlist, 25 MB cap)
3. Private cloud storage       ({document_id}/v{n}/{filename})
4. Document + version record   (version number assigned server-side)
5. Text extraction             → direct PDF text first
6. OCR fallback                → only when direct extraction yields too little
7. AI metadata, classification refinement, summary
8. Automatic organization      → department / category
9. Indexing                    → weighted tsvector + retrieval chunks
10. Available in the workspace
```

The user performs step 1 only. Everything else is the platform's job — that is the point of the product.

## Classification honesty

At upload the classifier sees only the **title and filename**, and the document records `system_metadata.classification.basis = 'title_and_filename'`. Once extraction runs, the same classifier re-runs with document text and the basis changes. The UI shows the matched terms and a confidence percentage, so a user can always see why a document was filed where it was, and override it.

---

# Automatic Folder Organization

A **controlled two-level taxonomy**, seeded rather than user-created, which avoids uncontrolled folder explosion while still giving a real institutional tree.

```text
Institution
├── Academic         → Notices · Reports · Policies
├── Administration   → Circulars · Requests · Forms
├── Finance          → Budgets · Invoices · Approvals
├── HR               → Recruitment · Leave · Policies
└── Procurement      → Quotations · Purchase Requests · Vendor Documents
```

Each category carries `match_keywords` that drive classification. Multi-word phrases score higher than single tokens, since they discriminate far better. A user-selected folder always overrides the classifier.

Adding a category is a seed change, not a schema change.

---

# User Roles

**Exactly three roles: `student`, `faculty`, `hod`.** The HOD inherits institutional management duties.

| Action | Student | Faculty | HOD |
| --- | --- | --- | --- |
| Upload documents | Yes | Yes | Yes |
| View / manage / search own documents | Yes | Yes | Yes |
| Browse folders | Yes | Yes | Yes |
| Submit own document | Yes | Yes | Yes |
| Upload new version when changes requested | Yes | Yes | Yes |
| Comment | Yes | Yes | Yes |
| See others' documents once they leave draft | No | Yes | Yes |
| Start faculty review | No | Yes | Yes |
| Approve at faculty tier | **No** | Yes | Yes |
| Reject / request changes at faculty tier | **No** | Yes | Yes |
| Route / escalate to HOD | **No** | Yes | Yes |
| Decide at HOD tier | **No** | **No** | Yes |
| Manage categories, departments, roles | No | No | Yes |

Three invariants hold at every role:

- **Students cannot reach the HOD directly.** Both routing transitions require the review tier, and students do not hold that capability — so this is structural, not a rule that can be forgotten.
- **Faculty and HOD users cannot see another user's drafts.** A document becomes visible to the review tier only once it leaves `draft`.
- **Nobody decides on their own document**, including the HOD. Enforced inside `transition_document`.

New accounts always start as `student`. Role is never accepted from client-supplied signup metadata.

---

# Workflow

Workflow is **document- and process-dependent**. Nothing forces a document through Student → Faculty → HOD. Faculty may approve directly when HOD involvement is not required, or escalate when it is.

```text
Student ─┐
Faculty ─┴─▶ draft ──submit──▶ submitted
                                  │
                    ┌─────────────┼──────────────┐
                    ▼             ▼              │
             faculty_review   hod_review    (withdraw)
                    │             │              │
     ┌──────────────┼────┐        │              ▼
     ▼              ▼    ▼        │            draft
  approved     rejected  changes_requested
                    │             │
                    │        ┌────┴─────┬──────────┐
                    │        ▼          ▼          ▼
                    │    approved   rejected  changes_requested
                    │                    │          │
                    └──▶ draft ◀─────────┘          │
                                                     │
                         submitted ◀─────resubmit────┘

  faculty_review ──route/escalate──▶ hod_review
```

## The 13 legal transitions

| From → To | Who |
| --- | --- |
| `draft` → `submitted` | Owner |
| `submitted` → `draft` | Owner (withdraw before pickup) |
| `submitted` → `faculty_review` | Faculty, HOD |
| `submitted` → `hod_review` | Faculty, HOD (direct escalation) |
| `faculty_review` → `approved` | Faculty, HOD — **not the owner** |
| `faculty_review` → `rejected` | Faculty, HOD — **not the owner** |
| `faculty_review` → `changes_requested` | Faculty, HOD — **not the owner** |
| `faculty_review` → `hod_review` | Faculty, HOD — **owner permitted** (routing) |
| `hod_review` → `approved` | **HOD only** — not the owner |
| `hod_review` → `rejected` | **HOD only** — not the owner |
| `hod_review` → `changes_requested` | **HOD only** — not the owner |
| `changes_requested` → `submitted` | Owner (resubmit) |
| `rejected` → `draft` | Owner |

Uploading a new version onto an `approved` or `rejected` document returns it to `draft`, starting a new cycle. The workflow always acts on the **same document record** — stages never duplicate a document.

## Why two review states, not one

A single generic review state cannot record *which tier* holds the document. Splitting into `faculty_review` and `hod_review` puts the tier into the state itself, so the `(from, to)` pair alone carries enough information to authorize the move.

## Routing is not a decision

Separation of duties applies to `approved`, `rejected` and `changes_requested` only. Routing to the HOD is a hand-off, so the owner **is** allowed to perform it. This matters practically: a faculty-created document cannot be reviewed by its own author, so without self-escalation a lone faculty member could never get their own document approved.

## Enforcement

Three independent layers, so the UI is never the security boundary:

1. `transition_document` (`SECURITY DEFINER`) locks the row, validates the state pair, validates role **for that specific tier**, enforces separation of duties, then writes the review record and audit row atomically.
2. `guard_workflow_transition` trigger rejects an illegal state pair **even via direct SQL or a service-role connection**.
3. RLS blocks status changes through the ordinary update path entirely.

---

# Security Model

- Supabase Auth required for all data access; `getUser()` revalidates the token on every request rather than trusting the cookie.
- **RLS is the authorization boundary.** Hiding a button is not authorization.
- The browser receives only the anon key. **The service-role key and the `ANTHROPIC_API_KEY` are server-side only** and never prefixed `NEXT_PUBLIC_`. `processing/analyze.ts` throws if it is ever imported into a client bundle, so this is enforced rather than trusted.
- Private storage bucket; no public URLs; reads use short-lived signed URLs (300 s).
- Upload limits enforced in **three layers**: bucket configuration, database `CHECK` constraints, and server-side validation. A client cannot weaken any of them.
- Uploaded versions are immutable — a trigger rejects changes to identity and file columns; storage has no client `UPDATE`/`DELETE` policy.
- Audit logs are append-only and written only inside `SECURITY DEFINER` functions, so the actor cannot be spoofed. `UPDATE`/`DELETE` are blocked by trigger at every privilege level.
- An unauthorized document returns 404, not 403 — existence is not leaked.
- Uploaded files are never executed or rendered as active content.

---

# Data Model

| Table | Purpose |
| --- | --- |
| `profiles` | Application identity and role, keyed to `auth.users` |
| `departments`, `categories` | Controlled taxonomy with classifier keywords |
| `documents` | The logical document: owner, folder, status, metadata, current version |
| `document_versions` | Immutable uploads; processing status and extracted text |
| `document_insights` | AI summary, key points, entities, important dates (Phase 3) |
| `document_chunks` | Retrieval units with per-chunk `tsvector` (Phase 4–5) |
| `document_comments` | Discussion, attributable |
| `document_reviews` | Review decisions, attributable |
| `audit_logs` | Append-only record of meaningful actions |
| `document_search` | Weighted `tsvector` over the document surface |

Human metadata (`user_metadata`), platform-derived metadata (`system_metadata`) and AI output (`document_insights`) are stored **separately** so they never silently overwrite one another.

---

# Success Criteria

A judge should be able to:

1. Sign up, sign in, and land in a workspace.
2. Upload a real PDF and see it stored privately.
3. See it filed automatically into a department/category, with the matched terms and confidence shown.
4. Browse the folder tree and open the document.
5. See extracted text, metadata and an AI summary. *(Phase 3)*
6. Search for a phrase inside the document body. *(Phase 4)*
7. See related documents. *(Phase 4)*
8. Ask a question and get an answer with a source reference. *(Phase 5)*
9. Submit for review, and be refused when approving their own document.
10. Sign in as an HOD, open the queue, request changes, then approve after resubmission.
11. Upload a new version and confirm the previous version is intact.
12. Open the audit trail and see real actions with actor and timestamp.

Criteria 1–4 and 9–12 are implemented today. 5–8 are the remaining phases.

---

# Implementation Phases

| Phase | Scope | Status |
| --- | --- | --- |
| 1 — Foundation | App, auth, Supabase, base schema, layout, roles | **Implemented** |
| 2 — Core documents | Upload, storage, records, taxonomy, list, detail | **Implemented** |
| 3 — Intelligence | Extraction, OCR fallback, metadata, classification refinement, summaries | **Implemented** |
| 4 — Search | Full-text over extracted text, filters, similar documents | Pending |
| 5 — Q&A | Chunk retrieval, grounded answers with citations | Pending |
| 6 — Workflow polish | Queue refinement, notifications | Partly done (workflow itself is complete) |
| 7 — Polish | Loading/empty/error states, responsive, demo data | Pending |

---

# Current Status

**Implementation:** Phases 1, 2 and 3 are code-complete in `frontend/` and `supabase/migrations/`.

**Verified:** `npm run typecheck` passes with zero errors. `npm run build` passes, compiling 11 routes. `npm run test:processing` passes 43/43. The dev server boots.

**Not verified:** the student upload path end to end, and the live Claude call. The Claude integration is proven up to the auth boundary — it builds the request, receives a real HTTP response, and maps the failure honestly — but `ANTHROPIC_API_KEY` in `.env.local` is rejected `401` by both `api.anthropic.com` ("API key is invalid.") and the `ANTHROPIC_BASE_URL` gateway currently set in the shell. See `npm run probe:ai`.

**Live environment:** a hosted Supabase project is connected via `frontend/.env.local`. Auth, profile provisioning and the authenticated student workspace all work against it. Migrations `0001`–`0007` are applied.

**Migration order:**

```text
0001_init.sql            schema, enums, triggers, indexes
0002_security.sql        RLS, role helpers, workflow state machine, RPCs
0003_storage.sql         private documents bucket + object policies
0004_profile_backfill.sql  orphaned-profile repair, ensure_profile()
0005_fix_search_trigger.sql  applied
0006_table_grants.sql        applied
0007_processing.sql          applied; Phase 3 processing RPCs
seed.sql                 taxonomy (departments + categories) — applied
```

**Authorization is two independent layers.** This distinction caused a whole debugging cycle, so it is recorded explicitly:

| Mechanism | Question it answers | Failure mode |
| --- | --- | --- |
| `GRANT` | May this role touch this table at all? | `42501 permission denied for table X` |
| RLS policy | Which rows, under what condition? | Empty result set, or `violates row-level security policy` |

PostgreSQL checks privileges **before** RLS, so a correct policy is unreachable without a grant. `0006_table_grants.sql` grants to `authenticated` and `service_role` only — **`anon` receives no privilege on any application table**, which is stricter than the Supabase default. Where RLS has no write policy (immutable versions, append-only audit, definer-written reviews) the privilege is withheld as well, so the layers reinforce each other. See ADR-027.

**Second known defect, fix written and pending:** `trg_refresh_document_search()` evaluated
`case when tg_table_name = 'documents' then new.id else new.document_id end` as a single expression. plpgsql binds every parameter of an expression before the `CASE` is evaluated, so `new.document_id` was resolved even on `documents`, raising `record "new" has no field "document_id"` (SQLSTATE 42703) on **every** `documents` insert and on any update of `current_version_id`. `0005` replaces the `CASE` with `IF/ELSE` and backfills `document_search`.

**Local tooling gap:** Docker, the Supabase CLI and `psql` are not installed (Node 22.20.0, npm 11.19.0, Python 3.13.7 are present). Migrations are applied through the Supabase SQL editor.

**Auth constraint affecting tests:** email confirmation is enabled on the project and the built-in SMTP is rate-limited (`over_email_send_rate_limit`), so throwaway signups cannot be created on demand. `SUPABASE_SERVICE_ROLE_KEY` is also absent from `.env.local`. Either disable email confirmation or add the key to run `frontend/scripts/diagnose-upload.mjs`.

**Error visibility:** unmapped database errors are no longer collapsed into a generic message. `mapDbError()` returns the real SQLSTATE and message; `logAndMap()` writes `message`/`details`/`hint` to the server log under a named step. Hiding the real error previously turned a one-line trigger bug into a blind hunt.

**Diagnostics:** `frontend/scripts/probe-schema.mjs` checks every table, RPC and the storage bucket using the anon key only. `frontend/scripts/probe-grants.mjs` discriminates a grant failure (`42501`) from RLS row-filtering and prints the raw SQLSTATE, message and hint. `frontend/scripts/diagnose-upload.mjs` replays all five upload steps as a real user. `frontend/scripts/probe-ai.mts` (`npm run probe:ai`) calls Claude for real against a synthetic institutional circular and asserts the structured contract field by field, reporting the key prefix and endpoint in use without printing the key.

**Build hygiene:** `next build` and `next dev` write incompatible artifacts into the same `.next`. Run `npm run clean` when switching modes, or the dev server throws `__webpack_modules__[moduleId] is not a function`.

**Roles for the demo:** signup creates `student` accounts only. To demonstrate the faculty and HOD experiences, promote accounts directly:
```sql
update profiles set role = 'faculty' where id = '<uuid>';
update profiles set role = 'hod'     where id = '<uuid>';
```

A three-account demo (one student, one faculty, one HOD) exercises every path, including escalation.

**Tests:** `npm run test:processing` runs 43 tests covering extraction, the OCR fallback decision, OCR, rasterisation, chunking, and the AI layer's response schema and `coerce()` coercion — no database and no network. Still uncovered: the security boundaries, which are RLS visibility, invalid workflow transitions, self-approval refusal, **faculty attempting to decide at `hod_review`**, **students attempting to escalate**, audit immutability and version-number uniqueness.
