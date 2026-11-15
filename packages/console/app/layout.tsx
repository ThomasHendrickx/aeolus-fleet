import type { Metadata } from 'next';
import { cookies } from 'next/headers';
import { connection } from 'next/server';
import type { ReactNode } from 'react';

import { analyticsAdapterFrom } from '../lib/analytics-adapter';
import { serverUrlFrom } from '../lib/server-url';
import { hostedAccountUrlFrom } from '../lib/hosted-account-url';
import { hostedSignInUrlFrom } from '../lib/hosted-sign-in';
import { consoleConstantsOf } from '../lib/console-constants-of';
import { CONSOLE_PAGE_TITLE } from '../lib/page-title';
import { themeOfCookies } from '@aeolus-fleet/common/rules';
import { themeScript } from '@aeolus-fleet/ui';
import { themeCookieDomainFrom } from '../lib/theme-cookie-domain';
import { geistMono, geistSans } from './fonts';
import { Providers } from './providers';
import './globals.css';

export const metadata: Metadata = {
  title: CONSOLE_PAGE_TITLE,
};


export default async function RootLayout({ children }: { children: ReactNode }) {
  // Rendered per request, so the server's address is the one the web app
  // runs with, never one fixed when it was built.
  await connection();
  const serverUrl = serverUrlFrom(process.env);
  // One theme per browser, whoever is signed in here, argo and the viewer too
  // (docs/design/header-across-apps.md, T1 to T3): the cookie every Aeolus app reads.
  const theme = themeOfCookies((await cookies()).toString());
  return (
    // The theme script sets the class before React hydrates.
    <html lang="en" className={`${geistSans.variable} ${geistMono.variable}`} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeScript(theme) }} />
      </head>
      <body>
        <Providers serverUrl={serverUrl} constants={consoleConstantsOf()} hostedAccountUrl={hostedAccountUrlFrom(process.env)} hasOwnSignIn={hostedSignInUrlFrom(process.env) === undefined} themeCookieDomain={themeCookieDomainFrom(process.env)} isAnalyticsOn={analyticsAdapterFrom(process.env) !== undefined}>
          {children}
        </Providers>
      </body>
    </html>
  );
}
