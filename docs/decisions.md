# Architecture Decisions

> Original ADRs are preserved. Where the revised product direction changed a premise, the ADR is **amended** rather than deleted, so the reasoning trail stays intact.

## ADR-001 Supabase as primary platform
**Status:** Accepted

Use Supabase for Auth, PostgreSQL, Storage and RLS. This minimizes infrastructure while fitting relational workflow/version/audit data.

**Amendment (revised direction):** Supabase is now also the **single identity provider for both applications**. The desktop app authenticates against the same Supabase Auth instance, so one account spans web and desktop.

## ADR-002 Python/FastAPI processing service
**Status:** **Superseded by ADR-010**

Originally: use Python for PDF/OCR/AI orchestration because document-processing libraries fit the problem.

**Why superseded:** the service was justified almost entirely by OCR/PyMuPDF. With OCR demoted from hero to a minimal compliance path, and with the desktop app needing extraction to run *locally on the user's machine* rather than in a cloud service, a separate Python service no longer earns its deployment cost in the MVP. Extraction now happens in the Electron process locally and in Route Handlers server-side.

## ADR-003 PostgreSQL FTS for MVP
**Status:** Accepted, amended

Use Postgres FTS for cloud search. Avoid Elasticsearch.

**Amendment:** search is now **dual-engine**. SQLite FTS5 serves the desktop app offline; PostgreSQL FTS serves the cloud. Both apply the **same field weights** so results feel consistent. Elasticsearch remains excluded entirely.

## ADR-004 Tesseract for OCR fallback
**Status:** Accepted, **demoted**

Use PyMuPDF first; trigger Tesseract only when extracted text is insufficient.

**Amendment:** OCR is **no longer a differentiator or a critical-path feature**. It is retained as a minimal web-app capability solely because FS-05 explicitly requires *"extract searchable text from scanned documents using OCR"*, and dropping it entirely risks losing marks against a stated organizer requirement. It is scheduled last (Phase 6) and must never consume time budgeted for search quality.

## ADR-005 Gemini for intelligence
**Status:** Accepted, amended

Use Gemini for AI capabilities.

**Amendment:** **AI is not the product; it is an enhancement layer.** Scope narrows to metadata extraction, categorization, similarity assistance, search enhancement and summaries. Grounded Q&A is removed from the MVP (see ADR-016). All Gemini calls are server-side proxies — see ADR-013.

## ADR-006 Data-configured workflows
**Status:** **Superseded by ADR-012**

Originally: represent workflow states/transitions as data while shipping one default workflow.

**Why superseded:** "complex workflow builders" are explicitly out of MVP scope. A `workflows` table with `states`/`transitions` JSON invites building an engine we have committed not to build, and it weakens enforcement by moving rules out of constraints. The MVP ships a fixed state machine in the database instead.

## ADR-007 Versioned immutability
**Status:** Accepted

Approved content is never silently overwritten. Every replacement is a new immutable version with audit history.

---

## ADR-008 Two connected applications
**Status:** Accepted

The product is a **web platform** (institutional workflow, satisfies FS-05) and a **desktop application** (intelligent organization and search), sharing one identity system and one metadata vocabulary.

**Reasoning:** the two serve genuinely different jobs — governance versus discovery — for different users, with different data-ownership expectations. Forcing them into one application would compromise both. The desktop app is a first-class product, not a feature.

**Cost:** roughly doubles the surface area within a fixed 24 hours. Mitigated by ADR-009.

## ADR-009 Desktop app is the hero; web app is the compliance spine
**Status:** Accepted

The desktop application is the primary demo. The web platform is deliberately narrowed to the capabilities FS-05 requires.

**Reasoning:** search/discovery is the differentiator, and the desktop app is where folder-scoped search, similarity and organization recommendations live. But FS-05 is the scored rubric, so the web governance spine is scheduled early (Phase 2) rather than last, to guarantee it exists.

## ADR-010 Custody model: files stay where they live
**Status:** Accepted

The platform owns only **derived data** — metadata, indexes, categories, similarity links and pointers. Two custody modes: **custodial** (web, files in Supabase Storage) and **non-custodial** (desktop, files on the user's disk; Drive/OneDrive/Dropbox later).

**Consequences:**
- Identity is a **SHA-256 content hash**, not a path or provider ID, so the same file converges across devices and sources.
- Staleness detection (move/rename/delete/unreachable) becomes a required subsystem.
- In non-custodial mode the **source system's permissions are authoritative**.
- Future Google Drive mode reads metadata and indexes in place, with **no migration of files into platform storage**.

**Reasoning:** this is what makes local folders and future cloud-drive support the same architecture rather than two products. It is also the strongest trust property we can offer an individual user.

## ADR-011 Electron + TypeScript for the desktop application
**Status:** Accepted

**Alternatives considered:** Tauri (small binary, but needs a Rust toolchain that is not installed and whose setup cost lands inside the 24 hours); Python + Flet/Qt (best extraction ecosystem, but splits the team across two UI stacks with no reusable UI).

**Chosen because:** one language across web and desktop, reusable React/Tailwind components, and adequate Node-side PDF text extraction. The larger binary is irrelevant for a demo run from a dev build.

**Accepted cost:** binary size, and no code signing — the demo runs from a dev build rather than an installer, since unsigned installers trigger SmartScreen/Gatekeeper warnings.

## ADR-012 Fixed MVP workflow enforced in the database
**Status:** Accepted — supersedes ADR-006

The five user transitions and one system transition are fixed and enforced by a `SECURITY DEFINER` function plus a defence-in-depth trigger, so even direct SQL cannot perform `draft → approved`.

Includes **separation of duties**: a user may never approve or reject their own document, regardless of role.

**Reasoning:** the frontend cannot be the enforcement point, and a configurable engine is explicitly out of scope. Constraints are cheaper and stronger than configuration here.

## ADR-013 No secrets in any client
**Status:** Accepted

Neither the browser nor the desktop binary ever receives the service-role key or an AI provider key.

**Reasoning:** a desktop application fundamentally cannot hold a secret — anything shipped in the bundle is extractable. Therefore all AI calls are **proxied through an authenticated server endpoint** (the alternative being a user-supplied key). Desktop auth uses **PKCE** with refresh tokens in the OS keychain (DPAPI / Keychain / libsecret), never a plaintext config file.

This is the single most likely place for an accidental security mistake in this architecture, which is why it is an explicit ADR.

## ADR-014 Append-only audit written only by trusted functions
**Status:** Accepted

`audit_logs` has **no client `INSERT` policy**. Rows are written exclusively inside `SECURITY DEFINER` functions and triggers. `UPDATE` and `DELETE` are revoked and additionally blocked by a trigger.

**Reasoning:** if clients could insert their own audit rows, the actor could be spoofed and the log would be worthless as evidence. Deriving the actor from `auth.uid()` inside a trusted function is the only way the log means anything.

## ADR-015 Search is the hero feature
**Status:** Accepted

**Primary Product Differentiator: Intelligent Metadata-Driven Search.** The success of the MVP depends more on search quality than on OCR quality. Search is treated as the hero feature during architecture and implementation decisions.

**Binding consequences:**
- Ranking is a **specified artifact** (title > file name > keywords > body, plus recency and exact-phrase boosts), identical in both engines.
- A **golden query set** is a committed test artifact — search quality is measured, not asserted.
- Folder scope is a core feature with **exclude winning over include**.
- Query understanding is an AI enhancement that **must degrade gracefully** to lexical search offline.
- When a design choice trades search quality against another capability, search wins.

## ADR-016 Lexical similarity now, embeddings as a reserved extension point
**Status:** Accepted

MVP similarity is lexical (BM25/TF-IDF nearest-neighbour). Organization recommendations use **deterministic facet grouping** on shared category / author / department / keywords.

**Reasoning:** pgvector and Elasticsearch are excluded, and a local embedding model would add a model download plus CPU cost inside a 24-hour build. Facet grouping is also **explainable** — "these 12 share department = Finance and keyword = budget" — which both demos better and debugs faster than an opaque cluster.

**Extension point:** a `method` discriminator on similarity records (`lexical` | `embedding`) means vector similarity can be added later with no schema or API change.

**Accepted risk:** lexical similarity can look weak on a small or homogeneous corpus, so demo corpus selection matters.

## ADR-017 Grounded Q&A removed from MVP
**Status:** Accepted

Grounded document Q&A with citations moves to **stretch**.

**Reasoning:** it is absent from the revised MVP, and it depended on chunking plus vector or FTS retrieval infrastructure that no longer sits on the critical path. Removing it frees time for search quality.

**Accepted cost:** this was the strongest "wow" moment in the original demo script. The trade is deliberate — a reliably excellent search demo beats a fragile Q&A demo.

## ADR-018 Metadata sync only; files stay local
**Status:** Accepted

Local files remain local by default. Metadata, categories and search indexes may sync when online. Optional file sync to cloud storage is a future feature.

**Design decisions:**
- The cloud index is **re-derived from synced metadata** rather than shipping SQLite blobs — same user-visible outcome, far less to build, nothing binary to version.
- MVP is **one-way push (desktop → cloud)**; bidirectional sync is documented as future. *(Flagged assumption — see `context.md`.)*
- Conflicts resolve last-writer-wins per content hash using `updated_at` + `device_id`; deletions use tombstones.
- Sync is **opt-in per indexed folder**, because enabling it means file names, folder paths and keywords leave the machine — and a file name alone can be sensitive.

## ADR-019 Recommendations are non-destructive
**Status:** Accepted

The desktop application never moves, renames, deletes or writes to a user's files. It recommends; the user acts. Suggested folder structures remain a future feature and would still require explicit user action.

**Reasoning:** we are indexing people's real personal folders. A single unwanted file move would destroy trust in the product permanently. The guarantee is worth more than the convenience.

## ADR-020 Personal catalogs are invisible to administrators
**Status:** Accepted

Personal desktop catalog tables are strictly owner-scoped. Institutional admins have **no** read access to any user's personal index.

**Reasoning:** a deliberate departure from "admin sees all". An institutional administrator has no legitimate need to read a student's or employee's personal file index, and granting it would make the desktop app untrustworthy for its actual audience.

**Accepted cost:** an institution cannot audit personal indexes at all. This should be stated to stakeholders rather than discovered later.
