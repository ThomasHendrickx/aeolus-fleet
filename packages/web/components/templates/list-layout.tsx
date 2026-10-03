import { SquarePen } from 'lucide-react';
import type { ReactNode } from 'react';

import { Button } from '../atoms/button';

import type { LiveState } from '../molecules/live-status';
import type { AccountMenuProps } from '../organisms/account-menu';
import { Header } from '../organisms/header';
import { Sidebar, type SidebarDestination } from '../organisms/sidebar';
import { TabBar } from '../organisms/tab-bar';
import { TopBar } from '../organisms/top-bar';

interface ListLayoutProps {
  /** The page title: the desktop h1 and the phone TopBar title. */
  title: string;
  description?: ReactNode;
  /** The page's one primary action, beside the title. */
  primaryAction?: ReactNode;
  /** Search and filters, under the title row. */
  toolbar?: ReactNode;
  live: LiveState;
  /** Where the operator is, and the counts the navigation shows once known. */
  nav: { active: SidebarDestination; inboxCount?: number; attentionCount?: number };
  /** Opens Compose: the Header's button, and on phone the TopBar's icon on a root page. */
  onCompose?: () => void;
  /** Opens the CommandPalette: the Header's search trigger, and on phone the root TopBar's search icon. */
  onSearch?: () => void;
  /** The signed-in operator, for the AccountMenu: the Sidebar's on desktop, the root TopBar's on phone. */
  account: AccountMenuProps;
  children: ReactNode;
}

/**
 * List pages (docs/design/png/ListLayout.png), single variant: Sidebar and
 * Header on desktop, TopBar (root, with the AccountMenu's Avatar last) and
 * TabBar on phone. The title and the one
 * primary action share the first row, the toolbar sits under it and the list
 * fills the rest. On phone the TopBar carries the title, and the TabBar's
 * height is kept free at the bottom.
 */
export function ListLayout({
  title,
  description,
  primaryAction,
  toolbar,
  live,
  nav,
  onCompose,
  onSearch,
  account,
  children,
}: ListLayoutProps) {
  return (
    <div className="flex min-h-dvh bg-background">
      <Sidebar
        active={nav.active}
        inboxCount={nav.inboxCount}
        attentionCount={nav.attentionCount}
        {...account}
      />
      <div className="flex min-w-0 grow flex-col">
        <Header breadcrumb={title} live={live} onCompose={onCompose} onSearch={onSearch} />
        <TopBar
          title={title}
          live={live}
          account={account}
          onSearch={onSearch}
          actions={
            onCompose ? (
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
        <main className="flex grow flex-col gap-5 px-8 py-6 max-sm:gap-3.5 max-sm:px-4 max-sm:pt-3.5 max-sm:pb-[calc(var(--size-tabbar)+var(--spacing)*4)]">
          <div className="flex flex-wrap items-start justify-between gap-4 max-sm:gap-3">
            <div className="flex min-w-0 flex-col gap-1">
              <h1 className="text-title font-semibold tracking-tight text-foreground max-sm:hidden">{title}</h1>
              {description ? (
                <p className="text-meta text-muted-foreground max-sm:text-body-touch">{description}</p>
              ) : null}
            </div>
            {primaryAction ? <div className="shrink-0 max-sm:w-full max-sm:[&>*]:w-full">{primaryAction}</div> : null}
          </div>
          {toolbar}
          {children}
        </main>
      </div>
      <TabBar
        active={nav.active === 'overview' ? 'fleet' : nav.active === 'settings' ? undefined : nav.active}
        inboxCount={nav.inboxCount}
        attentionCount={nav.attentionCount}
      />
    </div>
  );
}
