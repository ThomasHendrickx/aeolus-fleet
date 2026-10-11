'use client';

import type { ShipId } from '@aeolus-fleet/common';

import { useFleetSnapshot, useLabelContext } from '../../../lib/fleet';
import { usePluginShipIds } from '../../../lib/plugin-ships';
import type { FleetView } from '../lib/fleet-filter';
import { useNow } from '../../../lib/now';
import { useSquadrons } from '../../../lib/squadrons-api';
import { shipsInSquadrons } from '../../../lib/squadrons-view';
import { FleetTable, type FleetTableProps } from './fleet-table';

/**
 * The fleet overview: the live snapshot in FleetTable, each ship with its
 * actions behind their dialogs (from the page, since they are another feature), and with squadrons on, each flagship's and
 * member's squadron, and each ship's labels with the label filter (#102). Search and filters come from the page, which
 * keeps them in the URL.
 */
export function FleetOverview({
  view,
  onViewChange,
  newShipIds,
  renderRowActions,
}: {
  view: FleetView;
  onViewChange: (view: FleetView) => void;
  /** Ships commissioned since the page opened: their rows get the highlight. */
  newShipIds: ReadonlySet<ShipId>;
  renderRowActions: FleetTableProps['renderRowActions'];
}) {
  const fleet = useFleetSnapshot();
  const now = useNow();
  const squadrons = useSquadrons();
  const labels = useLabelContext();
  const pluginShipIds = usePluginShipIds();

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
        renderRowActions={renderRowActions}
        squadronsOf={squadrons.data ? shipsInSquadrons(squadrons.data) : undefined}
        labels={labels}
        pluginShipIds={pluginShipIds}
      />
    </section>
  );
}
