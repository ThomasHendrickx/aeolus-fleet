import { Search } from 'lucide-react';
import type { ReactNode } from 'react';

import { AppSwitcher } from './app-switcher.js';
import type { AppSwitcherModel } from './apps.js';
import { Button } from './atoms/button.js';
import { Kbd } from './atoms/kbd.js';
import { AvatarMenu, type AvatarMenuProps } from './avatar-menu.js';
import { classNames } from './class-names.js';

interface AppHeaderProps {
  /** Undefined while the fleet in view is not known yet: the title's shape stands in. */
  switcher: AppSwitcherModel | undefined;
  /** The avatar menu, always last. */
  account: AvatarMenuProps;
  /** Opens the command palette; without it the search trigger is not shown. */
  onSearch?: () => void;
  /** The search trigger's words: "Search ships or jump to". */
  searchLabel?: string;
  /** The app's own part after the title, such as a breadcrumb. */
  children?: ReactNode;
  /** The app's own controls before the search, such as a live status or Compose. */
  actions?: ReactNode;
  className?: string;
}

/**
 * The header every Aeolus web app shows on desktop (header design H1 to H13),
 * 56 px: the switcher in the title ("Acme / Console ▾"), the app's own part
 * after it, then the app's controls, the command palette's search trigger
 * with its ⌘K hint, and the avatar menu. Each app's own bar takes the
 * header on phone, with the switcher compact (H6).
 */
export function AppHeader({ switcher, account, onSearch, searchLabel = 'Search or jump to', children, actions, className }: AppHeaderProps) {
  return (
    <header
      data-slot="app-header"
      className={classNames('sticky top-0 z-30 flex h-(--size-header) shrink-0 items-center justify-between gap-4 border-b border-border bg-background px-6', className)}
    >
      <div className="flex min-w-0 items-center gap-3">
        {switcher === undefined ? (
          <span data-testid="app-switcher-loading" aria-hidden className="h-4 w-36 shrink-0 animate-pulse rounded bg-muted motion-reduce:animate-none" />
        ) : (
          <AppSwitcher switcher={switcher} layout="full" className="shrink-0" />
        )}
        {children}
      </div>
      <div className="flex shrink-0 items-center gap-3">
        {actions}
        {onSearch ? (
          <Button size="sm" icon={<Search aria-hidden />} data-testid="header-search" className="w-60 justify-start font-normal text-muted-foreground max-lg:w-auto" onClick={onSearch}>
            <span className="grow text-left max-lg:sr-only">{searchLabel}</span>
            <Kbd>⌘K</Kbd>
          </Button>
        ) : null}
        <AvatarMenu {...account} />
      </div>
    </header>
  );
}
