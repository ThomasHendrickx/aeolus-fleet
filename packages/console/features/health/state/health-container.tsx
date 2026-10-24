'use client';

import type { StuckCause } from '@aeolus-fleet/common';
import type { ReactNode } from 'react';

import { useFleetSnapshot } from '../../../lib/fleet';
import { useAcknowledged, useStuckHistory, useStuckPlaces, useStuckSummary } from '../../../lib/fleet-health';
import { spotsOf } from '../../../lib/machines';
import { useNow } from '../../../lib/now';
import type { PagedList } from '../../../lib/paged-list';
import { relativeTime } from '../../../lib/relative-time';
import type { Machine } from '../../../lib/trierarch-plugin-schemas';
import { useMachines } from '../../../lib/trierarch-plugin';
import { placeNote, type StuckPlace } from '../services/health-view';
import type { CausePlacesRead } from '../ui/organisms/cause-card';
import { HealthBoard, type HealthPartRead } from '../ui/organisms/health-board';
import type { HealthMachine } from '../ui/organisms/machines-panel';

interface HealthContainerProps {
  /** Whether a machine's trierarch answers, as the Trierarchs page shows it. */
  renderLiveness: (machine: Machine) => ReactNode;
  /** More sections after the machines, such as silent squadron members. */
  children?: ReactNode;
}

/**
 * The Health page's board, read live: the stuck summary, each cause's places
 * (read only for a cause with anything stuck), the trend and the
 * acknowledged, each by its own read; each stalled ship's last seen
 * from the fleet snapshot, and the machines with how many ships each crews
 * when the trierarch plugin is connected.
 */
export function HealthContainer({ renderLiveness, children }: HealthContainerProps) {
  const now = useNow();
  const summary = useStuckSummary();
  const isStuckBy = (cause: StuckCause) => summary.data?.byCause.some((total) => total.cause === cause) ?? false;
  const places: Record<StuckCause, CausePlacesRead> = {
    noShipCanTake: causePlacesReadOf(useStuckPlaces('noShipCanTake', isStuckBy('noShipCanTake'))),
    waitingForCrew: causePlacesReadOf(useStuckPlaces('waitingForCrew', isStuckBy('waitingForCrew'))),
    stalledInFlight: causePlacesReadOf(useStuckPlaces('stalledInFlight', isStuckBy('stalledInFlight'))),
    undeliverable: causePlacesReadOf(useStuckPlaces('undeliverable', isStuckBy('undeliverable'))),
  };
  const stuckPerHour = useStuckHistory();
  const acknowledged = useAcknowledged();
  const fleet = useFleetSnapshot();
  const machines = useMachines();
  const ships = fleet.data ?? [];
  const shipsById = new Map(ships.map((ship) => [ship.id, ship]));
  const notes = new Map<StuckPlace, string>();
  for (const place of Object.values(places).flatMap((read) => read.places ?? [])) {
    const ship = place.place.kind === 'ship' ? shipsById.get(place.place.ship.id) : undefined;
    const note = placeNote(place, { facts: ship && { lastSeenAt: ship.lastSeenAt }, since: (at) => relativeTime(at, now) });
    if (note !== null) {
      notes.set(place, note);
    }
  }
  const machinesById = new Map<string, Machine>((machines.data ?? []).map((machine) => [machine.shipId, machine]));
  const healthMachines: HealthMachine[] | undefined = machines.data?.map((machine) => ({ id: machine.shipId, name: machine.name, ships: spotsOf(machine, ships).length }));
  return (
    <HealthBoard
      summary={partRead(summary)}
      places={places}
      stuckPerHour={partRead(stuckPerHour)}
      acknowledged={partRead(acknowledged)}
      notes={notes}
      machines={healthMachines}
      renderLiveness={(machine) => {
        const listed = machinesById.get(machine.id);
        return listed === undefined ? null : renderLiveness(listed);
      }}
      now={now}
    >
      {children}
    </HealthBoard>
  );
}

/** A query as the board shows its part. */
function partRead<T>(query: { data: T | undefined; isError: boolean; refetch: () => Promise<unknown> }): HealthPartRead<T> {
  return {
    data: query.data,
    isError: query.isError,
    onRetry: () => {
      void query.refetch();
    },
  };
}

/** A cause's paged places as its card shows them. */
function causePlacesReadOf(list: PagedList<StuckPlace, unknown>): CausePlacesRead {
  return {
    places: list.items,
    isFailed: list.isFailed,
    onRetry: list.retry,
    hasMore: list.hasMore,
    isLoadingMore: list.isLoadingMore,
    isLoadMoreFailed: list.isLoadMoreFailed,
    onLoadMore: list.loadMore,
  };
}
