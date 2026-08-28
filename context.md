# Revelio Desktop — Agent Context File

> **Purpose:** persistent memory across chat sessions. If a thread crashes or context
> runs out, read THIS file first, then continue from "Next unfinished task".
> **Rule:** update this file after every completed step (tick the checkbox, add a
> progress-log entry, move the "Next unfinished task" pointer).

Last updated: 2026-08-28 (phase 2 kickoff — plan written, work starting at S1)

---

## History (phase 1, compressed)

Sessions 1–4 built the entire desktop app in `desktop/` (Electron + electron-vite +
React 19 + Tailwind v4 + better-sqlite3 FTS5): db/schema, indexer, watcher, search
parser/query, IPC/preload, 6 UI pages, App shell, 65 parser/query tests, error/empty
states, keyboard nav, electron-builder packaging (NSIS installer verified on Windows).

**Committed** as `c3bba1b` on branch `sohail-desktop` ("Add Revelio desktop app
(Electron + SQLite FTS5)", 52 files). Root `.gitignore` gained `!desktop/build/`
so the packaging icon stays tracked. User smoke-tested: folder connect + search work.

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
| `text.ts` | tokenize, light suffix stem, sentence splitting |
| `rules.ts` | data: English stopwords, document-type keyword rules, deadline cue words |
| `keywords.ts` | TF-scored unigrams + bigrams, proper-noun & filename boost → 3–10 tags |
| `summarize.ts` | extractive summary: sentence scoring (term freq, position, title overlap, length penalty) → top 2–4 in document order; key_points = next best sentences |
| `categorize.ts` | document_type via weighted keyword rules (Invoice, Receipt, Resume, Contract, Research Paper, Report, Letter, Memo, Form, Notes…); category = reuse existing library category when keywords match its name/members' keywords, else coin Title Case from top bigram; heuristic confidence 0..1 |
| `entities.ts` | regex NER-lite: emails, URLs, phones, money amounts, proper-noun runs; multi-format date extraction → ISO, document_date from early text, is_deadline from nearby cue words |
| `index.ts` | `analyzeLocally(input): AiAnalysis` orchestrator |

Why heuristics and not a bundled ML model: zero download, instant, deterministic,
offline on any machine, no binary bloat, honest (extractive, not generative).
An optional Ollama (local LLM, still keyless) enhancement could come later — it is
explicitly OUT of scope for phase 2.

Category stability (what the AI prompt's "existing categories" hint did): the
categorizer receives existing category names + representative keywords per category
from the DB, and reuses a category when the document's keywords overlap it.

## Step roadmap (small steps, one at a time)

### Phase 1 of plan — the engine (pure code + tests, no app wiring yet)
- [ ] **S1** `local/text.ts` + `local/rules.ts` — tokenizing, stopwords, stem, sentences, rule data
- [ ] **S2** `local/keywords.ts` — term scoring + keyword extraction
- [ ] **S3** `local/summarize.ts` — extractive summary + key points
- [ ] **S4** `local/categorize.ts` — document type + category + confidence
- [ ] **S5** `local/entities.ts` — entities + dates
- [ ] **S6** `local/index.ts` orchestrator + `scripts/test-analyze.mts` test suite + `test:analyze` npm script — all green

### Phase 2 of plan — rewiring the app
- [ ] **S7** rewrite `processing/analyze.ts` → calls local engine; keep `AiOutcome` shape; reasons shrink to `NO_TEXT | ANALYSIS_ERROR`; model = `revelio-local`
- [ ] **S8** delete `processing/providers.ts`; remove `@anthropic-ai/sdk` from package.json; refresh lockfile
- [ ] **S9** settings: drop `provider`/`apiKey`/`model` from `AppSettings` (shared/types.ts), `DEFAULT_SETTINGS`, delete `buildAiEnv`; on load, strip stale key material from existing `settings.json` (privacy)
- [ ] **S10** indexer: remove key pre-check + env plumbing; on startup, re-queue files whose `ai_error = 'NO_API_KEY'` for local re-analysis (heals the user's existing library)
- [ ] **S11** db: add `categoryKeywordProfiles()` (top keywords per existing category) for category-reuse matching; wire through `runAnalysis`
- [ ] **S12** renderer: Settings page (remove provider/key/model/Verify rows, new "runs entirely on this machine" copy), DocumentDetail (drop "Add an API key…" message, local badge copy), Categories page wording
- [ ] **S13** `desktop/.env.example`: remove AI vars (file becomes OCR/indexing-only or is deleted)

### Phase 3 of plan — verify + ship
- [ ] **S14** typecheck + `test:search` + `test:analyze` + build — all green
- [ ] **S15** repackage `npm run dist:win`; verify artifacts again
- [ ] **S16** update `docs/desktop-plan.md` AI-keys row + commit (only when user asks)

## Progress log

- 2026-08-28 Committed phase 1 (`c3bba1b`). Wrote this plan. Starting S1.

## Verification status

- `npm run typecheck` ✅ (as of phase-1 commit)
- `npm run test:search` ✅ 65/65
- `npm run build` ✅
- `npm run dist:win` ✅ `release/Revelio Setup 0.1.0.exe`

## Next unfinished task (start here in a new session)

**S1** — create `desktop/src/main/processing/local/text.ts` and `local/rules.ts`.
Then continue S2…S16 in order, ticking boxes and logging progress above.

## Key facts / gotchas

- Repo root = `E:\sohail\code\Build-a-thon\Revelio`; tool paths prefix `Revelio/`.
  Shell `cd Revelio` lands in the repo root (git bash on Windows).
- Git: branch `sohail-desktop`; phase 1 committed as `c3bba1b`; phase 2 uncommitted.
- NEVER read image files (icons, screenshots) with the model — text-only model.
  Verify images programmatically (PNG header bytes, file size) if needed.
- Node v22.20.0; tests run with `node --experimental-strip-types` + node:assert/strict,
  no test framework. Runtime relative imports in Node-loaded modules need explicit
  `.ts` extensions (`allowImportingTsExtensions` is on in tsconfig.node.json).
- The local engine modules must stay dependency-free and DB-free so plain Node tests
  can import them directly. Category profiles are PASSED IN by the caller.
- `AiAnalysis`/`AiOutcome` live in `processing/analyze.ts`; DB write = `saveAnalysis`
  in `db/db.ts`; existing-category list = `listExistingCategories()`.
- IPC contract = `desktop/src/shared/types.ts`. `AppSettings` currently has
  provider/apiKey/model — removed in S9. Settings file: `userData/settings.json`,
  loaded with `{...DEFAULT_SETTINGS, ...parsed}` (unknown keys tolerated, but S9
  actively strips key material and rewrites the file).
- Indexer queue concurrency = 2; local analysis is milliseconds, so no throttling
  needed. `ai_status` flow (pending → ok/skipped/failed) stays.
- Desktop commands (from `desktop/`): `npm run typecheck`, `npm run build`,
  `npm run test:search`, `npm run dev` (GUI), `npm run dist:win`.
- Packaging: electron-builder 26.15.3, Electron 37.10.3, NSIS x64, unsigned.
  `release/` gitignored. Icon 512×512 at `desktop/build/icon.png`.
- User instructions: keep this file updated after EVERY step; plan in small steps
  and achieve them one by one; don't inspect images.
