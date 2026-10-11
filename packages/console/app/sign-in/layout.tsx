import type { ReactNode } from 'react';

import { Avatar } from '../../components/atoms/avatar';

/**
 * Signed-out pages (docs/design/png/AuthLayout.png): the brand above the
 * page's AuthCard on the dotted ground. No Sidebar, Header or TabBar.
 */
export default function SignInLayout({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-dvh flex-col bg-background sm:items-center sm:justify-center sm:bg-dots sm:px-4 sm:py-10">
      <main className="flex w-full grow flex-col gap-6 px-4 pt-6 sm:max-w-100 sm:grow-0 sm:items-stretch sm:px-0 sm:pt-0">
        <div className="flex items-center gap-2.5 sm:justify-center">
          <Avatar kind="app" size={28} />
          <span className="text-section font-semibold">Aeolus</span>
        </div>
        {children}
      </main>
    </div>
  );
}
