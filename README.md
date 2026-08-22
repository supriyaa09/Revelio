# Revelio: Document Workflow & Knowledge Organization Platform

> **Status:** Direction finalized, documentation synchronized. **Implementation not started** — no application code, migrations or database objects exist yet.
>
> Problem statement **FS-05 — Document Management** (Full-Stack Development). 24-hour hackathon, team of 3.

## Overview

Two connected applications sharing one identity system and one metadata vocabulary.

| | **Web platform** | **Desktop application** (hero) |
| --- | --- | --- |
| Purpose | Institutional document workflow management | Intelligent document organization and search |
| Users | Universities, colleges, government departments, NGOs, companies | Students, researchers, professionals, small teams |
| Files | Uploaded into private platform storage | **Stay on the user's machine** |
| Satisfies FS-05 | Yes | No — it's the differentiator |

## Problem

Institutions need documents uploaded, categorized, searched, reviewed and approved with a complete audit trail. Individuals have the opposite problem: the documents already exist, scattered across folders, and are effectively unfindable.

## Solution

**Files stay where they live. The platform owns only the derived intelligence** — metadata, indexes, categories, similarity links and pointers.

That single principle gives two custody modes: *custodial* (web app, files in private cloud storage, governed by workflow and RLS) and *non-custodial* (desktop app, files indexed in place on disk — and, in future, in Google Drive with no migration).

## Primary Product Differentiator

**Intelligent Metadata-Driven Search.**

The success of the MVP depends more on search quality than on OCR quality. Search is treated as the hero feature during architecture and implementation decisions.

Searchable by file name, metadata, content, category, tags, author, date and **folder scope** — search all indexed folders, or only selected ones, with exclusions. Exclude wins over include.

## Features

**Web platform** — auth · upload · metadata · categorization · approval and rejection workflow · comments · versioning · audit logs · search · minimal OCR (FS-05 compliance)

**Desktop application** — folder selection with include/exclude · metadata extraction · categorization · similarity grouping · intelligent faceted search · automatic organization recommendations · **fully offline**

**AI (enhancement layer, not the product)** — metadata extraction · categorization · search enhancement · summaries

**Not in MVP** — Elasticsearch · pgvector · Google Drive / OneDrive / Dropbox implementations · full-drive indexing · complex workflow builders · enterprise permissions matrix · grounded Q&A (stretch)

## Tech Stack

| Layer | Choice |
| --- | --- |
| Web | Next.js (App Router) · TypeScript · Tailwind |
| Desktop | **Electron · TypeScript** |
| Local index | **SQLite + FTS5** |
| Cloud data | Supabase PostgreSQL |
| Auth | Supabase Auth — single provider for both apps |
| Storage | Supabase Storage, private bucket |
| Authorization | PostgreSQL Row Level Security |
| Cloud search | PostgreSQL full-text search |
| Similarity | Lexical (BM25/TF-IDF); embeddings reserved as a stretch extension point |
| AI | Anthropic Claude API, server-side only |

## Architecture

See [docs/architecture.md](docs/architecture.md). Key points:

- The foundation API is **Next.js Route Handlers under `/api`**, executing as the signed-in user so RLS applies to every query.
- **RLS is the primary authorization boundary.** UI hiding an action is not authorization.
- **No client ever holds a secret.** Neither the browser nor the desktop bundle receives the service-role key or an AI provider key; desktop auth uses PKCE with refresh tokens in the OS keychain.
- Workflow transitions are enforced in the database by a `SECURITY DEFINER` function plus a defence-in-depth trigger — invalid transitions fail even via direct SQL.
- Audit logs are append-only and written only by trusted functions, so the actor cannot be spoofed.
- Document identity is a **SHA-256 content hash**, so the same file converges across devices and sources.

## Setup

> Not yet implemented. This is the intended setup, recorded so the next step is unambiguous.

**Required but currently missing on the dev machine:** Docker, the Supabase CLI, and `psql`. Present: Node 22.20.0, npm 11.19.0, Python 3.13.7.

```bash
# 1. Environment
cp .env.example .env.local     # fill in locally; never commit

# 2. Local Supabase stack (requires Docker Desktop)
npx supabase start
npx supabase db reset          # applies migrations + seed

# 3. Web platform
cd frontend && npm install && npm run dev

# 4. Desktop application
cd desktop && npm install && npm run dev
```

## Environment Variables

See [.env.example](.env.example). Copy to `.env.local` and fill in real values locally. `.env` files are gitignored and must never be committed.

```bash
cp .env.example .env.local
```

**Hard rule:** only `NEXT_PUBLIC_`-prefixed variables may reach a browser. The service-role key and any AI provider key are server-side only, and **must never be bundled into the desktop application** — a shipped binary cannot keep a secret.

## Running Locally

Not yet implemented — see Setup above.

## Testing

Strategy in [docs/testing.md](docs/testing.md); automated tests in [tests/](tests/).

Test priority follows the product direction: **search quality first** (a committed golden query set of ~20 queries with expected results), then security boundaries, workflow rules and versioning.

Database, RLS and storage tests cannot be executed until Docker + the Supabase CLI are installed, or a hosted Supabase project is supplied.

## Deployment

- Web: free static/SSR host (Vercel or Render)
- Data/auth/storage: Supabase Free
- AI: Anthropic Claude (`claude-opus-5` by default)
- Desktop: **dev build for the demo.** Code signing is out of scope; unsigned installers trigger SmartScreen/Gatekeeper warnings, so judges should not be asked to install one.

## Team

TBD — 3 members.

---

## Repository Layout

```text
hackathon-project/
├── docs/                   Living project documentation
│   ├── context.md           What we are building and why (source of truth)
│   ├── current-changes.md   Change log — update on every meaningful change
│   ├── decisions.md         Architecture Decision Records
│   ├── architecture.md      System design
│   ├── database.md          Schema, relationships, RLS, storage, workflow
│   ├── api.md               Endpoints, validation, errors
│   ├── testing.md           Test strategy
│   └── pitch.md             Presentation and judge Q&A prep
├── frontend/               Web platform — Next.js (empty)
├── desktop/                Desktop application — Electron (not yet created)
├── backend/                Reserved; no separate service in MVP (see ADR-002)
├── supabase/
│   ├── migrations/          SQL migrations (empty)
│   └── seed/                Seed scripts (empty)
├── tests/                  Automated tests (empty)
├── .env.example            Variable names only, never values
├── .gitignore
├── README.md
└── TODO.md                 Task tracker
```

`frontend/`, `backend/`, `supabase/` and `tests/` are still empty placeholders. `desktop/` does not exist yet.

**Note:** `backend/` was reserved for a Python/FastAPI processing service. That service was superseded — see ADR-002 in [docs/decisions.md](docs/decisions.md). The directory is retained pending a decision to remove it.

---

## Implementation Order

| Phase | Scope |
| --- | --- |
| 0 | Supabase project, cloud schema, RLS, Auth, private bucket, shared vocabulary, seed |
| 1 | Desktop core: Electron shell, folder scope, SQLite+FTS5, extraction, faceted search, ranking (offline) |
| 2 | Web governance spine: upload, metadata, workflow, comments, versioning, audit, cloud search |
| 3 | Search quality: ranking against the golden query set, lexical similarity, facet grouping, saved profiles |
| 4 | Identity + sync: PKCE login, keychain storage, device registry, opt-in metadata push |
| 5 | AI enhancement: extraction, categorization, query understanding, summaries |
| 6 | Minimal OCR for FS-05, states/polish, deployment, demo hardening |

Phase 2 deliberately precedes search polish so the FS-05 rubric answer exists early, even though the desktop app is the hero demo.

---

## Operating Rules

1. **Search is the hero feature.** When a design choice trades search quality against another capability, search wins.
2. **AI is an enhancement layer, not the product.** Every AI feature must degrade gracefully when the provider is unavailable.
3. **Files stay where they live.** Never require migration into platform storage.
4. **Recommendations are non-destructive.** Never move, rename, delete or write to a user's files.
5. **Do not expose API keys or secrets.** No credentials in source, docs, commits, screenshots, or any client bundle.
6. **RLS is the authorization boundary.** Never weaken it to make the frontend easier.
7. **Do not choose technologies solely because they are popular.** Choose them based on requirements.
8. **Prefer free-tier services.**
9. **Do not over-engineer a 24-hour project**, and prioritize a working MVP over feature count.
10. **Before adding dependencies, verify they are necessary** and preferably free/open source.
11. **Every meaningful change must be reflected in [docs/current-changes.md](docs/current-changes.md)**, and product/architecture changes in [docs/context.md](docs/context.md).
12. **Important technical decisions are recorded in [docs/decisions.md](docs/decisions.md).**
13. **Do not remove existing functionality without documenting the reason.**
14. **Do not claim a feature is implemented unless it actually works.**

### Constraints

- Duration: 24 hours
- Team size: 3
- Problem statement: FS-05 Document Management
- Free-tier services only
