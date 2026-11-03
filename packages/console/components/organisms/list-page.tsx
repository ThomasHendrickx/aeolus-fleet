import { SquarePen } from 'lucide-react';
import type { ReactNode } from 'react';

import { Button, classNames, type AvatarMenuProps } from '@aeolus-fleet/ui';
import type { AppSwitcherModel } from '@aeolus-fleet/common/rules';
import type { LiveState } from '../molecules/live-status';
import { Header } from './header';
import { TopBar } from './top-bar';

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
  /** Opens Compose: the Header's button, and on phone the TopBar's icon on a root page. */
  onCompose?: () => void;
  /** Opens the CommandPalette: the Header's search trigger, and on phone the root TopBar's search icon. */
  onSearch?: () => void;
  /** The header's switcher; undefined until the session is read. */
  switcher: AppSwitcherModel | undefined;
  /** The avatar menu, in the root TopBar on phone; on desktop the Sidebar foot holds it. */
  account: AvatarMenuProps;
  /** The installation's notices for this session, above the page on desktop and phone. */
  banner?: ReactNode;
  /**
   * The phone TopBar's title, in place of the switcher's app name, as the fleet overview's "Fleet"
   * (docs/design/fleet-overview/console-phone.html): the TopBar then holds no search or Compose icon, and the title row
   * gives way to it below 640 px, its title kept for assistive technology.
   */
  phoneTitle?: string;
  /** A TopBar of the page's own on phone, in place of the root one: an open inbox message's, in detail mode. */
  phoneTopBar?: ReactNode;
  children: ReactNode;
}

/**
 * A list page inside the ConsoleFrame (docs/design/png/ListPage.png):
 * Header on desktop, TopBar (root, with the switcher first and the avatar
 * menu last) on phone. The title and the one primary action share the first
 * row, the toolbar sits under it and the list fills the rest. On phone the
 * TabBar's height is kept free at the bottom.
 */
export function ListPage({ title, description, titleMeta, primaryAction, isActionInTitleRow = false, toolbar, live, onCompose, onSearch, switcher, account, banner, phoneTitle, phoneTopBar, children }: ListPageProps) {
  return (
    <>
      <Header breadcrumb={title} live={live} switcher={switcher} onCompose={onCompose} onSearch={onSearch} />
      {banner}
      {phoneTopBar ?? (
      <TopBar
        title={phoneTitle ?? title}
        isTitled={phoneTitle !== undefined}
        live={live}
        switcher={switcher}
        account={account}
        {...(phoneTitle === undefined ? { onSearch } : {})}
        actions={
          onCompose && phoneTitle === undefined ? (
            <Button
              variant="ghost"
              size="touch"
              isIconOnly
              aria-label="Compose"
              data-testid="top-bar-compose"
              onClick={onCompose}
            >
              <SquarePen aria-hidden />
            </Button>
          ) : undefined
        }
      />
      )}
      <main className="flex grow flex-col gap-4 px-6 py-5 max-sm:gap-3.5 max-sm:px-4 max-sm:pt-3.5 max-sm:pb-[calc(var(--size-tabbar)+var(--spacing)*4)]">
        <div className={classNames('flex flex-wrap items-start justify-between gap-4 max-sm:gap-3', isActionInTitleRow && 'max-sm:flex-nowrap', phoneTitle !== undefined && 'max-sm:sr-only')}>
          <div className="flex min-w-0 flex-col gap-1">
            <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1">
              <h1 className="text-title font-semibold tracking-tight text-foreground max-sm:text-title-touch">{title}</h1>
              {titleMeta}
            </div>
            {description ? (
              <p className="text-meta text-muted-foreground max-sm:text-body-touch">{description}</p>
            ) : null}
          </div>
          {primaryAction ? <div className={classNames('shrink-0', !isActionInTitleRow && 'max-sm:w-full max-sm:[&>*]:w-full', phoneTitle !== undefined && 'max-sm:hidden')}>{primaryAction}</div> : null}
        </div>
        {toolbar}
        {children}
      </main>
    </>
  );
}
