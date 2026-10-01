import type { ReactNode } from 'react';

import { LiveStatus, type LiveState } from '../molecules/live-status';

interface TopBarProps {
  /** The page title; on a root page it is the page's one title. */
  title: string;
  live: LiveState;
  /** Up to two icon-only Buttons, each with its aria-label. */
  actions?: ReactNode;
}

/**
 * Phone top bar (docs/design/png/TopBar.png), 56 px, in root mode: the page
 * title, the live status and up to two icon actions. Detail and modal modes
 * come with the pages that need them.
 */
export function TopBar({ title, live, actions }: TopBarProps) {
  return (
    <header
      data-slot="top-bar"
      className="sticky top-0 z-30 flex h-(--size-header) items-center gap-2.5 border-b border-border bg-background px-4 sm:hidden"
    >
      <h1 className="truncate text-title-touch font-semibold tracking-tight text-foreground">{title}</h1>
      <LiveStatus state={live} />
      {actions ? <div className="ml-auto flex items-center gap-1">{actions}</div> : null}
    </header>
  );
}
