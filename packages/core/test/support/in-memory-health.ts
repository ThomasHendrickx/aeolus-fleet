/**
 * The health records (decision 0042) over the in-memory state: what the
 * stuck rule reads, as the Postgres adapter reads it from its tables.
 */
import type { FleetId, TurnState } from '@aeolus-fleet/common';

import type { HealthRecords } from '../../src/domain/shared/health.js';
import { stateStepOf, type DeliveryRecord, type LeaseRecord, type ShipRecord } from '../../src/domain/shared/stuck.js';
import type { InMemoryState } from './in-memory.js';

const OPEN_STATES = new Set(['pending', 'received', 'handed', 'undeliverable']);

function isTurnState(value: unknown): value is TurnState {
  return value === 'idle' || value === 'busy';
}

export function createInMemoryHealthRecords(state: InMemoryState): HealthRecords {
  const eventsOf = (fleetId: FleetId) => state.events.filter((event) => event.fleetId === fleetId);
  const lastSeenOf = (fleetId: FleetId, lease: { id: string; startedAt: Date }) =>
    state.leaseSeen.find((seen) => seen.fleetId === fleetId && seen.leaseId === lease.id)?.at ?? lease.startedAt;

  return {
    read: (fleetId, since) => {
      const events = eventsOf(fleetId);
      const ships = state.ships
        .filter((ship) => ship.fleetId === fleetId && (ship.retiredAt === null || ship.retiredAt >= since))
        .map(
          (ship): ShipRecord => ({
            shipId: ship.id,
            name: ship.name,
            type: ship.type,
            isAlwaysCrewed: ship.kind !== 'agent',
            commissionedAt: ship.createdAt,
            retiredAt: ship.retiredAt,
          }),
        );
      const leases = state.leases
        .filter((lease) => lease.fleetId === fleetId && (lease.endedAt === null || lease.endedAt >= since))
        .map(
          (lease): LeaseRecord => ({
            leaseId: lease.id,
            shipId: lease.shipId,
            startedAt: lease.startedAt,
            endedAt: lease.endedAt,
            pushedAt: state.pushedLeases.find((pushed) => pushed.fleetId === fleetId && pushed.leaseId === lease.id)?.at ?? null,
            lastSeenAt: lastSeenOf(fleetId, lease),
            turns: events.flatMap((event) => {
              const turn = event.details.turn;
              return event.type === 'TurnReported' && event.details.leaseId === lease.id && isTurnState(turn) ? [{ state: turn, at: event.occurredAt }] : [];
            }),
          }),
        );
      const deliveries = state.deliveries
        .filter((delivery) => delivery.fleetId === fleetId)
        .map((delivery) => ({ delivery, events: events.filter((event) => event.deliveryId === delivery.id) }))
        .filter(({ delivery, events: its }) => OPEN_STATES.has(delivery.state) || its.some((event) => event.occurredAt >= since))
        .map(
          ({ delivery, events: its }): DeliveryRecord => ({
            deliveryId: delivery.id,
            recipient: delivery.recipient,
            reachableShipIds: delivery.reachableShipIds ?? [],
            sentAt: delivery.createdAt,
            steps: its.flatMap((event) => stateStepOf(event) ?? []),
          }),
        );
      const machines = state.crewRequests.flatMap((request) => {
        const machine = state.ships.find((ship) => ship.fleetId === fleetId && ship.id === request.assignedTo);
        if (request.fleetId !== fleetId || machine === undefined) {
          return [];
        }
        const lease = state.leases.find((held) => held.fleetId === fleetId && held.shipId === machine.id && held.endedAt === null);
        return [{ shipId: request.shipId, machine: { id: machine.id, name: machine.name, lastSeenAt: lease === undefined ? null : lastSeenOf(fleetId, lease) } }];
      });
      return Promise.resolve({ ships, leases, deliveries, machines });
    },
    acknowledged: (fleetId, since) => {
      const waits = eventsOf(fleetId)
        .filter((event) => event.type === 'DeliveryAcknowledged' && event.occurredAt >= since)
        .flatMap((event) => {
          const delivery = state.deliveries.find((held) => held.fleetId === fleetId && held.id === event.deliveryId);
          return delivery === undefined ? [] : [event.occurredAt.getTime() - delivery.createdAt.getTime()];
        })
        .toSorted((first, second) => first - second);
      const middle = Math.floor(waits.length / 2);
      const median = waits.length % 2 === 1 ? waits[middle] : ((waits[middle - 1] ?? 0) + (waits[middle] ?? 0)) / 2;
      return Promise.resolve({ count: waits.length, medianMs: waits.length === 0 ? null : (median ?? null) });
    },
  };
}
