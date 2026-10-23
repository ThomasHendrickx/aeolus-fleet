/**
 * The stuck snapshot over the in-memory state: its hour rows, the fold of the
 * latest, and the snapshot lock, which a test takes for another instance.
 */
import type { FleetId } from '@aeolus-fleet/common';

import type { SequencedEvent } from '../../src/domain/shared/events.js';
import { foldAt, type HealthFold } from '../../src/domain/shared/health-fold.js';
import { readsMessage } from '../../src/domain/registry/public.js';
import { hourMarkOf, stuckCountOf, type HealthSnapshotWriter, type HourSnapshot } from '../../src/domain/shared/health-snapshot.js';
import type { HealthRecords } from '../../src/domain/shared/health.js';
import type { DeliveryRecord } from '../../src/domain/shared/stuck.js';
import type { InMemoryState } from './in-memory.js';

const HOUR_MS = 60 * 60 * 1000;
const KEPT_HOURS = 168;

/** One hour row, as health_snapshots holds it; the fold is the latest row's. */
export interface HeldHourSnapshot extends HourSnapshot {
  fleetId: FleetId;
  fold: HealthFold;
}

export function createInMemoryHealthSnapshots(state: InMemoryState, health: HealthRecords): HealthSnapshotWriter {
  const numbered = (fleetId: FleetId): SequencedEvent[] =>
    state.events.filter((event) => event.fleetId === fleetId).map((event, index) => ({ ...event, seq: index + 1 }));
  const rowsOf = (fleetId: FleetId) => state.healthSnapshots.filter((row) => row.fleetId === fleetId).toSorted((first, second) => first.hour.getTime() - second.hour.getTime());
  const sentOf = (fleetId: FleetId, events: readonly SequencedEvent[]): DeliveryRecord[] =>
    events.flatMap((event) => {
      const delivery = state.deliveries.find((held) => held.fleetId === fleetId && held.id === event.deliveryId);
      const message = delivery && state.messages.find((held) => held.fleetId === fleetId && held.id === delivery.messageId);
      if (event.type !== 'MessageAccepted' || delivery === undefined || message === undefined) {
        return [];
      }
      return [
        {
          deliveryId: delivery.id,
          messageId: delivery.messageId,
          senderId: message.senderShipId,
          recipient: delivery.recipient,
          claimedBy: null,
          reachableShipIds: delivery.reachableShipIds ?? [],
          sentAt: delivery.createdAt,
          steps: [],
        },
      ];
    });

  return {
    latest: (fleetId) => {
      const row = rowsOf(fleetId).at(-1);
      return Promise.resolve(row && structuredClone({ hour: row.hour, fold: row.fold }));
    },
    hours: (fleetId, since) =>
      Promise.resolve(
        rowsOf(fleetId)
          .filter((row) => row.hour > since)
          .map(({ hour, stuck, acknowledged }) => structuredClone({ hour, stuck, acknowledged })),
      ),
    stuckCounts: (fleetId, { since, reach }) =>
      Promise.resolve(
        rowsOf(fleetId)
          .filter((row) => row.hour > since)
          .map((row) => stuckCountOf(row, (message) => readsMessage(reach, message))),
      ),
    acknowledgedHours: (fleetId, since) =>
      Promise.resolve(
        rowsOf(fleetId)
          .filter((row) => row.hour > since)
          .map(({ hour, acknowledged }) => structuredClone({ hour, acknowledged })),
      ),
    eventsAfter: (fleetId, { seq, limit }) => {
      const events = numbered(fleetId)
        .filter((event) => event.seq > seq)
        .slice(0, limit);
      return Promise.resolve({ events, sent: sentOf(fleetId, events) });
    },
    crews: async (fleetId, since) => {
      const { ships, leases } = await health.read(fleetId, since);
      return { ships, leases: leases.map((lease) => ({ ...lease, turns: [] })) };
    },
    crewsTouching: async (fleetId, { since, touched }) => {
      const { ships, leases } = await health.read(fleetId, since);
      const ofLeases = new Set(leases.filter((lease) => touched.leaseIds.includes(lease.leaseId)).map((lease) => lease.shipId));
      const touchedShips = ships.filter((ship) => touched.shipIds.includes(ship.shipId) || touched.types.includes(ship.type) || ofLeases.has(ship.shipId));
      const shipIds = new Set(touchedShips.map((ship) => ship.shipId));
      return {
        ships: touchedShips,
        leases: leases.filter((lease) => shipIds.has(lease.shipId) || touched.leaseIds.includes(lease.leaseId)).map((lease) => ({ ...lease, turns: [] })),
      };
    },
    machines: async (fleetId) => (await health.read(fleetId, new Date(0))).machines,
    tryLock: (fleetId) => Promise.resolve(!state.healthSnapshotLocks.includes(fleetId)),
    baseAt: async (fleetId, hour) => {
      const events = numbered(fleetId);
      const past = events.find((event) => event.occurredAt > hour);
      return foldAt(await health.read(fleetId, hour), { at: hour, seq: past === undefined ? events.length : past.seq - 1 });
    },
    write: (fleetId, { hours, fold }) => {
      const last = hours.at(-1);
      if (last === undefined) {
        return Promise.resolve();
      }
      const isLastNew = !state.healthSnapshots.some((row) => row.fleetId === fleetId && row.hour.getTime() === last.hour.getTime());
      for (const hour of hours) {
        if (!state.healthSnapshots.some((row) => row.fleetId === fleetId && row.hour.getTime() === hour.hour.getTime())) {
          state.healthSnapshots.push(structuredClone({ fleetId, ...hour, fold: hour === last ? fold : { ...fold, deliveries: [], turns: [] } }));
        }
      }
      if (isLastNew) {
        const oldest = hourMarkOf(new Date(last.hour.getTime() - (KEPT_HOURS - 1) * HOUR_MS));
        const kept = state.healthSnapshots.filter((row) => row.fleetId !== fleetId || row.hour >= oldest);
        state.healthSnapshots.splice(0, state.healthSnapshots.length, ...kept);
      }
      return Promise.resolve();
    },
  };
}
