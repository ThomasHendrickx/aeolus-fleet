import { AppSwitcher, AvatarMenuSheet, Button, type AppSwitcherModel, type AvatarMenuProps } from '@aeolus-fleet/common/header';
import { ChevronLeft, Search } from 'lucide-react';
import Link from 'next/link';
import type { ReactNode } from 'react';

import { LiveStatus, type LiveState } from '../molecules/live-status';

interface TopBarProps {
  /** The page title: in detail mode the bar's title; in root mode the switcher stands in its place, and the page shows its own title. */
  title: string;
  /** Root mode: the switcher, compact (header design H6); undefined until the session is read. */
  switcher?: AppSwitcherModel;
  live: LiveState;
  /** Up to two icon-only Buttons, each with its aria-label. */
  actions?: ReactNode;
  /**
   * Detail mode: the back link, labelled with the page it returns to. The page
   * below carries its own title then, so the bar's title is no heading.
   */
  back?: { href: string; label: string };
  /** Root mode: the avatar menu, always last. Detail and modal modes need none. */
  account?: AvatarMenuProps;
  /** Root mode: the search icon that opens the CommandPalette full screen, before the other actions. */
  onSearch?: () => void;
}

/**
 * Phone top bar (docs/design/png/TopBar.png), 56 px. Root mode: the
 * switcher, the app's name with ▾ that opens the fleets and apps in a bottom
 * Sheet (header design H6), the live status, the CommandPalette's search
 * icon, up to two icon actions and the avatar menu, always last, which opens
 * as a bottom Sheet. Detail mode: a back link
 * labelled with the previous page, the title and the live status. Modal mode
 * comes with the pages that need it.
 */
export function TopBar({ title, live, actions, back, switcher, account, onSearch }: TopBarProps) {
  const search = onSearch && !back ? onSearch : undefined;
  return (
    <header
      data-slot="top-bar"
      data-mode={back ? 'detail' : 'root'}
      className="sticky top-0 z-30 flex h-(--size-header) items-center gap-2.5 border-b border-border bg-background px-4 sm:hidden"
    >
      {back ? (
        <>
          <Link
            href={back.href}
            className="-ml-1.5 inline-flex h-(--size-control-touch) shrink-0 items-center gap-0.5 rounded-md pr-2 text-body-touch text-foreground focus-visible:outline-2 focus-visible:outline-ring [&_svg]:size-(--size-icon)"
          >
            <ChevronLeft aria-hidden />
            {back.label}
          </Link>
          <p className="min-w-0 flex-1 truncate text-center text-body-touch font-semibold text-foreground">{title}</p>
        </>
      ) : (
        // Until the session is read the console's own name stands in: the switcher only adds where else to go.
        switcher ? <AppSwitcher switcher={switcher} layout="compact" className="min-w-0" /> : <p className="truncate px-1.5 text-title-touch font-semibold text-foreground">Console</p>
      )}
      <LiveStatus state={live} />
      {actions || search || (account && !back) ? (
        <div className="ml-auto flex items-center gap-1">
          {search ? (
            <Button
              variant="ghost"
              size="touch"
              isIconOnly
              aria-label="Search ships or jump to"
              data-testid="top-bar-search"
              onClick={search}
            >
              <Search aria-hidden />
            </Button>
          ) : null}
          {actions}
          {account && !back ? <AvatarMenuSheet {...account} /> : null}
        </div>
      ) : null}
    </header>
  );
}
