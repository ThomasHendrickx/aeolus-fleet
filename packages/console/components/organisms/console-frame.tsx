import type { ReactNode } from 'react';

import type { AccountMenuProps } from './account-menu';
import { Sidebar, type SidebarDestination } from './sidebar';
import { TabBar } from './tab-bar';

/**
 * Where the operator is, and the counts the navigation shows once known.
 * hasSquadrons, hasTrierarchs: whether the console has squadrons or the trierarch plugin, which adds them to the navigation;
 * hasNetwork: whether Network is offered (argo, the networking plugin connected);
 * hasSettings: whether Settings is offered (a plugin on and a session that manages the fleet).
 */
export interface ConsoleNav {
  active: SidebarDestination;
  inboxCount?: number;
  attentionCount?: number;
  needsCrewCount?: number;
  hasSquadrons?: boolean;
  hasTrierarchs?: boolean;
  trierarchsCount?: number;
  hasNetwork?: boolean;
  hasSettings?: boolean;
}

/**
 * The frame around every signed-in page (docs/design/png/ListLayout.png,
 * DetailLayout.png): the Sidebar on desktop, the TabBar on phone, and the
 * page between them, a ListPage or a DetailPage. The signed-in route layout
 * fills it.
 */
export function ConsoleFrame({ nav, account, children }: { nav: ConsoleNav; account: AccountMenuProps; children: ReactNode }) {
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
        hasNetwork={nav.hasNetwork}
        hasSettings={nav.hasSettings}
        {...account}
      />
      <div className="flex min-w-0 grow flex-col">{children}</div>
      <TabBar
        active={nav.active === 'overview' || nav.active === 'needs-crew' ? 'fleet' : nav.active === 'settings' || nav.active === 'network' ? undefined : nav.active}
        hasSquadrons={nav.hasSquadrons}
        hasTrierarchs={nav.hasTrierarchs}
        trierarchsCount={nav.trierarchsCount}
        inboxCount={nav.inboxCount}
        attentionCount={nav.attentionCount}
      />
    </div>
  );
}
