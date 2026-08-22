# Pitch and Demo Plan

## Positioning

**An AI-Powered Document Workflow & Knowledge Organization Platform — two connected applications that turn the documents you already have into organized, searchable knowledge, and give institutions a governed approval trail.**

## Primary Product Differentiator

**Intelligent Metadata-Driven Search.**

The success of the product depends more on search quality than on OCR quality. Search is the hero feature — in the architecture, in the build order, and in the demo.

## The one-sentence hook

> Most document tools make you upload your files somewhere new. We index them where they already are — and then let you actually find them.

## The two applications

| | Web platform | Desktop application |
| --- | --- | --- |
| For | Universities, colleges, government departments, NGOs, companies | Students, researchers, professionals, small teams |
| Job | Governed document workflow — review, approve, audit | Intelligent organization and search |
| Files | Uploaded into private platform storage | **Stay on your machine** |
| Answers | The FS-05 requirement | Why anyone would choose us |

## The architectural idea worth stating out loud

**Files stay where they live. We own only the derived intelligence — metadata, indexes, categories, similarity.**

This is why the desktop app needs no migration, works offline, and why future Google Drive support is the same architecture rather than a rewrite: authenticate, read metadata, index in place, never move the files.

## Value loop

```text
Index in place -> Extract metadata -> Categorize -> Search -> Discover -> (institutional) Review -> Approve -> Audit
```

---

## 90-second demo

The desktop app is the hero. Lead with it.

**Desktop — 55 seconds**

1. **Open the app with Wi-Fi visibly off.** "This works entirely offline."
2. Select `Research` and `Policies`. Point out that `Downloads` and `Temporary Files` are excluded by default. "You choose what gets indexed. Nothing else is ever read."
3. Indexing completes; the library appears organized by category.
4. **Search a phrase that exists only deep inside a document** — not in any file name. "That's content search, over files that never left this laptop."
5. **Narrow scope to `Research` only.** Results change live. "Folder-scoped search — because 'somewhere in my documents' isn't an answer."
6. **"Find files similar to this one."** Show the grouping, and the stated reason: shared department and keywords. "Explainable, not a black box."
7. Show organization recommendations. "It suggests. It never moves your files."

**Web — 25 seconds**

8. Sign in. Upload a policy PDF, categorize it, submit for review.
9. **Try to approve your own document — get refused.** "Separation of duties, enforced in the database, not the UI."
10. Switch role, approve, then show the version history and audit trail. "Every action attributable, and the audit log cannot be edited by anyone."

**Close — 10 seconds**

11. Turn Wi-Fi back on; metadata syncs. "Same account across both apps. Metadata syncs. Your files don't — unless you ask them to."

## If something breaks — fallback ladder

Rehearse this. In order of preference:

1. Full demo as above.
2. Network stays off entirely — the desktop demo is *stronger* offline anyway, and sync becomes a spoken claim.
3. Pre-indexed corpus loaded from a fixture, skipping the live index walk.
4. Web app only, leading with workflow/audit for FS-05 compliance.
5. Golden-query-set test output as evidence that search works, if the UI fails.

Never demo something that has not been rehearsed against the fallback.

---

## Judge-facing differentiators

- **Satisfies every required FS-05 capability** — upload, categorize, metadata, OCR text extraction, full-text search and filtering, role-based review/approval, versioning, audit history.
- **Search is genuinely the product**, not a text box bolted onto a file list.
- **No migration required.** Files stay where they are — on disk today, in Google Drive tomorrow.
- **Works offline.** A real constraint for students and researchers, and a real engineering claim.
- **Security enforced where it counts:** RLS as the authorization boundary, workflow transitions validated in the database, append-only audit that no client can write, no secrets in any client bundle.
- **Explainable AI.** Grouping states its reasons. AI is an enhancement layer, and we say so.
- **Privacy as a design decision:** institutional admins deliberately cannot see a user's personal index.

## Anticipated judge questions

**"Why two apps instead of one?"**
Governance and discovery are different jobs for different users with different expectations about who holds their files. One app would compromise both.

**"Isn't this just search over a folder?"**
Scope, facets, similarity and explainable grouping — and the same metadata model that drives an institutional approval workflow. The index is shared; the custody model is not.

**"Where does the AI actually help?"**
Metadata extraction, categorization, similarity and turning "show approved policies" into structured filters. We deliberately did not make AI the product — if the AI provider is down, search still works.

**"How do you know search is good?"**
A committed golden query set of ~20 queries with expected results, run as a test. Search quality is measured, not asserted.

**"What about OCR?"**
Implemented for scanned PDFs in the web app, because FS-05 requires it. But it is not our differentiator, and we were explicit about that trade: metadata and search quality earn more than OCR polish.

**"What did you cut, and why?"**
Grounded Q&A, vector embeddings and cloud-drive connectors. Each was a scope decision recorded as an ADR with the reasoning and the accepted cost.

## Business model

Possible SaaS model:

- Free desktop tier for individuals — local indexing and search
- Paid sync/backup tier for individuals and small teams
- Institutional subscription for the governed web platform, priced per seat
- Usage-based AI overages
- Enterprise controls later: SSO, retention policy, compliance reporting

No billing implementation in MVP.

## Language

**Avoid saying:** AI PDF chatbot · Google Drive with AI · PDF summarizer · document management system.

**Prefer:** intelligent metadata-driven search · document workflow and knowledge organization · index in place, no migration · searchable and actionable document lifecycle.
