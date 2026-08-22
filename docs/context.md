# Project Context

> **Rule:** This is the single source of truth for what we are building and why. Update it whenever requirements, architecture, features, constraints, or product direction changes.

## Project Overview

| Field | Current Value |
| --- | --- |
| Project name | DocIntel (working name) |
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
| AI | Gemini, server-side only, from Phase 3 |
| OCR | Fallback only, for scanned/image documents |
| Current phase | **Phases 1–2 implemented.** Phase 3 (intelligence) is next. |

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

- **Staff experience** prioritizes productivity and document intelligence.
- **HOD / reviewer experience** prioritizes the review and approval queue.

> **Superseded decision:** an earlier plan made a separate Electron desktop application the hero interface. That is **cancelled**. No desktop code was written, so nothing was discarded. Its intelligent-organization and search capabilities now live inside the web app.

## AI positioning

AI is an **enhancement layer**, not the product. It extracts metadata, classifies documents, summarizes, answers questions grounded in retrieved chunks, and assists similarity. It never overwrites human-entered metadata, and every AI-derived value is labelled as such in the UI.

---

# Capabilities

## Implemented (Phases 1–2)

| Area | State |
| --- | --- |
| Authentication | Sign up, sign in, sign out, cookie sessions, protected routes |
| Roles | `staff`, `reviewer`, `approver`, `admin` — resolved server-side |
| Upload | Server-validated, into a private bucket, immutable per version |
| Document records | Title, description, owner, folder, status, tags, metadata, versions |
| Automatic organization | Deterministic keyword classifier over the taxonomy, with confidence and provenance |
| Folder browsing | Two-level department → category tree |
| Document detail | Metadata, preview, comments, versions, review history, audit trail |
| Workflow | Full state machine enforced in the database |
| Versioning | Server-assigned numbers, previous versions retained |
| Audit | Real rows written by database functions |
| Comments | First-class, attributable |
| Search | Title and description, plus status and folder filters |

## Not yet implemented

| Area | Phase |
| --- | --- |
| Text extraction from PDFs | 3 |
| OCR fallback for scanned documents | 3 |
| AI metadata extraction, entity and date extraction | 3 |
| AI summaries | 3 |
| Full-text search over extracted text | 4 |
| Similar-document discovery | 4 |
| Document Q&A with source citations | 5 |
| Cross-document questions | 5 |

Anything in this second table is **absent, not stubbed**. The UI states plainly that intelligence features are not enabled rather than showing placeholder output.

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

| Action | Staff | Reviewer | Approver / HOD | Admin |
| --- | --- | --- | --- | --- |
| Upload, view own documents | Yes | Yes | Yes | Yes |
| Search, browse folders | Yes | Yes | Yes | Yes |
| Edit own draft metadata | Yes | Yes | Yes | Yes |
| Submit own document | Yes | Yes | Yes | Yes |
| Comment | Yes | Yes | Yes | Yes |
| See others' documents in workflow | No | Yes | Yes | Yes |
| Start review | No | Yes | Yes | Yes |
| Request changes, reject | No | Yes | Yes | Yes |
| **Approve** | No | **No** | Yes | Yes |
| Manage users, roles, categories | No | No | No | Yes |

Two rules hold at every role:

- **Reviewers cannot see another user's drafts.** A document becomes visible to reviewers only once it leaves `draft`.
- **Separation of duties: nobody decides on their own document**, including admins. Enforced inside `transition_document`.

New accounts always start as `staff`. Role is never accepted from client-supplied signup metadata.

---

# Workflow

```text
draft ──submit──▶ submitted ──start review──▶ under_review
  ▲                   │                          ├──▶ approved
  │                   └──withdraw──▶ draft       ├──▶ rejected ──▶ draft
  │                                              └──▶ changes_requested
  └──────────────── resubmit ◀──────────────────────────────┘
```

Legal transitions, and nothing else:

| From | To | Who |
| --- | --- | --- |
| `draft` | `submitted` | Owner, admin |
| `submitted` | `under_review` | Reviewer, approver, admin |
| `submitted` | `draft` | Owner (withdraw before review starts) |
| `under_review` | `approved` | **Approver or admin only** |
| `under_review` | `rejected` | Reviewer, approver, admin |
| `under_review` | `changes_requested` | Reviewer, approver, admin |
| `changes_requested` | `submitted` | Owner (resubmit) |
| `rejected` | `draft` | Owner |

Uploading a new version onto an `approved` or `rejected` document returns it to `draft`, starting a new review cycle. The workflow always acts on the **same document record** — stages never duplicate a document.

## Enforcement

Three independent layers, so the UI is never the security boundary:

1. `transition_document` (`SECURITY DEFINER`) locks the row, validates the state pair, validates role, enforces separation of duties, then writes the review record and audit row atomically.
2. `guard_workflow_transition` trigger rejects an illegal state pair **even via direct SQL or a service-role connection**.
3. RLS blocks status changes through the ordinary update path entirely.

---

# Security Model

- Supabase Auth required for all data access; `getUser()` revalidates the token on every request rather than trusting the cookie.
- **RLS is the authorization boundary.** Hiding a button is not authorization.
- The browser receives only the anon key. **The service-role key and the Gemini key are server-side only** and never prefixed `NEXT_PUBLIC_`.
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
| `document_reviews` | Reviewer decisions, attributable |
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
| 3 — Intelligence | Extraction, OCR fallback, metadata, classification refinement, summaries | Next |
| 4 — Search | Full-text over extracted text, filters, similar documents | Pending |
| 5 — Q&A | Chunk retrieval, grounded answers with citations | Pending |
| 6 — Workflow polish | Queue refinement, notifications | Partly done (workflow itself is complete) |
| 7 — Polish | Loading/empty/error states, responsive, demo data | Pending |

---

# Current Status

**Implementation:** Phases 1 and 2 are code-complete in `frontend/` and `supabase/migrations/`.

**Verified:** `npx tsc --noEmit` passes with zero errors. `npx next build` passes, compiling 10 routes. The dev server boots.

**Not verified:** no code path that touches Supabase has been executed. Login, upload, storage, workflow transitions and audit writes are **unproven at runtime** because no Supabase project is connected.

**Blocker — required manual setup:**

- Docker, the Supabase CLI and `psql` are **not installed** on the development machine (Node 22.20.0, npm 11.19.0 and Python 3.13.7 are present).
- To run for real, either install Docker Desktop and run `npx supabase start`, or create a hosted Supabase free project.
- Then apply `supabase/migrations/0001_init.sql`, `0002_security.sql`, `0003_storage.sql` and `supabase/seed/seed.sql`, and populate `frontend/.env.local` from `frontend/.env.example`.

**Roles for the demo:** signup creates `staff` accounts only. To demonstrate the HOD experience, promote one account with
`update profiles set role = 'approver' where id = '<uuid>';`

**Tests:** none written yet. The security boundaries that most need coverage are RLS visibility, invalid workflow transitions, self-approval refusal, audit immutability and version-number uniqueness.
