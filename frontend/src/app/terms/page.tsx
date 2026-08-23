import Link from 'next/link';
import { ArrowLeft, FileText, Shield } from 'lucide-react';
import { Logo } from '@/components/logo';

export default function TermsPage() {
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
              <FileText className="size-3.5 text-accent" />
              Terms of Service
            </div>
            <h1 className="text-2xl font-bold tracking-tight text-ink sm:text-3xl">
              Terms & Conditions
            </h1>
            <p className="mt-1 text-xs text-muted">
              Last updated: August 2026. Governs access and usage of the Revelio platform.
            </p>
          </div>

          <section className="space-y-3 text-sm leading-relaxed text-ink-2">
            <h2 className="text-base font-semibold text-ink">1. Acceptance of Terms</h2>
            <p>
              By accessing or using the Revelio document intelligence platform, you agree to comply with
              these terms and all institutional governance policies established by your educational
              institution.
            </p>
          </section>

          <section className="space-y-3 text-sm leading-relaxed text-ink-2">
            <h2 className="text-base font-semibold text-ink">2. User Responsibilities & Roles</h2>
            <p>
              Users are assigned specific roles (Student, Faculty, HOD, Dean/Admin). You agree to submit
              accurate documents, refrain from uploading unauthorized material, and perform review actions
              honestly and according to institutional guidelines.
            </p>
          </section>

          <section className="space-y-3 text-sm leading-relaxed text-ink-2">
            <h2 className="text-base font-semibold text-ink">3. Intellectual Property & Document Ownership</h2>
            <p>
              All institutional documents uploaded to Revelio remain the property of their respective
              authors and the host institution. Revelio operates strictly as a management and intelligence
              processing interface.
            </p>
          </section>

          <section className="space-y-3 text-sm leading-relaxed text-ink-2">
            <h2 className="text-base font-semibold text-ink">4. System Availability & Integrity</h2>
            <p>
              While Revelio strives for high availability and zero-loss storage, users should maintain local
              copies of critical submissions. Service is provided in accordance with institutional SLA terms.
            </p>
          </section>

          <section className="space-y-3 text-sm leading-relaxed text-ink-2">
            <h2 className="text-base font-semibold text-ink">5. Modifications</h2>
            <p>
              These terms may be updated periodically to reflect institutional policy changes or legal
              requirements. Continued use of the platform represents acceptance of updated terms.
            </p>
          </section>
        </div>
      </div>
    </main>
  );
}
