# FS-05 Document Intelligence Hackathon Workspace

## Current state
Architecture and MVP scope finalized.

## Source-of-truth files
- `context.md`
- `current-changes.md`

## Supporting design files
- `architecture.md`
- `database.md`
- `api.md`
- `testing.md`
- `decisions.md`
- `pitch.md`

## Implementation order
1. Supabase project, migrations and RLS
2. Auth
3. Private storage
4. document/version schema
5. FastAPI skeleton
6. PDF extraction
7. OCR
8. chunking + FTS
9. search
10. workflow/audit/versioning
11. Claude summary/metadata
12. grounded Q&A
13. frontend polish
14. deployment
15. full demo test

## Non-negotiable engineering rules
- never expose service-role key in browser
- validate workflow transitions on server
- enforce authorization on search
- ground Q&A in retrieved text
- preserve previous versions
- append audit events
- do not add Elasticsearch before core MVP works
