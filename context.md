# Revelio Desktop — Agent Context File

> **Purpose:** persistent memory across chat sessions. If a thread crashes or context
> runs out, read THIS file first, then continue from "Next unfinished task".
> **Rule:** update this file after every completed step (tick the checkbox, add a
> progress-log entry, move the "Next unfinished task" pointer).

Last updated: 2026-08-28 (phase 2 COMPLETE — S1–S16 done; commit = "Replace cloud AI with on-device analysis engine" on sohail-desktop, right after bfacbce)

---

## History (phase 1, compressed)

Sessions 1–4 built the entire desktop app in `desktop/` (Electron + electron-vite +
React 19 + Tailwind v4 + better-sqlite3 FTS5): db/schema, indexer, watcher, search
parser/query, IPC/preload, 6 UI pages, App shell, 65 parser/query tests, error/empty
states, keyboard nav, electron-builder packaging (NSIS installer verified on Windows).

**Committed** as `c3bba1b` on branch `sohail-desktop` ("Add Revelio desktop app
(Electron + SQLite FTS5)", 52 files). Root `.gitignore` gained `!desktop/build/`
so the packaging icon stays tracked. **User smoke-tested the installer build:
connecting a folder + search work nicely.** (AI analysis was skipped on their
library — no API key — which phase 2 heals automatically, see S10.)

## Phase 2 mission (CURRENT)

**Goal: zero API keys. 100% on-device document intelligence.**

The desktop app currently sends document text to Anthropic / AgentRouter for
analysis (summary, keywords, category, entities, dates). That requires an API key
and sends private files to a third party. Phase 2 replaces the model call with a
**built-in, deterministic, offline analysis engine** written in pure TypeScript.

Definition of done:
- No API-key field anywhere (settings UI, settings store, env files, code).
- No network call in the analysis path; no `@anthropic-ai/sdk` dependency.
- Every document with extractable text gets `ai_status: 'ok'` with local insights.
- Libraries indexed during the key era are re-analyzed locally automatically.
- typecheck + all tests + build + packaging all green.
- Web app in `frontend/` stays UNTOUCHED (it keeps its own Anthropic integration).

## Design: built-in local analysis engine

Keep the existing `AiAnalysis` contract (document_type, category, keywords, summary,
key_points, entities, important_dates, document_date, confidence) so DB schema, IPC,
and UI need no structural change. `ai_model` is recorded as `revelio-local`.

New pure modules under `desktop/src/main/processing/local/` (no Electron/DB imports —
plain Node-testable with `--experimental-strip-types`):

| Module | Responsibility |
| --- | --- |
| `text.ts` | tokenize (Token = term/raw/stem/index), light suffix stem, sentence splitting |
| `rules.ts` | data: English stopwords, noise terms, document-type keyword rules, deadline cues, doc-date labels, month names |
| `keywords.ts` | TF-scored unigrams + bigrams, proper-noun & filename/title boost → 3–10 tags; exports `ScoredTerm` |
| `summarize.ts` | extractive summary: sentence scoring (term freq, position, title overlap, length penalty) → top 2–4 in document order; key_points = next best sentences |
| `categorize.ts` | document_type via weighted keyword rules; category = reuse existing library category when keywords overlap its name/members' keywords, else coin Title Case from top bigram; heuristic confidence 0..1 |
| `entities.ts` | regex NER-lite: emails, URLs, phones, money, proper-noun runs; multi-format date extraction → ISO, document_date from labelled/early dates, is_deadline from nearby cue words |
| `index.ts` | `analyzeLocally(input): LocalAnalysis` orchestrator + `LOCAL_MODEL_NAME = 'revelio-local'` |

Why heuristics and not a bundled ML model: zero download, instant, deterministic,
offline on any machine, no binary bloat, honest (extractive, not generative).
An optional Ollama (local LLM, still keyless) enhancement could come later — it is
explicitly OUT of scope for phase 2.

Category stability (what the AI prompt's "existing categories" hint did): the
categorizer receives existing category names + representative keywords per category
from the DB, and reuses a category when the document's keywords overlap it.

## Step roadmap (small steps, one at a time)

### Phase 1 of plan — the engine (pure code + tests, no app wiring yet)
- [x] **S1** `local/text.ts` + `local/rules.ts` — DONE (splitSentences infinite loop found & fixed, see RESOLVED BLOCKER)
- [x] **S2** `local/keywords.ts` — WRITTEN (untested until blocker cleared)
- [x] **S3** `local/summarize.ts` — WRITTEN (untested)
- [x] **S4** `local/categorize.ts` — WRITTEN (untested)
- [x] **S5** `local/entities.ts` — WRITTEN (untested)
- [x] **S6** `local/index.ts` orchestrator + `scripts/test-analyze.mts` (~45 tests) + `test:analyze` npm script — ✅ 45/45 green

### Phase 2 of plan — rewiring the app (DONE)
- [x] **S7** `processing/analyze.ts` rewritten → calls local engine; `AiOutcome` shape kept; reasons = `NO_TEXT | ANALYSIS_ERROR`; model = `LOCAL_MODEL_NAME`
- [x] **S8** `processing/providers.ts` deleted; `@anthropic-ai/sdk` removed from package.json; lockfile refreshed (`npm install --ignore-scripts`, 7 packages removed)
- [x] **S9** settings: `provider`/`apiKey`/`model` dropped from `AppSettings` + `DEFAULT_SETTINGS`; `buildAiEnv` deleted; `load()` strips retired fields from existing `settings.json` and rewrites it (privacy)
- [x] **S10** indexer: key pre-check + env plumbing removed; `requeueKeylessAnalyses()` added and called at startup re-queues `ai_error = 'NO_API_KEY'` files for local re-analysis
- [x] **S11** db: `categoryKeywordProfiles()` added (json_each over stored keywords, top 8 per category, 40 categories) + `listKeylessSkippedIds()`; wired through `runAnalysis`
- [x] **S12** renderer: Settings page (provider/key/model/Verify rows gone, on-device copy), DocumentDetail ("analyzed locally" badge, no API-key message, per-reason hints), Categories page wording
- [x] **S13** `desktop/.env.example` DELETED (no user-configurable env vars remain; only electron-vite's own ELECTRON_RENDERER_URL is read)

### Phase 3 of plan — verify + ship (DONE except S16)
- [x] **S14** typecheck + `test:search` 65/65 + `test:analyze` 45/45 + build — all green; built `out/` grepped: zero anthropic/apiKey/agentrouter refs
- [x] **S15** repackaged `npm run dist:win` → `release/Revelio Setup 0.1.0.exe` (~125 MB). app.asar verified: 0 anthropic refs, revelio-local present, unpacked modules = @napi-rs, better-sqlite3, jszip, tesseract.js(-core) only. ⚠ electron-builder's WASM PNG→ICO converter fails on this machine ("WebAssembly.Memory(): could not allocate memory") — worked around with `scripts/make-ico.mts` which prebuilds `build/icon.ico` (256/48/32/16 px PNG-in-ICO via @napi-rs/canvas); electron-builder uses it and skips the conversion
- [x] **S16** `docs/desktop-plan.md` AI row updated; all phase-2 work committed on
  `sohail-desktop` as "Replace cloud AI with on-device analysis engine" (25 files;
  find it with `git log --oneline` — it sits directly on top of `bfacbce`)

## ✅ RESOLVED BLOCKER — splitSentences infinite loop (fixed 2026-08-28)

Root cause was NOT the main loop or the flush() closure (the hand-trace of the
loop was right). The hang was in the helper `isAbbreviationDot()` in
`local/text.ts`: its "walk back over the preceding word" loop did `j++` instead
of `j--`, so it walked FORWARD off the end of the string; `text[j]` became
`undefined`, and `RegExp.test(undefined)` coerces to the string "undefined"
which matches `/[A-Za-z.]/` — hence an infinite loop. One-character fix (`j--`).

Also fixed while getting the suite green: added `'before'` to DEADLINE_CUES in
`rules.ts` (invoice fixture: "remit payment ... before 2024-05-30"). Deliberately
did NOT add 'by' — "Issued on 2024-04-30 by the billing department" would
false-positive as a deadline.

`npm run test:analyze` now passes 45/45; `test:search` still 65/65.
Throwaway `scripts/tmp-probe.mts` deleted.

## Progress log

- 2026-08-28 (session 5) Committed phase 1 (`c3bba1b`). Wrote phase-2 plan.
  Wrote S1–S6 engine code + test suite + `test:analyze` script. Fixed stemWord
  4-char plural bug. Hit splitSentences hang (blocker above). User ended session
  here; S7–S16 untouched.
- 2026-08-28 (session 6) Fixed splitSentences blocker (j++ → j-- in
  isAbbreviationDot), added 'before' deadline cue; test:analyze 45/45 green,
  test:search 65/65. Deleted tmp-probe.mts. Starting S7.
- 2026-08-28 (session 6 cont.) Completed S7–S15 in one pass: analyze.ts now
  wraps the local engine; providers.ts + @anthropic-ai/sdk + .env.example gone;
  settings/types scrubbed of key material (with on-load cleanup of old
  settings.json); indexer heals NO_API_KEY libraries at startup; db gained
  categoryKeywordProfiles(); renderer copy updated. Typecheck, 110 tests, build
  all green; out/ bundle verified clean. dist:win initially failed on the WASM
  icon converter (env issue) — fixed via scripts/make-ico.mts → build/icon.ico;
  installer rebuilt and app.asar verified anthropic-free. Note: user committed a
  stale context.md as bfacbce ("desktop") mid-session; the working-tree copy is
  the current one.
- 2026-08-28 (session 7) S15 finished: make-ico.mts → build/icon.ico unblocked
  dist:win (WASM converter env crash); installer rebuilt + asar verified. S16:
  docs/desktop-plan.md AI row rewritten. Final verification pass green.
  Committed ALL phase-2 work on sohail-desktop (user-approved); the commit
  sits directly on top of bfacbce. PHASE 2 COMPLETE.

## Verification status

- `npm run typecheck` ✅ (after S7–S13 rewiring)
- `npm run test:search` ✅ 65/65
- `npm run test:analyze` ✅ 45/45
- `npm run build` ✅ — `out/` grepped clean of anthropic/apiKey/agentrouter
- `npm run dist:win` ✅ `release/Revelio Setup 0.1.0.exe` (~125 MB); app.asar
  verified: 0 anthropic refs, revelio-local bundled

## Next unfinished task (start here in a new session)

**Phase 2 is COMPLETE, committed and PUSHED** ("Replace cloud AI with
on-device analysis engine", on `sohail-desktop` directly after `bfacbce`).
No open tasks. Possible next work (not yet requested): user smoke-test of the
new installer (existing library should heal from NO_API_KEY → ok on first
launch), or the deferred Ollama enhancement (explicitly out of phase-2 scope).

## Key facts / gotchas

- Repo root = `E:\sohail\code\Build-a-thon\Revelio`; tool paths prefix `Revelio/`.
  Shell `cd Revelio` lands in the repo root (git bash on Windows).
- Git: branch `sohail-desktop` (pushed to origin); phase 1 = `c3bba1b`;
  bfacbce was a stale-context.md commit made mid-phase-2; phase 2 = the commit
  directly on top of bfacbce ("Replace cloud AI with on-device analysis
  engine").
- NEVER read image files (icons, screenshots) with the model — text-only model.
  Verify images programmatically (PNG header bytes, file size) if needed.
- **Always run terminal commands with `timeout_ms`** — a hang once cost a session;
  the user gets impatient when commands sit still ("u got stuck… continue working").
  Prefer several fast targeted commands over one long one.
- Node v22.20.0; tests run with `node --experimental-strip-types` + node:assert/strict,
  no test framework. Runtime relative imports in Node-loaded modules need explicit
  `.ts` extensions (`allowImportingTsExtensions` is on in tsconfig.node.json).
- The local engine modules must stay dependency-free and DB-free so plain Node tests
  can import them directly. Category profiles are PASSED IN by the caller.
- Phase-2 removal map (ALL DONE — do not re-remove): `processing/providers.ts`
  deleted, `processing/analyze.ts` rewritten around `local/`,
  `indexing/indexer.ts` key pre-check gone, `settings.ts` + `shared/types.ts`
  scrubbed of provider/apiKey/model, renderer Settings/DocumentDetail/Categories
  copy updated, `desktop/.env.example` deleted, `@anthropic-ai/sdk` removed.
  `frontend/` has its own Anthropic integration — still UNTOUCHED.
- DB write = `saveAnalysis` in `db/db.ts` (accepts ai_status pending/ok/skipped/failed);
  existing-category list = `listExistingCategories()`.
- Indexer queue concurrency = 2; local analysis is milliseconds, no throttling needed.
- Desktop commands (from `desktop/`): `npm run typecheck`, `npm run build`,
  `npm run test:search`, `npm run test:analyze`, `npm run dev` (GUI), `npm run dist:win`.
- Packaging: electron-builder 26.15.3, Electron 37.10.3, NSIS x64, unsigned.
  `release/` gitignored. Icon 512×512 at `desktop/build/icon.png`; prebuilt
  `desktop/build/icon.ico` (from `scripts/make-ico.mts`) is REQUIRED for
  dist:win on this machine because electron-builder's WASM PNG→ICO converter
  crashes with a WebAssembly.Memory allocation error.
- User instructions: keep this file updated after EVERY step; plan in small steps
  and achieve them one by one; don't inspect images; commit only when asked.
