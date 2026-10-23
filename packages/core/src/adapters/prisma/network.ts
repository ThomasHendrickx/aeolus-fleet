/**
 * The fleet's network settings, the draft of its rules and the records of the
 * sends they refused, on Postgres (decision 0034). A send and a change of rules take turns on a
 * transaction-level advisory lock on the fleet's settings: a send holds it
 * shared, a set exclusively. An advisory lock, not a row lock: Postgres
 * queues a shared request behind an exclusive one that waits, so a stream of
 * sends never starves a change, and the lock holds before the fleet first set
 * rules. The settings are read after the lock, so they are the latest
 * committed.
 */
import { accountIdSchema, carriedLabelSchema, idSchema, NETWORK_VERBS, networkRuleSchema, networkRulesSchema, type FleetId } from '@aeolus-fleet/common';
import { z } from 'zod';

import type { DeclaredNetworkRules } from '../../domain/registry/declared-network-rules.js';
import type { NetworkRulesDraft } from '../../domain/registry/network-rules-draft.js';
import { noNetworkSettings, type NetworkRule, type NetworkSettings } from '../../domain/registry/network-settings.js';
import type { DeclaredNetworkRulesRepository, NetworkRulesDraftRepository, NetworkSettingsRepository, ReachRefusalRepository } from '../../domain/registry/ports.js';
import type { ReachRefusal, RefusedActor, RefusedShip } from '../../domain/registry/reach-refusal.js';
import { pageOf } from '../../domain/shared/page.js';
import type { Db } from './client.js';
import { Prisma } from './generated/client.js';

const settingsRowSchema = z.object({ rules: networkRulesSchema, version: z.number().int().min(0), builtInViewerRead: z.boolean() });

const draftRowSchema = z.object({ fleetId: idSchema('fleet'), rules: networkRulesSchema, savedAt: z.date(), savedAgainstVersion: z.number().int().min(0) });

/** The rules as a JSON column keeps them: none as SQL NULL. */
function rulesJson(rules: readonly NetworkRule[] | null) {
  return rules === null ? Prisma.DbNull : rules.map((rule) => ({ verb: rule.verb, from: [...rule.from], to: [...rule.to] }));
}

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
});

export function createPrismaNetworkSettingsRepository(db: Db): NetworkSettingsRepository {
  const read = async (fleetId: FleetId): Promise<NetworkSettings> => {
    const row = await db.networkSettings.findUnique({ where: { fleetId }, select: { rules: true, version: true, builtInViewerRead: true } });
    if (!row) {
      return noNetworkSettings(fleetId);
    }
    const { rules, version, builtInViewerRead } = settingsRowSchema.parse(row);
    return { fleetId, rules, isViewerReadOn: builtInViewerRead, version };
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
    save: async ({ fleetId, rules, isViewerReadOn, version }) => {
      const kept = { rules: rulesJson(rules), builtInViewerRead: isViewerReadOn, version };
      await db.networkSettings.upsert({ where: { fleetId }, create: { fleetId, ...kept }, update: kept });
    },
  };
}

/** The draft of each fleet's own rules (decision 0034): one row a fleet while it has one. */
export function createPrismaNetworkRulesDraftRepository(db: Db): NetworkRulesDraftRepository {
  return {
    find: async (fleetId) => {
      const row = await db.networkRulesDraft.findUnique({ where: { fleetId } });
      return row ? (draftRowSchema.parse(row) satisfies NetworkRulesDraft) : undefined;
    },
    save: async ({ fleetId, rules, savedAt, savedAgainstVersion }) => {
      const kept = { rules: rulesJson(rules), savedAt, savedAgainstVersion };
      await db.networkRulesDraft.upsert({ where: { fleetId }, create: { fleetId, ...kept }, update: kept });
    },
    remove: async (fleetId) => {
      await db.networkRulesDraft.deleteMany({ where: { fleetId } });
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
    record: async ({ id, fleetId, at, sender, askedBy, recipient, verb, settingsVersion }) => {
      await db.reachRefusal.create({ data: { id, fleetId, at, sender: actorJson(sender), askedBy: askedBy === null ? Prisma.DbNull : shipJson(askedBy), recipient: recipientJson(recipient), verb, settingsVersion } });
    },
    latest: async (fleetId, { cursor, limit }) => {
      const rows = await db.reachRefusal.findMany({ where: { fleetId, ...(cursor === undefined ? {} : { id: { lt: cursor } }) }, orderBy: { id: 'desc' }, take: limit + 1 });
      return pageOf(
        rows.map((row): ReachRefusal => refusalRowSchema.parse(row)),
        { limit, cursorOf: (refusal) => refusal.id },
      );
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
