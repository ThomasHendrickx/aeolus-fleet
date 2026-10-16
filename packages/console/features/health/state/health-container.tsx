'use client';

import type { ReactNode } from 'react';

import { useFleetSnapshot } from '../../../lib/fleet';
import { useFleetHealth } from '../../../lib/fleet-health';
import { spotsOf } from '../../../lib/machines';
import { useNow } from '../../../lib/now';
import { relativeTime } from '../../../lib/relative-time';
import type { Machine } from '../../../lib/trierarch-plugin-schemas';
import { useMachines } from '../../../lib/trierarch-plugin';
import { placeNote, type StuckPlace } from '../services/health-view';
import { HealthBoard } from '../ui/organisms/health-board';
import type { HealthMachine } from '../ui/organisms/machines-panel';

interface HealthContainerProps {
  /** Whether a machine's trierarch answers, as the Trierarchs page shows it. */
  renderLiveness: (machine: Machine) => ReactNode;
  /** More sections after the machines, such as silent squadron members. */
  children?: ReactNode;
}

/**
 * The Health page's board, read live: the fleet's health, each stalled
 * ship's last seen from the fleet snapshot, and the machines with how many
 * ships each crews when the trierarch plugin is connected.
 */
export function HealthContainer({ renderLiveness, children }: HealthContainerProps) {
  const now = useNow();
  const health = useFleetHealth();
  const fleet = useFleetSnapshot();
  const machines = useMachines();
  const ships = fleet.data ?? [];
  const shipsById = new Map(ships.map((ship) => [ship.id, ship]));
  const notes = new Map<StuckPlace, string>();
  for (const place of health.data?.stuck ?? []) {
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
      state={health.isError ? 'error' : health.data ? 'ready' : 'loading'}
      health={health.data}
      onRetry={() => {
        void health.refetch();
      }}
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
