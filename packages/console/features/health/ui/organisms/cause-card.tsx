import { ChevronRight } from 'lucide-react';
import Link from 'next/link';

import { Badge } from '../../../../components/atoms/badge';
import { Button } from '../../../../components/atoms/button';
import { StatusBadge, statusLabel } from '../../../../components/molecules/status-badge';
import { duration } from '../../../../lib/relative-time';
import { CAUSE_SENTENCES, causePathOf, nextStepOf, waitMinutes, type CauseGroup, type StuckPlace } from '../../services/health-view';
import { WaitAxis, WaitStrip } from '../molecules/wait-strip';

interface CauseCardProps {
  group: CauseGroup;
  /** One line under a place that explains its wait, by place; none to add nothing. */
  notes: ReadonlyMap<StuckPlace, string>;
  now: Date;
}

function PlaceName({ place }: { place: StuckPlace['place'] }) {
  return place.kind === 'ship' ? <span className="font-medium text-foreground">{place.ship.name}</span> : <Badge variant="type">{place.type}</Badge>;
}

/**
 * One cause a delivery is stuck by (mock-up A): its badge and count, what it
 * waits on in one sentence, and each place with how many wait there and the
 * oldest, its wait strip on the shared scale and its one next step. The
 * title opens the cause's own page.
 */
export function CauseCard({ group, notes, now }: CauseCardProps) {
  const { cause, count, places } = group;
  return (
    <section
      aria-label={statusLabel(cause)}
      data-testid="health-cause"
      data-cause={cause}
      className="flex flex-col gap-3 rounded-lg border border-border bg-card p-4 shadow-sm max-sm:rounded-xl"
    >
      <header className="flex items-start justify-between gap-3">
        <Link href={causePathOf(cause)} className="group inline-flex items-center gap-1.5 rounded-md" data-testid="health-cause-open">
          <StatusBadge status={cause} />
          <ChevronRight aria-hidden className="size-(--size-icon-sm) text-muted-foreground group-hover:text-foreground" />
          <span className="sr-only">Open the deliveries {statusLabel(cause).toLowerCase()}</span>
        </Link>
        <span className="text-metric font-semibold tabular-nums text-foreground max-sm:text-title-touch">{count}</span>
      </header>
      <p className="text-body text-muted-foreground max-sm:text-body-touch">{CAUSE_SENTENCES[cause]}</p>
      <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)_auto] gap-x-4 max-sm:grid-cols-1">
        <div className="col-span-3 grid grid-cols-subgrid items-center text-caption font-medium text-muted-foreground max-sm:col-span-1">
          <span className="max-sm:hidden">Where, how long</span>
          <WaitAxis />
          <span className="text-right max-sm:hidden">Next step</span>
        </div>
        <ul className="col-span-3 grid grid-cols-subgrid divide-y divide-border max-sm:col-span-1">
          {places.map((place) => {
            const step = nextStepOf(place);
            const note = notes.get(place);
            const oldest = duration(new Date(place.oldestSince), now);
            return (
              <li
                key={`${place.cause}-${place.place.kind === 'ship' ? place.place.ship.id : place.place.type}`}
                data-testid="health-place"
                className="col-span-3 grid grid-cols-subgrid items-center gap-y-2 py-3 last:pb-0 max-sm:col-span-1"
              >
                <div className="flex min-w-0 flex-col gap-0.5">
                  <PlaceName place={place.place} />
                  <span className="text-meta tabular-nums text-muted-foreground">
                    {place.count} · oldest {oldest}
                  </span>
                </div>
                <WaitStrip waits={place.deliveries.map((delivery) => waitMinutes(delivery.since, now))} label={`${String(place.count)} waiting, the oldest ${oldest}`} />
                <Button
                  variant="secondary"
                  size="sm"
                  nativeButton={false}
                  render={<Link href={step.href} />}
                  className="max-sm:h-(--size-control-touch) max-sm:w-full max-sm:text-body-touch"
                  data-testid="health-next-step"
                >
                  {step.label}
                </Button>
                {note !== undefined && <p className="col-span-3 text-meta text-muted-foreground max-sm:col-span-1">{note}</p>}
              </li>
            );
          })}
        </ul>
      </div>
    </section>
  );
}
