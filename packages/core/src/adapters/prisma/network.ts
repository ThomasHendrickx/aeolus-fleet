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
import { carriedLabelSchema, idSchema, networkRuleSchema, WHILE_UNAVAILABLE, type FleetId } from '@aeolus-fleet/common';
import { z } from 'zod';

import { noNetworkSettings, type NetworkSettings } from '../../domain/registry/network-settings.js';
import type { DeclaredNetworkRulesRepository, NetworkSettingsRepository, ReachRefusalRepository } from '../../domain/registry/ports.js';
import type { ReachRefusal, RefusedShip } from '../../domain/registry/reach-refusal.js';
import type { Db } from './client.js';
import { Prisma } from './generated/client.js';

const settingsRowSchema = z.object({
  rules: z.array(networkRuleSchema).nullable(),
  version: z.number().int().min(0),
  pluginShipId: idSchema('ship').nullable(),
  pluginWhileUnavailable: z.enum(WHILE_UNAVAILABLE).nullable(),
  pluginNotRespondingAfterSeconds: z.number().int().nullable(),
});

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
  whilePluginUnavailable: z.enum(['block-all', 'keep-latest']).nullable(),
});

export function createPrismaNetworkSettingsRepository(db: Db): NetworkSettingsRepository {
  const read = async (fleetId: FleetId): Promise<NetworkSettings> => {
    const row = await db.networkSettings.findUnique({
      where: { fleetId },
      select: { rules: true, version: true, pluginShipId: true, pluginWhileUnavailable: true, pluginNotRespondingAfterSeconds: true },
    });
    if (!row) {
      return noNetworkSettings(fleetId);
    }
    const { rules, version, pluginShipId, pluginWhileUnavailable, pluginNotRespondingAfterSeconds } = settingsRowSchema.parse(row);
    // The table's check keeps the three set together or none.
    const plugin =
      pluginShipId !== null && pluginWhileUnavailable !== null && pluginNotRespondingAfterSeconds !== null
        ? { shipId: pluginShipId, whileUnavailable: pluginWhileUnavailable, notRespondingAfterSeconds: pluginNotRespondingAfterSeconds }
        : null;
    return { fleetId, rules, version, plugin };
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
    save: async ({ fleetId, rules, version, plugin }) => {
      const kept = {
        rules: rules === null ? Prisma.DbNull : rules.map((rule) => ({ from: [...rule.from], to: [...rule.to] })),
        version,
        pluginShipId: plugin?.shipId ?? null,
        pluginWhileUnavailable: plugin?.whileUnavailable ?? null,
        pluginNotRespondingAfterSeconds: plugin?.notRespondingAfterSeconds ?? null,
      };
      await db.networkSettings.upsert({ where: { fleetId }, create: { fleetId, ...kept }, update: kept });
    },
  };
}

/** Each ship's declared rules (decision 0037): one row per declaring ship, none while it declares none. */
export function createPrismaDeclaredNetworkRulesRepository(db: Db): DeclaredNetworkRulesRepository {
  const declaredOf = (row: { fleetId: string; shipId: string; rules: unknown }) => ({
    fleetId: idSchema('fleet').parse(row.fleetId),
    shipId: idSchema('ship').parse(row.shipId),
    rules: z.array(networkRuleSchema).parse(row.rules),
  });
  return {
    list: async (fleetId) => (await db.declaredNetworkRules.findMany({ where: { fleetId }, orderBy: { shipId: 'asc' } })).map(declaredOf),
    find: async (fleetId, shipId) => {
      const row = await db.declaredNetworkRules.findUnique({ where: { fleetId_shipId: { fleetId, shipId } } });
      return row ? declaredOf(row) : undefined;
    },
    save: async ({ fleetId, shipId, rules }) => {
      if (rules.length === 0) {
        await db.declaredNetworkRules.deleteMany({ where: { fleetId, shipId } });
        return;
      }
      const kept = { rules: rules.map((rule) => ({ from: [...rule.from], to: [...rule.to] })) };
      await db.declaredNetworkRules.upsert({ where: { fleetId_shipId: { fleetId, shipId } }, create: { fleetId, shipId, ...kept }, update: kept });
    },
  };
}

export function createPrismaReachRefusalRepository(db: Db): ReachRefusalRepository {
  return {
    record: async ({ id, fleetId, at, sender, recipient, settingsVersion, whilePluginUnavailable }) => {
      await db.reachRefusal.create({ data: { id, fleetId, at, sender: shipJson(sender), recipient: recipientJson(recipient), settingsVersion, whilePluginUnavailable } });
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
