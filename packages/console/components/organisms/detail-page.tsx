import type { AppsAndFleetsState, AvatarMenuProps } from '@aeolus-fleet/ui';
import type { AppSwitcherModel } from '@aeolus-fleet/common/rules';
import Link from 'next/link';
import type { ReactNode } from 'react';

import type { LiveState } from '../molecules/live-status';
import { Header, type BreadcrumbLevel } from './header';

interface DetailPageProps {
  /** The page's name: the end of the breadcrumb. */
  title: string;
  /** Every level above the page, the top first: "Squadrons", then a squadron; each links up to it. */
  parents: readonly [BreadcrumbLevel, ...BreadcrumbLevel[]];
  /** ShipHeader. */
  header: ReactNode;
  /** The Tabs and their content. */
  children: ReactNode;
  /** A sheet over the page: the MessageSheet. */
  sheet?: ReactNode;
  live: LiveState;
  /** The app and the fleet in the bar; undefined until the session is read. */
  switcher: AppSwitcherModel | undefined;
  /** What the console knows of the apps and fleets beyond the list, and its handlers. */
  switcherState?: AppsAndFleetsState;
  /** The account button, at the end of the bar. */
  account: AvatarMenuProps;
  /** Opens Compose: the bar's button, an icon on phone. */
  onCompose?: () => void;
  /** Opens the CommandPalette: the bar's search field, an icon on phone. */
  onSearch?: () => void;
  /** The installation's notices for this session, above the page on desktop and phone. */
  banner?: ReactNode;
}

/**
 * The breadcrumb in the page on phone, where the bar has no room for it
 * (docs/design/app-navigation, section 4): every level above the page links
 * up to it, then the page.
 */
function PhoneBreadcrumb({ title, parents }: { title: string; parents: readonly BreadcrumbLevel[] }) {
  return (
    <nav aria-label="Breadcrumb" data-testid="page-breadcrumb" className="text-meta text-muted-foreground sm:hidden">
      <ol className="flex flex-wrap items-center gap-1">
        {parents.map((level) => (
          <li key={level.href} className="flex items-center gap-1">
            <Link href={level.href} className="inline-flex min-h-(--size-control-touch) items-center hover:text-foreground hover:underline">
              {level.label}
            </Link>
            <span aria-hidden>/</span>
          </li>
        ))}
        <li aria-current="page" className="min-w-0 truncate">
          {title}
        </li>
      </ol>
    </nav>
  );
}

/**
 * A detail page inside the ConsoleFrame, such as the ship page
 * (docs/design/png/DetailPage.png), under the console's bar (Header) at both
 * widths. Desktop: the breadcrumb in the bar, ShipHeader, then line Tabs and
 * their content; a message opens in the side Sheet over the page. Phone: the
 * breadcrumb at the top of the page, the stacked ShipHeader and segmented
 * Tabs, the TabBar's height kept free at the bottom.
 */
export function DetailPage({ title, parents, header, children, sheet, live, switcher, switcherState, account, onCompose, onSearch, banner }: DetailPageProps) {
  return (
    <>
      <Header
        breadcrumb={title}
        parents={parents}
        live={live}
        switcher={switcher}
        {...(switcherState === undefined ? {} : { switcherState })}
        account={account}
        onCompose={onCompose}
        onSearch={onSearch}
      />
      {banner}
      <main className="flex grow flex-col gap-4 px-6 py-5 max-sm:gap-3.5 max-sm:px-4 max-sm:pt-3.5 max-sm:pb-[calc(var(--size-tabbar)+var(--spacing)*4)]">
        <PhoneBreadcrumb title={title} parents={parents} />
        {header}
        {children}
      </main>
      {sheet}
    </>
  );
}
