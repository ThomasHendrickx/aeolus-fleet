import { SquarePen } from 'lucide-react';

import { Button } from '../atoms/button';
import { LiveStatus, type LiveState } from '../molecules/live-status';

interface HeaderProps {
  /** The current page's place: "Fleet overview". */
  breadcrumb: string;
  live: LiveState;
  /** Opens Compose, a new message as argo; without it the button is not shown. */
  onCompose?: () => void;
}

/**
 * Desktop top bar (docs/design/png/Header.png), 56 px: the breadcrumb, the
 * live connection status, whose dot always has its word, and Compose. The
 * sidebar toggle, CommandPalette search and the theme toggle come with the
 * slices that build them.
 */
export function Header({ breadcrumb, live, onCompose }: HeaderProps) {
  return (
    <header
      data-slot="header"
      className="sticky top-0 z-30 hidden h-(--size-header) shrink-0 items-center justify-between gap-4 border-b border-border bg-background px-6 sm:flex"
    >
      <p className="truncate text-body font-medium text-foreground">{breadcrumb}</p>
      <div className="flex items-center gap-3">
        <LiveStatus state={live} />
        {onCompose ? (
          <Button size="sm" icon={<SquarePen aria-hidden />} data-testid="header-compose" onClick={onCompose}>
            Compose
          </Button>
        ) : null}
      </div>
    </header>
  );
}
