import { Search, SquarePen } from 'lucide-react';

import { Button } from '../atoms/button';
import { Kbd } from '../atoms/kbd';
import { LiveStatus, type LiveState } from '../molecules/live-status';

interface HeaderProps {
  /** The current page's place: "Fleet overview". */
  breadcrumb: string;
  live: LiveState;
  /** Opens Compose, a new message as argo; without it the button is not shown. */
  onCompose?: () => void;
  /** Opens the CommandPalette; without it the search trigger is not shown. */
  onSearch?: () => void;
}

/**
 * Desktop top bar (docs/design/png/Header.png), 56 px: the breadcrumb, the
 * live connection status, whose dot always has its word, the CommandPalette's
 * search trigger with its ⌘K hint, and Compose. The theme lives in the
 * AccountMenu; the sidebar toggle comes with the slice that builds it.
 */
export function Header({ breadcrumb, live, onCompose, onSearch }: HeaderProps) {
  return (
    <header
      data-slot="header"
      className="sticky top-0 z-30 hidden h-(--size-header) shrink-0 items-center justify-between gap-4 border-b border-border bg-background px-6 sm:flex"
    >
      <p className="truncate text-body font-medium text-foreground">{breadcrumb}</p>
      <div className="flex items-center gap-3">
        <LiveStatus state={live} />
        {onSearch ? (
          <Button
            size="sm"
            icon={<Search aria-hidden />}
            data-testid="header-search"
            className="w-60 justify-start font-normal text-muted-foreground"
            onClick={onSearch}
          >
            <span className="grow text-left">Search ships or jump to</span>
            <Kbd>⌘K</Kbd>
          </Button>
        ) : null}
        {onCompose ? (
          <Button size="sm" icon={<SquarePen aria-hidden />} data-testid="header-compose" onClick={onCompose}>
            Compose
          </Button>
        ) : null}
      </div>
    </header>
  );
}
