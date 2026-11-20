import { ChevronLeft } from 'lucide-react';
import Link from 'next/link';
import type { ReactNode } from 'react';

import { LiveStatus, type LiveState } from '../molecules/live-status';

interface TopBarProps {
  /** The bar's title, beside the back link; the page below carries its own, so it is no heading. */
  title: string;
  live: LiveState;
  /** Up to two icon-only Buttons, each with its aria-label. */
  actions?: ReactNode;
  /** The back link, labelled with the page it returns to. */
  back: { href: string; label: string };
}

/**
 * A page's own phone bar (docs/design/png/TopBar.png), 56 px, in place of
 * the console's bar: an open inbox conversation's, with a back link labelled
 * with the page it returns to, the title, the live status and up to two icon
 * actions. It holds no launcher: the page is a step inside another.
 */
export function TopBar({ title, live, actions, back }: TopBarProps) {
  return (
    <header data-slot="top-bar" data-mode="detail" className="sticky top-0 z-30 flex h-(--size-header) items-center gap-2.5 border-b border-border bg-background px-4 sm:hidden">
      <Link
        href={back.href}
        className="-ml-1.5 inline-flex h-(--size-control-touch) shrink-0 items-center gap-0.5 rounded-md pr-2 text-body-touch text-foreground focus-visible:outline-2 focus-visible:outline-ring [&_svg]:size-(--size-icon)"
      >
        <ChevronLeft aria-hidden />
        {back.label}
      </Link>
      <p className="min-w-0 flex-1 truncate text-center text-body-touch font-semibold text-foreground">{title}</p>
      <LiveStatus state={live} />
      {actions ? <div className="ml-auto flex items-center gap-1">{actions}</div> : null}
    </header>
  );
}
