'use client';

import { Activity, ChartColumn, Inbox, Network, Settings2, Shapes, Ship, ShipWheel, Users } from 'lucide-react';
import Link from 'next/link';
import type { ReactNode } from 'react';

import { Avatar } from '@aeolus-fleet/ui';
import { Badge } from '../atoms/badge';
import { NavLinkIcon } from '../molecules/nav-link-icon';

/** The console's destinations so far. */
export type SidebarDestination = 'overview' | 'needs-crew' | 'squadrons' | 'trierarchs' | 'usage' | 'inbox' | 'health' | 'network' | 'settings';

interface SidebarProps {
  /** The page the operator is on: its item is marked current. */
  active: SidebarDestination;
  /** What waits on the operator in argo's inbox, open questions and open messages; hidden until known, and when there are none. */
  inboxCount?: number;
  /** Stuck deliveries (decision 0042); hidden until known, and when there are none. */
  stuckCount?: number;
  /** Ships on Needs crew; hidden until known, and when there are none. */
  needsCrewCount?: number;
  /** Whether the console has squadrons: Squadrons then comes second. */
  hasSquadrons?: boolean;
  /** Whether the console has the trierarch plugin: Trierarchs then comes after Squadrons, and Usage after Trierarchs. */
  hasTrierarchs?: boolean;
  /** Silent machines; hidden until known, and when there are none. */
  trierarchsCount?: number;
  /** Whether Network is offered: argo's alone, while the networking plugin is connected (decision 0036). */
  hasNetwork?: boolean;
  /** Whether Settings is offered: it holds the plugins, and only a session that manages the fleet changes them. */
  hasSettings?: boolean;
}

const ITEM =
  'relative flex h-7.5 items-center gap-2.5 rounded-md px-2.5 text-body text-foreground transition-colors duration-(--duration-fast) hover:bg-accent aria-[current=page]:bg-accent aria-[current=page]:font-medium aria-[current=page]:[&_svg]:text-primary max-lg:justify-center max-lg:px-0 [&_svg]:size-(--size-icon) [&_svg]:shrink-0';

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
      <NavLinkIcon icon={icon} />
      <span className="grow max-lg:sr-only">{label}</span>
      {count}
    </Link>
  );
}

/**
 * The inbox count: a pill in --primary from 1024 px, a dot on the rail, the
 * number kept for assistive technology either way.
 */
function InboxCount({ count, testId = 'nav-inbox-count' }: { count: number | undefined; testId?: string }) {
  if (count === undefined || count === 0) {
    return null;
  }
  return (
    <>
      <Badge variant="count" data-testid={testId} className="h-4.5 min-w-4.5 max-lg:sr-only">
        {count}
        <span className="sr-only"> open</span>
      </Badge>
      <span aria-hidden className="absolute top-1.5 right-4 size-1.5 rounded-full bg-primary lg:hidden" />
    </>
  );
}

/** The Needs crew count: a neutral pill from 1024 px, a dot on the rail, the number kept for assistive technology either way. */
function NeedsCrewCount({ count }: { count: number | undefined }) {
  if (count === undefined || count === 0) {
    return null;
  }
  return (
    <>
      <Badge variant="count-neutral" data-testid="nav-needs-crew-count" className="h-4.5 min-w-4.5 max-lg:sr-only">
        {count}
        <span className="sr-only"> need crew</span>
      </Badge>
      <span aria-hidden className="absolute top-1.5 right-4 size-1.5 rounded-full bg-muted-foreground lg:hidden" />
    </>
  );
}

/**
 * The attention count: a pill in the attention tone from 1024 px, a dot on the
 * rail, the number kept for assistive technology either way.
 */
function AttentionCount({ count, testId, words }: { count: number | undefined; testId: string; words: string }) {
  if (count === undefined || count === 0) {
    return null;
  }
  return (
    <>
      <Badge variant="count-attention" data-testid={testId} className="h-4.5 min-w-4.5 max-lg:sr-only">
        {count}
        <span className="sr-only"> {words}</span>
      </Badge>
      <span aria-hidden className="absolute top-1.5 right-4 size-1.5 rounded-full bg-tone-attention-fg lg:hidden" />
    </>
  );
}

/**
 * Desktop navigation (docs/design/fleet-overview/console-desktop.html): the
 * mark and "Aeolus", then the destinations in one list. 256 px from 1024 px; a
 * 64 px rail from 640 to 1023 px, labels kept for assistive technology and
 * dots instead of numbers. Destinations: Fleet overview; Health, which counts
 * the stuck deliveries in the attention tone (#304); Needs crew, which counts
 * the ships on it (#245); with squadrons on, Squadrons; with the trierarch
 * plugin on, Trierarchs, counting its silent machines in the attention tone
 * (#245), and Usage; Operator inbox, which counts its open questions and open
 * messages in --primary; Network, the networking plugin's rules, for argo
 * while it is connected; and Settings, which holds the plugins. A count simply
 * hides until it is known.
 */
export function Sidebar({ active, inboxCount, stuckCount, needsCrewCount, hasSquadrons = false, hasTrierarchs = false, trierarchsCount, hasNetwork = false, hasSettings = false }: SidebarProps) {
  return (
    <aside
      data-slot="sidebar"
      className="sticky top-0 hidden h-dvh w-(--size-rail) shrink-0 flex-col border-r border-border bg-sidebar p-3 text-sidebar-foreground sm:flex lg:w-(--size-sidebar)"
    >
      <div className="mb-2.5 flex h-10 items-center gap-2.5 px-2 max-lg:justify-center max-lg:px-0">
        <Avatar kind="app" size={28} />
        <span className="text-body font-semibold text-foreground max-lg:sr-only">Aeolus</span>
      </div>
      <nav aria-label="Console" className="flex grow flex-col gap-0.5">
        <NavItem
          href="/"
          label="Fleet overview"
          icon={<Ship aria-hidden />}
          isActive={active === 'overview'}
          testId="nav-overview"
        />
        <NavItem
          href="/fleet-health"
          label="Health"
          icon={<Activity aria-hidden />}
          isActive={active === 'health'}
          testId="nav-health"
          count={<AttentionCount count={stuckCount} testId="nav-health-count" words="stuck" />}
        />
        <NavItem
          href="/needs-crew"
          label="Needs crew"
          icon={<Users aria-hidden />}
          isActive={active === 'needs-crew'}
          testId="nav-needs-crew"
          count={<NeedsCrewCount count={needsCrewCount} />}
        />
        {hasSquadrons && (
          <NavItem href="/squadrons" label="Squadrons" icon={<Shapes aria-hidden />} isActive={active === 'squadrons'} testId="nav-squadrons" />
        )}
        {hasTrierarchs && (
          <NavItem
            href="/trierarchs"
            label="Trierarchs"
            icon={<ShipWheel aria-hidden />}
            isActive={active === 'trierarchs'}
            testId="nav-trierarchs"
            count={<AttentionCount count={trierarchsCount} testId="nav-trierarchs-count" words="silent" />}
          />
        )}
        {hasTrierarchs && <NavItem href="/usage" label="Usage" icon={<ChartColumn aria-hidden />} isActive={active === 'usage'} testId="nav-usage" />}
        <NavItem
          href="/inbox"
          label="Operator inbox"
          icon={<Inbox aria-hidden />}
          isActive={active === 'inbox'}
          testId="nav-inbox"
          count={<InboxCount count={inboxCount} />}
        />
        {hasNetwork && <NavItem href="/network" label="Network" icon={<Network aria-hidden />} isActive={active === 'network'} testId="nav-network" />}
        {hasSettings && <NavItem href="/settings" label="Settings" icon={<Settings2 aria-hidden />} isActive={active === 'settings'} testId="nav-settings" />}
      </nav>
    </aside>
  );
}
