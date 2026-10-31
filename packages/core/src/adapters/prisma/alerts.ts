import { alertClearedWhySchema, alertSignalFactsSchema, idSchema, type AlertSignalFacts } from '@aeolus-fleet/common';

import type { Alert } from '../../domain/registry/alert.js';
import type { AlertRepository } from '../../domain/registry/ports.js';
import type { Db } from './client.js';

interface AlertRow {
  id: string;
  fleetId: string;
  shipId: string;
  signal: string;
  occurrenceKey: string;
  facts: unknown;
  ownerShipId: string | null;
  since: Date;
  raisedAt: Date;
  clearedAt: Date | null;
  clearedWhy: string | null;
}

/** The alert a row holds, its signal and facts parsed by common's schema. */
export function alertOf(row: AlertRow): Alert {
  const signalFacts: AlertSignalFacts = alertSignalFactsSchema.parse({ signal: row.signal, facts: row.facts });
  return {
    ...signalFacts,
    fleetId: idSchema('fleet').parse(row.fleetId),
    id: idSchema('alert').parse(row.id),
    shipId: idSchema('ship').parse(row.shipId),
    occurrenceKey: row.occurrenceKey,
    ownerShipId: row.ownerShipId === null ? null : idSchema('ship').parse(row.ownerShipId),
    since: row.since,
    raisedAt: row.raisedAt,
    cleared: row.clearedAt === null ? null : { at: row.clearedAt, why: alertClearedWhySchema.parse(row.clearedWhy) },
  };
}

/** The fleet's alerts on Postgres (decision 0071), unique per ship, signal and occurrence. */
export function createPrismaAlertRepository(db: Db): AlertRepository {
  const find: AlertRepository['find'] = async (fleetId, alertId) => {
    const row = await db.alert.findFirst({ where: { fleetId, id: alertId } });
    return row === null ? undefined : alertOf(row);
  };
  return {
    findByOccurrence: async (fleetId, { shipId, signal, occurrenceKey }) => {
      const row = await db.alert.findUnique({ where: { fleetId_shipId_signal_occurrenceKey: { fleetId, shipId, signal, occurrenceKey } } });
      return row === null ? undefined : alertOf(row);
    },
    find,
    findForUpdate: async (fleetId, alertId) => {
      await db.$queryRaw`SELECT 1 FROM alerts WHERE fleet_id = ${fleetId} AND id = ${alertId} FOR UPDATE`;
      return find(fleetId, alertId);
    },
    listOpenOnShipForUpdate: async (fleetId, shipId) => {
      // Through alerts_open_on_ship_idx.
      await db.$queryRaw`SELECT 1 FROM alerts WHERE fleet_id = ${fleetId} AND ship_id = ${shipId} AND cleared_at IS NULL FOR UPDATE`;
      return (await db.alert.findMany({ where: { fleetId, shipId, clearedAt: null }, orderBy: { id: 'asc' } })).map(alertOf);
    },
    create: async (alert) => {
      await db.alert.create({
        data: {
          id: alert.id,
          fleetId: alert.fleetId,
          shipId: alert.shipId,
          signal: alert.signal,
          occurrenceKey: alert.occurrenceKey,
          facts: alert.facts,
          ownerShipId: alert.ownerShipId,
          since: alert.since,
          raisedAt: alert.raisedAt,
        },
      });
    },
    saveCleared: async (alert) => {
      await db.alert.update({
        where: { id: alert.id, fleetId: alert.fleetId },
        data: { clearedAt: alert.cleared?.at ?? null, clearedWhy: alert.cleared?.why ?? null },
      });
    },
  };
}
