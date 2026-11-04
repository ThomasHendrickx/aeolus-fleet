import { Search } from 'lucide-react';
import type { ReactNode } from 'react';

import { AppSwitcher } from '../molecules/app-switcher.js';
import type { AppSwitcherModel } from '@aeolus-fleet/common/rules';
import { Button } from '../atoms/button.js';
import { Kbd } from '../atoms/kbd.js';
import { AvatarMenu, type AvatarMenuProps } from '../molecules/avatar-menu.js';
import { classNames } from '../class-names.js';

interface AppHeaderProps {
  /** Undefined while the fleet in view is not known yet: the title's shape stands in. */
  switcher: AppSwitcherModel | undefined;
  /** full: "Acme / Console ▾"; fleet: "Acme" alone, for an app whose breadcrumb follows the fleet. */
  switcherLayout?: 'full' | 'fleet';
  /** The avatar menu, always last; unset, the app shows it elsewhere, such as in its sidebar foot. */
  account?: AvatarMenuProps;
  /** Opens the command palette; without it the search trigger is not shown. */
  onSearch?: () => void;
  /** The search trigger's words: "Search ships or jump to". */
  searchLabel?: string;
  /** trigger: a button with the ⌘K hint, after the app's controls. field: shaped as a search field, before them. */
  search?: 'trigger' | 'field';
  /** The app's own part after the title, such as a breadcrumb. */
  children?: ReactNode;
  /** The app's own controls beside the search, such as a live status or Compose. */
  actions?: ReactNode;
  className?: string;
}

/**
 * The header every Aeolus web app shows on desktop (header design H1 to H13),
 * 56 px: the switcher in the title ("Acme / Console ▾", or "Acme" alone), the
 * app's own part after it, then the app's controls, the command palette's
 * search trigger with its ⌘K hint (or a search field before the controls,
 * as the console draws it: docs/design/fleet-overview), and the avatar menu
 * unless the app shows it elsewhere. Each app's own bar takes the header on
 * phone, with the switcher compact (H6).
 */
export function AppHeader({ switcher, switcherLayout = 'full', account, onSearch, searchLabel = 'Search or jump to', search = 'trigger', children, actions, className }: AppHeaderProps) {
  const searchTrigger = onSearch ? (
    search === 'field' ? (
      <Button
        variant="secondary"
        size="md"
        icon={<Search aria-hidden />}
        data-testid="header-search"
        onClick={onSearch}
        className="w-50 justify-start font-normal text-muted-foreground outline-none focus-visible:outline-2 focus-visible:outline-ring"
      >
        <span className="truncate">{searchLabel}</span>
      </Button>
    ) : (
      <Button size="sm" icon={<Search aria-hidden />} data-testid="header-search" className="w-60 justify-start font-normal text-muted-foreground max-lg:w-auto" onClick={onSearch}>
        <span className="grow text-left max-lg:sr-only">{searchLabel}</span>
        <Kbd>⌘K</Kbd>
      </Button>
    )
  ) : null;
  return (
    <header
      data-slot="app-header"
      className={classNames('sticky top-0 z-30 flex h-(--size-header) shrink-0 items-center justify-between gap-4 border-b border-border bg-background px-6', className)}
    >
      <div className="flex min-w-0 items-center gap-3">
        {switcher === undefined ? (
          <span data-testid="app-switcher-loading" aria-hidden className="h-4 w-36 shrink-0 animate-pulse rounded bg-muted motion-reduce:animate-none" />
        ) : (
          <AppSwitcher switcher={switcher} layout={switcherLayout} className="shrink-0" />
        )}
        {children}
      </div>
      <div className="flex shrink-0 items-center gap-3">
        {search === 'field' ? searchTrigger : null}
        {actions}
        {search === 'trigger' ? searchTrigger : null}
        {account === undefined ? null : <AvatarMenu {...account} />}
      </div>
    </header>
  );
}
