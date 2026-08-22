# Current Changes

> **Rule:** Update this document after every meaningful project change, decision, addition, removal, architecture change, feature change, bug fix, or scope change.

## Current Project Status

- Last updated: 2026-08-22 21:20 IST
- Project name: **Revelio**
- Current phase: Upload pipeline debugged; `0005`, `0006` and `seed.sql` await execution
- Overall status: Builds and typechecks; upload blocked on two pending migrations
- Selected problem: FS-05 Document Management
- Product shape: **ONE web application** (intelligent workspace + institutional governance)
- Roles: **`student`, `faculty`, `hod`** — three only, no admin
- Workflow: `draft → submitted → faculty_review | hod_review → approved / rejected / changes_requested`
- Deployment status: Not deployed
- Blocker: apply `0005_fix_search_trigger.sql`, `0006_table_grants.sql`, then `seed/seed.sql`

---

## Change Log

### 2026-08-22 21:20 IST — Fix `permission denied for table categories` (missing GRANTs)

#### Root cause

`42501 permission denied for table categories` is a **GRANT failure, not an RLS failure**. PostgreSQL evaluates table privileges *before* row-level security, so `categories_select ... using (true)` was never reached. The policies were correct throughout; the roles had no privileges at all.

A live probe with the anon key confirmed **all 11 application tables** return `42501`, with Postgres emitting the remedy itself as a hint:

```
categories   42501  "permission denied for table categories"
             hint: "Grant the required privileges to the current role with:
                    GRANT SELECT ON public.categories TO anon;"
```

This is the expected consequence of `DROP SCHEMA public CASCADE; CREATE SCHEMA public;` without restoring the default-privileges block. Note also that `ALTER DEFAULT PRIVILEGES` only affects objects created *after* it runs, so issuing it once the tables already existed would leave them ungranted too.

#### Why the app looked half-working

`requireSession()` discarded the error from its `profiles` SELECT and fell through to `ensure_profile()`. That RPC is `SECURITY DEFINER`, so it **bypasses table grants** — every request was silently papering over the missing privilege on `profiles`, which is why sign-in and the workspace shell loaded while every other table failed. Separately, the workspace discarded its `departments`/`categories` load errors, so a missing grant rendered as an empty folder tree indistinguishable from an unseeded database.

#### Change

**Added**

- `supabase/migrations/0006_table_grants.sql` — grant matrix for `authenticated` and `service_role`.
- `frontend/scripts/probe-grants.mjs` — discriminates grant failures from RLS filtering, printing raw SQLSTATE, message and hint.

**Modified**

- [auth.ts](../frontend/src/lib/auth.ts) — captures the `profiles` SELECT error, logs SQLSTATE/message/hint, and treats `42501` as a hard configuration failure with an actionable message instead of masking it via `ensure_profile()`. The RPC fallback is now reserved for a genuinely absent row.
- [workspace/page.tsx](<../frontend/src/app/(app)/workspace/page.tsx>) — taxonomy load errors are logged and rendered in the folder panel rather than discarded.

**No RLS, policy, enum, table, workflow or storage change. No data modified.**

#### The grant design

Deliberately **narrower** than the Supabase default. `anon` gets **nothing** — no application table needs anonymous access and every policy is already scoped `to authenticated`. Where RLS has no write policy, the privilege is withheld too, so the layers reinforce each other:

| Table | `authenticated` |
| --- | --- |
| `profiles` | select, insert, update |
| `departments`, `categories` | select, insert, update, delete (writes gated to HOD by policy) |
| `documents` | select, insert, update, delete |
| `document_versions` | select, **insert only** — immutable |
| `document_insights`, `document_chunks`, `document_search` | select |
| `document_comments` | select, insert, delete |
| `document_reviews`, `audit_logs` | select — written only by SECURITY DEFINER functions |

#### Role model audit (requested)

Source is clean — a grep for `staff`, `reviewer`, `approver`, `admin`, `is_admin`, `can_approve`, `canApprove` across `supabase/` and `frontend/src` returns **nothing**.

| Item | State |
| --- | --- |
| `app_role` enum | `('student', 'faculty', 'hod')` — `0001_init.sql:9` |
| Security helpers | `current_app_role()`, `is_hod()`, `can_review()`, `document_is_visible()` |
| Removed helpers | `is_admin()`, `can_approve()` — absent |
| Taxonomy policies | `departments_select` / `departments_manage_hod`, `categories_select` / `categories_manage_hod` |
| Frontend | `AppRole = 'student' \| 'faculty' \| 'hod'`; `canReview`, `isHod`, `canDecideAt`, `canRoute` |

The live enum could not be introspected (no `psql`/CLI/service key, and `information_schema` is not exposed through PostgREST). Verification query 4 in `0006` confirms it.

#### Migration order

```text
0001_init.sql   0002_security.sql   0003_storage.sql   0004_profile_backfill.sql
0005_fix_search_trigger.sql    <-- pending
0006_table_grants.sql          <-- pending
seed.sql                       <-- pending (taxonomy still empty)
```

Both `0005` and `0006` are required before an upload can succeed: `0006` unblocks the categories read, `0005` unblocks the `documents` insert.

#### Verification status

| Item | Status |
| --- | --- |
| `npm run typecheck` | **Passes**, zero errors |
| `npm run build` | **Passes**, 11 routes |
| All 11 tables return `42501` for anon | **Verified** against the live project |
| Role model free of old names | **Verified** by grep across source |
| `0005` / `0006` applied | **NO — not executed** |
| Student uploads a PDF end to end | **NOT VERIFIED** |

Runtime verification is still blocked: throwaway signup hits `over_email_send_rate_limit` (email confirmation enabled) and `SUPABASE_SERVICE_ROLE_KEY` is absent from `.env.local`, so no authenticated session can be minted from this environment.

#### Status

- [x] Planned
- [x] Implemented
- [ ] Tested — `0005`, `0006` and `seed.sql` not yet applied
- [ ] Deployed


### 2026-08-22 20:40 IST — Official name Revelio; fix upload failure (broken search trigger)

#### Root cause of the upload failure

`trg_refresh_document_search()` in `0001_init.sql` contained:

```sql
perform refresh_document_search(
  case when tg_table_name = 'documents' then new.id else new.document_id end
);
```

That is a **single SQL expression**. plpgsql resolves and binds every parameter of an expression *before* the executor evaluates the `CASE`, so `new.document_id` was looked up even when the trigger fired on `documents`, where no such field exists. Every insert therefore raised:

```
record "new" has no field "document_id"      SQLSTATE 42703
```

`trg_documents_search` is `AFTER INSERT OR UPDATE OF … ON documents`, so this broke:

- **every `documents` INSERT** — `uploadDocument()` died at step 2, before storage was ever touched
- **every `UPDATE` of `current_version_id`** — so `create_document_version()` would also have failed
- `document_search` was never populated for any document

#### Why the UI said "Something went wrong. Please try again."

That string is the `INTERNAL_ERROR` fallback in `mapDbError()`. `42703` matched none of the recognised codes, so the real message was discarded before reaching the browser. The error-hiding was a second, independent defect: it turned a one-line trigger bug into an undebuggable one.

#### Diagnosis method

Storage was ruled out analytically before any code was touched: a storage failure returns a *specific* `UPLOAD_FAILED` message, so the generic text proved the failure was in the categories query, the documents insert, or the version RPC.

Two throwaway scripts then established what actually existed in the live project, using the anon key only:

- `frontend/scripts/probe-schema.mjs` — all 11 tables reachable; all 4 RPCs present (anon correctly gets `42501`, since execute is granted to `authenticated` only).
- A raw storage probe distinguished `NoSuchKey` from `NoSuchBucket`, proving the private `documents` bucket **does** exist. An earlier `listBuckets()` result suggesting otherwise was an RLS artifact, not a missing bucket.

With the schema confirmed intact, the failure had to be inside a trigger fired by the insert — which is where the `CASE` expression was found.

#### Change

**Added**

- `supabase/migrations/0005_fix_search_trigger.sql` — corrected trigger function, plus a `refresh_document_search()` backfill for documents created while it was broken.
- `frontend/scripts/probe-schema.mjs`, `frontend/scripts/diagnose-upload.mjs` — anon-key diagnostics.

**Modified**

- `0001_init.sql` — same trigger fix, so fresh installs are correct from the start. Now branches with `IF/ELSE` so only the taken branch is planned and the absent field is never resolved.
- [errors.ts](../frontend/src/lib/errors.ts) — `mapDbError()` no longer collapses unknown errors to a generic string. It maps `23502`, `23503`, `23505`, `23514`, `42501`, `42703`, `42883`, `42P01`, `PGRST202`, `PGRST205`, and otherwise returns `DATABASE_ERROR` **with the real SQLSTATE and message**. Added `logAndMap()`, which logs `message`/`details`/`hint` server-side (never to the browser).
- [documents.ts](../frontend/src/lib/actions/documents.ts) — every step now logs under a named label (`categories query`, `documents insert`, `storage upload`, `create_document_version RPC`, `log_audit_event RPC`). The audit RPC error is now inspected and logged instead of ignored, while staying non-fatal.
- **Official name applied: Revelio** — `layout.tsx` metadata, login heading, sidebar, `package.json` name (`revelio-web`), `docs/context.md`.

**Rollback behaviour is unchanged.** A storage failure still deletes the draft row; a version-RPC failure still removes the stored object *then* the row, in that order, so an object is never left pointing at a deleted document.

#### Database / storage / RLS changes

One trigger **function body**. No policy, grant, bucket, enum, table or workflow change. RLS was not weakened, no bucket was made public, no service-role credential entered the frontend, and no authorization was bypassed.

#### Verification status

| Item | Status |
| --- | --- |
| `npm run typecheck` | **Passes**, zero errors |
| `npm run build` | **Passes**, 11 routes |
| All 11 tables exist and are reachable | **Verified** via anon probe |
| All 4 RPCs exist with correct grants | **Verified** via anon probe |
| Private `documents` bucket exists | **Verified** (`NoSuchKey` vs `NoSuchBucket`) |
| `0005_fix_search_trigger.sql` applied | **NO — not executed** |
| Student uploads a PDF end to end | **NOT VERIFIED** |
| `documents` / `document_versions` / storage object / `audit_logs` rows | **NOT VERIFIED** |

Runtime verification was blocked: creating a throwaway user hit `over_email_send_rate_limit` (email confirmation is enabled on the project) and `SUPABASE_SERVICE_ROLE_KEY` is absent from `.env.local`, so no session could be minted. The root cause is deterministic plpgsql parameter-binding behaviour and it uniquely explains the observed symptom, but it has not been executed against the database.

After applying `0005`, `node scripts/diagnose-upload.mjs` runs all five steps and prints the four verification counts — it needs either the service-role key in `.env.local` or email confirmation disabled.

#### Status

- [x] Planned
- [x] Implemented
- [ ] Tested — `0005` not applied; upload not yet re-run
- [ ] Deployed


### 2026-08-22 19:55 IST — Fix `__webpack_modules__[moduleId] is not a function` on /workspace

#### Root cause

Not an application bug. `frontend/.next` held a **mixed production + development build**:

| Artifact | Written by | Time |
| --- | --- | --- |
| `BUILD_ID`, `prerender-manifest.json`, `export-marker.json`, prerendered `login.html` / `signup.html` | `next build` | 19:27 |
| `build-manifest.json`, `app-build-manifest.json`, `static/development/`, `static/webpack/` | `next dev` | 19:46 |

`.next/static/` contained both the production hashed directory `5ULcpEcv7pIxi5fpmAg_t/` and dev's `development/` + `webpack/`. The dev server overwrote the manifests while production chunks stayed on disk and were still referenced, so the runtime resolved a module id from one compiler's manifest into the other compiler's chunk. The module factory was absent, producing `__webpack_modules__[moduleId] is not a function`.

**Why only /workspace:** `/login` and `/signup` were prerendered to static HTML by the 19:27 build, so they could be served from the stale production output. `/workspace` is dynamic (`ƒ`) and had to resolve modules through the manifest per request, which is where the mismatch surfaced.

**How it got there:** repeated `npx next build` runs in the same directory that `npm run dev` was later started in, with no cache clear between modes.

#### Ruled out

Audited and clean — no change needed:

- No client component imports `@/lib/auth`, `@/lib/supabase/server`, or `next/headers`.
- `lib/types.ts` is type-only and is only ever `import type`-ed, so no value import resolves to an empty module.
- No circular imports in the `/workspace` graph — `types.ts`, `constants.ts` and `ui.tsx` are leaves.
- `lib/actions/documents.ts` is the only `'use server'` module and all four exports are `async`, as that directive requires.
- No default/named export mismatch, no dynamic imports.

#### Change

**Added**

- `clean` script in `frontend/package.json`, using Node's `fs.rmSync` so it works in both `cmd.exe` and Git Bash without adding a dependency:
  `node -e "require('fs').rmSync('.next',{recursive:true,force:true})"`

**No application code was modified.** No database change, no workflow change.

#### Prevention

`next build` and `next dev` write incompatible artifacts into the same `.next`. Run `npm run clean` when switching modes. Note that `.next` was cleaned again *after* the verification build, so the tree is currently in a dev-only state and `npm run dev` will start correctly.

#### Verification

| Check | Result |
| --- | --- |
| `npm run typecheck` | **Passes**, zero errors |
| `npm run build` (from clean cache) | **Passes**, 11 routes, `/workspace` compiled and page data collected |
| Dev server restarted on a clean cache | **Ready in 2s**, middleware + `/login` compiled, no webpack errors |
| `GET /login` | **200** |
| `GET /workspace` unauthenticated | **307 → `/login?next=%2Fworkspace`** (correct; previously a 500) |
| Authenticated `/workspace` render | **Not verified** — requires a browser session, which is not available here |
| Production markers remaining in `.next` | **None** |

The authenticated render is the one thing left to confirm from the browser. The successful production build exercises the same module graph, so the remaining risk is low, but it is not the same as loading the page while signed in.

#### Status

- [x] Planned
- [x] Implemented
- [x] Tested — typecheck, build, clean dev boot, route probes
- [ ] Deployed


### 2026-08-22 19:05 IST — Fix orphaned auth users; harden the profile trigger

#### Change

**Added**

- `supabase/migrations/0004_profile_backfill.sql` — idempotent repair migration.
- `ensure_profile()` RPC — a self-healing safety net callable by the signed-in user.

**Modified**

- `handle_new_user()` in `0001_init.sql` — hardened `full_name` fallback chain.
- `on_auth_user_created` trigger — now recreated with `drop trigger if exists`, so applying the migration also repairs a database where the trigger was missing.
- [auth.ts](../frontend/src/lib/auth.ts) — `requireSession()` calls `ensure_profile()` on a profile miss instead of throwing, and uses `maybeSingle()` rather than `single()` so a missing row is not an error.

**Not changed:** workflow logic, transitions, RLS policies on documents, roles model. Nothing outside profile creation was touched.

#### Root cause

`on_auth_user_created` is an **AFTER INSERT** trigger, so it only fires for *new* signups. Any auth user that already existed when `0001` was applied never received a `public.profiles` row. `requireSession()` threw for those accounts, locking them out.

User `7c7eb4fa-8983-42f5-817f-69aa5787f76f` (Sohail → student) was repaired by hand. This migration removes the need to ever do that again.

#### Second defect found while auditing

The previous fallback was:

```sql
coalesce(new.raw_user_meta_data ->> 'full_name', split_part(new.email, '@', 1))
```

This can resolve to **NULL** — `email` is nullable for phone and some OAuth identities, and `split_part(NULL, '@', 1)` is NULL. Because `profiles.full_name` is `NOT NULL` and the trigger runs *inside the signup transaction*, that violation would abort the signup itself, surfacing as `Database error saving new user` with no auth user created at all. An empty-string `full_name` also passed `coalesce` and produced a blank name.

Now a three-step chain that cannot yield NULL: trimmed metadata → email local-part → `'User'`.

#### Requirements verification

| # | Requirement | State |
| --- | --- | --- |
| 1 | Trigger exists on `auth.users` | Present in source (`0001` L260–263); recreated by `0004`. **Live DB unverified** |
| 2 | Trigger inserts `public.profiles` row | Yes — `handle_new_user()`, `SECURITY DEFINER`, pinned `search_path` |
| 3 | Default role is `student` | Yes — enum default `'student'` (`0001` L31) **and** the literal in the function body |
| 4 | Auto-creates id / full_name / role | Yes — `new.id`; metadata → email local-part → `'User'`; `'student'` |
| 5 | Faculty and HOD never from client metadata | Yes — role is a hard-coded literal. `raw_user_meta_data` is read **only** for `full_name`; a client sending `{"role":"hod"}` is ignored |
| 6 | No service-role secrets exposed | Yes — `SECURITY DEFINER` replaces any need for a service-role key. No key added to client or env |
| 7 | Fixed in migration, not by manual insert | Yes — `0004` backfills all orphans and adds `ensure_profile()` |
| 8 | Tested with a throwaway user | **NOT DONE — see below** |
| 9 | `current-changes.md` updated | This entry |

#### Requirement 8 is not satisfied

I have no database access in this environment — no `psql`, no Supabase CLI, no Docker, no project credentials. **No SQL was executed and no throwaway signup was performed.** The test procedure:

```sql
-- 1. Apply 0004, then confirm zero orphans:
select count(*) as orphans from auth.users u
  left join public.profiles p on p.id = u.id where p.id is null;   -- expect 0

-- 2. Sign up a throwaway account through the app UI, then:
select p.id, p.full_name, p.role, u.email, u.created_at
  from auth.users u join public.profiles p on p.id = u.id
 order by u.created_at desc limit 1;                                -- expect role = student

-- 3. Confirm client metadata cannot elevate. In the browser console on /signup:
--    await supabase.auth.signUp({ email:'x@y.test', password:'passw0rd123',
--      options:{ data:{ full_name:'Probe', role:'hod' } } })
--    then re-run query 2 — role must still be student.

-- 4. Confirm the repaired account survived the backfill unchanged:
select id, full_name, role from public.profiles
 where id = '7c7eb4fa-8983-42f5-817f-69aa5787f76f';
```

Step 3 is the one worth actually running — it is the requirement-5 guarantee, and the only way to prove it rather than assert it.

#### Impact

- Existing orphaned accounts are repaired in bulk; no further manual inserts.
- A future orphan self-heals on next request, because `requireSession()` recovers.
- Signup no longer fails for identities without an email address.
- The backfill uses `LEFT JOIN ... WHERE p.id IS NULL` plus `ON CONFLICT DO NOTHING`, so **existing profiles are untouched** — the hand-repaired account keeps its row, and nobody already set to `faculty` or `hod` is demoted.

#### Verification status

| Item | Status |
| --- | --- |
| `npx tsc --noEmit` | **Passes**, zero errors |
| `npx next build` | **Passes**, 11 routes |
| `0004_profile_backfill.sql` applied | **NO — not executed** |
| Throwaway-user signup test | **NO — requirement 8 outstanding** |
| Orphan count after backfill | **Unverified** |

#### Status

- [x] Planned
- [x] Implemented — migration and app change written
- [ ] Tested — requires applying `0004` and one throwaway signup
- [ ] Deployed


### 2026-08-22 14:45 IST — Final three-role model and tiered workflow

#### Change

**Added**

- `supabase/migrations/0004_roles_workflow.sql` — additive migration, single transaction, non-destructive.
- Workflow states `faculty_review` and `hod_review`, replacing the single `under_review`.
- `review_action` value `routed_to_hod`, so escalation is a distinct, attributable event.
- `is_hod()` role helper.
- Frontend helpers `isHod()`, `canDecideAt(role, state)`, `canRoute(role)`, `decisionStatesForRole(role)`.
- "Escalate to HOD" / "Route to HOD" action in the workflow panel.
- Review queue partitioned by tier: HOD sees escalated work first; faculty see escalated documents read-only for tracking.
- ADR-021 through ADR-026.

**Modified**

- `app_role` enum: `staff | reviewer | approver | admin` → **`student | faculty | hod`**. Rows remapped staff→student, reviewer→faculty, approver→hod, admin→hod.
- `workflow_state` enum: 6 → 7 values; existing `under_review` rows remapped to `faculty_review` across `documents`, `document_reviews` and `audit_logs`.
- `is_valid_transition`: 8 edges → **13**, adding `submitted → hod_review`, `faculty_review → hod_review`, and splitting the three decision edges across both tiers.
- `transition_document`: authority is now resolved from the **tier holding the document**, not from the role alone. Decisions at `hod_review` require HOD; decisions at `faculty_review` require the reviewer tier.
- `can_review()`: reviewer/approver/admin → faculty/hod.
- `document_is_visible()`: replaced via `CREATE OR REPLACE` (unchanged signature), so the six policies using it needed no edits.
- `create_document_version()`: swapped `is_admin()` → `is_hod()`.
- `handle_new_user()`: default role `staff` → `student`.
- 9 RLS policies dropped and recreated against `is_hod()`; `profiles_update_self` hardened to use `current_app_role()` for a snapshot-stable role lock.
- Frontend: `types.ts`, `constants.ts`, `workflow-actions.tsx`, `review/page.tsx`, `search/page.tsx`, `signup/page.tsx`, `workspace/page.tsx`.

**Removed**

- The `admin` role entirely. HOD inherits management duties.
- `is_admin()` and `can_approve()`. Approval authority is state-dependent, so a global role predicate would have been misleading.
- Workflow state `under_review`.
- Frontend `canApprove(role)`, replaced by `canDecideAt(role, state)`.

#### Reason

The institutional model has exactly three actors. A four-role model included an administrator persona nobody occupies, and a single `under_review` state could not express tiered authority — there was no way for the database to know whether faculty or the HOD held a document, so HOD-tier approval could not be restricted to the HOD.

#### Impact

- **Workflow is process-dependent, not a fixed chain.** Faculty approve directly when HOD involvement is not needed, or escalate when it is. Both student-originated and faculty-originated documents can take either path.
- **Students cannot reach the HOD structurally** — both escalation edges require `can_review()`, and students are not reviewers. No dedicated guard clause to forget.
- **Routing is exempt from separation of duties**, so faculty can escalate their own document. Without this, a faculty-created document would need a second faculty member and could never be approved in a single-faculty department.
- Migration `0001`–`0003` untouched; they remain history. `seed.sql` not run.

#### Verification status

| Item | Status |
| --- | --- |
| `npx tsc --noEmit` | **Passes**, zero errors |
| `npx next build` | **Passes**, 11 routes |
| Stale role/state references in `frontend/src` | **None** — grep for `staff`/`reviewer`/`approver`/`admin`/`under_review`/`is_admin`/`canApprove` is clean |
| `0004_roles_workflow.sql` applied | **NO — not executed** |
| Enum remap verified against live data | **NO** |
| Transition rules exercised at runtime | **NO** |
| Automated tests | **None written yet** |

No SQL was executed. The migration is written and reviewed but unapplied, so nothing about the live database has changed.

#### Open assumptions

Both were recommendations that went unanswered, and are implemented as stated. Either is reversible:

1. **HOD is the manager** — inherits category, department and role management, since no admin role exists.
2. **`submitted → hod_review` is permitted for faculty** — enables the lone-faculty case described above.

#### Status

- [x] Planned
- [x] Implemented — code and migration written
- [ ] Tested — migration not applied; no runtime verification
- [ ] Deployed


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
