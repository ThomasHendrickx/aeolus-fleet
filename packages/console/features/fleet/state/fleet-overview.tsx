'use client';

import type { ShipId } from '@aeolus-fleet/common';

import { useLabelContext } from '../../../lib/fleet';
import { usePluginShipIds } from '../../../lib/plugin-ships';
import type { FleetView } from '../services/fleet-filter';
import { fleetListFilterOf, fleetListSortOf } from '../services/fleet-list-input';
import { useNow } from '../../../lib/now';
import { useSessionFleetId } from '../../../lib/session-fleet-id';
import { useSquadrons } from '../../../lib/squadrons-api';
import { shipsInSquadrons } from '../../../lib/squadrons-view';
import { useShipTypes } from '../../../lib/ship-types';
import { useFleetCounts, useFleetPages, useOpenAlerts } from '../hooks/fleet-pages';
import { OpenAlerts } from '../ui/organisms/open-alerts';
import { FleetTable, type FleetTableProps } from '../ui/organisms/fleet-table';

/** The types the Type filter offers: the fleet's and those picked, each once, sorted. */
function typesOf(types: readonly string[], picked: readonly string[]): string[] {
  return [...new Set([...types, ...picked])].toSorted((first, second) => first.localeCompare(second));
}

/**
 * The fleet overview: the ships the view selects, 20 a page as `fleet.list`
 * orders them, with Load more, in FleetTable, each ship with its actions
 * behind their dialogs (from the page, since they are another feature), and
 * with squadrons on, each flagship's and member's squadron, and each ship's
 * labels with the label filter (#102). Search, filters and sort come from
 * the page, which keeps them in the URL; the counts from `fleet.shipCounts`
 * and the Type filter's types from `fleet.shipTypes`. Open alerts above the
 * table from `fleet.openAlerts`, read beside the list (decision 0071).
 */
export function FleetOverview({
  view,
  onViewChange,
  placedFirstShipIds,
  renderRowActions,
}: {
  view: FleetView;
  onViewChange: (view: FleetView) => void;
  /** Ships a live event put first on the loaded pages: their rows get the highlight. */
  placedFirstShipIds: ReadonlySet<ShipId>;
  renderRowActions: FleetTableProps['renderRowActions'];
}) {
  const now = useNow();
  const viewerFleetId = useSessionFleetId();
  const squadrons = useSquadrons();
  const labels = useLabelContext();
  const pluginShipIds = usePluginShipIds();
  const squadronsOf = squadrons.data ? shipsInSquadrons(squadrons.data) : undefined;
  const filter = fleetListFilterOf(view, { squadronsOf, pluginShipIds });
  const ships = useFleetPages(filter, fleetListSortOf(view.sort));
  const { counts, isOnlyArgo } = useFleetCounts(filter);
  const types = useShipTypes(view.filters.isRetiredShown);
  const openAlerts = useOpenAlerts();

  return (
    <section aria-label="Fleet" className="flex flex-col gap-3">
      {openAlerts === undefined ? null : <OpenAlerts alerts={openAlerts.alerts} hasMore={openAlerts.hasMore} now={now} />}
      <FleetTable
        ships={ships.items ?? []}
        counts={counts}
        isOnlyArgo={isOnlyArgo}
        types={typesOf(types ?? [], view.filters.type)}
        more={{ hasMore: ships.hasMore, isLoading: ships.isLoadingMore, isFailed: ships.isLoadMoreFailed, onLoad: ships.loadMore }}
        view={view}
        onViewChange={onViewChange}
        state={ships.isFailed ? 'error' : ships.items === undefined ? 'loading' : 'ready'}
        error={{ detail: ships.error instanceof Error ? ships.error.message : undefined, onRetry: ships.retry }}
        highlightedShipIds={placedFirstShipIds}
        now={now}
        viewerFleetId={viewerFleetId}
        renderRowActions={renderRowActions}
        squadronsOf={squadronsOf}
        labels={labels}
        pluginShipIds={pluginShipIds}
      />
    </section>
  );
}
