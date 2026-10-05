import { ChevronRight, Search, SquarePen } from 'lucide-react';
import Link from 'next/link';

import { Button } from '../atoms/button';
import { Kbd } from '../atoms/kbd';
import { LiveStatus, type LiveState } from '../molecules/live-status';

/** A level above the current page, in the breadcrumb: a link up to it. */
export interface BreadcrumbLevel {
  href: string;
  label: string;
}

interface HeaderProps {
  /** The current page's name, the end of the breadcrumb: "Fleet overview". */
  breadcrumb: string;
  /** Every level above the current page, the top first; each is a link. */
  parents?: readonly BreadcrumbLevel[];
  live: LiveState;
  /** Opens Compose, a new message as argo; without it the button is not shown. */
  onCompose?: () => void;
  /** Opens the CommandPalette; without it the search trigger is not shown. */
  onSearch?: () => void;
}

/**
 * Desktop top bar (docs/design/png/Header.png), 56 px: the breadcrumb, whose
 * every level above the page links up to it, the
 * live connection status, whose dot always has its word, the CommandPalette's
 * search trigger with its ⌘K hint, and Compose. The theme lives in the
 * AccountMenu; the sidebar toggle comes with the slice that builds it.
 */
export function Header({ breadcrumb, parents = [], live, onCompose, onSearch }: HeaderProps) {
  return (
    <header
      data-slot="header"
      className="sticky top-0 z-30 hidden h-(--size-header) shrink-0 items-center justify-between gap-4 border-b border-border bg-background px-6 sm:flex"
    >
      <nav aria-label="Breadcrumb" data-testid="header-breadcrumb" className="min-w-0 text-body">
        <ol className="flex min-w-0 items-center gap-1.5">
          {parents.map((level) => (
            <li key={level.href} className="flex shrink-0 items-center gap-1.5">
              <Link href={level.href} className="text-muted-foreground hover:text-foreground hover:underline">
                {level.label}
              </Link>
              <ChevronRight aria-hidden className="size-3.5 text-muted-foreground" />
            </li>
          ))}
          <li aria-current="page" className="truncate font-medium text-foreground">
            {breadcrumb}
          </li>
        </ol>
      </nav>
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
