import { Ship, TriangleAlert } from 'lucide-react';
import Link from 'next/link';
import type { ReactNode } from 'react';

/** The console's destinations on phone so far. */
export type TabBarDestination = 'fleet' | 'attention';

interface TabBarProps {
  /** The page the operator is on: its tab is marked current. */
  active: TabBarDestination;
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
  count?: number;
}) {
  const isCounted = count !== undefined && count > 0;
  return (
    <Link href={href} aria-current={isActive ? 'page' : undefined} data-testid={testId} className={TAB}>
      <span className="relative">
        {icon}
        {isCounted ? (
          <span
            data-testid={`${testId}-count`}
            className="absolute -top-1.5 -right-2 flex h-4 min-w-4 items-center justify-center rounded-full bg-destructive px-1 text-micro font-semibold text-destructive-foreground tabular-nums"
          >
            {count}
            <span className="sr-only"> need attention</span>
          </span>
        ) : null}
      </span>
      {label}
    </Link>
  );
}

/**
 * Phone navigation (docs/design/png/TabBar.png): 68 px including the safe
 * area, the same destinations and counts as Sidebar: Fleet, and Attention
 * with the undeliverable deliveries counted on its icon. The active tab uses
 * --primary for icon and label.
 */
export function TabBar({ active, attentionCount }: TabBarProps) {
  return (
    <nav
      aria-label="Console"
      data-slot="tab-bar"
      className="fixed inset-x-0 bottom-0 z-40 flex min-h-(--size-tabbar) border-t border-border bg-background pb-[env(safe-area-inset-bottom)] sm:hidden"
    >
      <Tab href="/" label="Fleet" icon={<Ship aria-hidden />} isActive={active === 'fleet'} testId="tab-fleet" />
      <Tab
        href="/needs-attention"
        label="Attention"
        icon={<TriangleAlert aria-hidden />}
        isActive={active === 'attention'}
        testId="tab-attention"
        count={attentionCount}
      />
    </nav>
  );
}
