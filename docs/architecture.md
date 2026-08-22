# Architecture Specification

> Reflects the revised two-application product direction. Nothing in this document is implemented yet.

## Decision

Build **two connected applications** over one identity system and one metadata vocabulary:

1. **Web platform** — Next.js (App Router) / TypeScript / Tailwind. Institutional document workflow. Satisfies FS-05.
2. **Desktop application** — Electron + TypeScript, local index on SQLite + FTS5. Intelligent document organization and search. **Primary demo.**
3. **Supabase** — Auth + PostgreSQL + Storage + RLS. Single identity provider for both apps.
4. **Anthropic Claude API** — server-side only, as an enhancement layer.

Do **not** deploy Elasticsearch. Do **not** enable pgvector in MVP.

## Guiding principle: the custody model

> **Files stay where they live. The platform owns only derived data.**

| | Custodial | Non-custodial |
| --- | --- | --- |
| Files | Supabase private bucket | User's disk; Drive/OneDrive/Dropbox later |
| Consumer | Web platform | Desktop application |
| Platform holds | Files + derived data | **Derived data only** |
| Access governed by | Our RLS + workflow | **Source system permissions** |

The web app is the *custodial mode* of the same catalog — not a separate product.

## Primary Product Differentiator: Intelligent Metadata-Driven Search

**The success of the MVP depends more on search quality than on OCR quality. Search is treated as the hero feature during architecture and implementation decisions.**

Architectural consequences:

- Metadata extraction and normalization receive the engineering time OCR would have consumed.
- Ranking is a **specified artifact** with fixed field weights, not emergent behaviour.
- The same field weights are applied in **both** search engines so results feel consistent across apps.
- A **golden query set** is a committed test artifact; search quality is measured, not asserted.
- Query understanding (natural language → facets) is an AI enhancement that **must degrade gracefully** to plain lexical search offline.

## Logical architecture

```text
              ┌──────────────────────────────┐
              │   Desktop App (Electron+TS)  │   ← HERO
              │  ┌────────────────────────┐  │
              │  │ SQLite + FTS5 (local)  │  │
              │  │ index · metadata ·     │  │
              │  │ categories · similarity│  │
              │  └────────────────────────┘  │
              │  local extraction + hashing  │
              │  folder scope (include/excl) │
              └───────┬──────────────┬───────┘
       reads in place │              │ opt-in metadata sync
                      v              │ (no file bytes)
        ┌─────────────────────┐      │
        │  User's filesystem  │      │
        │  (files never move) │      │
        └─────────────────────┘      │
                                     v
┌──────────────────┐        ┌──────────────────────────┐
│  Web (Next.js)   │───────▶│        Supabase          │
│  upload·workflow │  RLS   │  Auth · Postgres · RLS   │
│  comments·audit  │        │  Storage (private)       │
└──────────────────┘        └────────────┬─────────────┘
                                         │ server-side only
                                         v
                              ┌────────────────────┐
                              │  Claude API        │
                              │ (enhancement only) │
                              └────────────────────┘

Future, unimplemented extension point:
  Google Drive / OneDrive / Dropbox ──▶ source provider interface
  (authenticate, read metadata, index in place, never migrate)
```

## Responsibilities

### Desktop application (Electron + TypeScript)

- Folder selection: index-time include roots and exclude rules
- Filesystem walk with permission-denied, locked-file, large-folder and symlink-loop tolerance
- SHA-256 content hashing for source-independent identity
- Local metadata + text extraction (Node-side PDF text extraction)
- Local categorization and keyword derivation
- SQLite + FTS5 index population and incremental re-index
- Faceted, folder-scoped search with the specified ranking
- Lexical similarity and facet-based organization recommendations
- Fully offline operation
- Optional: PKCE sign-in, device registration, opt-in metadata push

### Web platform (Next.js)

- Auth UI and session handling
- Upload into private storage via server-issued signed upload URLs
- Metadata and categorization
- Workflow actions and role-aware UI
- Comments
- Version history
- Audit timeline
- Cloud search over custodial documents and synced catalog

### Foundation API (Next.js Route Handlers, `/api`)

Runs server-side **as the signed-in user**, so RLS applies to every query. Owns:

- Document CRUD, version records, transitions, comments, audit reads
- Signed upload URL issuance with server-computed storage paths
- Sync endpoints for the desktop app
- AI proxy endpoints (the only place a provider key exists)

### Supabase

- Authentication for both applications
- Relational application data
- **RLS as the primary authorization boundary**
- Private PDF storage
- Workflow transition enforcement via `SECURITY DEFINER` functions and constraints

### AI enhancement layer (Claude, server-side)

- Metadata extraction
- Categorization
- Similarity assistance
- Search enhancement / query understanding
- Summaries

Never authoritative. Never overwrites human metadata. Never invoked from the desktop binary directly.

## Search architecture

Two engines, one specification.

| | Local (desktop) | Cloud (web) |
| --- | --- | --- |
| Engine | SQLite FTS5 | PostgreSQL FTS |
| Corpus | Files in selected folders | Custodial documents + synced catalog |
| Scope | Include/exclude folder paths | Authorization-filtered, plus folder scope on synced rows |
| Ranking | `bm25()` with fixed field weights | `ts_rank_cd` with equivalent weights |
| Similarity | Lexical nearest-neighbour | Deferred |
| Offline | Yes | No |

Fixed field weights, both engines: **title > file name > keywords > body**, plus recency boost and exact-phrase boost.

**Folder scope precedence: exclude wins over include.** Paths are stored normalized and prefix-searchable.

## Similarity

- **MVP:** lexical — BM25/TF-IDF nearest-neighbour over the local index.
- **Stretch:** vector embeddings. The schema reserves an extension point (a `method` discriminator on similarity records and a documented place for a future vector store). No vector dependency, column or extension is created in MVP.

## Synchronization architecture

- Local files remain local by default.
- Syncable: metadata, categories, search index.
- **Index sync is achieved by syncing metadata and re-deriving the cloud index** — no SQLite blobs on the wire.
- Identity: SHA-256 content hash, so the same file on two machines converges to one catalog row.
- MVP direction: **one-way push, desktop → cloud** (assumption flagged in `context.md`).
- Conflict policy: last-writer-wins per content hash, using per-row `updated_at` + `device_id`.
- Deletions use tombstones.
- Opt-in per indexed folder. File bytes are never transmitted in MVP.

## Staleness and re-indexing

Non-custodial sources change outside our control. Required behaviour:

1. Detect candidate changes by `mtime` + `size`.
2. Confirm by re-hashing.
3. A moved or renamed file with an unchanged hash updates its **locator**, never creating a duplicate catalog row.
4. A vanished file sets locator state to `missing`; an unreadable source sets `unreachable`.
5. Re-indexing is incremental, resumable and idempotent.

## Storage provider extension point

An interface with two implementations now and three defined-but-unimplemented:

| Provider | MVP status |
| --- | --- |
| `local_fs` | Implemented (desktop) |
| `platform_storage` (Supabase) | Implemented (web) |
| `google_drive` | **Interface only** |
| `onedrive` | **Interface only** |
| `dropbox` | **Interface only** |

Future Drive mode authenticates with Google, leaves files in Drive, and reads metadata / indexes / organizes / categorizes / searches without migration. Drive ACLs remain authoritative.

## Security architecture

- RLS enabled on every application table; UI hiding an action is not authorization.
- **Neither the browser nor the desktop binary ever receives the service-role key or an AI API key.**
- A desktop app cannot hold a secret → AI calls are proxied through an authenticated server endpoint, or use a user-supplied key.
- Desktop auth: PKCE; refresh token in the OS keychain (DPAPI / Keychain / libsecret), never plaintext on disk.
- Personal catalogs are strictly owner-scoped. **Institutional admins cannot read any user's personal desktop index.**
- Workflow transitions validated in the database; a defence-in-depth trigger rejects illegal state pairs even on direct SQL.
- Audit rows are written only inside `SECURITY DEFINER` functions so the actor cannot be spoofed; no client `INSERT`, `UPDATE` or `DELETE`.
- Storage: private bucket, immutable per-version object paths, no client update/delete, reads via short-lived signed URLs.
- Upload limits enforced in three layers: bucket configuration, database `CHECK` constraints, and server-side route validation.
- Local indexing requires explicit per-folder consent and never reads outside selected roots.
- Recommendations are non-destructive; the app never writes to user files.

## Reliability rules

- Desktop search and indexing work with no network.
- A failed AI enrichment must never destroy usable extracted metadata.
- A version becomes current only after its row is committed.
- Previous versions are immutable.
- Indexing is idempotent per content hash.
- Processing failures are visible and retryable.
- Query understanding failure falls back to lexical search rather than erroring.

## Deployment

- Web: free static/SSR host (Vercel or Render).
- Supabase: Free project.
- Claude: metered API usage; `claude-opus-5` by default, overridable with `ANTHROPIC_MODEL`.
- Desktop: **dev build for the demo.** Code signing is out of scope; unsigned installers trigger SmartScreen/Gatekeeper warnings, so judges should not be asked to install one.

## Build order

| Phase | Scope |
| --- | --- |
| 0 | Supabase project, cloud schema, RLS, Auth, private bucket, shared vocabulary, seed |
| 1 | Desktop core: Electron shell, folder scope, SQLite+FTS5, extraction, faceted search, ranking (offline) |
| 2 | Web governance spine: upload, metadata, workflow, comments, versioning, audit, cloud search |
| 3 | Search quality: ranking against golden set, lexical similarity, facet grouping, saved profiles |
| 4 | Identity + sync: PKCE login, keychain, device registry, opt-in metadata push |
| 5 | AI enhancement: extraction, categorization, query understanding, summaries |
| 6 | Minimal OCR for FS-05, states/polish, deployment, demo hardening |

Phase 2 precedes search polish so the FS-05 rubric answer exists early, despite the desktop being the hero demo.
