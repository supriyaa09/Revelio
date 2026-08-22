import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Revelio — Institutional Document Intelligence',
  description:
    'Upload, organize, search, review and approve institutional documents with an auditable trail.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
