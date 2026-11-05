import type { ReactNode } from 'react';

import { SignInBackground } from '@aeolus-fleet/ui';
import { BrandLogo } from '../../components/atoms/brand-logo';

/**
 * Signed-out pages (docs/design/png/SignInLayout.png): the brand above the
 * page's AuthCard on one of the sign-in backgrounds, picked at load. No
 * Sidebar, Header or TabBar.
 */
export default function SignInLayout({ children }: { children: ReactNode }) {
  return (
    <div className="relative isolate flex min-h-dvh flex-col bg-background sm:items-center sm:justify-center sm:px-4 sm:py-10">
      <SignInBackground className="-z-10 hidden sm:block" />
      <main className="flex w-full grow flex-col gap-6 px-4 pt-6 sm:max-w-100 sm:grow-0 sm:items-stretch sm:px-0 sm:pt-0">
        <div className="flex items-center sm:justify-center">
          <BrandLogo kind="wordmark" className="h-7" />
        </div>
        {children}
      </main>
    </div>
  );
}
