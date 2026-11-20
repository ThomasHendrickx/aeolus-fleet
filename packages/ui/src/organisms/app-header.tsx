import { Search } from 'lucide-react';
import type { ReactNode } from 'react';

import type { AppSwitcherModel } from '@aeolus-fleet/common/rules';
import { Button } from '../atoms/button.js';
import { Kbd } from '../atoms/kbd.js';
import { AppSwitcher, type AppsAndFleetsState } from '../molecules/app-switcher.js';
import { AvatarMenu, AvatarMenuSheet, type AvatarMenuProps } from '../molecules/avatar-menu.js';
import { classNames } from '../class-names.js';

interface AppHeaderProps {
  /** Undefined while the app open and the fleet in view are not known yet: their shape stands in. */
  switcher: AppSwitcherModel | undefined;
  /** What the app knows about the apps and fleets beyond the list, and its handlers. */
  switcherState?: AppsAndFleetsState;
  /** desktop: 56 px, the panels under their buttons. phone: 64 px, 44 px targets, the panels as bottom Sheets. */
  layout?: 'desktop' | 'phone';
  /** The account button, always last; unset, the app shows it elsewhere, such as in its sidebar foot. */
  account?: AvatarMenuProps;
  /** Opens the command palette; without it the search trigger is not shown. */
  onSearch?: () => void;
  /** The search trigger's words: "Search ships or jump to". */
  searchLabel?: string;
  /** trigger: a button with the ⌘K hint, after the app's controls. field: shaped as a search field, before them. */
  search?: 'trigger' | 'field';
  /** The page's own part after the fleet, such as Console's "/ Fleet" or Bridge's tabs. */
  children?: ReactNode;
  /** The app's own controls before the account button, such as a live status or Compose. */
  actions?: ReactNode;
  className?: string;
}

/**
 * The bar every Aeolus working page opens with (docs/design/app-navigation,
 * section 4), across the full width: at the start the launcher of the Apps
 * and fleets panel, the app open and the fleet in view, then the page's own
 * part; at the end the app's controls and the account button. The same bar on
 * phone, with 44 px targets and its panels as bottom Sheets.
 */
export function AppHeader({ switcher, switcherState, layout = 'desktop', account, onSearch, searchLabel = 'Search or jump to', search = 'trigger', children, actions, className }: AppHeaderProps) {
  const isPhone = layout === 'phone';
  const searchTrigger =
    onSearch === undefined || isPhone ? null : search === 'field' ? (
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
    );
  return (
    <header
      data-slot="app-header"
      data-layout={layout}
      className={classNames(
        'sticky top-0 z-30 flex shrink-0 items-center justify-between border-b border-border',
        isPhone ? 'h-16 gap-1 bg-background px-2' : 'h-(--size-header) gap-4 bg-sidebar pr-4 pl-2',
        className,
      )}
    >
      <div className="flex min-w-0 items-center gap-3">
        {switcher === undefined ? (
          <span data-testid="app-switcher-loading" aria-hidden className="h-4 w-36 shrink-0 animate-pulse rounded bg-muted motion-reduce:animate-none" />
        ) : (
          <AppSwitcher switcher={switcher} layout={isPhone ? 'sheet' : 'menu'} {...(switcherState === undefined ? {} : { state: switcherState })} />
        )}
        {children}
      </div>
      <div className="flex min-w-0 shrink-0 items-center gap-3">
        {search === 'field' ? searchTrigger : null}
        {actions}
        {search === 'trigger' ? searchTrigger : null}
        {account === undefined ? null : isPhone ? <AvatarMenuSheet {...account} /> : <AvatarMenu {...account} layout="bar" />}
      </div>
    </header>
  );
}
