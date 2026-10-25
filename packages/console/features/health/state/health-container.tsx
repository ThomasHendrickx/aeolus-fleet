'use client';

import type { StuckCause } from '@aeolus-fleet/common';
import type { ReactNode } from 'react';

import { HistoryKeptFrom } from '../../../components/molecules/history-kept-from';
import { useFleetLimits } from '../../../lib/fleet-limits';
import { useAcknowledged, useStuckHistory, useStuckPlaces, useStuckSummary } from '../../../lib/fleet-health';
import { useListedShips } from '../../../lib/listed-ships';
import { useNow } from '../../../lib/now';
import type { PagedList } from '../../../lib/paged-list';
import { relativeTime } from '../../../lib/relative-time';
import type { Machine } from '../../../lib/trierarch-plugin-schemas';
import { notOfferedOf } from '../../../lib/machines';
import { useMachines } from '../../../lib/trierarch-plugin';
import { useMachineShipCounts } from '../hooks/use-machine-ship-counts';
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
 * acknowledged, each by its own read; the last seen of each ship a shown
 * place names, read by id, and the machines with how many ships each crews,
 * counted per machine, when the trierarch plugin is connected; last, where
 * the fleet's kept history begins (fleet.limits). Never the whole fleet.
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
  const keptFrom = useFleetLimits().data?.retention.keptFrom ?? null;
  const machines = useMachines();
  const shownPlaces = Object.values(places).flatMap((read) => read.places ?? []);
  const shipsById = useListedShips(shownPlaces.flatMap(({ place }) => (place.kind === 'ship' ? [place.ship.id] : [])));
  const machineShipCounts = useMachineShipCounts((machines.data ?? []).map((machine) => machine.shipId));
  const notes = new Map<StuckPlace, string>();
  for (const place of shownPlaces) {
    const ship = place.place.kind === 'ship' ? shipsById?.get(place.place.ship.id) : undefined;
    const note = placeNote(place, { facts: ship && { lastSeenAt: ship.lastSeenAt }, since: (at) => relativeTime(at, now) });
    if (note !== null) {
      notes.set(place, note);
    }
  }
  const machinesById = new Map<string, Machine>((machines.data ?? []).map((machine) => [machine.shipId, machine]));
  const notOffered = notOfferedOf(machines.data ?? []);
  const healthMachines: HealthMachine[] | undefined = machines.data?.map((machine) => ({ id: machine.shipId, name: machine.name, ships: machineShipCounts.get(machine.shipId) ?? 0, notOffered: notOffered.filter((one) => one.machineId === machine.shipId) }));
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
      <HistoryKeptFrom keptFrom={keptFrom} area="health" />
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
