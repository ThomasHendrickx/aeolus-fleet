import type { Metadata } from 'next';
import { connection } from 'next/server';
import type { ReactNode } from 'react';

import { serverUrlFrom } from '../lib/server-url';
import { geistMono, geistSans } from './fonts';
import { Providers } from './providers';
import './globals.css';

export const metadata: Metadata = {
  title: 'Aeolus',
};

/**
 * Dark follows the system setting: .dark on <html> (docs/design/conventions.md,
 * "Stack"), set before the first paint so the page never flashes light, and
 * kept in step when the setting changes.
 */
const FOLLOW_SYSTEM_THEME = `(() => {
  const query = window.matchMedia('(prefers-color-scheme: dark)');
  const apply = () => document.documentElement.classList.toggle('dark', query.matches);
  apply();
  query.addEventListener('change', apply);
})();`;

export default async function RootLayout({ children }: { children: ReactNode }) {
  // Rendered per request, so the server's address is the one the web app
  // runs with, never one fixed when it was built.
  await connection();
  return (
    // The theme script sets the class before React hydrates.
    <html lang="en" className={`${geistSans.variable} ${geistMono.variable}`} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: FOLLOW_SYSTEM_THEME }} />
      </head>
      <body>
        <Providers serverUrl={serverUrlFrom(process.env)}>{children}</Providers>
      </body>
    </html>
  );
}
