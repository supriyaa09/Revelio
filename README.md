# Revelio
### AI-Powered Document Intelligence & Workflow Platform

> Secure document management, intelligent organization, OCR extraction, AI-powered insights, search, workflow approvals, versioning, and audit trails.

**Problem Statement:** FS-05 — Document Management  
**Category:** Full Stack Development  
**Hackathon Duration:** 24 Hours  
**Team Size:** 3

---

# Overview

Revelio is an AI-powered institutional document intelligence platform that transforms uploaded documents into searchable, organized, reviewable knowledge assets.

Instead of acting as a simple file repository, Revelio automatically:

- Extracts document text
- Performs OCR on scanned documents
- Generates AI-powered summaries and metadata
- Organizes documents into institutional categories
- Supports review and approval workflows
- Maintains complete version history
- Preserves audit trails

The platform provides different experiences for students, faculty, and HODs while operating on a single codebase, database, and identity system.

---

# Problem

Institutions generate and manage large volumes of documents:

- Notices
- Reports
- Policies
- Circulars
- Requests
- Financial records
- Approval documents

These documents are often:

- Difficult to locate
- Poorly categorized
- Hard to search
- Missing workflow controls
- Lacking auditability

Traditional document repositories store files but provide little intelligence.

---

# Solution

Revelio combines:

- Secure document storage
- OCR text extraction
- AI-powered metadata generation
- Intelligent categorization
- Full-text search
- Approval workflows
- Version management
- Audit tracking

Every uploaded document becomes searchable, discoverable, and governable.

---

# Key Features

## Document Management

- Secure uploads
- Private storage
- Metadata management
- Folder organization
- Version history

## OCR & Text Extraction

- Direct PDF text extraction
- OCR fallback for scanned documents
- Mixed extraction support
- Per-page processing

## AI-Powered Intelligence

- Automatic categorization
- Metadata extraction
- Summary generation
- Key point extraction
- Entity detection
- Important date identification

## Search

Current:

- Title search
- Description search
- Status filters
- Folder filters

Planned:

- Full-text search
- Similar document discovery
- Semantic retrieval
- Document Q&A

## Workflow Management

- Draft
- Submission
- Faculty Review
- HOD Review
- Approval
- Rejection
- Change Requests

## Governance

- Role-based access
- Version tracking
- Audit logs
- Review history
- Comments

---

# User Roles

| Role | Capabilities |
|--------|-------------|
| Student | Upload, manage, search, submit documents |
| Faculty | Review, approve, reject, escalate |
| HOD | Final approval authority, administration |

---

# Workflow

```text
Draft
  ↓
Submitted
  ↓
Faculty Review
  ↓
HOD Review
  ↓
Approved

or

Rejected
or
Changes Requested
```

Every action is recorded in the audit trail.

---

# Technology Stack

## Frontend

- Next.js 15
- React 19
- TypeScript
- Tailwind CSS v4

## Backend

- Next.js Route Handlers
- Server Actions

## Database

- Supabase PostgreSQL

## Authentication

- Supabase Auth

## Storage

- Supabase Storage
- Private Documents Bucket

## Search

- PostgreSQL Full Text Search
- Weighted TSVectors

## AI

- Anthropic Claude
- Structured JSON Outputs

## OCR

- Tesseract.js

## PDF Processing

- unpdf (pdf.js)

---

# Architecture

```text
User
  │
  ▼
Next.js Application
  │
  ├── Authentication
  ├── Upload Pipeline
  ├── Workflow Engine
  ├── Search Engine
  └── AI Processing
          │
          ▼
      Claude API

  │
  ▼

Supabase
  ├── PostgreSQL
  ├── Storage
  └── Authentication
```

---

# Upload Pipeline

```text
Upload
   ↓
Validation
   ↓
Private Storage
   ↓
Version Record
   ↓
Text Extraction
   ↓
OCR (if needed)
   ↓
AI Analysis
   ↓
Categorization
   ↓
Indexing
   ↓
Available in Workspace
```

---

# Security

- Supabase Authentication
- PostgreSQL Row Level Security (RLS)
- Private Storage Buckets
- Signed File URLs
- Immutable Document Versions
- Append-Only Audit Logs
- Server-Side AI Processing
- No API Keys Exposed to Clients

---

# Data Model

Core entities:

- Profiles
- Departments
- Categories
- Documents
- Document Versions
- Document Insights
- Document Chunks
- Comments
- Reviews
- Audit Logs
- Search Index

---

# Current Status

## Implemented

- Authentication
- Role Management
- Upload Pipeline
- Versioning
- Workflow Engine
- OCR Pipeline
- AI Metadata Extraction
- AI Summaries
- Automatic Categorization
- Audit Logging
- Comments
- Processing Dashboard

## In Progress

- Full Text Search
- Similar Document Discovery

## Planned

- Document Q&A
- Cross-Document Questions
- Advanced Retrieval

---

# Setup

```bash
git clone <repository-url>

cd frontend

npm install

npm run dev
```

Create:

```bash
.env.local
```

Add:

```env
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=

ANTHROPIC_API_KEY=
```

---

# Deployment

- Frontend: Vercel
- Backend: Next.js Server Runtime
- Database: Supabase
- Storage: Supabase Storage
- AI: Anthropic Claude

---

# Team

Team of 3

Built for FS-05 — Document Management Hackathon.