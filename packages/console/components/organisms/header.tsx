import { AppHeader, Button, type AvatarMenuProps } from '@aeolus-fleet/ui';
import type { AppSwitcherModel } from '@aeolus-fleet/common/rules';
import { ChevronRight, SquarePen } from 'lucide-react';
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
  account: AvatarMenuProps;
  /** Opens Compose, a new message as argo; without it the button is not shown. */
  onCompose?: () => void;
  /** Opens the CommandPalette; without it the search trigger is not shown. */
  onSearch?: () => void;
}

/**
 * Desktop top bar (docs/design/png/Header.png): the header every Aeolus app
 * shows (@aeolus-fleet/ui), with the switcher in the title, then
 * the breadcrumb, whose every level above the page links up to it; the live
 * connection status, whose dot always has its word, Compose, the
 * CommandPalette's search trigger with its ⌘K hint, and the avatar menu.
 */
export function Header({ breadcrumb, parents = [], live, switcher, account, onCompose, onSearch }: HeaderProps) {
  return (
    <AppHeader
      switcher={switcher}
      account={account}
      onSearch={onSearch}
      searchLabel="Search ships or jump to"
      className="hidden sm:flex"
      actions={
        <>
          <LiveStatus state={live} />
          {onCompose ? (
            <Button size="sm" icon={<SquarePen aria-hidden />} data-testid="header-compose" onClick={onCompose}>
              Compose
            </Button>
          ) : null}
        </>
      }
    >
      <ChevronRight aria-hidden className="size-3.5 shrink-0 text-muted-foreground" />
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
    </AppHeader>
  );
}
