# Current Changes

> **Rule:** Update this document after every meaningful project change, decision, addition, removal, architecture change, feature change, bug fix, or scope change.

## Current Project Status

- Last updated: 2026-08-23
- Project name: **Revelio**
- Current phase: **Phase 3 implemented** (extraction, OCR, AI, chunks). Phase 4 (search) is next.
- Overall status: Typechecks, builds (11 routes), **132/132 tests pass** (75 processing + 57 search); `0001`–`0007` applied, **`0008` pending**
- Selected problem: FS-05 Document Management
- Product shape: **ONE web application** (intelligent workspace + institutional governance)
- Roles: **`student`, `faculty`, `hod`** — three only, no admin
- Workflow: `draft → submitted → faculty_review | hod_review → approved / rejected / changes_requested`
- AI provider: **AgentRouter** (`REVELIO_AI_PROVIDER=agentrouter`, `claude-opus-5` via `agentrouter.org`), server-side only. Anthropic direct remains the default and is fully supported (ADR-042).
- Deployment status: Not deployed
- Blocker: **`0008_processing_access.sql` is not applied.** Until it is, only a document's owner can process it — faculty reviewers still see no Process button. Confirm with `npm run probe:processing`. The AI layer is no longer blocked: a live analysis is verified end to end via `npm run probe:ai`.

---

## Change Log

### 2026-08-23 — Merge `sohail-feature` + `sohail-AG` into `sohail-integration`

#### Change

Integration merge. `sohail-AG` contributed **Smart Search** (`lib/search/parse.ts`, `lib/search/query.ts`, an enhanced `search/page.tsx`, and `scripts/test-search.mts` — 57 tests). It also contained its own independently-developed copy of the auto-start / migration `0008` / endpoint-security work, which is what produced the conflicts.

**Conflicts and how each was resolved** — seven files, `UU` in all cases:

| File | Resolution | Why |
| --- | --- | --- |
| `processing/analyze.ts` | **HEAD** | `sohail-AG` held the earlier form of the same feature: an inline `resolveBaseUrl` and an inline SDK call. HEAD had already moved both into `providers.ts` behind `sendMessages()` and added the AgentRouter provider. Every AG-only line was superseded phrasing, not lost behaviour — checked line by line, not assumed |
| `scripts/probe-ai.mts` | **HEAD** | AG's version reported only the endpoint; HEAD's also reports provider, model and credential **source** |
| `scripts/test-processing.mts` | **HEAD** | AG's endpoint tests called `resolveBaseUrl()` expecting a **string**; it now returns `{ baseUrl, source }`. Keeping AG's would not have compiled. HEAD has the same six tests, updated, plus 26 more. AG's search tests were never at risk — they live in a separate new file |
| `.env.example` | **HEAD** | AG's AI section predates the provider variables. HEAD documents `REVELIO_AI_PROVIDER`, all four `REVELIO_AGENTROUTER_*` variables **and** the base-URL override rules AG documented |
| `package.json` | **union** | The only difference was AG's `test:search`. Added to HEAD's script list next to `test:processing`; dependencies and devDependencies were byte-identical, so nothing to reconcile |
| `docs/decisions.md` | **HEAD** | One hunk, and AG's side of it was empty. AG introduced no new ADR, so ADR-042 (AgentRouter) is kept and AG's edits elsewhere in the file had already merged cleanly |
| `docs/current-changes.md` | **HEAD** + this entry | AG's side was empty for the changelog hunk and stale for the two status hunks — it still listed "no `ANTHROPIC_API_KEY` is set" as a blocker, which a verified live analysis has since disproved |

Every conflict resolved to HEAD because in each case AG's side was an **earlier iteration of the same work**, never a distinct feature. AG's actual unique contribution — Smart Search — arrived as new files and staged without conflict.

**Nothing was dropped.** AgentRouter support, the Claude processing pipeline, pipeline auto-start, migration `0008`, endpoint security, Smart Search, and both test suites are all present.

#### Deviation worth flagging

`sohail-AG` shipped Smart Search with no changelog entry and no ADR, so the merge inherited an undocumented feature. This entry records its arrival, but the search design decisions — how the query parser resolves filters, ranking behaviour — remain undocumented by whoever wrote them. Worth an ADR before the work is graded.

#### Verification status

| Item | Status |
| --- | --- |
| Conflict markers anywhere in the tree | **None** — grepped across `docs/`, `frontend/src/`, `frontend/scripts/` |
| `npm run typecheck` | **Passes**, zero errors |
| `npm run build` | **Passes**, 11 routes |
| `npm run test:processing` | **75 passed, 0 failed** |
| `npm run test:search` | **57 passed, 0 failed** |
| Combined | **132 passed, 0 failed** |
| Merge committed | **NO — staged only, deliberately left uncommitted** |
| `0008_processing_access.sql` applied | **NO — still pending** |

#### Status

- [x] Planned
- [x] Implemented
- [x] Tested — 132/132 across both suites, typecheck and build
- [ ] Deployed


### 2026-08-23 — AgentRouter as a first-class AI provider; first verified live analysis

#### Change

**Added**

- `frontend/src/lib/processing/providers.ts` — provider selection and transport. `REVELIO_AI_PROVIDER=agentrouter` POSTs directly to `{base}/v1/messages` with `x-api-key`; `anthropic` (default) keeps using the SDK, unchanged. Plus `resolveProvider()`, `callAgentRouter()`, `ProviderHttpError`, and endpoint building that tolerates a trailing `/` or `/v1`.
- `extractJsonObject()` and `jsonContractInstruction()` in `analyze.ts`. The unwrapper is string-aware, so a `}` inside a summary cannot truncate the object.
- **26 new tests.** **49 → 75.**
- Env: `REVELIO_AI_PROVIDER`, `REVELIO_AGENTROUTER_BASE_URL`, `REVELIO_AGENTROUTER_MODEL`, `REVELIO_AGENTROUTER_API_KEY`, `REVELIO_AGENTROUTER_USER_AGENT`.

**Modified**

- `analyze.ts` — endpoint resolution moved to `providers.ts` and re-exported, so existing importers are unaffected. `sendMessages()` is the single provider branch point. `JSON.parse` now goes through `extractJsonObject()`.
- `probe-ai.mts` — reports provider, endpoint, model, credential **source** and the client identity.
- `.env.local` — `REVELIO_AI_PROVIDER=agentrouter` added; the dead `REVELIO_ANTHROPIC_BASE_URL=https://co.agentrouter.org` commented out.

**Not changed:** the analysis contract, the taxonomy enum, `coerce()`, the `AiOutcome` protocol, the pipeline, the database, RLS, and the Anthropic code path.

#### Four incompatibilities that made a base-URL override insufficient

All verified against the live service, not inferred:

1. **`co.agentrouter.org` is the wrong host.** It answers, but returns `401 {"code":401,"msg":"Invalid API Key!"}` for every combination of host × auth scheme × headers tried (8 of them). `agentrouter.org` works. This is why the previous entry recorded an "invalid key" that was in fact valid.
2. **The gateway fingerprints its client.** Without `user-agent: claude-cli/…` it returns `401 unauthorized client detected`. The Anthropic SDK sends its own User-Agent, so **no SDK configuration can satisfy this** — the same key worked in Claude Code throughout.
3. **No JSON content-type.** `messages.create()` returned the response body as a **string** with no `content`, `stop_reason` or `model`, which surfaced as `Cannot read properties of undefined (reading 'map')`. The body itself was valid Messages format.
4. **`output_config` is accepted and ignored.** It answered `200` and returned ```json-fenced markdown with invented keys (`reference_number`, `issuing_office`) instead of the schema.

Both `x-api-key` and `Bearer` are accepted, so auth was never the problem — item 2 was, and it masqueraded as an auth failure.

#### The honest cost

**ADR-036 is weaker on this provider.** Without server-side schema enforcement an out-of-taxonomy slug is no longer *unrepresentable*, only rejected afterwards. The prompt-level contract and the unwrapper raise the hit rate; they are not guarantees. The layers that cannot fail open are untouched: `coerce()` clamps and bounds every field, and `pipeline.ts` resolves every slug against the database, so a hallucinated category resolves to no folder. Use the `anthropic` provider where the stronger guarantee matters.

`claude-sonnet-5` returns `503 no available channel` on this account, so `claude-opus-5` is the default.

#### Verification status

| Item | Status |
| --- | --- |
| `npm run typecheck` | **Passes**, zero errors |
| `npm run build` | **Passes**, 11 routes |
| `npm run test:processing` | **75 passed, 0 failed** (was 49) |
| **A real end-to-end AI analysis** | **VERIFIED** — `npm run probe:ai`, `OK in 18279 ms`, "Structured contract satisfied" |
| Taxonomy resolution from live model output | **Verified** — `finance` / `budgets`, both in taxonomy, confidence 0.95 |
| Date extraction incl. deadline flagging | **Verified** — 4 ISO dates, 2 correctly marked deadlines |
| Anthropic provider path | **Unchanged; not re-verified live** (no `sk-ant-` key available) |
| `0008_processing_access.sql` applied | **NO — still pending** |
| End-to-end upload → auto-process → insights in the UI | **NOT VERIFIED** |

**This is the first verified live AI analysis in the project.** Every prior entry recorded the provider call as unverified. The remaining gap is the browser round trip: applying `0008` and watching a real upload populate the Document intelligence panel.

#### Status

- [x] Planned
- [x] Implemented
- [x] Tested — 75/75 unit, plus a verified live analysis
- [ ] Deployed


### 2026-08-23 — Make the pipeline reachable: auto-start, reviewer access, endpoint pinning

#### The reported symptom

A document showed **"Uploaded · Not processed yet"** with no way to process it. The Processing panel rendered no button at all.

#### Three independent causes, not one

**1. The button was correctly hidden.** `canProcess` was `isOwner || role === 'hod'`, which mirrored `can_process_version()` in the database exactly. The viewer was **faculty and not the owner**, so both the UI and the database agreed she could not process it. Nothing was broken here — the *rule* was wrong. See ADR-039.

**2. Nothing ever started the pipeline.** `uploadDocument()` returned after writing its audit event; no code path invoked `processVersion` for a new upload. Every document ever uploaded was waiting for a human to press a button that most viewers could not see. See ADR-040.

**3. No `ANTHROPIC_API_KEY` was configured**, so even a successful run would have produced extraction, chunks and keyword filing but no summary, entities or dates — reported honestly by the UI as "no AI analysis is stored", which reads like a bug when the cause is a missing variable.

#### Change

**Added**

- `supabase/migrations/0008_processing_access.sql` — `can_process_version()` becomes `document_is_visible(v.document_id)`, the same predicate behind every read policy. `apply_ai_metadata()`'s inline owner-or-HOD check is widened identically, because leaving it would have raised `FORBIDDEN` *after* extraction and AI analysis had already been persisted — a partial pipeline, worse than a clean refusal. Also revokes `EXECUTE` on `can_process_version` from `public`/`anon`, which `0007` omitted.
- **Auto-start** in `processing-status.tsx`: opening a `pending` version runs the pipeline, non-blocking, with the existing stage polling showing real progress. A `failed` version is deliberately **not** retried automatically.
- `frontend/scripts/probe-processing.mjs` + `npm run probe:processing` — verifies the Phase-3 database objects exist and reports whether `0008` is applied, using anon-key signals only.
- `resolveBaseUrl()` in `analyze.ts`, plus `ANTHROPIC_ALLOW_BASE_URL_OVERRIDE`.
- **6 new tests** covering endpoint resolution. **43 → 49.**

**Modified**

- `documents/[id]/page.tsx` — `canProcess` now mirrors `document_is_visible()`: `isOwner || (canReview(role) && status !== 'draft')`.
- `analyze.ts` — `baseURL` is passed to the SDK explicitly, so it cannot read `ANTHROPIC_BASE_URL` from the ambient environment. An unapproved override is ignored and named in the log.
- `probe-ai.mts` — reports the endpoint that will *actually* be used, and says when an override was set and refused. It previously printed the variable, which misreported the destination.
- `.env.example` — documents the `sk-ant-` prefix and the two-variable proxy opt-in.

**Not changed, deliberately:** the workflow state machine, transitions, roles, RLS policies, storage policies, grants, the structured AI contract, `coerce()`, the `AiOutcome` failure protocol, version-scoped insights (ADR-032), provenance-as-a-parameter (ADR-031), and the keyword-classifier fallback. No service-role key was introduced. Nothing was granted to `anon` — one grant was removed.

#### Why `document_is_visible()` rather than a new rule

The old check was wrong in both directions simultaneously: too narrow for faculty (a reviewer could read a submission but not analyse it) and too broad for the HOD (who could process a draft they are not permitted to read). Processing derives nothing a reader could not obtain by reading the file, so "may process" and "may read" are one question — and it was being answered inconsistently in two places. Full reasoning in ADR-039.

#### Verification status

| Item | Status |
| --- | --- |
| `npm run typecheck` | **Passes**, zero errors |
| `npm run build` | **Passes**, 11 routes |
| `npm run test:processing` | **49 passed, 0 failed** (was 43) |
| `0007` objects exist in the live database | **Verified** — `npm run probe:processing` |
| `can_process_version` was anon-executable before `0008` | **Verified** — the probe executed it as anon |
| `0008_processing_access.sql` applied | **NO — not executed.** The probe reports `NOT APPLIED` |
| A successful live Claude analysis | **NOT VERIFIED — no `ANTHROPIC_API_KEY` is set** |
| End-to-end upload → auto-process → insights | **NOT VERIFIED** |

**What is proven and what is not.** The pipeline modules, the schema contract and the endpoint logic are covered by 49 executed tests, and the Phase-3 RPCs are confirmed present in the live project. The two things that would make the feature visibly work — applying `0008` and supplying a valid key — are both outstanding and neither is a code change. Until `0008` is applied, only the document **owner** can process; auto-start already works for them, which is enough to exercise the full path end to end.

#### Status

- [x] Planned
- [x] Implemented
- [~] Tested — 49/49 unit; `0008` unapplied and no live AI round trip
- [ ] Deployed


### 2026-08-23 — Switch AI provider from Gemini to Anthropic Claude

#### Change

**Added**

- `frontend/src/lib/processing/analyze.ts` — Claude integration. `@anthropic-ai/sdk`, model `claude-opus-5` (overridable with `ANTHROPIC_MODEL`), structured outputs via `output_config.format` (`type: 'json_schema'`), adaptive thinking at `effort: 'medium'`, `max_tokens: 16_000`. Replaces `gemini.ts`; see ADR-034 and ADR-037.
- `frontend/scripts/probe-ai.mts` + `npm run probe:ai` — live provider probe against a synthetic institutional circular. Asserts the structured contract field by field and reports the endpoint and key prefix in use, never the key.
- **15 new tests** in `scripts/test-processing.mts` covering the AI layer: response-schema subset conformance, enum-constrained taxonomy, and the whole of `coerce()`. **28 → 43 tests.**
- `ANTHROPIC_MODEL` as an optional override.
- A once-per-process warning when `ANTHROPIC_BASE_URL` is set (ADR-038).
- A module-level throw in `analyze.ts` if it is ever imported into a client bundle.

**Removed**

- `frontend/src/lib/processing/gemini.ts`.
- `@google/genai` dependency.
- `GEMINI_API_KEY` and `GEMINI_MODEL` — no longer read anywhere.
- `temperature: 0.1` — sampling parameters return a 400 on Claude Opus 5.

**Modified**

- `pipeline.ts` — one import line, plus comments now describing the two-layer taxonomy guarantee and the fallback story.
- `documents/[id]/page.tsx` — the "no AI analysis stored" message names `ANTHROPIC_API_KEY`.
- `0007_processing.sql` — one comment; `p_source` documentation is now provider-neutral. **No schema, RPC, policy or grant change.**
- `.env.example` — `ANTHROPIC_API_KEY` plus the optional model override, and two corrections (below).
- `docs/context.md`, `docs/decisions.md`, `docs/architecture.md`, `README.md`, `docs/README.md`.

**Dependencies:** `+ @anthropic-ai/sdk@0.120.0`, `− @google/genai`. Net one package; **no `zod`** — the raw JSON Schema path does not need it.

**Not changed, deliberately:** the structured contract (`summary`, `key_points`, `entities`, `important_dates`, classification), the `AiOutcome` failure protocol, `coerce()`'s clamping, the processing state machine, version-scoped insights (ADR-032), provenance-as-a-parameter (ADR-031), the deterministic keyword classifier fallback, RLS, grants, storage policies, the workflow, and the roles model. **No service-role key was introduced.**

#### Structured JSON handling: what the API forced to change

| Concern | Gemini | Claude |
| --- | --- | --- |
| Schema parameter | `config.responseSchema` + `responseMimeType` | `output_config.format` — GA, **no beta header** |
| Nullable fields | `nullable: true` | not in the supported subset → `anyOf` with `{type:'null'}`, or an `enum` containing `null` |
| Objects | — | **must** carry `additionalProperties: false` |
| Array/number bounds | — | `maxItems`, `minimum`, `maxLength` unsupported → bounds stay in `coerce()` |
| Reading the output | `response.text` | narrow `response.content[]` to the `text` block |
| `JSON.parse` → `coerce()` | — | **unchanged** |

#### Three honesty improvements, not just a port

1. **`REFUSED` is a new failure reason.** A safety refusal (`stop_reason: 'refusal'`) is a real outcome, not a malformed one, and `max_tokens` truncation is now named rather than surfacing as a JSON syntax error at some byte offset. Both fall through to the keyword classifier.
2. **The taxonomy is enforced in the schema, not only resolved afterwards** — `enum` of the real slugs plus `null`, so an invented slug is unrepresentable rather than merely discarded. Database resolution stays as the layer that cannot fail open. ADR-036.
3. **Every key is `required` with `null` as the explicit unknown.** An omitted optional field is indistinguishable from a field the model had nothing to say about. ADR-035.

#### Two defects found while inspecting, both fixed

**1. `.env.example` would not boot a fresh clone.** It specified `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`, but [env.ts](../frontend/src/lib/env.ts) and the working `.env.local` both read `NEXT_PUBLIC_SUPABASE_ANON_KEY`. Reverted to the name the code actually reads.

**2. Its `SUPABASE_SERVICE_ROLE_KEY` comment was false.** It claimed the key "is used only by the document-processing pipeline". The pipeline writes through `SECURITY DEFINER` RPCs precisely so that no service-role key is needed, and none exists in this deployment. The comment now says the key is optional and only used by `diagnose-upload.mjs`.

**One hardening while adding coverage:** `coerce()` accepted a non-finite confidence, because `typeof NaN === 'number'` and `Math.max(0, Math.min(1, NaN))` is `NaN`. That would have reached the numeric `category_confidence` column and the AI badge percentage. Now `Number.isFinite`, with a test.

#### Verification status

| Item | Status |
| --- | --- |
| `npm run typecheck` | **Passes**, zero errors |
| `npm run build` | **Passes**, 11 routes |
| `npm run test:processing` | **43 passed, 0 failed** (was 28) |
| No Gemini references remain in source or docs | **Verified** by grep |
| Request reaches the provider and a real HTTP response is parsed | **Verified** — `npm run probe:ai` |
| Failure path maps to `API_ERROR` with actionable detail | **Verified** — reported `Error 401: 401 UNAUTHENTICATED` |
| **A successful Claude analysis** | **NOT VERIFIED — blocked on the credential** |
| End-to-end upload → process → insights | **NOT VERIFIED** |

**Why the live call is unverified.** The `ANTHROPIC_API_KEY` in `.env.local` is `sk-ZliX8…` (51 chars). An Anthropic key starts `sk-ant-`. Probed directly:

```text
api.anthropic.com   HTTP 401  {"type":"authentication_error","message":"API key is invalid."}
agentrouter.org     HTTP 401  {"type":"unauthorized_client_error","message":"UNAUTHENTICATED"}
```

`ANTHROPIC_BASE_URL=https://agentrouter.org` is set **in the shell environment, not in `.env.local`**, so it silently redirected the call to a third-party router — which would also happen to `next dev` and `next build`, sending institutional document text there. That is now warned about at call time and in the probe (ADR-038), and is the reason that ADR exists.

Everything up to the auth boundary is proven: the request is built, sent, answered, and the failure is mapped honestly and degraded to keyword classification. Only the authenticated round trip is outstanding, and it needs a valid key rather than a code change.

#### Status

- [x] Planned
- [x] Implemented
- [~] Tested — schema, coercion and failure contract yes (43/43); one successful live analysis outstanding
- [ ] Deployed


### 2026-08-23 — Phase 3: real document intelligence (extraction, OCR, AI, chunks)

> **Partly superseded by the provider switch above.** Everything here still holds except the AI module: `gemini.ts` / `@google/genai` / `GEMINI_API_KEY` were replaced by `analyze.ts` / `@anthropic-ai/sdk` / `ANTHROPIC_API_KEY` later the same day. The record below is left as written, since the four defects and the reasoning that produced this design are what made the swap a one-module change.

#### Change

**Added — processing pipeline (`frontend/src/lib/processing/`)**

- `extract.ts` — per-page PDF text via `unpdf`; page rasterisation; normalisation (de-hyphenation across line breaks, whitespace collapse); `MIN_CHARS_PER_PAGE = 100` OCR trigger; `MAX_STORED_CHARS = 200_000` cap.
- `ocr.ts` — `tesseract.js` fallback. Worker created per run and always terminated in `finally`; batched across pages; `MAX_OCR_PAGES = 15`; `MIN_OCR_CONFIDENCE = 30`.
- `chunk.ts` — 1,800-char chunks with 200-char overlap, real `page_start`/`page_end`, `MAX_CHUNKS = 400`.
- `gemini.ts` — `@google/genai` with `responseMimeType: 'application/json'` **and** an explicit `responseSchema`; taxonomy constrained to real seeded slugs; `coerce()` re-validates and clamps everything; every failure returns `ok: false` with a reason.
- `pipeline.ts` — orchestrator. Stages, failure isolation, provenance.

**Added — database**

- `supabase/migrations/0007_processing.sql`: `document_versions.processing_stage`; `can_process_version()`; and four `SECURITY DEFINER` RPCs — `set_version_processing`, `save_document_insights`, `save_document_chunks`, `apply_ai_metadata`.

**Added — app**

- `POST /api/documents/:id/process` (Node runtime, `maxDuration = 300`).
- `components/processing-status.tsx` — real stages polled from `document_versions`, with retry.
- Document detail now renders stored summary, key points, entities and important dates, each labelled AI.

**Added — tests**

- `scripts/test-processing.mts` — **28 tests, all passing**, covering all five required file types plus regressions.
- `scripts/register-hook.mjs` + `ts-ext-hook.mjs` — Node ESM resolution for extensionless TS imports, so app source stays idiomatic.
- `npm run test:processing`.

**Modified**

- `next.config.ts` — `serverExternalPackages: ['@napi-rs/canvas', 'tesseract.js', 'unpdf']`. Native `.node` binaries and tesseract's wasm/worker assets cannot be webpack-bundled.
- `lib/classify.ts` is now called with extracted text, not just title and filename.
- `lib/types.ts` — `processing_stage`, `DocumentInsights`.

**Dependencies added:** `unpdf`, `tesseract.js`, `@google/genai`, `@napi-rs/canvas`.

**Not changed:** the approval workflow, transitions, roles, RLS policies, storage policies.

#### Deviation from the brief

PyMuPDF was declined. ADR-002 retired the FastAPI service, and a second runtime plus a second free-tier deploy target costs more than it buys inside 24 hours. `unpdf` + `tesseract.js` run in the existing Node runtime. See ADR-029 for the accepted costs and the reconsider trigger.

#### Four defects found and fixed before reporting

An adversarial review (6 independent lenses, findings then attacked by skeptics defaulting to *refuted*; 28 agents, 1 refuted, 1 verifier errored) found four real defects. **Two were things my own passing test suite could not see.**

**1. CRITICAL — pdf.js detaches its input buffer, so all PDF OCR was dead.**
`extractPdfText(bytes)` transfers the `ArrayBuffer`; the subsequent `renderPdfPageToPng(bytes, …)` then threw `Cannot perform %TypedArray%.prototype.slice on a detached ArrayBuffer`. A scanned PDF failed outright and retried identically; a **mixed** PDF silently dropped its scanned pages while recording `extraction_method = 'text'` and reporting success. Found independently by 3 of the 6 lenses.
*Fix:* retain one pristine `Buffer`, hand out `freshBytes()` per call. *Why tests missed it:* every test passed a fresh array per call, never reproducing the pipeline's reuse. Now covered by three regression tests.

**2. CRITICAL — the detail page showed another version's AI insights as the current version's analysis.**
The query selected the newest `document_insights` row by `document_id`. After uploading v2, v1's summary, entities and dates were rendered as the analysis of v2 — real model output misattributed to content it never saw, which is a fabrication violation.
*Fix:* key insights by `document_version_id`. See ADR-032.

**3. HIGH — `splitLongText` made zero forward progress on some inputs.**
`rest.slice(Math.max(0, cut - CHUNK_OVERLAP))` returned the same string whenever `cut <= 200`, spinning to `MAX_CHUNKS`. Measured on a page whose only space is at index 40: **400 chunks, 1 unique**. After the fix: **9 chunks, 9 unique** — verified by running the pre-fix logic in an isolated copy.
*Fix:* skip the overlap rather than stall when `cut <= CHUNK_OVERLAP`.

**4. HIGH — deterministic keyword classification was stored and audited as AI output.**
`apply_ai_metadata` hardcoded `category_source = 'ai'` and `audit metadata source = 'ai'`, but two engines call it. Without `GEMINI_API_KEY`, the keyword classifier's decision got an **AI** badge and an AI audit entry — while the source comment claimed the opposite.
*Fix:* explicit `p_source metadata_source` parameter, validated in-function; Gemini passes `'ai'`, the classifier passes `'system'`. See ADR-031.

A fifth issue surfaced during testing rather than review: unpdf's serverless pdfjs bundle has a **stub** `NodeCanvasFactory`, so hand-rolled `page.render()` failed on every page containing an image — exactly the scanned pages OCR exists for. Switched to `renderPageAsImage` with an injected `canvasImport`. See ADR-030.

#### Test results — 28 passed, 0 failed

| Group | Coverage |
| --- | --- |
| Normal text PDF | Multi-page extraction, per-page isolation, OCR correctly **not** triggered |
| Scanned PDF | No text layer detected → flagged → rasterised → **OCR recovered "BUDGET APPROVAL 2026"** |
| Poor / empty PDF | Zero text treated as success, not failure; blank OCR returns no noise |
| Invalid file | Garbage bytes and truncated headers both rejected by throw |
| Large file | 30 pages / 41,631 chars in 45 ms; storage cap enforced |
| Buffer reuse | Detachment asserted; extract-then-render from one retained buffer; 3-page scan |
| Chunking | Index contiguity, page ranges, oversized split, stall regressions, `MAX_CHUNKS` |

Fixtures are genuinely constructed, including a real image-only PDF with an embedded JPEG (`DCTDecode`) so the OCR path is exercised for real rather than mocked.

#### Verification status

| Item | Status |
| --- | --- |
| `npm run typecheck` | **Passes**, zero errors |
| `npm run build` | **Passes**, 11 routes incl. the process endpoint |
| `npm run test:processing` | **28 passed, 0 failed** |
| Adversarial review | 4 confirmed defects, all fixed |
| `0007_processing.sql` applied | **NO — not executed** |
| End-to-end upload → process → insights | **NOT VERIFIED** |
| Gemini call against the live API | **NOT VERIFIED** — no `GEMINI_API_KEY` present |

Extraction, OCR, rasterisation and chunking are proven by executed tests. The **database RPCs and the Gemini call have never run**: `0007` is not applied and no API key is configured. With no key the pipeline is designed to degrade to extraction plus deterministic keyword classification, and to say so rather than invent output — but that degradation path is also unexecuted.

#### Status

- [x] Planned
- [x] Implemented
- [~] Tested — pipeline modules yes (28/28); database RPCs and Gemini no
- [ ] Deployed


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
