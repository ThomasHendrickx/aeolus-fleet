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
import { accountIdSchema, carriedLabelSchema, idSchema, NETWORK_VERBS, networkRuleSchema, WHILE_UNAVAILABLE, type FleetId } from '@aeolus-fleet/common';
import { z } from 'zod';

import type { DeclaredNetworkRules } from '../../domain/registry/declared-network-rules.js';
import { noNetworkSettings, type NetworkRule, type NetworkSettings } from '../../domain/registry/network-settings.js';
import type { DeclaredNetworkRulesRepository, NetworkSettingsRepository, ReachRefusalRepository } from '../../domain/registry/ports.js';
import type { ReachRefusal, RefusedActor, RefusedShip } from '../../domain/registry/reach-refusal.js';
import type { Db } from './client.js';
import { Prisma } from './generated/client.js';

const settingsRowSchema = z.object({
  rules: z.array(networkRuleSchema),
  version: z.number().int().min(0),
  pluginShipId: idSchema('ship').nullable(),
  pluginWhileUnavailable: z.enum(WHILE_UNAVAILABLE).nullable(),
  pluginNotRespondingAfterSeconds: z.number().int().nullable(),
  pluginRegisteredAt: z.date().nullable(),
  builtInViewerRead: z.boolean(),
  builtInOpenSend: z.boolean(),
  builtInOpenRead: z.boolean(),
  builtInOpenManage: z.boolean(),
});

const refusedShipSchema = z.object({
  id: idSchema('ship'),
  name: z.string(),
  labels: z.array(carriedLabelSchema),
  owner: z.object({ id: idSchema('ship'), name: z.string() }).nullable(),
});

/** Who a refusal refused (decision 0057): a ship as before, an account by its id only, or the installation. */
const refusedActorSchema = z.union([
  // A ship's record kept before accounts were actors names no kind.
  refusedShipSchema.extend({ kind: z.literal('ship').default('ship') }),
  z.object({
    kind: z.literal('account'),
    accountId: accountIdSchema,
    labels: z.array(carriedLabelSchema),
    personShip: z.object({ id: idSchema('ship'), name: z.string() }).nullable(),
  }),
  z.object({ kind: z.literal('installation') }),
]);

const refusalRowSchema = z.object({
  id: idSchema('reachRefusal'),
  fleetId: idSchema('fleet'),
  at: z.date(),
  sender: refusedActorSchema,
  askedBy: refusedShipSchema.nullable(),
  recipient: z.discriminatedUnion('kind', [
    z.object({ kind: z.literal('ship'), ship: refusedShipSchema }),
    z.object({ kind: z.literal('type'), type: z.string(), ships: z.array(refusedShipSchema) }),
  ]),
  verb: z.enum(NETWORK_VERBS),
  settingsVersion: z.number().int().min(1),
  whilePluginUnavailable: z.enum(['block-all', 'keep-latest']).nullable(),
});

export function createPrismaNetworkSettingsRepository(db: Db): NetworkSettingsRepository {
  const read = async (fleetId: FleetId): Promise<NetworkSettings> => {
    const row = await db.networkSettings.findUnique({
      where: { fleetId },
      select: {
        rules: true,
        version: true,
        pluginShipId: true,
        pluginWhileUnavailable: true,
        pluginNotRespondingAfterSeconds: true,
        pluginRegisteredAt: true,
        builtInViewerRead: true,
        builtInOpenSend: true,
        builtInOpenRead: true,
        builtInOpenManage: true,
      },
    });
    if (!row) {
      return noNetworkSettings(fleetId);
    }
    const { rules, version, pluginShipId, pluginWhileUnavailable, pluginNotRespondingAfterSeconds, pluginRegisteredAt, ...builtIn } = settingsRowSchema.parse(row);
    // The table's check keeps the four set together or none.
    const plugin =
      pluginShipId !== null && pluginWhileUnavailable !== null && pluginNotRespondingAfterSeconds !== null && pluginRegisteredAt !== null
        ? { shipId: pluginShipId, whileUnavailable: pluginWhileUnavailable, notRespondingAfterSeconds: pluginNotRespondingAfterSeconds, registeredAt: pluginRegisteredAt }
        : null;
    const builtIns = { isViewerReadOn: builtIn.builtInViewerRead, open: { send: builtIn.builtInOpenSend, read: builtIn.builtInOpenRead, manage: builtIn.builtInOpenManage } };
    return { fleetId, rules, builtIns, version, plugin };
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
    find: read,
    save: async ({ fleetId, rules, builtIns, version, plugin }) => {
      const kept = {
        rules: rules.map((rule) => ({ verb: rule.verb, from: [...rule.from], to: [...rule.to] })),
        builtInViewerRead: builtIns.isViewerReadOn,
        builtInOpenSend: builtIns.open.send,
        builtInOpenRead: builtIns.open.read,
        builtInOpenManage: builtIns.open.manage,
        version,
        pluginShipId: plugin?.shipId ?? null,
        pluginWhileUnavailable: plugin?.whileUnavailable ?? null,
        pluginNotRespondingAfterSeconds: plugin?.notRespondingAfterSeconds ?? null,
        pluginRegisteredAt: plugin?.registeredAt ?? null,
      };
      await db.networkSettings.upsert({ where: { fleetId }, create: { fleetId, ...kept }, update: kept });
    },
  };
}

/**
 * Each declarer's declared rules (decisions 0037, 0052): one row per declaring
 * ship, and one per fleet for the installation, none while it declares none.
 */
export function createPrismaDeclaredNetworkRulesRepository(db: Db): DeclaredNetworkRulesRepository {
  const rulesOf = (rules: unknown) => z.array(networkRuleSchema).parse(rules);
  const keptOf = (rules: readonly NetworkRule[]) => ({ rules: rules.map((rule) => ({ verb: rule.verb, from: [...rule.from], to: [...rule.to] })) });
  const shipsOf = (row: { fleetId: string; shipId: string; rules: unknown }): DeclaredNetworkRules => ({
    fleetId: idSchema('fleet').parse(row.fleetId),
    declarer: { kind: 'ship', shipId: idSchema('ship').parse(row.shipId) },
    rules: rulesOf(row.rules),
  });
  const installationsOf = (row: { fleetId: string; rules: unknown }): DeclaredNetworkRules => ({
    fleetId: idSchema('fleet').parse(row.fleetId),
    declarer: { kind: 'installation' },
    rules: rulesOf(row.rules),
  });
  return {
    list: async (fleetId) => {
      const ships = await db.declaredNetworkRules.findMany({ where: { fleetId }, orderBy: { shipId: 'asc' } });
      const installation = await db.installationDeclaredNetworkRules.findUnique({ where: { fleetId } });
      return [...ships.map(shipsOf), ...(installation ? [installationsOf(installation)] : [])];
    },
    find: async (fleetId, declarer) => {
      if (declarer.kind === 'installation') {
        const row = await db.installationDeclaredNetworkRules.findUnique({ where: { fleetId } });
        return row ? installationsOf(row) : undefined;
      }
      const row = await db.declaredNetworkRules.findUnique({ where: { fleetId_shipId: { fleetId, shipId: declarer.shipId } } });
      return row ? shipsOf(row) : undefined;
    },
    save: async ({ fleetId, declarer, rules }) => {
      if (declarer.kind === 'installation') {
        if (rules.length === 0) {
          await db.installationDeclaredNetworkRules.deleteMany({ where: { fleetId } });
          return;
        }
        await db.installationDeclaredNetworkRules.upsert({ where: { fleetId }, create: { fleetId, ...keptOf(rules) }, update: keptOf(rules) });
        return;
      }
      const { shipId } = declarer;
      if (rules.length === 0) {
        await db.declaredNetworkRules.deleteMany({ where: { fleetId, shipId } });
        return;
      }
      await db.declaredNetworkRules.upsert({ where: { fleetId_shipId: { fleetId, shipId } }, create: { fleetId, shipId, ...keptOf(rules) }, update: keptOf(rules) });
    },
  };
}

export function createPrismaReachRefusalRepository(db: Db): ReachRefusalRepository {
  return {
    record: async ({ id, fleetId, at, sender, askedBy, recipient, verb, settingsVersion, whilePluginUnavailable }) => {
      await db.reachRefusal.create({ data: { id, fleetId, at, sender: actorJson(sender), askedBy: askedBy === null ? Prisma.DbNull : shipJson(askedBy), recipient: recipientJson(recipient), verb, settingsVersion, whilePluginUnavailable } });
    },
    latest: async (fleetId, limit) => {
      const rows = await db.reachRefusal.findMany({ where: { fleetId }, orderBy: [{ at: 'desc' }, { id: 'desc' }], take: limit });
      return rows.map((row): ReachRefusal => refusalRowSchema.parse(row));
    },
  };
}

function shipJson(ship: RefusedShip) {
  return { id: ship.id, name: ship.name, labels: ship.labels.map((label) => ({ ...label })), owner: ship.owner === null ? null : { ...ship.owner } };
}

function actorJson(actor: RefusedActor) {
  switch (actor.kind) {
    case 'ship':
      return { kind: actor.kind, ...shipJson(actor) };
    case 'account':
      return { kind: actor.kind, accountId: actor.accountId, labels: actor.labels.map((label) => ({ ...label })), personShip: actor.personShip === null ? null : { ...actor.personShip } };
    case 'installation':
      return { kind: actor.kind };
  }
}

function recipientJson(recipient: ReachRefusal['recipient']) {
  return recipient.kind === 'ship' ? { kind: recipient.kind, ship: shipJson(recipient.ship) } : { kind: recipient.kind, type: recipient.type, ships: recipient.ships.map(shipJson) };
}
