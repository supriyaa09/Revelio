import Link from 'next/link';
import { ArrowLeft, Lock, ShieldCheck } from 'lucide-react';
import { Logo } from '@/components/logo';

export default function PrivacyPage() {
  return (
    <main className="min-h-screen bg-paper px-4 py-12 sm:px-6 lg:px-8">
      <div className="mx-auto max-w-3xl space-y-8">
        <div className="flex items-center justify-between">
          <Link href="/">
            <Logo size="sm" />
          </Link>
          <Link
            href="/"
            className="inline-flex items-center gap-1.5 text-xs font-semibold text-muted hover:text-ink"
          >
            <ArrowLeft className="size-3.5" />
            Back to Portal
          </Link>
        </div>

        <div className="card p-6 sm:p-8 space-y-6 shadow-e1">
          <div className="border-b border-line pb-4">
            <div className="mb-2 inline-flex items-center gap-1.5 rounded-full bg-accent-soft px-3 py-1 text-xs font-semibold text-accent-ink ring-1 ring-inset ring-accent-line">
              <ShieldCheck className="size-3.5 text-accent" />
              Institutional Data Governance
            </div>
            <h1 className="text-2xl font-bold tracking-tight text-ink sm:text-3xl">
              Privacy Policy
            </h1>
            <p className="mt-1 text-xs text-muted">
              Last updated: August 2026. Applicable to all institutional documents and user data.
            </p>
          </div>

          <section className="space-y-3 text-sm leading-relaxed text-ink-2">
            <h2 className="text-base font-semibold text-ink">1. Information We Collect</h2>
            <p>
              Revelio is designed for institutional document intelligence. We collect user profile
              information (full name, institutional email address, assigned department, and academic role)
              and uploaded institutional documents (PDFs, images, text layers, and associated metadata).
            </p>
          </section>

          <section className="space-y-3 text-sm leading-relaxed text-ink-2">
            <h2 className="text-base font-semibold text-ink">2. How Information is Processed</h2>
            <p>
              Uploaded documents are processed through automated text extraction, neural OCR, and AI
              classification pipelines solely to index, categorize, summarize, and extract critical dates
              for your institution. Documents are never used to train public machine learning models.
            </p>
          </section>

          <section className="space-y-3 text-sm leading-relaxed text-ink-2">
            <h2 className="text-base font-semibold text-ink">3. Row-Level Security & Access Control</h2>
            <p>
              All stored records are protected by PostgreSQL Row-Level Security (RLS) policies. Only
              authorized students, faculty reviewers, and heads of departments with explicit cryptographic
              permissions can view, review, or approve documents in their domain.
            </p>
          </section>

          <section className="space-y-3 text-sm leading-relaxed text-ink-2">
            <h2 className="text-base font-semibold text-ink">4. Auditing & Retention</h2>
            <p>
              All document access, workflow state transitions, and reviewer decisions are recorded in an
              immutable audit trail to satisfy institutional compliance and accreditation standards.
            </p>
          </section>

          <section className="space-y-3 text-sm leading-relaxed text-ink-2">
            <h2 className="text-base font-semibold text-ink">5. Contact & Inquiries</h2>
            <p>
              For data privacy questions or audit inquiries, contact your institution administrator or email{' '}
              <span className="font-mono text-xs text-accent-ink">privacy@revelio.edu</span>.
            </p>
          </section>
        </div>
      </div>
    </main>
  );
}
