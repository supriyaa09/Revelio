# Testing Strategy

> **Specification only.** No tests are implemented yet. Local tooling required to run database tests is currently missing — see the gap note at the end.

Priority follows the product direction: **search quality is the primary thing worth measuring**, followed by the security boundaries and business rules.

Do not aim for coverage percentage. Test the boundaries and the rules.

---

# 1. Search quality — hero feature

## Golden query set

A committed fixture of **~20 queries with expected results**, run as a normal test. This is the single most valuable test artifact in the project: it is the only mechanism that prevents discovering at hour 20 that search "feels bad".

Each case asserts:

- Expected documents appear in the result set.
- Expected documents appear **within the top N**.
- Known-irrelevant documents do **not** appear.

Representative cases: `show scholarship documents`, `show approved policies`, `find AI-related files`, plus content-only matches (a phrase buried inside a file, absent from its name).

## Ranking

- Title matches outrank file-name matches; file-name outranks keyword; keyword outranks body.
- Exact-phrase matches outrank scattered-term matches.
- More recent documents outrank older ones at equal relevance.
- **Both engines produce the same relative ordering** for the same fixture corpus — SQLite FTS5 and PostgreSQL FTS parity.

## Facets

- Each facet filters correctly in isolation: category, tag, author, department, date range, workflow status.
- Facets compose (category **and** date range **and** author).
- An unknown facet value returns empty, not an error.

## Folder scope

- Search across all indexed folders returns the full corpus.
- Include-only scope (`Research`, `Policies`) returns nothing outside those roots.
- Exclusions (`Downloads`, `Temporary Files`) remove those roots.
- **Exclude wins over include** in the nested case: include `/Research`, exclude `/Research/Temp` → nothing from `Temp`.
- Saved search profiles reproduce their scope exactly.
- Path normalization: case differences, trailing separators and drive-letter forms resolve to the same scope on Windows.

## Query understanding

- `show approved policies` maps to `workflow_status=approved` + `category=policy`.
- **Provider failure or offline falls back to lexical search and still returns results** — query understanding never blocks search.

---

# 2. Desktop / local index

- Indexing a fixture folder tree produces the expected row count.
- Default exclusions are honoured on first run.
- Files outside selected roots are never read.
- Incremental re-index picks up a modified file without duplicating it.
- **A renamed or moved file with an unchanged hash updates its locator, not creating a second catalog row.**
- A deleted file sets locator state to `missing`.
- An unreadable file sets `unreachable` and does not abort the run.
- Permission-denied files, locked files and symlink loops do not crash indexing.
- Indexing is resumable after interruption.
- **Search and indexing work fully with the network disabled.**

# 3. Similarity and organization

- Known-similar fixtures (same department + overlapping keywords) group together.
- Known-dissimilar fixtures do not.
- Every recommendation exposes the signals that produced it (shared category / author / department / keywords).
- **Non-destructive guarantee: after generating recommendations, the fixture tree is byte-identical.** No file moved, renamed, deleted or written.

# 4. Synchronization

- **No file bytes leave the machine while cloud backup is off** — assert on outbound payloads. Highest-value privacy test in the suite.
- Only folders with `sync_enabled = true` are pushed; a non-opted-in folder is rejected rather than partially applied.
- Push is **idempotent** — replaying a batch produces no duplicates.
- Conflicts resolve last-writer-wins by `updated_at`.
- Deletions produce tombstones, never hard deletes.
- The cloud index is re-derived from pushed metadata and returns the same results as the local index for the same corpus.
- Audit records for sync contain counts only, never file names.

---

# 5. Security boundaries

## Authentication and authorization

- Unauthenticated requests are rejected.
- A user cannot read another user's documents.
- **A user cannot read another user's personal catalog — including as an admin.**
- Role restrictions are enforced server-side with the UI bypassed entirely (direct API calls).
- A reviewer cannot see another user's drafts.
- Admin-only operations (categories, role changes) are protected.
- A resource the caller cannot see returns `404`, not `403` — existence is not leaked.

## Protected fields

Supplying any of these is rejected rather than silently ignored: `owner_id`, `uploaded_by`, `version_number`, `storage_path`, `workflow_status`, `processing_status`, audit actor, review actor.

## Audit integrity

- Audit rows cannot be inserted directly by a client.
- Audit rows cannot be updated or deleted by anyone, at any privilege level available to the application.
- Every successful workflow transition creates exactly one audit event.

## Storage

- Objects in the `documents` bucket are not publicly readable.
- A signed URL is required to read, and it expires.
- A user cannot read another user's stored file by guessing a path.
- A client cannot overwrite or delete a stored object.
- Non-PDF uploads are rejected.
- Uploads over 25 MB are rejected.
- Rejection happens **server-side**, with the client-side check bypassed.

## Secrets

- No service-role key, AI key or connection string appears in any client bundle — asserted against the built web and desktop artifacts.
- No secret appears in committed source or in `.env.example`.

---

# 6. Workflow

- Each of the five valid user transitions succeeds for a permitted role.
- Every invalid transition is rejected: `draft → approved`, `draft → under_review`, `submitted → approved`, `approved → under_review`, `rejected → approved`, and any state to itself.
- **Approval cannot happen from `draft`.**
- **A rejected document requires resubmission (`rejected → draft → submitted → under_review`) before it can be approved.**
- **A user cannot approve or reject their own document, at any role including admin.**
- Staff cannot approve.
- Reviewer can move `submitted → under_review` and reject, but cannot approve.
- Approver can approve and reject.
- The state pair is rejected by the **database** even when the API layer is bypassed.
- Each transition writes an attributable `document_reviews` row.

# 7. Versioning

- A new version increments the version number.
- A duplicate version number is rejected.
- **Previous versions remain intact and readable after a new version is created.**
- Version content columns cannot be updated.
- The current-version pointer advances only after the version row commits.
- Creating a version on an `approved` or `rejected` document returns it to `draft`.
- A failed version creation does not silently replace the current version.

# 8. Minimal OCR — FS-05 compliance (Phase 6)

- A scanned PDF produces searchable text.
- A text-layer PDF does **not** unnecessarily invoke OCR.
- Malformed and password-protected PDFs fail cleanly with the documented error codes.
- Failure sets an explicit `failed` state and is retryable.
- **An AI or OCR failure never destroys already-extracted metadata.**

# 9. Deferred

Not tested in MVP, matching their scope status: grounded Q&A (stretch), vector-embedding similarity (stretch), bidirectional sync (future), Google Drive / OneDrive / Dropbox connectors (interface only), file backup to cloud (future).

---

# Manual demo test

**Desktop (hero):**

1. Launch the app with the network disabled.
2. Select `Research` and `Policies` to index; confirm `Downloads` and `Temporary Files` are excluded by default.
3. Watch indexing complete.
4. Search a phrase that exists only inside a file's content.
5. Narrow the scope to `Research` only; confirm results change.
6. Add an exclusion; confirm exclude wins.
7. Open a document and request similar files; inspect the stated shared signals.
8. Review automatic organization recommendations; confirm no file was moved.
9. Re-enable the network, sign in, and confirm metadata syncs with no file bytes transmitted.

**Web (FS-05):**

10. Sign in as Staff; upload a PDF; add category and metadata.
11. Submit for review; attempt to approve as the owner and confirm refusal.
12. Switch to Reviewer; move to Under Review; reject with a comment.
13. Confirm the audit trail shows the rejection and actor.
14. Resubmit; switch to Approver; approve.
15. Upload a new version; confirm the previous version is intact and the document re-entered review.
16. Inspect the full audit timeline.

# UX failure testing

Every state must show state, a useful error, retry where safe, and a fallback where possible.

- Search must never show a blank screen — empty results and errors are distinct, labelled states.
- AI unavailable must degrade to lexical search silently, not error.
- Offline must be a first-class state in the desktop app, not an error.
- An AI enrichment failure must never make a successfully indexed document disappear.

---

# Tooling gap

Database, RLS and storage tests **cannot currently be executed** on the development machine.

| Present | Missing |
| --- | --- |
| Node 22.20.0, npm 11.19.0, Python 3.13.7 | **Docker**, **Supabase CLI**, **`psql`** |

To run them, either install Docker Desktop plus the Supabase CLI (`npx supabase start` for a local stack), or supply a hosted Supabase project and connection details via `.env.local`. Until then, no test in sections 1, 4, 5, 6 or 7 that touches PostgreSQL can be reported as passing.
