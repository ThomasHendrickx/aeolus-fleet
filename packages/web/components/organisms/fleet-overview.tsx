'use client';

import type { ShipId } from '@aeolus-fleet/common';

import { useFleetSnapshot } from '../../lib/fleet';
import type { FleetView } from '../../lib/fleet-filter';
import { useNow } from '../../lib/now';
import { useSquadrons } from '../../lib/squadrons-api';
import { shipsInSquadrons } from '../../lib/squadrons-view';
import { FleetTable } from './fleet-table';
import { ShipActions } from './ship-actions';

/**
 * The fleet overview: the live snapshot in FleetTable, each ship with its
 * actions behind their dialogs, and with squadrons on, each flagship's and
 * member's squadron. Search and filters come from the page, which
 * keeps them in the URL.
 */
export function FleetOverview({
  view,
  onViewChange,
  newShipIds,
}: {
  view: FleetView;
  onViewChange: (view: FleetView) => void;
  /** Ships commissioned since the page opened: their rows get the highlight. */
  newShipIds: ReadonlySet<ShipId>;
}) {
  const fleet = useFleetSnapshot();
  const now = useNow();
  const squadrons = useSquadrons();

  return (
    <section aria-label="Fleet" className="flex flex-col gap-3">
      <FleetTable
        ships={fleet.data ?? []}
        view={view}
        onViewChange={onViewChange}
        state={fleet.isPending ? 'loading' : fleet.isError ? 'error' : 'ready'}
        error={{
          detail: fleet.error?.message,
          onRetry: () => {
            void fleet.refetch();
          },
        }}
        highlightedShipIds={newShipIds}
        now={now}
        renderRowActions={(ship) => <ShipActions ship={ship} />}
        squadronsOf={squadrons.data ? shipsInSquadrons(squadrons.data) : undefined}
      />
    </section>
  );
}
