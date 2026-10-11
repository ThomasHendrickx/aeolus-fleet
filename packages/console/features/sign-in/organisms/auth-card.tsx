import type { ReactNode } from 'react';

/**
 * A signed-out page's one centred 400 px card, and the recovery line under
 * it (docs/design/png/AuthLayout.png), inside the sign-in route layout. On
 * phone the card drops away and the recovery line is pinned to the bottom.
 */
export function AuthCard({ children, recovery }: { children: ReactNode; recovery: ReactNode }) {
  return (
    <>
      <div className="sm:rounded-xl sm:border sm:border-border sm:bg-card sm:p-7 sm:shadow-sm">{children}</div>
      <p className="mt-auto pb-6 text-center text-caption text-muted-foreground sm:mt-0 sm:pb-0">{recovery}</p>
    </>
  );
}
