/**
 * The fleet's network settings and the records of the sends they refused, on
 * Postgres (decision 0034). A send and a change of rules take turns on a
 * transaction-level advisory lock on the fleet's settings: a send holds it
 * shared, a set exclusively. An advisory lock, not a row lock: Postgres
 * queues a shared request behind an exclusive one that waits, so a stream of
 * sends never starves a change, and the lock holds before the fleet first set
 * rules. The settings are read after the lock, so they are the latest
 * committed.
 */
import { carriedLabelSchema, idSchema, networkRuleSchema, type FleetId } from '@aeolus-fleet/common';
import { z } from 'zod';

import { noNetworkSettings, type NetworkSettings } from '../../domain/registry/network-settings.js';
import type { NetworkSettingsRepository, ReachRefusalRepository } from '../../domain/registry/ports.js';
import type { ReachRefusal, RefusedShip } from '../../domain/registry/reach-refusal.js';
import type { Db } from './client.js';
import { Prisma } from './generated/client.js';

const settingsRowSchema = z.object({ rules: z.array(networkRuleSchema).nullable(), version: z.number().int().min(0) });

const refusedShipSchema = z.object({ id: idSchema('ship'), name: z.string(), labels: z.array(carriedLabelSchema) });

const refusalRowSchema = z.object({
  id: idSchema('reachRefusal'),
  fleetId: idSchema('fleet'),
  at: z.date(),
  sender: refusedShipSchema,
  recipient: z.discriminatedUnion('kind', [
    z.object({ kind: z.literal('ship'), ship: refusedShipSchema }),
    z.object({ kind: z.literal('type'), type: z.string(), ships: z.array(refusedShipSchema) }),
  ]),
  settingsVersion: z.number().int().min(1),
});

export function createPrismaNetworkSettingsRepository(db: Db): NetworkSettingsRepository {
  const read = async (fleetId: FleetId): Promise<NetworkSettings> => {
    const row = await db.networkSettings.findUnique({ where: { fleetId }, select: { rules: true, version: true } });
    if (!row) {
      return noNetworkSettings(fleetId);
    }
    const { rules, version } = settingsRowSchema.parse(row);
    return { fleetId, rules, version };
  };
  return {
    findForShare: async (fleetId) => {
      await db.$executeRaw`SELECT pg_advisory_xact_lock_shared(hashtext(${fleetId}), hashtext('network-settings'))`;
      return read(fleetId);
    },
    findForUpdate: async (fleetId) => {
      await db.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${fleetId}), hashtext('network-settings'))`;
      return read(fleetId);
    },
    save: async ({ fleetId, rules, version }) => {
      const kept = rules === null ? Prisma.DbNull : rules.map((rule) => ({ from: [...rule.from], to: [...rule.to] }));
      await db.networkSettings.upsert({ where: { fleetId }, create: { fleetId, rules: kept, version }, update: { rules: kept, version } });
    },
  };
}

export function createPrismaReachRefusalRepository(db: Db): ReachRefusalRepository {
  return {
    record: async ({ id, fleetId, at, sender, recipient, settingsVersion }) => {
      await db.reachRefusal.create({ data: { id, fleetId, at, sender: shipJson(sender), recipient: recipientJson(recipient), settingsVersion } });
    },
    latest: async (fleetId, limit) => {
      const rows = await db.reachRefusal.findMany({ where: { fleetId }, orderBy: [{ at: 'desc' }, { id: 'desc' }], take: limit });
      return rows.map((row): ReachRefusal => refusalRowSchema.parse(row));
    },
  };
}

function shipJson(ship: RefusedShip) {
  return { id: ship.id, name: ship.name, labels: ship.labels.map((label) => ({ ...label })) };
}

function recipientJson(recipient: ReachRefusal['recipient']) {
  return recipient.kind === 'ship' ? { kind: recipient.kind, ship: shipJson(recipient.ship) } : { kind: recipient.kind, type: recipient.type, ships: recipient.ships.map(shipJson) };
}
