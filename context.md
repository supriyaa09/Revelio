# Revelio Desktop — Agent Context File

> **Purpose:** persistent memory across chat sessions. If a thread crashes or context
> runs out, read THIS file first, then continue from "Next unfinished task".
> **Rule:** update this file after every completed sub-task.

Last updated: 2026-08-28 (session 4 — step 12 packaging DONE; installer built; only manual smoke test + commit remain)

---

## The mission

Turn Revelio from a Next.js + Supabase institutional document system into a
**desktop app** (Electron + electron-vite + React + SQLite FTS5) that indexes and
AI-searches the user's local files. Plan: `docs/desktop-plan.md`. Branch: `sohail-desktop`.
The web app in `frontend/` stays untouched. All new code lives in `desktop/`.

## Roadmap status (from docs/desktop-plan.md §6)

| Step | Scope | Status |
| --- | --- | --- |
| 1 | Scaffold desktop/ (electron-vite, TS, Tailwind v4, React 19) | ✅ done |
| 2 | SQLite schema + db module + settings store | ✅ done |
| 3 | Port processing pipeline (extract/ocr/chunk/providers) | ✅ done |
| 4 | Adapt AI analysis to free-form categories | ✅ done |
| 5 | Indexer: walk → hash → extract → chunk → insert, queue, progress | ✅ done |
| 6 | Watcher (chokidar) | ✅ done |
| 7 | Search parser + FTS5 query builder + bm25 | ✅ done |
| 8 | IPC bridge + preload | ✅ done |
| 9 | UI pages: Dashboard, Search, DocumentDetail, Categories, Folders, Settings | ✅ done |
| 9b | **App.tsx shell (sidebar + routing)** | ✅ done THIS session |
| 10 | Parser/query tests (`scripts/test-search.mts`) | ✅ done THIS session (65 tests) |
| 11 | Polish: empty states, error states, keyboard nav | ✅ done |
| 12 | Packaging (electron-builder) | ✅ done THIS session |

## What session 1 did (recovered from repo state; branch untracked, nothing committed yet)

- Built the entire `desktop/` tree: main process (db, indexing, processing, search,
  settings, ipc), preload bridge, shared types, and all 6 renderer pages.
- Last acts of session 1: fixed DocumentDetail back-navigation to use the `from`
  view prop; wrote Categories, Folders, Settings pages. Crashed before writing App.tsx.

## What session 2 (this one) did, in order

1. Inspected repo, found `desktop/src/renderer/src/App.tsx` missing (`main.tsx`
   imports it → app couldn't build). Also `desktop/scripts/` empty.
2. **Created `desktop/src/renderer/src/App.tsx`** — shell with:
   - state-based routing (`View` from `lib/nav.ts`), renders Sidebar + active page
   - subscribes `window.api.onEvent`: `index:progress` → progress state,
     `index:finished` → clear progress + bump dataVersion, `files:changed` → bump
   - `dataVersion` counter passed to Dashboard/Categories/Folders for refetch
   - dark mode: `.dark` class on `<html>`, persisted in localStorage key `revelio-dark`
   - ⌘K/Ctrl+K → navigate to search + focus input (preserves in-progress query)
   - SearchPage keyed by `view.query ?? ''` so navigating with a new query remounts
3. `npm install` in `desktop/` — succeeded; electron-rebuild rebuilt better-sqlite3
   for Electron ABI; verified `electron.exe` + `better_sqlite3.node` present.
   better-sqlite3 ALSO still loads in plain Node v22.20 (needed for tests).
4. Fixed 5 pre-existing typecheck errors (main process):
   - `db/db.ts`: exported `FileRow` interface; widened `saveAnalysis` ai_status
     param to include `'pending'` (indexer marks pending before AI call)
   - `search/query.ts`: `ResultRow` now `extends FileRow` (+ score/snip/body)
     instead of an index-signature bag → `mapFileRow(row)` typechecks
   - `processing/analyze.ts` + `processing/providers.ts`: replaced
     `typeof window !== 'undefined'` guard (TS2304 under Node types) with
     `'window' in globalThis`; updated providers.ts message to Electron terminology
5. ✅ `npm run typecheck` — clean (both tsconfig.node.json and tsconfig.web.json)
6. ✅ `npm run build` (electron-vite build) — succeeds: out/main/index.js 68.6 kB,
   out/preload/index.mjs 1.4 kB, out/renderer bundle 633 kB + 22 kB css
7. Prep for tests: added explicit `.ts` extensions to runtime relative imports so
   plain Node (`node --experimental-strip-types`) can load the modules:
   - `search/query.ts`: `../db/db.ts`, `./parse.ts`, `../indexing/walk.ts`
   - `db/db.ts`: `./schema.ts`
   - Added `"allowImportingTsExtensions": true` to `desktop/tsconfig.node.json`
     (required by tsc for `.ts` extension imports; typecheck passes `--noEmit`)
8. **Wrote `desktop/scripts/test-search.mts`** — 65 tests, 14 sections: basic
   parsing, type:/category:/in:/modified:/after:/before:, #tags, phrases,
   combined pitch queries, isValidIsoDate, resolveModified, splitTerms,
   describeFilters, buildFtsMatch. Same harness as frontend (node:assert/strict).
9. **Fixed real parser bug the tests exposed** (`search/parse.ts`): stage-1
   phrase extraction was swallowing quoted filter values (`category:"Research
   Papers"` → phrase 'Research Papers', filter lost). This broke the UI's own
   generated queries (Categories page, Dashboard chips, Search facets all emit
   `category:"Name"`). Fix: phrase regex now uses negative lookbehind
   `(?<!\b(?:type|category|in):)` to skip quotes glued to filter prefixes, and
   `""` empty-quote pairs are stripped as noise (`[^"]*` instead of `[^"]+`).
10. ✅ `npm run test:search` → 65 passed, 0 failed
11. ✅ `npm run typecheck` clean again; ✅ `npm run build` clean again
12. Editor-diagnostic cleanup: added `"noEmit": true` to `tsconfig.node.json`
    (satisfies the allowImportingTsExtensions requirement in the editor too;
    CLI typecheck still passes because it overrides `--composite false`).
    NOTE: two editor diagnostics remain that are FALSE POSITIVES (verified):
    - `desktop/src/renderer/src/main.tsx` "Cannot find module './App'" — stale
      editor TS-server cache / solution-style root tsconfig confusion; App.tsx
      exists, CLI tsc passes, and the production build bundles it fine.
    - `frontend/scripts/test-search.mts` node-types errors — pre-existing web-app
      file, untouched by us, not our problem.

## What session 3 did, in order

1. **CRITICAL bug fix**: `main/index.ts` loaded preload from `../preload/index.js`
   but electron-vite emits `out/preload/index.mjs` (ESM preload, sandbox:false).
   The mismatch would silently break `window.api` in dev AND packaged builds.
   Fixed → `index.mjs`.
2. **Step 11 polish — error states**:
   - New `renderer/src/lib/errors.ts` → `errorMessage(e: unknown): string`
   - New `ErrorState` component in `components/ui.tsx` (icon, message, Try again)
   - All IPC loads now catch + render ErrorState with retry: Dashboard, Categories,
     Settings (reloadKey pattern), Folders (existing error banner), DocumentDetail
     (ErrorState on initial fail + "Could not refresh" banner on refetch fail),
     Search (inline "Search failed" card, resets searching flag)
3. **Step 11 polish — keyboard**: Esc on DocumentDetail navigates back to `from`;
   back button shows `<Kbd>Esc</Kbd>` hint. (Search already had ↑/↓/Enter/Esc; App has ⌘K.)
4. ✅ typecheck + build + 65/65 tests all green after the changes.

## What session 4 did, in order

> Previous thread crashed trying to visually inspect an image (icon). Rule for
> this repo: NEVER read image files with the model — check them programmatically
> (e.g. PNG header bytes via node one-liner).

1. Recovered state from this file. Verified step-12 prep was already in place:
   electron-builder in devDependencies, full `build` block in package.json,
   `dist`/`dist:win`/`dist:dir` scripts, `resources/eng.traineddata` (5.2 MB).
2. Verified `build/icon.png` WITHOUT reading it as an image: node one-liner on
   the PNG header → valid PNG magic, 512×512 (meets electron-builder's ≥256px).
3. ✅ typecheck clean + 65/65 tests green before packaging.
4. ✅ `npm run dist:win` — SUCCESS. Outputs in `desktop/release/` (gitignored):
   - `Revelio Setup 0.1.0.exe` (~126 MB NSIS installer, oneClick=false)
   - `win-unpacked/` portable dir with `Revelio.exe`
   - electron-builder rebuilt better-sqlite3 for Electron 37.10.3 via @electron/rebuild
5. Verified packaged artifacts:
   - `release/win-unpacked/resources/resources/eng.traineddata` present (matches
     main/index.ts resolveOcrLangDir `process.resourcesPath/resources` lookup)
   - `app.asar.unpacked/node_modules/` contains better-sqlite3, tesseract.js,
     tesseract.js-core, @napi-rs (asarUnpack worked)
6. Fixed electron-builder warning "author is missed in the package.json" →
   added `"author": "Shaik Sohail Ahmed"`; re-ran `dist:win` → clean rebuild,
   warning gone. Remaining advisory ("use electron-builder install-app-deps
   instead of @electron/rebuild") intentionally ignored — current postinstall
   works for both dev and packaging.
7. ✅ Re-ran `npm run test:search` AFTER packaging: 65/65 — better-sqlite3
   still loads in plain Node v22 despite the Electron-ABI rebuild.

## Verification status (all run & passing as of last update)

- `npm run typecheck` ✅ clean (node + web)
- `npm run build` ✅ (renderer bundle now 637 kB, 1683 modules)
- `npm run test:search` ✅ 65/65 (re-verified after packaging rebuild)
- `npm run dist:win` ✅ produces `release/Revelio Setup 0.1.0.exe` + `win-unpacked/`

## Next unfinished task (start here in a new session)

Step 12 is DONE. Only two items remain, both gated on the user:

1. **Manual smoke test** (needs a GUI — user must do it): either run
   `release/win-unpacked/Revelio.exe` directly, install the Setup exe, or
   `cd desktop && npm run dev`. Check: Dashboard empty state → connect a
   folder → indexing progress in sidebar → search → open a document →
   Esc/back returns with query intact → ⌘K focuses search → dark-mode
   toggle persists. OCR path needs an image/PDF with text in a connected folder.
2. **Commit everything** — `desktop/`, `docs/desktop-plan.md`, `context.md`
   are UNTRACKED on branch `sohail-desktop`. Only if user asks.
   `desktop/release/` is gitignored (installer stays local).

## Key facts / gotchas (verified)

- Repo root = `E:\sohail\code\Build-a-thon\Revelio`; project tool paths prefix `Revelio/`.
  Shell `cd Revelio` lands in the repo root (git bash on Windows).
- Git: branch `sohail-desktop`; `desktop/`, `docs/desktop-plan.md` untracked; nothing committed by us.
- Node v22.20.0; type stripping available; plain Node can load better-sqlite3 here.
- Dark mode: Tailwind v4 `@custom-variant dark (&:where(.dark, .dark *))` in
  `desktop/src/renderer/src/styles.css`; tokens under `:root` and `.dark`.
- Page component signatures (for App wiring, already done):
  - `Dashboard({ dataVersion, progress, onNavigate })`
  - `SearchPage({ initialQuery?, onNavigate, inputRef })`
  - `DocumentDetail({ id, from, onNavigate })`
  - `Categories({ dataVersion, onNavigate })`
  - `Folders({ dataVersion })`
  - `SettingsPage()` no props
  - `Sidebar({ view, onNavigate, progress, dark, onToggleDark })`
- IPC contract = `desktop/src/shared/types.ts` (RevelioApi, MainEvent, IndexProgress…).
- Events main→renderer on channel `revelio:event`; types: index:progress / index:finished / files:changed.
- Frontend (web) test culture: `node --experimental-strip-types` + node:assert/strict, no test framework.
- Desktop commands (all from `desktop/`): `npm run typecheck`, `npm run build`,
  `npm run test:search`, `npm run dev` (GUI). All green as of last update.
- Parser quirk kept as-is: an unresolvable `modified:xyz` token is consumed from
  the text but sets no filter (documented by test 'unresolvable modified: value').
- User instruction: keep this file updated after EVERY completed sub-task.
- NEVER read image files (icons, screenshots) with the model — text-only model.
  Verify images programmatically (PNG header bytes, file size) if needed.
- Packaging facts: electron-builder 26.15.3, Electron 37.10.3, NSIS target x64.
  Icon auto-converted to .ico (`release/.icon-ico/`). Unsigned build (no cert).
  `release/` dir ≈ 400 MB total (installer + win-unpacked), gitignored.
