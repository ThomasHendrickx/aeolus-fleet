import { Inbox, Ship, TriangleAlert } from 'lucide-react';
import Link from 'next/link';
import type { ReactNode } from 'react';

import { classNames } from '../../lib/class-names';

/** The console's destinations on phone so far. */
export type TabBarDestination = 'fleet' | 'inbox' | 'attention';

interface TabBarProps {
  /** The page the operator is on: its tab is marked current; none on a page no tab leads to, such as Settings. */
  active: TabBarDestination | undefined;
  /** Open messages to argo; hidden until known, and when there are none. */
  inboxCount?: number;
  /** Undeliverable deliveries; hidden until known, and when there are none. */
  attentionCount?: number;
}

const TAB =
  'flex grow flex-col items-center justify-center gap-1 text-micro text-muted-foreground outline-none focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring aria-[current=page]:font-medium aria-[current=page]:text-primary [&_svg]:size-(--size-icon-tab)';

function Tab({
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
  count?: { value: number | undefined; tone: 'primary' | 'attention'; words: string };
}) {
  const isCounted = count?.value !== undefined && count.value > 0;
  return (
    <Link href={href} aria-current={isActive ? 'page' : undefined} data-testid={testId} className={TAB}>
      <span className="relative">
        {icon}
        {isCounted ? (
          <span
            data-testid={`${testId}-count`}
            className={classNames(
              'absolute -top-1.5 -right-2 flex h-4 min-w-4 items-center justify-center rounded-full px-1 text-micro font-semibold tabular-nums',
              count.tone === 'primary' ? 'bg-primary text-primary-foreground' : 'bg-destructive text-destructive-foreground',
            )}
          >
            {count.value}
            <span className="sr-only"> {count.words}</span>
          </span>
        ) : null}
      </span>
      {label}
    </Link>
  );
}

/**
 * Phone navigation (docs/design/png/TabBar.png): 68 px including the safe
 * area, the same destinations and counts as Sidebar: Fleet; Inbox with the
 * open messages to argo counted on its icon in --primary; and Attention with
 * the undeliverable deliveries counted in the attention tone. The active tab
 * uses --primary for icon and label.
 */
export function TabBar({ active, inboxCount, attentionCount }: TabBarProps) {
  return (
    <nav
      aria-label="Console"
      data-slot="tab-bar"
      className="fixed inset-x-0 bottom-0 z-40 flex min-h-(--size-tabbar) border-t border-border bg-background pb-[env(safe-area-inset-bottom)] sm:hidden"
    >
      <Tab href="/" label="Fleet" icon={<Ship aria-hidden />} isActive={active === 'fleet'} testId="tab-fleet" />
      <Tab
        href="/inbox"
        label="Inbox"
        icon={<Inbox aria-hidden />}
        isActive={active === 'inbox'}
        testId="tab-inbox"
        count={{ value: inboxCount, tone: 'primary', words: 'open' }}
      />
      <Tab
        href="/needs-attention"
        label="Attention"
        icon={<TriangleAlert aria-hidden />}
        isActive={active === 'attention'}
        testId="tab-attention"
        count={{ value: attentionCount, tone: 'attention', words: 'need attention' }}
      />
    </nav>
  );
}
