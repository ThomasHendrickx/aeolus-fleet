import Link from 'next/link';

import { classNames } from '../../lib/class-names';

/**
 * The Fleet tab's two views on phone (#245, decision 6): every ship, and
 * Needs crew, with how many ships are on it. Segmented, as views of one list
 * are (docs/design/conventions.md, "Components: which one"). Desktop has
 * Needs crew in the Sidebar instead.
 */
export function FleetSegments({ active, needsCrewCount }: { active: 'ships' | 'needs-crew'; needsCrewCount?: number }) {
  const segment = (isActive: boolean) =>
    classNames(
      'flex h-(--size-control-touch) grow items-center justify-center gap-1.5 rounded-md text-body-touch font-medium',
      isActive ? 'bg-card text-foreground shadow-sm' : 'text-muted-foreground',
    );
  return (
    <nav aria-label="Fleet views" className="flex gap-0.5 rounded-lg border border-border bg-muted p-0.5 sm:hidden" data-testid="fleet-segments">
      <Link href="/" aria-current={active === 'ships' ? 'page' : undefined} className={segment(active === 'ships')} data-testid="fleet-segment-ships">
        Ships
      </Link>
      <Link href="/needs-crew" aria-current={active === 'needs-crew' ? 'page' : undefined} className={segment(active === 'needs-crew')} data-testid="fleet-segment-needs-crew">
        Needs crew
        {needsCrewCount === undefined || needsCrewCount === 0 ? null : <span className="text-micro tabular-nums">{needsCrewCount}</span>}
      </Link>
    </nav>
  );
}
