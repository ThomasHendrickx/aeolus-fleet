import { AppHeader, Button } from '@aeolus-fleet/ui';
import type { AppSwitcherModel } from '@aeolus-fleet/common/rules';
import { Plus } from 'lucide-react';
import Link from 'next/link';

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
  /** The switcher in the title; undefined until the session is read. */
  switcher: AppSwitcherModel | undefined;
  /** Opens Compose, a new message as argo; without it the button is not shown. */
  onCompose?: () => void;
  /** Opens the CommandPalette; without it the search trigger is not shown. */
  onSearch?: () => void;
}

/**
 * Desktop top bar (docs/design/fleet-overview/console-desktop.html): the
 * header every Aeolus app shows (@aeolus-fleet/ui), with the fleet in the
 * title, which opens the fleets and apps; then the breadcrumb, whose every
 * level above the page links up to it, and the live connection status, whose
 * dot always has its word; at the end the CommandPalette's search field and
 * Compose. The avatar menu sits in the Sidebar foot.
 */
export function Header({ breadcrumb, parents = [], live, switcher, onCompose, onSearch }: HeaderProps) {
  return (
    <AppHeader
      switcher={switcher}
      switcherLayout="fleet"
      onSearch={onSearch}
      search="field"
      searchLabel="Search"
      className="hidden sm:flex"
      actions={
        onCompose ? (
          <Button size="sm" icon={<Plus aria-hidden />} data-testid="header-compose" onClick={onCompose}>
            Compose
          </Button>
        ) : null
      }
    >
      <nav aria-label="Breadcrumb" data-testid="header-breadcrumb" className="-ml-2 flex min-w-0 items-center gap-3 text-body">
        <ol className="flex min-w-0 items-center gap-1">
          <li aria-hidden className="text-muted-foreground">
            /
          </li>
          {parents.map((level) => (
            <li key={level.href} className="flex shrink-0 items-center gap-1">
              <Link href={level.href} className="text-muted-foreground hover:text-foreground hover:underline">
                {level.label}
              </Link>
              <span aria-hidden className="text-muted-foreground">
                /
              </span>
            </li>
          ))}
          <li aria-current="page" className="truncate font-medium text-foreground">
            {breadcrumb}
          </li>
        </ol>
      </nav>
      <LiveStatus state={live} />
    </AppHeader>
  );
}
