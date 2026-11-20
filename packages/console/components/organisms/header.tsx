import { AppHeader, Button, type AppsAndFleetsState, type AvatarMenuProps } from '@aeolus-fleet/ui';
import type { AppSwitcherModel } from '@aeolus-fleet/common/rules';
import { Plus, Search, SquarePen } from 'lucide-react';
import Link from 'next/link';
import type { ReactNode } from 'react';

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
  /** The app and the fleet in the bar; undefined until the session is read. */
  switcher: AppSwitcherModel | undefined;
  /** What the console knows of the apps and fleets beyond the list, and its handlers. */
  switcherState?: AppsAndFleetsState;
  /** The account button, at the very end of the bar. */
  account: AvatarMenuProps;
  /** Opens Compose, a new message as argo; without it the button is not shown. */
  onCompose?: () => void;
  /** Opens the CommandPalette; without it the search trigger is not shown. */
  onSearch?: () => void;
  /** A bar of the page's own on phone, in place of this one: an open inbox conversation's. */
  phoneBar?: ReactNode;
}

/**
 * The bar every console page opens with (docs/design/app-navigation,
 * section 4), the one @aeolus-fleet/ui's AppHeader draws. Desktop, across the
 * full width above the Sidebar: the Apps and fleets launcher with the app and
 * the fleet, then the breadcrumb, whose every level above the page links up
 * to it, and the live connection status; at the end the CommandPalette's
 * search field, Compose and the account button. Phone: the launcher with the
 * app and the fleet, the live status, the search and Compose icons and the
 * avatar, 44 px each; the page keeps its breadcrumb. A page with a phone bar
 * of its own shows that one on phone instead.
 */
export function Header({ breadcrumb, parents = [], live, switcher, switcherState, account, onCompose, onSearch, phoneBar }: HeaderProps) {
  const shared = { switcher, account, ...(switcherState === undefined ? {} : { switcherState }) };
  return (
    <>
      <AppHeader
        {...shared}
        onSearch={onSearch}
        search="field"
        searchLabel="Search"
        // Across the full width: over the Sidebar's column, which starts below the bar.
        className="hidden sm:-ml-(--size-rail) sm:flex lg:-ml-(--size-sidebar)"
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
      {phoneBar ?? (
        <AppHeader
          {...shared}
          layout="phone"
          className="sm:hidden"
          actions={
            <>
              <LiveStatus state={live} className="mr-1" />
              {onSearch ? (
                <Button variant="ghost" size="touch" isIconOnly aria-label="Search ships or jump to" data-testid="top-bar-search" onClick={onSearch}>
                  <Search aria-hidden />
                </Button>
              ) : null}
              {onCompose ? (
                <Button variant="ghost" size="touch" isIconOnly aria-label="Compose" data-testid="top-bar-compose" onClick={onCompose}>
                  <SquarePen aria-hidden />
                </Button>
              ) : null}
            </>
          }
        />
      )}
    </>
  );
}
