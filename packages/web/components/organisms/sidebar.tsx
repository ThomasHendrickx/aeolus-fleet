'use client';

import { CodeXml, Inbox, Settings, Shapes, Ship, TriangleAlert } from 'lucide-react';
import Link from 'next/link';
import type { ReactNode } from 'react';

import { Avatar } from '../atoms/avatar';
import { Badge } from '../atoms/badge';
import { SOURCE_URL } from '../../lib/source';
import { AccountMenu, type AccountMenuProps } from './account-menu';

/** The console's destinations so far. */
export type SidebarDestination = 'overview' | 'squadrons' | 'inbox' | 'attention' | 'settings';

interface SidebarProps extends AccountMenuProps {
  /** The page the operator is on: its item is marked current. */
  active: SidebarDestination;
  /** Open messages to argo; hidden until known, and when there are none. */
  inboxCount?: number;
  /** Undeliverable deliveries; hidden until known, and when there are none. */
  attentionCount?: number;
  /** Whether the console has squadrons: Squadrons then comes second. */
  hasSquadrons?: boolean;
  /** Whether Settings is offered: it holds squadrons alone today, and only a session that manages the fleet changes them. */
  hasSettings?: boolean;
}

const ITEM =
  'relative flex h-(--size-control) items-center gap-2.5 rounded-md px-2.5 text-body text-muted-foreground transition-colors duration-(--duration-fast) hover:bg-accent hover:text-foreground aria-[current=page]:bg-accent aria-[current=page]:font-medium aria-[current=page]:text-foreground max-lg:justify-center max-lg:px-0 [&_svg]:size-(--size-icon) [&_svg]:shrink-0';

function NavItem({
  href,
  label,
  icon,
  isActive,
  testId,
  count,
}: {
  href: string;
  label: string;
  icon: ReactNode;
  isActive: boolean;
  testId: string;
  count?: ReactNode;
}) {
  return (
    <Link href={href} aria-current={isActive ? 'page' : undefined} data-testid={testId} className={ITEM}>
      {icon}
      <span className="grow max-lg:sr-only">{label}</span>
      {count}
    </Link>
  );
}

/**
 * The inbox count: a pill in --primary from 1024 px, a dot on the rail, the
 * number kept for assistive technology either way.
 */
function InboxCount({ count }: { count: number | undefined }) {
  if (count === undefined || count === 0) {
    return null;
  }
  return (
    <>
      <Badge variant="count" data-testid="nav-inbox-count" className="max-lg:sr-only">
        {count}
        <span className="sr-only"> open</span>
      </Badge>
      <span aria-hidden className="absolute top-1.5 right-4 size-1.5 rounded-full bg-primary lg:hidden" />
    </>
  );
}

/**
 * The attention count: a pill in the attention tone from 1024 px, a dot on the
 * rail, the number kept for assistive technology either way.
 */
function AttentionCount({ count }: { count: number | undefined }) {
  if (count === undefined || count === 0) {
    return null;
  }
  return (
    <>
      <Badge variant="count-attention" data-testid="nav-attention-count" className="max-lg:sr-only">
        {count}
        <span className="sr-only"> need attention</span>
      </Badge>
      <span aria-hidden className="absolute top-1.5 right-4 size-1.5 rounded-full bg-tone-attention-fg lg:hidden" />
    </>
  );
}

/**
 * Desktop navigation (docs/design/png/Sidebar.png): the brand, the
 * destinations and the AccountMenu of the signed-in operator, which opens
 * upwards. 256 px
 * from 1024 px; a 64 px rail from 640 to 1023 px, labels kept for assistive
 * technology and dots instead of numbers. Destinations so far: Fleet overview;
 * Operator inbox, which counts the open messages to argo in --primary; and
 * Needs attention, which counts the undeliverable deliveries in the attention
 * tone. A count simply hides until it is known. With squadrons on, Squadrons
 * comes second, and Settings, which holds squadrons alone today, sits with
 * the link to the source on GitHub above the account menu.
 */
export function Sidebar({ active, inboxCount, attentionCount, hasSquadrons = false, hasSettings = false, ...account }: SidebarProps) {
  return (
    <aside
      data-slot="sidebar"
      className="sticky top-0 hidden h-dvh w-(--size-rail) shrink-0 flex-col border-r border-border bg-sidebar text-sidebar-foreground sm:flex lg:w-(--size-sidebar)"
    >
      <div className="flex h-(--size-header) items-center gap-2.5 px-4 max-lg:justify-center max-lg:px-0">
        <Avatar kind="app" size={28} />
        <div className="flex flex-col max-lg:sr-only">
          <span className="text-body font-semibold text-foreground">Aeolus</span>
          <span className="text-caption text-muted-foreground">Operator console</span>
        </div>
      </div>
      <nav aria-label="Console" className="flex grow flex-col gap-0.5 px-2.5 py-2">
        <NavItem
          href="/"
          label="Fleet overview"
          icon={<Ship aria-hidden />}
          isActive={active === 'overview'}
          testId="nav-overview"
        />
        {hasSquadrons && (
          <NavItem href="/squadrons" label="Squadrons" icon={<Shapes aria-hidden />} isActive={active === 'squadrons'} testId="nav-squadrons" />
        )}
        <NavItem
          href="/inbox"
          label="Operator inbox"
          icon={<Inbox aria-hidden />}
          isActive={active === 'inbox'}
          testId="nav-inbox"
          count={<InboxCount count={inboxCount} />}
        />
        <NavItem
          href="/needs-attention"
          label="Needs attention"
          icon={<TriangleAlert aria-hidden />}
          isActive={active === 'attention'}
          testId="nav-attention"
          count={<AttentionCount count={attentionCount} />}
        />
      </nav>
      <div className="px-2.5 pb-2">
        {hasSettings && <NavItem href="/settings" label="Settings" icon={<Settings aria-hidden />} isActive={active === 'settings'} testId="nav-settings" />}
        <a href={SOURCE_URL} target="_blank" rel="noreferrer" data-testid="nav-source" className={ITEM}>
          <CodeXml aria-hidden />
          <span className="grow max-lg:sr-only">Source on GitHub</span>
          <span className="sr-only"> (opens in a new tab)</span>
        </a>
      </div>
      <div className="border-t border-border p-2.5">
        <AccountMenu {...account} />
      </div>
    </aside>
  );
}
