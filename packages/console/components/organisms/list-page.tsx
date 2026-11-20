import type { ReactNode } from 'react';

import { classNames, type AppsAndFleetsState, type AvatarMenuProps } from '@aeolus-fleet/ui';
import type { AppSwitcherModel } from '@aeolus-fleet/common/rules';
import type { LiveState } from '../molecules/live-status';
import { Header } from './header';

interface ListPageProps {
  /** The page title: the h1, and the end of the desktop breadcrumb. */
  title: string;
  description?: ReactNode;
  /** A fact beside the title, such as the version a plugin runs; on phone, above the description. */
  titleMeta?: ReactNode;
  /** The page's one primary action, beside the title. */
  primaryAction?: ReactNode;
  /** On phone the primary action stays small at the end of the title row, instead of a full-width row of its own. */
  isActionInTitleRow?: boolean;
  /** Search and filters, under the title row. */
  toolbar?: ReactNode;
  live: LiveState;
  /** Opens Compose: the bar's button, an icon on phone. */
  onCompose?: () => void;
  /** Opens the CommandPalette: the bar's search field, an icon on phone. */
  onSearch?: () => void;
  /** The app and the fleet in the bar; undefined until the session is read. */
  switcher: AppSwitcherModel | undefined;
  /** What the console knows of the apps and fleets beyond the list, and its handlers. */
  switcherState?: AppsAndFleetsState;
  /** The account button, at the end of the bar. */
  account: AvatarMenuProps;
  /** The installation's notices for this session, above the page on desktop and phone. */
  banner?: ReactNode;
  /** A bar of the page's own on phone, in place of the console's: an open inbox conversation's TopBar. */
  phoneTopBar?: ReactNode;
  children: ReactNode;
}

/**
 * A list page inside the ConsoleFrame (docs/design/png/ListPage.png), under
 * the console's bar (Header) at both widths. The title and the one primary
 * action share the first row, the toolbar sits under it and the list fills
 * the rest. On phone the TabBar's height is kept free at the bottom.
 */
export function ListPage({ title, description, titleMeta, primaryAction, isActionInTitleRow = false, toolbar, live, onCompose, onSearch, switcher, switcherState, account, banner, phoneTopBar, children }: ListPageProps) {
  return (
    <>
      <Header
        breadcrumb={title}
        live={live}
        switcher={switcher}
        {...(switcherState === undefined ? {} : { switcherState })}
        account={account}
        onCompose={onCompose}
        onSearch={onSearch}
        phoneBar={phoneTopBar}
      />
      {banner}
      <main className="flex grow flex-col gap-4 px-6 py-5 max-sm:gap-3.5 max-sm:px-4 max-sm:pt-3.5 max-sm:pb-[calc(var(--size-tabbar)+var(--spacing)*4)]">
        <div className={classNames('flex flex-wrap items-start justify-between gap-4 max-sm:gap-3', isActionInTitleRow && 'max-sm:flex-nowrap')}>
          <div className="flex min-w-0 flex-col gap-1">
            <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1">
              <h1 className="text-title font-semibold tracking-tight text-foreground max-sm:text-title-touch">{title}</h1>
              {titleMeta}
            </div>
            {description ? (
              <p className="text-meta text-muted-foreground max-sm:text-body-touch">{description}</p>
            ) : null}
          </div>
          {primaryAction ? <div className={classNames('shrink-0', !isActionInTitleRow && 'max-sm:w-full max-sm:[&>*]:w-full')}>{primaryAction}</div> : null}
        </div>
        {toolbar}
        {children}
      </main>
    </>
  );
}
