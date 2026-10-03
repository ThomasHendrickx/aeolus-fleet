import type { Metadata } from 'next';
import { cookies } from 'next/headers';
import { connection } from 'next/server';
import type { ReactNode } from 'react';

import { serverInternalUrlFrom, serverUrlFrom } from '../lib/server-url';
import { squadronsUrlFrom } from '../lib/squadrons-url';
import { themeOfSession, themeScript } from '../lib/theme';
import { geistMono, geistSans } from './fonts';
import { Providers } from './providers';
import './globals.css';

export const metadata: Metadata = {
  title: 'Aeolus',
};


export default async function RootLayout({ children }: { children: ReactNode }) {
  // Rendered per request, so the server's address is the one the web app
  // runs with, never one fixed when it was built.
  await connection();
  const serverUrl = serverUrlFrom(process.env);
  // The operator's theme lives on their account (dark on <html> as .dark,
  // docs/design/conventions.md, "Stack"); signed out, it is System.
  const theme = await themeOfSession(serverInternalUrlFrom(process.env), (await cookies()).toString());
  return (
    // The theme script sets the class before React hydrates.
    <html lang="en" className={`${geistSans.variable} ${geistMono.variable}`} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeScript(theme) }} />
      </head>
      <body>
        <Providers serverUrl={serverUrl} isSquadronsConfigured={squadronsUrlFrom(process.env) !== undefined}>
          {children}
        </Providers>
      </body>
    </html>
  );
}
