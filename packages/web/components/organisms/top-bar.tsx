import { ChevronLeft } from 'lucide-react';
import Link from 'next/link';
import type { ReactNode } from 'react';

import { LiveStatus, type LiveState } from '../molecules/live-status';
import { AccountMenuSheet, type AccountMenuProps } from './account-menu';

interface TopBarProps {
  /** The page title; on a root page it is the page's one title. */
  title: string;
  live: LiveState;
  /** Up to two icon-only Buttons, each with its aria-label. */
  actions?: ReactNode;
  /**
   * Detail mode: the back link, labelled with the page it returns to. The page
   * below carries its own title then, so the bar's title is no heading.
   */
  back?: { href: string; label: string };
  /** Root mode: the AccountMenu's Avatar, always last. Detail and modal modes need none. */
  account?: AccountMenuProps;
}

/**
 * Phone top bar (docs/design/png/TopBar.png), 56 px. Root mode: the page
 * title, the live status, up to two icon actions and the AccountMenu's
 * Avatar, always last, which opens it as a bottom Sheet. Detail mode: a back link
 * labelled with the previous page, the title and the live status. Modal mode
 * comes with the pages that need it.
 */
export function TopBar({ title, live, actions, back, account }: TopBarProps) {
  return (
    <header
      data-slot="top-bar"
      data-mode={back ? 'detail' : 'root'}
      className="sticky top-0 z-30 flex h-(--size-header) items-center gap-2.5 border-b border-border bg-background px-4 sm:hidden"
    >
      {back ? (
        <>
          <Link
            href={back.href}
            className="-ml-1.5 inline-flex h-(--size-control-touch) shrink-0 items-center gap-0.5 rounded-md pr-2 text-body-touch text-foreground focus-visible:outline-2 focus-visible:outline-ring [&_svg]:size-(--size-icon)"
          >
            <ChevronLeft aria-hidden />
            {back.label}
          </Link>
          <p className="min-w-0 flex-1 truncate text-center text-body-touch font-semibold text-foreground">{title}</p>
        </>
      ) : (
        <h1 className="truncate text-title-touch font-semibold tracking-tight text-foreground">{title}</h1>
      )}
      <LiveStatus state={live} />
      {actions || (account && !back) ? (
        <div className="ml-auto flex items-center gap-1">
          {actions}
          {account && !back ? <AccountMenuSheet {...account} /> : null}
        </div>
      ) : null}
    </header>
  );
}
