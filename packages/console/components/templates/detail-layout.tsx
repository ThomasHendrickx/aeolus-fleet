import type { ReactNode } from 'react';

import type { LiveState } from '../molecules/live-status';
import type { AccountMenuProps } from '../organisms/account-menu';
import { Header, type BreadcrumbLevel } from '../organisms/header';
import { Sidebar, type SidebarDestination } from '../organisms/sidebar';
import { TabBar } from '../organisms/tab-bar';
import { TopBar } from '../organisms/top-bar';

interface DetailLayoutProps {
  /** The page's name: the end of the desktop breadcrumb and the phone TopBar title. */
  title: string;
  /** Every level above the page, the top first: "Squadrons", then a squadron. The phone TopBar's back link goes to the last. */
  parents: readonly [BreadcrumbLevel, ...BreadcrumbLevel[]];
  /** ShipHeader. */
  header: ReactNode;
  /** The Tabs and their content. */
  children: ReactNode;
  /** A sheet over the page: the MessageSheet. */
  sheet?: ReactNode;
  live: LiveState;
  /** Where the operator is, and the counts the navigation shows once known. */
  /** hasSquadrons, hasTrierarchs: whether the console has squadrons or the trierarch plugin, which adds them to the navigation; hasSettings: whether Settings is offered (a plugin on and a session that manages the fleet). */
  nav: { active: SidebarDestination; inboxCount?: number; attentionCount?: number; needsCrewCount?: number; hasSquadrons?: boolean; hasTrierarchs?: boolean; trierarchsCount?: number; hasSettings?: boolean };
  /** Opens Compose: the Header's button, and on phone the TopBar's icon on a root page. */
  onCompose?: () => void;
  /** Opens the CommandPalette: the Header's search trigger, and on phone the root TopBar's search icon. */
  onSearch?: () => void;
  /** The signed-in operator, for the AccountMenu: the Sidebar's on desktop, the root TopBar's on phone. */
  account: AccountMenuProps;
  /** The installation's notices for this session, above the page on desktop and phone. */
  banner?: ReactNode;
}

/**
 * The ship page (docs/design/png/DetailLayout.png). Desktop: Sidebar, Header
 * with the breadcrumb, ShipHeader, then line Tabs and their content; a message
 * opens in the side Sheet over the page. Phone: TopBar in detail mode with the
 * back link, the stacked ShipHeader and segmented Tabs, the TabBar's height
 * kept free at the bottom.
 */
export function DetailLayout({
  title,
  parents,
  header,
  children,
  sheet,
  live,
  nav,
  onCompose,
  onSearch,
  account,
  banner,
}: DetailLayoutProps) {
  return (
    <div className="flex min-h-dvh bg-background">
      <Sidebar
        active={nav.active}
        inboxCount={nav.inboxCount}
        attentionCount={nav.attentionCount}
        needsCrewCount={nav.needsCrewCount}
        hasSquadrons={nav.hasSquadrons}
        hasTrierarchs={nav.hasTrierarchs}
        trierarchsCount={nav.trierarchsCount}
        hasSettings={nav.hasSettings}
        {...account}
      />
      <div className="flex min-w-0 grow flex-col">
        <Header breadcrumb={title} parents={parents} live={live} onCompose={onCompose} onSearch={onSearch} />
        {banner}
        <TopBar title={title} live={live} back={parents[parents.length - 1] ?? parents[0]} />
        <main className="flex grow flex-col gap-5 px-8 py-6 max-sm:gap-3.5 max-sm:px-4 max-sm:pt-3.5 max-sm:pb-[calc(var(--size-tabbar)+var(--spacing)*4)]">
          {header}
          {children}
        </main>
      </div>
      {sheet}
      <TabBar
        active={nav.active === 'overview' || nav.active === 'needs-crew' ? 'fleet' : nav.active === 'settings' ? undefined : nav.active}
        hasSquadrons={nav.hasSquadrons}
        hasTrierarchs={nav.hasTrierarchs}
        trierarchsCount={nav.trierarchsCount}
        inboxCount={nav.inboxCount}
        attentionCount={nav.attentionCount}
      />
    </div>
  );
}
