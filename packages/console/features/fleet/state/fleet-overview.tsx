'use client';

import type { ShipId } from '@aeolus-fleet/common';
import { EmptyState, Harbour, HarbourNumbers } from '@aeolus-fleet/ui';
import { Ship } from 'lucide-react';
import Link from 'next/link';
import type { AnchorHTMLAttributes, ReactNode } from 'react';

import { useLabelContext } from '../../../lib/fleet';
import { useNow } from '../../../lib/now';
import { usePluginShipIds } from '../../../lib/plugin-ships';
import { useSessionFleetId } from '../../../lib/session-fleet-id';
import { useShipTypeCounts } from '../../../lib/ship-types';
import { useSquadrons } from '../../../lib/squadrons-api';
import { shipsInSquadrons } from '../../../lib/squadrons-view';
import { useFleetCounts, useFleetPages } from '../hooks/fleet-pages';
import { useHarbour, useHarbourNumbers } from '../hooks/harbour';
import { activeFilterCount, DEFAULT_FLEET_VIEW, type FleetView } from '../services/fleet-filter';
import { fleetListFilterOf, fleetListSortOf } from '../services/fleet-list-input';
import { NoMatch } from '../ui/molecules/no-match';
import { FleetBar } from '../ui/organisms/fleet-bar';
import { FleetTable, type FleetTableProps } from '../ui/organisms/fleet-table';

function errorDetailOf(error: unknown): string | undefined {
  return error instanceof Error ? error.message : undefined;
}

/**
 * The fleet overview (docs/design/fleet-overview, "One view: cards or
 * list"): Harbour's numbers on top for the whole fleet, then one bar, then
 * either Harbour's groups of tiles or the fleet table, filtered the same.
 * The cards read `fleet.harbour` with the bar's filter, every page; the list
 * reads `fleet.list` 20 a page with Load more, each ship with its actions
 * (from the page, since they are another feature). The view, search and
 * filters come from the page, which keeps them in the address. With argo
 * alone, no bar: there is nothing to filter, and what to do next.
 */
export function FleetOverview({
  view,
  onViewChange,
  placedFirstShipIds,
  renderRowActions,
  emptyAction,
}: {
  view: FleetView;
  onViewChange: (view: FleetView) => void;
  /** Ships a live event put first on the loaded pages: their rows get the highlight. */
  placedFirstShipIds: ReadonlySet<ShipId>;
  renderRowActions: FleetTableProps['renderRowActions'];
  /** argo alone: Commission your first ship, for those who may. */
  emptyAction: ReactNode;
}) {
  const now = useNow();
  const viewerFleetId = useSessionFleetId();
  const squadrons = useSquadrons();
  const labels = useLabelContext();
  const pluginShipIds = usePluginShipIds();
  const types = useShipTypeCounts();
  const isCards = view.mode === 'cards';
  const filter = fleetListFilterOf(view);
  const numbers = useHarbourNumbers();
  const harbour = useHarbour(filter, isCards);
  const ships = useFleetPages(isCards ? null : filter, fleetListSortOf(view.sort));
  const listCounts = useFleetCounts(isCards ? null : filter).counts;
  const counts = numbers.counts;
  const isOnlyArgo = counts !== undefined && counts.ships <= 1;
  const isUpdating = isCards ? harbour.isUpdating : ships.isPlaceholder;
  const isFailed = isCards ? numbers.isFailed || harbour.isFailed : ships.isFailed;
  // The bar filters what is read: while the first read runs or fails, there is nothing for it to filter.
  const isRead = counts !== undefined && (isCards ? harbour.groups !== undefined : ships.items !== undefined);
  const clear = () => {
    onViewChange({ ...DEFAULT_FLEET_VIEW, mode: view.mode, sort: view.sort });
  };

  const bar = isOnlyArgo || isFailed || !isRead ? null : (
    <FleetBar view={view} onViewChange={onViewChange} counts={counts} types={types} labels={labels} shown={isCards ? harbour.shown : listCounts?.shown} isUpdating={isUpdating} />
  );
  const noMatch = <NoMatch query={view.query} hasFilters={activeFilterCount(view.filters) > 0} fleetShips={counts?.ships} onClear={clear} />;
  const onlyArgo = isOnlyArgo ? (
    <EmptyState
      icon={<Ship />}
      title="No ships besides argo yet"
      description="argo is your own ship: messages to the operator land in its inbox. Commission a ship to add an agent to the fleet."
      action={emptyAction}
    />
  ) : null;

  if (isCards) {
    return (
      <section aria-label="Fleet" className="flex flex-col gap-3.5" data-testid="fleet-overview" data-view="cards">
        <Harbour
          counts={counts}
          groups={harbour.groups}
          now={now}
          hrefOf={(shipId) => `/ships/${shipId}`}
          link={({ href, ...props }: AnchorHTMLAttributes<HTMLAnchorElement>) => <Link {...props} href={href ?? '/'} />}
          between={bar}
          empty={noMatch}
          state={isFailed ? 'error' : isRead ? 'ready' : 'loading'}
          errorDetail={errorDetailOf(harbour.error ?? numbers.error)}
          onRetry={() => {
            numbers.retry();
            harbour.retry();
          }}
          isUpdating={isUpdating}
        />
        {onlyArgo}
      </section>
    );
  }

  return (
    <section aria-label="Fleet" className="flex flex-col gap-3.5" data-testid="fleet-overview" data-view="list">
      <HarbourNumbers counts={counts} />
      {bar}
      <FleetTable
        ships={ships.items ?? []}
        isOnlyArgo={isOnlyArgo}
        more={{ hasMore: ships.hasMore, isLoading: ships.isLoadingMore, isFailed: ships.isLoadMoreFailed, onLoad: ships.loadMore }}
        sort={view.sort}
        onSortChange={(sort) => {
          onViewChange({ ...view, sort });
        }}
        noMatch={noMatch}
        isUpdating={isUpdating}
        state={ships.isFailed ? 'error' : ships.items === undefined ? 'loading' : 'ready'}
        error={{ detail: errorDetailOf(ships.error), onRetry: ships.retry }}
        highlightedShipIds={placedFirstShipIds}
        now={now}
        viewerFleetId={viewerFleetId}
        renderRowActions={renderRowActions}
        emptyAction={emptyAction}
        squadronsOf={squadrons.data ? shipsInSquadrons(squadrons.data) : undefined}
        labels={labels}
        pluginShipIds={pluginShipIds}
      />
    </section>
  );
}
