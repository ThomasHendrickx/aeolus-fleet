import type { Metadata } from 'next';
import { connection } from 'next/server';
import type { ReactNode } from 'react';

import { serverUrlFrom } from '../lib/server-url';
import { Providers } from './providers';

export const metadata: Metadata = {
  title: 'Aeolus',
};

export default async function RootLayout({ children }: { children: ReactNode }) {
  // Rendered per request, so the server's address is the one the web app
  // runs with, never one fixed when it was built.
  await connection();
  return (
    <html lang="en">
      <body>
        <Providers serverUrl={serverUrlFrom(process.env)}>{children}</Providers>
      </body>
    </html>
  );
}
