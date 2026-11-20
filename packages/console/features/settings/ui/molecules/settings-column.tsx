import type { ReactNode } from 'react';

/** Settings' sections in one column, 712 px at most on desktop, the page's width on phone (docs/design/app-navigation, where the account menu's items go). */
export function SettingsColumn({ children }: { children: ReactNode }) {
  return <div className="flex w-full max-w-178 flex-col gap-4 max-sm:gap-3.5">{children}</div>;
}
