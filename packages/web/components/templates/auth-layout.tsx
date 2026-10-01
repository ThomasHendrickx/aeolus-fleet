import type { ReactNode } from 'react';

import { Avatar } from '../atoms/avatar';

/**
 * Signed-out pages (docs/design/png/AuthLayout.png): the brand, one centred
 * 400 px card on the dotted ground, and the recovery line under it. No
 * Sidebar, Header or TabBar. On phone the card drops away and the recovery
 * line is pinned to the bottom.
 */
export function AuthLayout({ children, recovery }: { children: ReactNode; recovery: ReactNode }) {
  return (
    <div className="flex min-h-dvh flex-col bg-background sm:items-center sm:justify-center sm:bg-dots sm:px-4 sm:py-10">
      <main className="flex w-full grow flex-col gap-6 px-4 pt-6 sm:max-w-100 sm:grow-0 sm:items-stretch sm:px-0 sm:pt-0">
        <div className="flex items-center gap-2.5 sm:justify-center">
          <Avatar kind="app" size={28} />
          <span className="text-section font-semibold">Aeolus</span>
        </div>
        <div className="sm:rounded-xl sm:border sm:border-border sm:bg-card sm:p-7 sm:shadow-sm">{children}</div>
        <p className="mt-auto pb-6 text-center text-caption text-muted-foreground sm:mt-0 sm:pb-0">{recovery}</p>
      </main>
    </div>
  );
}
