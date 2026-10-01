import type { ReactNode } from 'react';

import type { LiveState } from '../molecules/live-status';
import { Header } from '../organisms/header';
import { Sidebar } from '../organisms/sidebar';
import { TabBar } from '../organisms/tab-bar';
import { TopBar } from '../organisms/top-bar';

interface DetailLayoutProps {
  /** The page's name: the end of the desktop breadcrumb and the phone TopBar title. */
  title: string;
  /** Where the page sits, before its name: "Fleet overview". */
  parent: { href: string; label: string };
  /** ShipHeader. */
  header: ReactNode;
  /** The Tabs and their content. */
  children: ReactNode;
  /** A sheet over the page: the MessageSheet. */
  sheet?: ReactNode;
  live: LiveState;
  onSignOut: () => void;
}

/**
 * The ship page (docs/design/png/DetailLayout.png). Desktop: Sidebar, Header
 * with the breadcrumb, ShipHeader, then line Tabs and their content; a message
 * opens in the side Sheet over the page. Phone: TopBar in detail mode with the
 * back link, the stacked ShipHeader and segmented Tabs, the TabBar's height
 * kept free at the bottom.
 */
export function DetailLayout({ title, parent, header, children, sheet, live, onSignOut }: DetailLayoutProps) {
  return (
    <div className="flex min-h-dvh bg-background">
      <Sidebar active="overview" onSignOut={onSignOut} />
      <div className="flex min-w-0 grow flex-col">
        <Header breadcrumb={`${parent.label} / ${title}`} live={live} />
        <TopBar title={title} live={live} back={{ href: parent.href, label: parent.label }} />
        <main className="flex grow flex-col gap-5 px-8 py-6 max-sm:gap-3.5 max-sm:px-4 max-sm:pt-3.5 max-sm:pb-[calc(var(--size-tabbar)+var(--spacing)*4)]">
          {header}
          {children}
        </main>
      </div>
      {sheet}
      <TabBar active="fleet" />
    </div>
  );
}
