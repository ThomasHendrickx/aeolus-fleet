import type { ReactNode } from 'react';

import type { LiveState } from '../molecules/live-status';
import { Header, type BreadcrumbLevel } from './header';
import { TopBar } from './top-bar';

interface DetailPageProps {
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
  /** Opens Compose: the Header's button. */
  onCompose?: () => void;
  /** Opens the CommandPalette: the Header's search trigger. */
  onSearch?: () => void;
  /** The installation's notices for this session, above the page on desktop and phone. */
  banner?: ReactNode;
}

/**
 * A detail page inside the ConsoleFrame, such as the ship page
 * (docs/design/png/DetailLayout.png). Desktop: Header with the breadcrumb,
 * ShipHeader, then line Tabs and their content; a message opens in the side
 * Sheet over the page. Phone: TopBar in detail mode with the back link, the
 * stacked ShipHeader and segmented Tabs, the TabBar's height kept free at
 * the bottom.
 */
export function DetailPage({ title, parents, header, children, sheet, live, onCompose, onSearch, banner }: DetailPageProps) {
  return (
    <>
      <Header breadcrumb={title} parents={parents} live={live} onCompose={onCompose} onSearch={onSearch} />
      {banner}
      <TopBar title={title} live={live} back={parents[parents.length - 1] ?? parents[0]} />
      <main className="flex grow flex-col gap-5 px-8 py-6 max-sm:gap-3.5 max-sm:px-4 max-sm:pt-3.5 max-sm:pb-[calc(var(--size-tabbar)+var(--spacing)*4)]">
        {header}
        {children}
      </main>
      {sheet}
    </>
  );
}
