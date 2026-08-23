import type { Metadata, Viewport } from 'next';
import { Inter, Playfair_Display } from 'next/font/google';
import './globals.css';

const inter = Inter({
  subsets: ['latin'],
  variable: '--font-sans-src',
  display: 'swap',
});

/*
 * The editorial half of the type system. Only the weights the `display` utility
 * and the wordmark actually use are requested — a serif is heavy, and shipping
 * five unused weights would cost more than the personality is worth.
 */
const playfair = Playfair_Display({
  subsets: ['latin'],
  variable: '--font-serif-src',
  display: 'swap',
  weight: ['400', '500', '600', '700'],
});

export const metadata: Metadata = {
  title: 'Revelio — Reveal. Organize. Intelligently.',
  description:
    'Revelio turns messy institutional documents into searchable, organized, intelligent and actionable information.',
};

export const viewport: Viewport = {
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#f7f4ea' },
    { media: '(prefers-color-scheme: dark)', color: '#141815' },
  ],
};

const THEME_BOOTSTRAP = `
(function(){try{
  var stored = localStorage.getItem('revelio-theme');
  var dark = stored ? stored === 'dark'
    : window.matchMedia('(prefers-color-scheme: dark)').matches;
  document.documentElement.classList.toggle('dark', dark);
}catch(e){}})();
`;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html
      lang="en"
      suppressHydrationWarning
      className={`${inter.variable} ${playfair.variable}`}
    >
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_BOOTSTRAP }} />
      </head>
      <body className="min-h-screen bg-paper text-ink antialiased selection:bg-accent-soft selection:text-accent-ink">{children}</body>
    </html>
  );
}
