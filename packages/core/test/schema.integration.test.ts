import { createIdGenerator, idSchema, type FleetId, type MessageId, type ShipId } from '@aeolus-fleet/common';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { createPrismaClient, type PrismaClient } from '../src/adapters/prisma/client.js';
import { createEmptyDatabase, createMigratedDatabase, executeSqlFile } from '../src/testing/database.js';
import { prisma } from '../src/testing/prisma-cli.js';

// The key constraints of docs/architecture.md ("Core tables"), proven against
// the committed migration on a real Postgres.

const now = new Date('2026-09-29T12:00:00.000Z');
const newId = createIdGenerator();

let databaseUrl: string;
let database: PrismaClient;

beforeAll(async () => {
  databaseUrl = await createMigratedDatabase();
  database = createPrismaClient(databaseUrl);
});

afterAll(async () => {
  await database.$disconnect();
});

/**
 * The columns of events before the event actors migration (decision 0057):
 * a test of an earlier migration reads only these, since the generated
 * client knows the columns later migrations add.
 */
const EVENT_COLUMNS_BEFORE_ACTORS = { id: true, fleetId: true, type: true, occurredAt: true, actorShipId: true, shipId: true, messageId: true, deliveryId: true, details: true, seq: true } as const;

interface EventBeforeActors {
  id: string;
  fleetId: string;
  type: string;
  occurredAt: Date;
  actorShipId?: string;
  shipId?: string;
  messageId?: string;
  deliveryId?: string;
  details: object;
  seq: bigint;
}

/** Writes events as an earlier migration's table holds them: raw, since the generated client writes the columns later migrations add. */
async function insertEventsBeforeActors(client: PrismaClient, events: readonly EventBeforeActors[]): Promise<void> {
  for (const event of events) {
    await client.$executeRaw`
      INSERT INTO events (id, fleet_id, type, occurred_at, actor_ship_id, ship_id, message_id, delivery_id, details, seq)
      VALUES (${event.id}, ${event.fleetId}, ${event.type}, ${event.occurredAt}, ${event.actorShipId ?? null}, ${event.shipId ?? null},
              ${event.messageId ?? null}, ${event.deliveryId ?? null}, ${JSON.stringify(event.details)}::jsonb, ${event.seq})`;
  }
}

async function createFleet(): Promise<FleetId> {
  const id = newId('fleet');
  await database.fleet.create({ data: { id, name: 'test fleet', createdAt: now } });
  return id;
}

async function createShip(fleetId: FleetId, name = `ship-${newId('ship').slice(-8)}`): Promise<ShipId> {
  const id = newId('ship');
  await database.ship.create({
    data: { id, fleetId, name, type: 'reviewer', kind: 'agent', scopes: ['messages:send'], createdAt: now },
  });
  return id;
}

function createOperatorShip(fleetId: FleetId, name = 'argo'): Promise<{ id: string }> {
  return database.ship.create({
    data: { id: newId('ship'), fleetId, name, type: 'operator', kind: 'operator', scopes: [], createdAt: now },
  });
}

function lease(fleetId: FleetId, shipId: ShipId) {
  return { id: newId('lease'), fleetId, shipId, location: 'DEVICE' as const, startedAt: now };
}

/** A message from a new ship of the fleet to the type queue `reviewer`. */
async function createMessage(fleetId: FleetId, payload = '{}'): Promise<MessageId> {
  const id = newId('message');
  await database.message.create({
    data: {
      id,
      fleetId,
      senderShipId: await createShip(fleetId),
      selectorKind: 'type',
      selectorType: 'reviewer',
      payload,
      contentType: 'application/json',
      idempotencyKey: id,
      requestHash: id,
      createdAt: now,
    },
  });
  return id;
}

describe('migrations', () => {
  it('produce exactly the Prisma schema', async () => {
    const { stdout } = await prisma(
      databaseUrl,
      'migrate',
      'diff',
      '--from-config-datasource',
      '--to-schema',
      'src/adapters/prisma/schema.prisma',
      '--exit-code',
    );

    expect(stdout).toContain('No difference detected');
  });

  it('give every table except fleets a fleet_id', async () => {
    const tables = await database.$queryRaw<{ table_name: string; hasFleetId: boolean }[]>`
      SELECT t.table_name,
             EXISTS (
               SELECT 1 FROM information_schema.columns c
               WHERE c.table_schema = t.table_schema AND c.table_name = t.table_name AND c.column_name = 'fleet_id'
             ) AS "hasFleetId"
      FROM information_schema.tables t
      WHERE t.table_schema = 'public' AND t.table_type = 'BASE TABLE' AND t.table_name <> '_prisma_migrations'
      ORDER BY t.table_name`;

    expect(tables.map((table) => table.table_name)).toEqual([
      'account_cut_offs',
      'account_guide_progress',
      'account_notice_dismissals',
      'console_sessions',
      'credentials',
      'crew_request_give_backs',
      'crew_requests',
      'declared_network_rules',
      'deliveries',
      'events',
      'fleets',
      'guide_progress',
      'guides',
      'health_snapshot_deliveries',
      'health_snapshots',
      'installation_declared_network_rules',
      'installation_requests',
      'installation_settings',
      'label_values',
      'labels',
      'leases',
      'meeting_mic_requests',
      'meeting_participants',
      'meetings',
      'message_days',
      'messages',
      'network_rules_drafts',
      'network_settings',
      'notice_dismissals',
      'notices',
      'operators',
      'overdue_deliveries',
      'reach_refusals',
      'schedules',
      'scope_namespaces',
      'ship_labels',
      'ships',
      'sign_in_tickets',
      'verified_facts',
      'worktree_clear_requests',
    ]);
    // The installation's settings, notices, guide and cut-off accounts belong to no fleet (decisions 0020, 0023, 0024 and 0058).
    expect(tables.filter((table) => !table.hasFleetId).map((table) => table.table_name)).toEqual(['account_cut_offs', 'fleets', 'guides', 'installation_settings', 'notices']);
  });

  it('index every foreign key by its columns, so a delete checks each row it removes with an index, never a scan', async () => {
    // A foreign key is served by an index whose leading columns are exactly
    // its columns, in any order. A partial index serves only some rows, so it
    // does not count.
    const unindexed = await database.$queryRaw<{ table_name: string; columns: string }[]>`
      SELECT c.conrelid::regclass::text AS table_name,
             (SELECT string_agg(a.attname, ', ' ORDER BY k.position)
                FROM unnest(c.conkey) WITH ORDINALITY AS k(attnum, position)
                JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = k.attnum) AS columns
      FROM pg_constraint c
      WHERE c.contype = 'f' AND c.connamespace = 'public'::regnamespace
        AND NOT EXISTS (
          SELECT 1 FROM pg_index i
          WHERE i.indrelid = c.conrelid AND i.indpred IS NULL
            AND (string_to_array(i.indkey::text, ' ')::int2[])[1:cardinality(c.conkey)] @> c.conkey
            AND (string_to_array(i.indkey::text, ' ')::int2[])[1:cardinality(c.conkey)] <@ c.conkey
        )
      ORDER BY 1, 2`;

    expect(unindexed.map((key) => `${key.table_name} (${key.columns})`)).toEqual([]);
  });
});

describe('the operator login migration', () => {
  const MIGRATIONS = fileURLToPath(new URL('../src/adapters/prisma/migrations', import.meta.url));

  const names = readdirSync(MIGRATIONS)
    .filter((name) => /^\d{14}_/.test(name))
    .sort();
  const operatorLogin = names.findIndex((name) => name.endsWith('_operator_login'));

  async function apply(databaseUrl: string, migrations: string[]): Promise<void> {
    for (const name of migrations) {
      await executeSqlFile(databaseUrl, `${MIGRATIONS}/${name}/migration.sql`);
    }
  }

  it("removes argo's secret and keeps every agent ship's secret", async () => {
    const url = await createEmptyDatabase();
    await apply(url, names.slice(0, operatorLogin));
    const before = createPrismaClient(url);
    const fleetId = newId('fleet');
    const argoId = newId('ship');
    const scoutId = newId('ship');
    const credential = (shipId: ShipId) => ({ id: newId('credential'), fleetId, shipId, secretHash: newId('credential'), issuedAt: now });
    try {
      // Raw: the generated client knows columns that later migrations add.
      await before.$executeRaw`INSERT INTO fleets (id, name, created_at) VALUES (${fleetId}, 'old fleet', ${now})`;
      await before.ship.createMany({
        data: [
          { id: argoId, fleetId, name: 'argo', type: 'operator', kind: 'operator', scopes: [], createdAt: now },
          { id: scoutId, fleetId, name: 'scout', type: 'reviewer', kind: 'agent', scopes: [], createdAt: now },
        ],
      });
      await before.credential.createMany({ data: [credential(argoId), credential(scoutId)] });
    } finally {
      await before.$disconnect();
    }

    await apply(url, [names[operatorLogin] ?? '']);

    const after = createPrismaClient(url);
    try {
      await expect(after.credential.findMany()).resolves.toEqual([expect.objectContaining({ shipId: scoutId })]);
    } finally {
      await after.$disconnect();
    }
  });
});

describe('the event sequence migration', () => {
  const MIGRATIONS = fileURLToPath(new URL('../src/adapters/prisma/migrations', import.meta.url));

  const names = readdirSync(MIGRATIONS)
    .filter((name) => /^\d{14}_/.test(name))
    .sort();
  const eventSeq = names.findIndex((name) => name.endsWith('_event_seq'));

  async function apply(databaseUrl: string, migrations: string[]): Promise<void> {
    for (const name of migrations) {
      await executeSqlFile(databaseUrl, `${MIGRATIONS}/${name}/migration.sql`);
    }
  }

  it('numbers the events written before it per fleet, by time then id, and records each fleet\'s last number', async () => {
    const url = await createEmptyDatabase();
    await apply(url, names.slice(0, eventSeq));
    const before = createPrismaClient(url);
    const home = newId('fleet');
    const away = newId('fleet');
    const [first, second, third] = [newId('event'), newId('event'), newId('event')];
    const later = new Date(now.getTime() + 1_000);
    try {
      await before.$executeRaw`
        INSERT INTO fleets (id, name, created_at) VALUES (${home}, 'home', ${now}), (${away}, 'away', ${now})`;
      await before.$executeRaw`
        INSERT INTO events (id, fleet_id, type, occurred_at, details) VALUES
          (${third}, ${home}, 'ShipCommissioned', ${later}, '{}'),
          (${first}, ${home}, 'FleetInitialised', ${now}, '{}'),
          (${second}, ${away}, 'FleetInitialised', ${now}, '{}')`;
    } finally {
      await before.$disconnect();
    }

    await apply(url, [names[eventSeq] ?? '']);

    const after = createPrismaClient(url);
    try {
      await expect(after.event.findMany({ select: { id: true, seq: true }, orderBy: { id: 'asc' } })).resolves.toEqual([
        { id: first, seq: 1n },
        { id: second, seq: 1n },
        { id: third, seq: 2n },
      ]);
      await expect(
        after.fleet.findMany({ select: { id: true, lastEventSeq: true }, orderBy: { id: 'asc' } }),
      ).resolves.toEqual([
        { id: home, lastEventSeq: 2n },
        { id: away, lastEventSeq: 1n },
      ]);
    } finally {
      await after.$disconnect();
    }
  });
});

describe('the network scope migration', () => {
  const MIGRATIONS = fileURLToPath(new URL('../src/adapters/prisma/migrations', import.meta.url));
  const networkScope = readdirSync(MIGRATIONS).find((name) => name.endsWith('_network_scope'));

  it("gives every fleet's argo fleet:network, as argo holds every scope, and no agent ship", async () => {
    const url = await createMigratedDatabase();
    const client = createPrismaClient(url);
    const fleetId = newId('fleet');
    const argoId = newId('ship');
    const scoutId = newId('ship');
    const everyScopeBefore = ['messages:send', 'messages:receive', 'fleet:read', 'fleet:manage', 'crew:assign', 'crew:run', 'labels:define', 'labels:assign'];
    try {
      // An argo from before the migration: every scope but fleet:network.
      await client.fleet.create({ data: { id: fleetId, name: 'old fleet', createdAt: now } });
      await client.ship.createMany({
        data: [
          { id: argoId, fleetId, name: 'argo', type: 'operator', kind: 'operator', scopes: everyScopeBefore, createdAt: now },
          { id: scoutId, fleetId, name: 'scout', type: 'reviewer', kind: 'agent', scopes: ['messages:send', 'messages:receive', 'fleet:read'], createdAt: now },
        ],
      });

      await executeSqlFile(url, `${MIGRATIONS}/${networkScope ?? ''}/migration.sql`);

      await expect(client.ship.findMany({ select: { id: true, scopes: true }, orderBy: { id: 'asc' } })).resolves.toEqual([
        { id: argoId, scopes: [...everyScopeBefore, 'fleet:network'] },
        { id: scoutId, scopes: ['messages:send', 'messages:receive', 'fleet:read'] },
      ]);
    } finally {
      await client.$disconnect();
    }
  });
});

describe('the force scope migration', () => {
  const MIGRATIONS = fileURLToPath(new URL('../src/adapters/prisma/migrations', import.meta.url));
  const forceScope = readdirSync(MIGRATIONS).find((name) => name.endsWith('_force_scope'));

  it("gives every fleet's argo messages:force, as argo holds every scope, and no agent ship", async () => {
    const url = await createMigratedDatabase();
    const client = createPrismaClient(url);
    const fleetId = newId('fleet');
    const argoId = newId('ship');
    const scoutId = newId('ship');
    const everyScopeBefore = ['messages:send', 'messages:receive', 'fleet:read', 'fleet:manage', 'crew:assign', 'crew:run', 'labels:define', 'labels:assign', 'fleet:network'];
    try {
      // An argo from before the migration: every scope but messages:force.
      await client.fleet.create({ data: { id: fleetId, name: 'old fleet', createdAt: now } });
      await client.ship.createMany({
        data: [
          { id: argoId, fleetId, name: 'argo', type: 'operator', kind: 'operator', scopes: everyScopeBefore, createdAt: now },
          { id: scoutId, fleetId, name: 'scout', type: 'reviewer', kind: 'agent', scopes: ['messages:send', 'messages:receive'], createdAt: now },
        ],
      });

      await executeSqlFile(url, `${MIGRATIONS}/${forceScope ?? ''}/migration.sql`);

      await expect(client.ship.findMany({ select: { id: true, scopes: true }, orderBy: { id: 'asc' } })).resolves.toEqual([
        { id: argoId, scopes: [...everyScopeBefore, 'messages:force'] },
        { id: scoutId, scopes: ['messages:send', 'messages:receive'] },
      ]);
    } finally {
      await client.$disconnect();
    }
  });
});

/** The network settings as they were before rules became a list: none, SQL NULL, was all-to-all then. */
async function withRulesThatMayBeNone(client: PrismaClient): Promise<void> {
  await client.$executeRawUnsafe('ALTER TABLE "network_settings" ALTER COLUMN "rules" DROP NOT NULL, ALTER COLUMN "rules" DROP DEFAULT');
}

/** The fleets' rules as none, which the client no longer writes. */
async function withNoRules(client: PrismaClient, fleetIds: FleetId[]): Promise<void> {
  await client.$executeRaw`UPDATE "network_settings" SET "rules" = NULL WHERE "fleet_id" = ANY(${fleetIds})`;
}

describe('the declare and grant scopes migration', () => {
  const MIGRATIONS = fileURLToPath(new URL('../src/adapters/prisma/migrations', import.meta.url));
  const declareAndGrant = readdirSync(MIGRATIONS).find((name) => name.endsWith('_declare_and_grant_scopes'));

  it("gives every fleet's argo scopes:declare and scopes:grant, as argo holds every scope, and no agent ship (decision 0046)", async () => {
    const url = await createMigratedDatabase();
    const client = createPrismaClient(url);
    const fleetId = newId('fleet');
    const argoId = newId('ship');
    const scoutId = newId('ship');
    const everyScopeBefore = ['messages:send', 'messages:receive', 'messages:force', 'fleet:read', 'fleet:manage', 'crew:assign', 'crew:run', 'labels:define', 'labels:assign', 'fleet:network'];
    try {
      // An argo from before the migration: every scope but declaring and granting.
      await client.fleet.create({ data: { id: fleetId, name: 'old fleet', createdAt: now } });
      await client.ship.createMany({
        data: [
          { id: argoId, fleetId, name: 'argo', type: 'operator', kind: 'operator', scopes: everyScopeBefore, createdAt: now },
          { id: scoutId, fleetId, name: 'scout', type: 'reviewer', kind: 'agent', scopes: ['messages:send', 'messages:receive'], createdAt: now },
        ],
      });

      await executeSqlFile(url, `${MIGRATIONS}/${declareAndGrant ?? ''}/migration.sql`);

      await expect(client.ship.findMany({ select: { id: true, scopes: true }, orderBy: { id: 'asc' } })).resolves.toEqual([
        { id: argoId, scopes: [...everyScopeBefore, 'scopes:declare', 'scopes:grant'] },
        { id: scoutId, scopes: ['messages:send', 'messages:receive'] },
      ]);
    } finally {
      await client.$disconnect();
    }
  });
});

describe('the scope catalogue migration', () => {
  const MIGRATIONS = fileURLToPath(new URL('../src/adapters/prisma/migrations', import.meta.url));
  const catalogue = readdirSync(MIGRATIONS).find((name) => name.endsWith('_scope_catalogue'));
  const before = ['messages:send', 'messages:receive', 'messages:force', 'fleet:read', 'fleet:manage', 'crew:assign', 'crew:run', 'labels:define', 'labels:assign', 'fleet:network', 'scopes:declare', 'scopes:grant'];

  /** A fleet as the migration finds it: every holder of fleet:manage, both plugins, and ships it leaves alone, two of them of a plugin's type. */
  async function fleetBefore(client: PrismaClient) {
    const fleetId = newId('fleet');
    const ships = {
      argo: newId('ship'),
      manager: newId('ship'),
      squadrons: newId('ship'),
      trierarchPlugin: newId('ship'),
      networking: newId('ship'),
      scout: newId('ship'),
      retired: newId('ship'),
      ofSquadronsType: newId('ship'),
      ofTrierarchPluginType: newId('ship'),
    };
    const earlier = newId('event');
    await client.fleet.create({ data: { id: fleetId, name: 'old fleet', createdAt: now, lastEventSeq: 1n } });
    await client.ship.createMany({
      data: [
        { id: ships.argo, fleetId, name: 'argo', type: 'operator', kind: 'operator', scopes: before, createdAt: now },
        { id: ships.manager, fleetId, name: 'manager', type: 'manager', kind: 'agent', scopes: ['messages:send', 'messages:receive', 'fleet:read', 'fleet:manage', 'squadrons:form'], createdAt: now },
        { id: ships.squadrons, fleetId, name: 'squadrons', type: 'squadrons', kind: 'agent', scopes: ['messages:send', 'messages:receive', 'fleet:read', 'fleet:manage', 'labels:define', 'labels:assign'], createdAt: now },
        {
          id: ships.trierarchPlugin,
          fleetId,
          name: 'trierarch-plugin',
          type: 'trierarch-plugin',
          kind: 'agent',
          scopes: ['messages:send', 'messages:receive', 'fleet:read', 'fleet:manage', 'crew:assign', 'crew:run', 'labels:define', 'labels:assign'],
          createdAt: now,
        },
        { id: ships.networking, fleetId, name: 'networking-plugin', type: 'networking-plugin', kind: 'agent', scopes: ['messages:send', 'messages:receive', 'fleet:read', 'fleet:network'], createdAt: now },
        { id: ships.scout, fleetId, name: 'scout', type: 'reviewer', kind: 'agent', scopes: ['messages:send', 'messages:receive', 'fleet:read'], createdAt: now },
        { id: ships.retired, fleetId, name: 'old-manager', type: 'manager', kind: 'agent', scopes: ['messages:send', 'messages:receive', 'fleet:manage'], createdAt: now, retiredAt: now },
        { id: ships.ofSquadronsType, fleetId, name: 'formation', type: 'squadrons', kind: 'agent', scopes: ['messages:send', 'messages:receive'], createdAt: now },
        { id: ships.ofTrierarchPluginType, fleetId, name: 'placer', type: 'trierarch-plugin', kind: 'agent', scopes: ['messages:send', 'messages:receive'], createdAt: now },
      ],
    });
    await insertEventsBeforeActors(client, [{ id: earlier, fleetId, type: 'ShipCommissioned', occurredAt: now, shipId: ships.scout, details: {}, seq: 1n }]);
    return { fleetId, ships, earlier };
  }

  it("keeps what each holder of fleet:manage did, giving it fleet:commission and messages:resend, and puts both plugins on exactly their sets, never another ship of a plugin's type (decision 0046)", async () => {
    const url = await createMigratedDatabase();
    const client = createPrismaClient(url);
    try {
      const { ships } = await fleetBefore(client);

      await executeSqlFile(url, `${MIGRATIONS}/${catalogue ?? ''}/migration.sql`);

      const after = new Map((await client.ship.findMany({ select: { id: true, scopes: true } })).map(({ id, scopes }) => [id, scopes]));
      expect(after.get(ships.argo)).toEqual(['messages:send', 'messages:receive', 'messages:force', 'messages:resend', 'fleet:read', 'fleet:commission', 'fleet:manage', 'crew:assign', 'crew:run', 'labels:define', 'labels:assign', 'fleet:network', 'scopes:declare', 'scopes:grant']);
      expect(after.get(ships.manager)).toEqual(['messages:send', 'messages:receive', 'messages:resend', 'fleet:read', 'fleet:commission', 'fleet:manage', 'squadrons:form']);
      expect(after.get(ships.squadrons)).toEqual(['messages:send', 'messages:receive', 'fleet:read', 'fleet:commission', 'fleet:manage', 'labels:define', 'labels:assign', 'scopes:declare']);
      expect(after.get(ships.trierarchPlugin)).toEqual(['messages:send', 'messages:receive', 'fleet:read', 'fleet:commission', 'crew:assign', 'crew:run', 'labels:define', 'labels:assign']);
      expect(after.get(ships.networking)).toEqual(['messages:send', 'messages:receive', 'fleet:read', 'fleet:network']);
      expect(after.get(ships.scout)).toEqual(['messages:send', 'messages:receive', 'fleet:read']);
      expect(after.get(ships.retired)).toEqual(['messages:send', 'messages:receive', 'fleet:manage']);
      expect(after.get(ships.ofSquadronsType)).toEqual(['messages:send', 'messages:receive']);
      expect(after.get(ships.ofTrierarchPluginType)).toEqual(['messages:send', 'messages:receive']);
    } finally {
      await client.$disconnect();
    }
  });

  it('records ScopesChanged for each ship it changes, what it added and took away, by the system, at the next numbers of its fleet', async () => {
    const url = await createMigratedDatabase();
    const client = createPrismaClient(url);
    try {
      const { fleetId, ships, earlier } = await fleetBefore(client);

      await executeSqlFile(url, `${MIGRATIONS}/${catalogue ?? ''}/migration.sql`);

      const recorded = await client.event.findMany({ where: { fleetId, id: { not: earlier } }, orderBy: { seq: 'asc' } , select: EVENT_COLUMNS_BEFORE_ACTORS });
      expect(new Map(recorded.map(({ shipId, details }) => [shipId, details]))).toEqual(
        new Map([
          [ships.argo, { added: 'messages:resend fleet:commission', removed: '' }],
          [ships.manager, { added: 'messages:resend fleet:commission', removed: '' }],
          [ships.squadrons, { added: 'fleet:commission scopes:declare', removed: '' }],
          [ships.trierarchPlugin, { added: 'fleet:commission', removed: 'fleet:manage' }],
        ]),
      );
      for (const [at, event] of recorded.entries()) {
        expect(event).toMatchObject({ type: 'ScopesChanged', actorShipId: null, seq: BigInt(at + 2) });
        expect(idSchema('event').safeParse(event.id).success).toBe(true);
      }
      await expect(client.fleet.findUnique({ where: { id: fleetId }, select: { lastEventSeq: true } })).resolves.toEqual({ lastEventSeq: 5n });
    } finally {
      await client.$disconnect();
    }
  });
});

describe('the trierarch plugin crew:run migration', () => {
  const MIGRATIONS = fileURLToPath(new URL('../src/adapters/prisma/migrations', import.meta.url));
  const crewRun = readdirSync(MIGRATIONS).find((name) => name.endsWith('_trierarch_plugin_crew_run'));

  it('gives every active trierarch-plugin ship crew:run, which it gives the trierarchs it commissions, once, and no other ship (decision 0046)', async () => {
    const url = await createMigratedDatabase();
    const client = createPrismaClient(url);
    const fleetId = newId('fleet');
    const pluginId = newId('ship');
    const heldId = newId('ship');
    const retiredId = newId('ship');
    const scoutId = newId('ship');
    const pluginScopes = ['messages:send', 'messages:receive', 'fleet:read', 'fleet:manage', 'crew:assign', 'labels:define', 'labels:assign'];
    try {
      await client.fleet.create({ data: { id: fleetId, name: 'old fleet', createdAt: now } });
      await client.ship.createMany({
        data: [
          { id: pluginId, fleetId, name: 'trierarch-plugin', type: 'trierarch-plugin', kind: 'agent', scopes: pluginScopes, createdAt: now },
          { id: heldId, fleetId, name: 'second-plugin', type: 'trierarch-plugin', kind: 'agent', scopes: ['messages:send', 'messages:receive', 'crew:run'], createdAt: now },
          { id: retiredId, fleetId, name: 'old-plugin', type: 'trierarch-plugin', kind: 'agent', scopes: pluginScopes, createdAt: now, retiredAt: now },
          { id: scoutId, fleetId, name: 'scout', type: 'reviewer', kind: 'agent', scopes: ['messages:send', 'messages:receive', 'crew:assign'], createdAt: now },
        ],
      });

      await executeSqlFile(url, `${MIGRATIONS}/${crewRun ?? ''}/migration.sql`);

      const ships = await client.ship.findMany({ select: { id: true, scopes: true } });
      expect(new Map(ships.map(({ id, scopes }) => [id, scopes]))).toEqual(
        new Map([
          [pluginId, [...pluginScopes, 'crew:run']],
          [heldId, ['messages:send', 'messages:receive', 'crew:run']],
          [retiredId, pluginScopes],
          [scoutId, ['messages:send', 'messages:receive', 'crew:assign']],
        ]),
      );
    } finally {
      await client.$disconnect();
    }
  });

  it('records ScopesChanged for each ship it changes, adding crew:run, by the system, at the next numbers of its fleet', async () => {
    const url = await createMigratedDatabase();
    const client = createPrismaClient(url);
    const fleetId = newId('fleet');
    const pluginId = newId('ship');
    const secondId = newId('ship');
    const heldId = newId('ship');
    const earlier = newId('event');
    const pluginScopes = ['messages:send', 'messages:receive', 'fleet:read', 'fleet:manage', 'crew:assign', 'labels:define', 'labels:assign'];
    try {
      await client.fleet.create({ data: { id: fleetId, name: 'old fleet', createdAt: now, lastEventSeq: 1n } });
      await client.ship.createMany({
        data: [
          { id: pluginId, fleetId, name: 'trierarch-plugin', type: 'trierarch-plugin', kind: 'agent', scopes: pluginScopes, createdAt: now },
          { id: secondId, fleetId, name: 'second-plugin', type: 'trierarch-plugin', kind: 'agent', scopes: pluginScopes, createdAt: now },
          { id: heldId, fleetId, name: 'held-plugin', type: 'trierarch-plugin', kind: 'agent', scopes: ['messages:send', 'messages:receive', 'crew:run'], createdAt: now },
        ],
      });
      await insertEventsBeforeActors(client, [{ id: earlier, fleetId, type: 'ShipCommissioned', occurredAt: now, shipId: pluginId, details: {}, seq: 1n }]);

      await executeSqlFile(url, `${MIGRATIONS}/${crewRun ?? ''}/migration.sql`);

      const recorded = await client.event.findMany({ where: { fleetId, id: { not: earlier } }, orderBy: { seq: 'asc' } , select: EVENT_COLUMNS_BEFORE_ACTORS });
      expect(recorded.map(({ shipId }) => shipId).toSorted()).toEqual([pluginId, secondId].toSorted());
      for (const [at, event] of recorded.entries()) {
        expect(event).toMatchObject({ type: 'ScopesChanged', actorShipId: null, details: { added: 'crew:run', removed: '' }, seq: BigInt(at + 2) });
        expect(idSchema('event').safeParse(event.id).success).toBe(true);
        expect(event.id > earlier).toBe(true);
      }
      await expect(client.fleet.findUnique({ where: { id: fleetId }, select: { lastEventSeq: true } })).resolves.toEqual({ lastEventSeq: 3n });
    } finally {
      await client.$disconnect();
    }
  });
});

describe('the on-behalf scope migration', () => {
  const MIGRATIONS = fileURLToPath(new URL('../src/adapters/prisma/migrations', import.meta.url));
  const onBehalf = readdirSync(MIGRATIONS).find((name) => name.endsWith('_on_behalf_scope'));
  const squadronsScopes = ['messages:send', 'messages:receive', 'fleet:read', 'fleet:commission', 'fleet:manage', 'labels:define', 'labels:assign', 'scopes:declare'];
  const squadronsScopesAfter = ['messages:send', 'messages:receive', 'fleet:read', 'fleet:commission', 'fleet:manage', 'labels:define', 'labels:assign', 'fleet:on-behalf', 'scopes:declare'];
  const everyScopeBefore = ['messages:send', 'messages:receive', 'messages:force', 'messages:resend', 'fleet:read', 'fleet:commission', 'fleet:manage', 'crew:assign', 'crew:run', 'labels:define', 'labels:assign', 'fleet:network', 'scopes:declare', 'scopes:grant', 'squadrons:form'];
  const everyScopeAfter = ['messages:send', 'messages:receive', 'messages:force', 'messages:resend', 'fleet:read', 'fleet:commission', 'fleet:manage', 'crew:assign', 'crew:run', 'labels:define', 'labels:assign', 'fleet:network', 'fleet:on-behalf', 'scopes:declare', 'scopes:grant', 'squadrons:form'];

  it("gives every fleet's argo and its active squadrons ship fleet:on-behalf in catalogue order, which squadrons reads on behalf of a named ship with, once, and no other ship, not even one of its type (decisions 0017 and 0046)", async () => {
    const url = await createMigratedDatabase();
    const client = createPrismaClient(url);
    const fleetId = newId('fleet');
    const argoId = newId('ship');
    const squadronsId = newId('ship');
    const heldId = newId('ship');
    const retiredId = newId('ship');
    const scoutId = newId('ship');
    const ofSquadronsTypeId = newId('ship');
    try {
      await client.fleet.create({ data: { id: fleetId, name: 'old fleet', createdAt: now } });
      await client.ship.createMany({
        data: [
          { id: ofSquadronsTypeId, fleetId, name: 'formation', type: 'squadrons', kind: 'agent', scopes: ['messages:send', 'messages:receive'], createdAt: now },
          { id: argoId, fleetId, name: 'argo', type: 'operator', kind: 'operator', scopes: everyScopeBefore, createdAt: now },
          { id: squadronsId, fleetId, name: 'squadrons', type: 'squadrons', kind: 'agent', scopes: squadronsScopes, createdAt: now },
          { id: heldId, fleetId, name: 'second-squadrons', type: 'squadrons', kind: 'agent', scopes: ['messages:send', 'messages:receive', 'fleet:on-behalf'], createdAt: now },
          { id: retiredId, fleetId, name: 'old-squadrons', type: 'squadrons', kind: 'agent', scopes: squadronsScopes, createdAt: now, retiredAt: now },
          { id: scoutId, fleetId, name: 'scout', type: 'reviewer', kind: 'agent', scopes: ['messages:send', 'messages:receive', 'fleet:read'], createdAt: now },
        ],
      });

      await executeSqlFile(url, `${MIGRATIONS}/${onBehalf ?? ''}/migration.sql`);

      const ships = await client.ship.findMany({ select: { id: true, scopes: true } });
      expect(new Map(ships.map(({ id, scopes }) => [id, scopes]))).toEqual(
        new Map([
          [argoId, everyScopeAfter],
          [squadronsId, squadronsScopesAfter],
          [heldId, ['messages:send', 'messages:receive', 'fleet:on-behalf']],
          [retiredId, squadronsScopes],
          [scoutId, ['messages:send', 'messages:receive', 'fleet:read']],
          [ofSquadronsTypeId, ['messages:send', 'messages:receive']],
        ]),
      );
    } finally {
      await client.$disconnect();
    }
  });

  it('records ScopesChanged for each ship it changes, adding fleet:on-behalf, by the system, at the next numbers of its fleet', async () => {
    const url = await createMigratedDatabase();
    const client = createPrismaClient(url);
    const fleetId = newId('fleet');
    const argoId = newId('ship');
    const squadronsId = newId('ship');
    const heldId = newId('ship');
    const earlier = newId('event');
    try {
      await client.fleet.create({ data: { id: fleetId, name: 'old fleet', createdAt: now, lastEventSeq: 1n } });
      await client.ship.createMany({
        data: [
          { id: argoId, fleetId, name: 'argo', type: 'operator', kind: 'operator', scopes: everyScopeBefore, createdAt: now },
          { id: squadronsId, fleetId, name: 'squadrons', type: 'squadrons', kind: 'agent', scopes: squadronsScopes, createdAt: now },
          { id: heldId, fleetId, name: 'held-squadrons', type: 'squadrons', kind: 'agent', scopes: ['messages:send', 'messages:receive', 'fleet:on-behalf'], createdAt: now },
        ],
      });
      await insertEventsBeforeActors(client, [{ id: earlier, fleetId, type: 'ShipCommissioned', occurredAt: now, shipId: squadronsId, details: {}, seq: 1n }]);

      await executeSqlFile(url, `${MIGRATIONS}/${onBehalf ?? ''}/migration.sql`);

      const recorded = await client.event.findMany({ where: { fleetId, id: { not: earlier } }, orderBy: { seq: 'asc' } , select: EVENT_COLUMNS_BEFORE_ACTORS });
      expect(recorded.map(({ shipId }) => shipId).toSorted()).toEqual([argoId, squadronsId].toSorted());
      for (const [at, event] of recorded.entries()) {
        expect(event).toMatchObject({ type: 'ScopesChanged', actorShipId: null, details: { added: 'fleet:on-behalf', removed: '' }, seq: BigInt(at + 2) });
        expect(idSchema('event').safeParse(event.id).success).toBe(true);
        expect(event.id > earlier).toBe(true);
      }
      await expect(client.fleet.findUnique({ where: { id: fleetId }, select: { lastEventSeq: true } })).resolves.toEqual({ lastEventSeq: 3n });
    } finally {
      await client.$disconnect();
    }
  });
});

describe('the scopes for what was argo\'s alone migration', () => {
  const MIGRATIONS = fileURLToPath(new URL('../src/adapters/prisma/migrations', import.meta.url));
  const argosJobs = readdirSync(MIGRATIONS).find((name) => name.endsWith('_argos_jobs_as_scopes'));
  const everyScopeBefore = ['messages:send', 'messages:receive', 'messages:force', 'messages:resend', 'fleet:read', 'fleet:commission', 'fleet:manage', 'crew:assign', 'crew:run', 'labels:define', 'labels:assign', 'fleet:network', 'fleet:on-behalf', 'scopes:declare', 'scopes:grant', 'squadrons:form'];
  const everyScopeAfter = [
    'messages:send',
    'messages:receive',
    'messages:force',
    'messages:resend',
    'fleet:read',
    'fleet:commission',
    'fleet:manage',
    'crew:assign',
    'crew:run',
    'labels:define',
    'labels:assign',
    'fleet:network',
    'fleet:on-behalf',
    'fleet:person',
    'fleet:owner',
    'fleet:explain',
    'fleet:connect',
    'labels:any',
    'scopes:declare',
    'scopes:grant',
    'squadrons:form',
  ];

  it("gives every fleet's argo the scopes for the jobs that were its alone, in catalogue order, once, and no other ship (decisions 0046, 0053)", async () => {
    const url = await createMigratedDatabase();
    const client = createPrismaClient(url);
    const fleetId = newId('fleet');
    const argoId = newId('ship');
    const scoutId = newId('ship');
    try {
      await client.fleet.create({ data: { id: fleetId, name: 'old fleet', createdAt: now } });
      await client.ship.createMany({
        data: [
          { id: argoId, fleetId, name: 'argo', type: 'operator', kind: 'operator', scopes: everyScopeBefore, createdAt: now },
          { id: scoutId, fleetId, name: 'scout', type: 'reviewer', kind: 'agent', scopes: ['messages:send', 'messages:receive', 'fleet:read'], createdAt: now },
        ],
      });

      await executeSqlFile(url, `${MIGRATIONS}/${argosJobs ?? ''}/migration.sql`);
      await executeSqlFile(url, `${MIGRATIONS}/${argosJobs ?? ''}/migration.sql`);

      const ships = await client.ship.findMany({ where: { fleetId }, select: { id: true, scopes: true } });
      expect(new Map(ships.map(({ id, scopes }) => [id, scopes]))).toEqual(
        new Map([
          [argoId, everyScopeAfter],
          [scoutId, ['messages:send', 'messages:receive', 'fleet:read']],
        ]),
      );
    } finally {
      await client.$disconnect();
    }
  });

  it('records ScopesChanged for each argo it changes, adding the five scopes, by the system, at the next number of its fleet', async () => {
    const url = await createMigratedDatabase();
    const client = createPrismaClient(url);
    const fleetId = newId('fleet');
    const argoId = newId('ship');
    try {
      await client.fleet.create({ data: { id: fleetId, name: 'old fleet', createdAt: now, lastEventSeq: 1n } });
      await client.ship.create({ data: { id: argoId, fleetId, name: 'argo', type: 'operator', kind: 'operator', scopes: everyScopeBefore, createdAt: now } });

      await executeSqlFile(url, `${MIGRATIONS}/${argosJobs ?? ''}/migration.sql`);

      const recorded = await client.event.findMany({ where: { fleetId } });
      expect(recorded).toMatchObject([
        {
          type: 'ScopesChanged',
          actorKind: 'system',
          actorShipId: null,
          shipId: argoId,
          details: { added: 'fleet:person fleet:owner fleet:explain fleet:connect labels:any', removed: '' },
          seq: 2n,
        },
      ]);
      expect(idSchema('event').safeParse(recorded[0]?.id).success).toBe(true);
    } finally {
      await client.$disconnect();
    }
  });

  it('lets a ship hold each of the five scopes', async () => {
    const url = await createMigratedDatabase();
    const client = createPrismaClient(url);
    const fleetId = newId('fleet');
    try {
      await client.fleet.create({ data: { id: fleetId, name: 'fleet', createdAt: now } });

      await expect(
        client.ship.create({
          data: { id: newId('ship'), fleetId, name: 'admin', type: 'admin', kind: 'agent', scopes: ['messages:send', 'messages:receive', 'fleet:person', 'fleet:owner', 'fleet:explain', 'fleet:connect', 'labels:any'], createdAt: now },
        }),
      ).resolves.toBeDefined();
    } finally {
      await client.$disconnect();
    }
  });
});

describe('the plugin ships migration', () => {
  const MIGRATIONS = fileURLToPath(new URL('../src/adapters/prisma/migrations', import.meta.url));
  const pluginShips = readdirSync(MIGRATIONS).find((name) => name.endsWith('_plugin_ships'));

  it('makes kind plugin every active ship with a plugin connection or the name and type of a plugin, gateway included, and drops the connections (decision 0050)', async () => {
    const url = await createMigratedDatabase();
    const client = createPrismaClient(url);
    const fleetId = newId('fleet');
    const ids = { squadrons: newId('ship'), trierarchPlugin: newId('ship'), gateway: newId('ship'), networking: newId('ship'), ofSquadronsType: newId('ship'), retired: newId('ship'), scout: newId('ship') };
    try {
      // The connections as they were before the migration.
      await client.$executeRawUnsafe('CREATE TABLE "plugin_connections" ("fleet_id" TEXT NOT NULL, "ship_id" TEXT NOT NULL, "connected_at" TIMESTAMPTZ(3) NOT NULL)');
      await client.fleet.create({ data: { id: fleetId, name: 'old fleet', createdAt: now } });
      await client.ship.createMany({
        data: [
          { id: ids.squadrons, fleetId, name: 'squadrons', type: 'squadrons', kind: 'agent', scopes: ['fleet:read'], createdAt: now },
          { id: ids.trierarchPlugin, fleetId, name: 'trierarch-plugin', type: 'trierarch-plugin', kind: 'agent', scopes: ['fleet:read'], createdAt: now },
          { id: ids.gateway, fleetId, name: 'gateway', type: 'gateway', kind: 'app', scopes: ['fleet:read'], createdAt: now },
          { id: ids.networking, fleetId, name: 'networking-plugin', type: 'networking-plugin', kind: 'agent', scopes: ['fleet:read'], createdAt: now },
          { id: ids.ofSquadronsType, fleetId, name: 'formation', type: 'squadrons', kind: 'agent', scopes: [], createdAt: now },
          { id: ids.retired, fleetId, name: 'gateway-old', type: 'gateway', kind: 'agent', scopes: [], createdAt: now, retiredAt: now },
          { id: ids.scout, fleetId, name: 'scout', type: 'reviewer', kind: 'agent', scopes: [], createdAt: now },
        ],
      });
      await client.$executeRawUnsafe(`INSERT INTO "plugin_connections" VALUES ('${fleetId}', '${ids.networking}', now()), ('${fleetId}', '${ids.retired}', now())`);

      await executeSqlFile(url, `${MIGRATIONS}/${pluginShips ?? 'missing'}/migration.sql`);

      const plugins = await client.ship.findMany({ where: { fleetId, kind: 'plugin' }, select: { id: true } });
      expect(plugins.map(({ id }) => id).toSorted()).toEqual([ids.squadrons, ids.trierarchPlugin, ids.gateway, ids.networking].toSorted());
      await expect(client.$queryRawUnsafe(`SELECT to_regclass('plugin_connections')::text AS "table"`)).resolves.toEqual([{ table: null }]);
    } finally {
      await client.$disconnect();
    }
  });

  it('writes PluginConnected, by the system, for each ship it makes kind plugin that had no connection, at the next numbers of its fleet stream', async () => {
    const url = await createMigratedDatabase();
    const client = createPrismaClient(url);
    const fleetId = newId('fleet');
    const ids = { connected: newId('ship'), squadrons: newId('ship'), gateway: newId('ship') };
    try {
      await client.$executeRawUnsafe('CREATE TABLE "plugin_connections" ("fleet_id" TEXT NOT NULL, "ship_id" TEXT NOT NULL, "connected_at" TIMESTAMPTZ(3) NOT NULL)');
      await client.fleet.create({ data: { id: fleetId, name: 'old fleet', createdAt: now, lastEventSeq: 1n } });
      await client.ship.createMany({
        data: [
          { id: ids.connected, fleetId, name: 'networking-plugin', type: 'networking-plugin', kind: 'agent', scopes: ['fleet:read'], createdAt: now },
          { id: ids.squadrons, fleetId, name: 'squadrons', type: 'squadrons', kind: 'agent', scopes: ['fleet:read'], createdAt: now },
          { id: ids.gateway, fleetId, name: 'gateway', type: 'gateway', kind: 'app', scopes: ['fleet:read'], createdAt: now },
        ],
      });
      await client.$executeRawUnsafe(`INSERT INTO "plugin_connections" VALUES ('${fleetId}', '${ids.connected}', now())`);

      await executeSqlFile(url, `${MIGRATIONS}/${pluginShips ?? 'missing'}/migration.sql`);

      const recorded = await client.event.findMany({ where: { fleetId }, orderBy: { seq: 'asc' }, select: { id: true, type: true, actorKind: true, actorShipId: true, shipId: true, details: true, seq: true } });
      expect(recorded.map(({ shipId }) => shipId).toSorted()).toEqual([ids.squadrons, ids.gateway].toSorted());
      for (const [at, event] of recorded.entries()) {
        expect(event).toMatchObject({ type: 'PluginConnected', actorKind: 'system', actorShipId: null, details: {}, seq: BigInt(at + 2) });
        expect(idSchema('event').safeParse(event.id).success).toBe(true);
      }
      await expect(client.fleet.findUniqueOrThrow({ where: { id: fleetId }, select: { lastEventSeq: true } })).resolves.toEqual({ lastEventSeq: 3n });
    } finally {
      await client.$disconnect();
    }
  });
});

describe('the network verbs migration', () => {
  const MIGRATIONS = fileURLToPath(new URL('../src/adapters/prisma/migrations', import.meta.url));
  const networkVerbs = readdirSync(MIGRATIONS).find((name) => name.endsWith('_network_verbs'));

  it("makes every rule a fleet holds and every rule a ship declared a send rule, as rules allowed only sends before", async () => {
    const url = await createMigratedDatabase();
    const client = createPrismaClient(url);
    const fleetId = newId('fleet');
    const declarerId = newId('ship');
    const labelId = newId('label');
    const valueId = newId('labelValue');
    const rule = { from: [valueId], to: [{ labelId, value: '#' }] };
    try {
      await client.fleet.create({ data: { id: fleetId, name: 'old fleet', createdAt: now } });
      await client.ship.create({ data: { id: declarerId, fleetId, name: 'squadrons', type: 'squadrons', kind: 'agent', scopes: ['labels:define'], createdAt: now } });
      await client.networkSettings.create({ data: { fleetId, rules: [rule, { from: [], to: [] }], version: 4 } });
      await client.declaredNetworkRules.create({ data: { fleetId, shipId: declarerId, rules: [rule] } });

      await executeSqlFile(url, `${MIGRATIONS}/${networkVerbs ?? 'missing'}/migration.sql`);

      await expect(client.networkSettings.findUniqueOrThrow({ where: { fleetId }, select: { rules: true, version: true } })).resolves.toEqual({
        rules: [
          { verb: 'send', ...rule },
          { verb: 'send', from: [], to: [] },
        ],
        version: 4,
      });
      await expect(client.declaredNetworkRules.findMany({ select: { rules: true } })).resolves.toEqual([{ rules: [{ verb: 'send', ...rule }] }]);
    } finally {
      await client.$disconnect();
    }
  });
});

describe('the network rules a list migration', () => {
  const MIGRATIONS = fileURLToPath(new URL('../src/adapters/prisma/migrations', import.meta.url));
  const rulesAList = readdirSync(MIGRATIONS).find((name) => name.endsWith('_network_rules_a_list'));

  it('makes none an empty list, as open says all-to-all now, and keeps every list', async () => {
    const url = await createMigratedDatabase();
    const client = createPrismaClient(url);
    const [none, list] = [newId('fleet'), newId('fleet')];
    const rules = [{ verb: 'send', from: [], to: [] }];
    try {
      await withRulesThatMayBeNone(client);
      await client.fleet.createMany({ data: [none, list].map((id) => ({ id, name: 'old fleet', createdAt: now })) });
      await client.networkSettings.createMany({ data: [{ fleetId: none, version: 2 }, { fleetId: list, rules, version: 3 }] });
      await withNoRules(client, [none]);

      await executeSqlFile(url, `${MIGRATIONS}/${rulesAList ?? 'missing'}/migration.sql`);

      await expect(client.networkSettings.findMany({ select: { fleetId: true, rules: true, version: true }, orderBy: { version: 'asc' } })).resolves.toEqual([
        { fleetId: none, rules: [], version: 2 },
        { fleetId: list, rules, version: 3 },
      ]);
    } finally {
      await client.$disconnect();
    }
  });
});

describe('the verb on reach refusals migration', () => {
  const MIGRATIONS = fileURLToPath(new URL('../src/adapters/prisma/migrations', import.meta.url));
  const verbOnRefusals = readdirSync(MIGRATIONS).find((name) => name.endsWith('_verb_on_reach_refusals'));

  it('makes every refusal from before verbs a refused send, as only sends were checked', async () => {
    const url = await createMigratedDatabase();
    const client = createPrismaClient(url);
    const fleetId = newId('fleet');
    const refusalId = newId('reachRefusal');
    const ship = { id: newId('ship'), name: 'planner', labels: [], owner: null };
    try {
      await client.$executeRawUnsafe('ALTER TABLE "reach_refusals" DROP COLUMN "verb"');
      await client.fleet.create({ data: { id: fleetId, name: 'old fleet', createdAt: now } });
      await client.$executeRaw`INSERT INTO "reach_refusals" ("id", "fleet_id", "at", "sender", "recipient", "settings_version") VALUES (${refusalId}, ${fleetId}, ${now}, ${JSON.stringify(ship)}::jsonb, ${JSON.stringify({ kind: 'ship', ship })}::jsonb, 2)`;

      await executeSqlFile(url, `${MIGRATIONS}/${verbOnRefusals ?? 'missing'}/migration.sql`);

      await expect(client.reachRefusal.findMany({ select: { id: true, verb: true } })).resolves.toEqual([{ id: refusalId, verb: 'send' }]);
    } finally {
      await client.$disconnect();
    }
  });
});

describe('the owners on reach refusals migration', () => {
  const MIGRATIONS = fileURLToPath(new URL('../src/adapters/prisma/migrations', import.meta.url));
  const ownersOnRefusals = readdirSync(MIGRATIONS).find((name) => name.endsWith('_owners_on_reach_refusals'));

  it('gives every ship of a refusal from before owners none, as no owner was known then', async () => {
    const url = await createMigratedDatabase();
    const client = createPrismaClient(url);
    const fleetId = newId('fleet');
    const toShip = newId('reachRefusal');
    const toType = newId('reachRefusal');
    const ship = (name: string) => ({ id: newId('ship'), name, labels: [] });
    const [planner, vault, keeper] = [ship('planner'), ship('vault'), ship('keeper')];
    try {
      await client.fleet.create({ data: { id: fleetId, name: 'old fleet', createdAt: now } });
      await client.reachRefusal.createMany({
        data: [
          { id: toShip, fleetId, at: now, sender: planner, recipient: { kind: 'ship', ship: vault }, verb: 'send', settingsVersion: 2 },
          { id: toType, fleetId, at: now, sender: planner, recipient: { kind: 'type', type: 'keeper', ships: [vault, keeper] }, verb: 'send', settingsVersion: 2 },
        ],
      });

      await executeSqlFile(url, `${MIGRATIONS}/${ownersOnRefusals ?? 'missing'}/migration.sql`);

      const none = (refused: typeof planner) => ({ ...refused, owner: null });
      await expect(client.reachRefusal.findMany({ select: { id: true, sender: true, recipient: true }, orderBy: { id: 'asc' } })).resolves.toEqual([
        { id: toShip, sender: none(planner), recipient: { kind: 'ship', ship: none(vault) } },
        { id: toType, sender: none(planner), recipient: { kind: 'type', type: 'keeper', ships: [none(vault), none(keeper)] } },
      ]);
    } finally {
      await client.$disconnect();
    }
  });
});

describe('ships', () => {
  it('keeps a name unique among ships that are not retired', async () => {
    const fleetId = await createFleet();
    const first = await createShip(fleetId, 'scout');

    await expect(createShip(fleetId, 'scout')).rejects.toThrow(/Unique constraint/);

    await database.ship.update({ where: { id: first }, data: { retiredAt: now } });
    await expect(createShip(fleetId, 'scout')).resolves.toMatch(/^shp_/);
  });

  it('allows the same name in two fleets', async () => {
    await createShip(await createFleet(), 'lookout');

    await expect(createShip(await createFleet(), 'lookout')).resolves.toMatch(/^shp_/);
  });
});

describe('the operator ship', () => {
  it('exists at most once per fleet', async () => {
    const fleetId = await createFleet();
    await createOperatorShip(fleetId);

    await expect(createOperatorShip(fleetId)).rejects.toThrow(/Unique constraint/);
  });

  it('is named argo', async () => {
    await expect(createOperatorShip(await createFleet(), 'helm')).rejects.toThrow(/ships_operator_is_argo/);
  });

  it('holds the name argo alone: no agent ship takes it', async () => {
    await expect(createShip(await createFleet(), 'argo')).rejects.toThrow(/ships_operator_is_argo/);
  });

  it('is never retired', async () => {
    const argo = await createOperatorShip(await createFleet());

    await expect(database.ship.update({ where: { id: argo.id }, data: { retiredAt: now } })).rejects.toThrow(
      /ships_operator_never_retired/,
    );
  });
});

describe('operator accounts', () => {
  function account(fleetId: FleetId, email = `${newId('operator')}@example.com`) {
    return database.operator.create({
      data: { id: newId('operator'), fleetId, email, passwordHash: 'hash', createdAt: now },
    });
  }

  it('hold an email unique across all fleets', async () => {
    await account(await createFleet(), 'thomas@example.com');

    await expect(account(await createFleet(), 'thomas@example.com')).rejects.toThrow(/Unique constraint/);
  });

  it('are one per fleet', async () => {
    const fleetId = await createFleet();
    await account(fleetId);

    await expect(account(fleetId)).rejects.toThrow(/Unique constraint/);
  });
});

describe('scopes', () => {
  it('are only the fifteen known ones', async () => {
    const id = await createShip(await createFleet());

    await expect(
      database.ship.update({ where: { id }, data: { scopes: ['messages:send', 'fleet:write'] } }),
    ).rejects.toThrow(/ships_scopes_known/);
    await expect(
      database.ship.update({
        where: { id },
        data: { scopes: ['messages:send', 'messages:receive', 'messages:force', 'messages:resend', 'fleet:read', 'fleet:commission', 'fleet:manage', 'crew:assign', 'crew:run', 'labels:define', 'labels:assign', 'fleet:network', 'fleet:on-behalf', 'scopes:declare', 'scopes:grant'] },
      }),
    ).resolves.toMatchObject({ scopes: ['messages:send', 'messages:receive', 'messages:force', 'messages:resend', 'fleet:read', 'fleet:commission', 'fleet:manage', 'crew:assign', 'crew:run', 'labels:define', 'labels:assign', 'fleet:network', 'fleet:on-behalf', 'scopes:declare', 'scopes:grant'] });
  });

  it('are never null', async () => {
    const id = await createShip(await createFleet());

    await expect(database.$executeRaw`UPDATE ships SET scopes = NULL WHERE id = ${id}`).rejects.toThrow(
      /ships_scopes_known/,
    );
  });
});

describe('tenancy', () => {
  it("refuses a row that points at another fleet's ship", async () => {
    const shipOfAnotherFleet = await createShip(await createFleet());
    const fleetId = await createFleet();

    await expect(database.lease.create({ data: lease(fleetId, shipOfAnotherFleet) })).rejects.toThrow(
      /Foreign key constraint/,
    );
  });
});

describe('leases', () => {
  it('allow at most one open lease per ship', async () => {
    const fleetId = await createFleet();
    const shipId = await createShip(fleetId);
    const first = await database.lease.create({ data: lease(fleetId, shipId) });

    await expect(database.lease.create({ data: lease(fleetId, shipId) })).rejects.toThrow(/Unique constraint/);

    await database.lease.update({ where: { id: first.id }, data: { endedAt: now } });
    await expect(database.lease.create({ data: lease(fleetId, shipId) })).resolves.toMatchObject({ endedAt: null });
  });
});

describe('crew token hashes', () => {
  it('are unique across all fleets', async () => {
    const crewTokenHash = newId('lease');
    const crewed = async () => {
      const fleetId = await createFleet();
      const shipId = await createShip(fleetId);
      return database.lease.create({ data: { ...lease(fleetId, shipId), crewTokenHash } });
    };

    await crewed();
    await expect(crewed()).rejects.toThrow(/Unique constraint/);
  });

  it('may be missing: a console session keeps its own token', async () => {
    const fleetId = await createFleet();

    await expect(database.lease.create({ data: lease(fleetId, await createShip(fleetId)) })).resolves.toMatchObject({
      crewTokenHash: null,
    });
  });
});

describe('lease locations', () => {
  it('take a description with OTHER only', async () => {
    const fleetId = await createFleet();
    const shipId = await createShip(fleetId);
    const withLocation = (location: 'DEVICE' | 'OTHER', locationDescription: string | null) =>
      database.lease.create({ data: { ...lease(fleetId, shipId), location, locationDescription } });

    await expect(withLocation('OTHER', null)).rejects.toThrow(/leases_location_description/);
    await expect(withLocation('OTHER', '  ')).rejects.toThrow(/leases_location_description/);
    await expect(withLocation('DEVICE', 'laptop')).rejects.toThrow(/leases_location_description/);
    await expect(withLocation('OTHER', 'web console')).resolves.toMatchObject({ location: 'OTHER' });
  });
});

describe('credentials', () => {
  it('allow at most one valid secret per ship', async () => {
    const fleetId = await createFleet();
    const shipId = await createShip(fleetId);
    const credential = () => ({ id: newId('credential'), fleetId, shipId, secretHash: newId('credential'), issuedAt: now });
    const first = credential();
    await database.credential.create({ data: first });

    await expect(database.credential.create({ data: credential() })).rejects.toThrow(/Unique constraint/);

    await database.credential.update({ where: { id: first.id }, data: { invalidatedAt: now } });
    await expect(database.credential.create({ data: credential() })).resolves.toMatchObject({ invalidatedAt: null });
  });
});

describe('secret hashes', () => {
  it('are unique across all fleets', async () => {
    const secretHash = newId('credential');
    const credential = async () => {
      const fleetId = await createFleet();
      const shipId = await createShip(fleetId);
      return database.credential.create({ data: { id: newId('credential'), fleetId, shipId, secretHash, issuedAt: now } });
    };

    await credential();
    await expect(credential()).rejects.toThrow(/Unique constraint/);
  });
});

describe('console sessions', () => {
  async function session(fleetId: FleetId, tokenHash = newId('consoleSession')) {
    const argo = await database.ship.findFirstOrThrow({ where: { fleetId, kind: 'operator' } });
    const argoId = idSchema('ship').parse(argo.id);
    const { id: leaseId } = await database.lease.create({
      data: { ...lease(fleetId, argoId), location: 'OTHER', locationDescription: 'web console' },
    });
    await database.lease.update({ where: { id: leaseId }, data: { endedAt: now } });
    return database.consoleSession.create({
      data: {
        id: newId('consoleSession'),
        fleetId,
        shipId: argo.id,
        leaseId,
        idleLimitSeconds: 30 * 24 * 60 * 60,
        tokenHash,
        createdAt: now,
        lastUsedAt: now,
        expiresAt: now,
      },
    });
  }

  it('allow one live session per fleet', async () => {
    const fleetId = await createFleet();
    await createOperatorShip(fleetId);
    const first = await session(fleetId);

    await expect(session(fleetId)).rejects.toThrow(/Unique constraint/);

    await database.consoleSession.update({ where: { id: first.id }, data: { endedAt: now } });
    await expect(session(fleetId)).resolves.toMatchObject({ endedAt: null });
  });

  it('have token hashes unique across all fleets', async () => {
    const tokenHash = newId('consoleSession');
    const fleetId = await createFleet();
    await createOperatorShip(fleetId);
    const otherFleetId = await createFleet();
    await createOperatorShip(otherFleetId);
    await session(fleetId, tokenHash);

    await expect(session(otherFleetId, tokenHash)).rejects.toThrow(/Unique constraint/);
  });
});

describe('messages', () => {
  it('accept a payload of exactly 64 KB', async () => {
    const fleetId = await createFleet();

    await expect(createMessage(fleetId, 'a'.repeat(65_536))).resolves.toMatch(/^msg_/);
  });

  it('refuse a payload one byte over 64 KB', async () => {
    const fleetId = await createFleet();

    await expect(createMessage(fleetId, 'a'.repeat(65_537))).rejects.toThrow(/messages_payload_max_64kb/);
  });

  it('count the payload in bytes, not characters', async () => {
    const fleetId = await createFleet();
    // 32,769 two-byte characters: under 64 K characters, over 64 KB.
    await expect(createMessage(fleetId, 'é'.repeat(32_769))).rejects.toThrow(/messages_payload_max_64kb/);
  });

  interface SelectorColumns {
    selectorKind: 'ship' | 'type';
    selectorShipId?: ShipId;
    selectorType?: string;
  }

  /** A message from the sender, to the type queue `reviewer` unless given other selector columns. */
  function message(
    fleetId: FleetId,
    sent: { senderShipId: ShipId; idempotencyKey?: string; selector?: SelectorColumns },
  ) {
    const { selector = { selectorKind: 'type', selectorType: 'reviewer' }, ...columns } = sent;
    return database.message.create({
      data: {
        id: newId('message'),
        fleetId,
        payload: '{}',
        contentType: 'application/json',
        idempotencyKey: newId('message'),
        requestHash: 'request',
        createdAt: now,
        ...selector,
        ...columns,
      },
    });
  }

  it('hold an idempotency key once per sender', async () => {
    const fleetId = await createFleet();
    const sender = await createShip(fleetId);
    const other = await createShip(fleetId);

    await message(fleetId, { senderShipId: sender, idempotencyKey: 'review-22' });
    await expect(message(fleetId, { senderShipId: sender, idempotencyKey: 'review-22' })).rejects.toThrow(
      /Unique constraint/,
    );
    await expect(message(fleetId, { senderShipId: other, idempotencyKey: 'review-22' })).resolves.toMatchObject({
      idempotencyKey: 'review-22',
    });
  });

  it('name a ship for a ship selector and a type for a type selector, never both', async () => {
    const fleetId = await createFleet();
    const sender = await createShip(fleetId);

    const withSelector = (selector: SelectorColumns) => message(fleetId, { senderShipId: sender, selector });

    await expect(withSelector({ selectorKind: 'ship' })).rejects.toThrow(/messages_one_selector/);
    await expect(
      withSelector({ selectorKind: 'ship', selectorShipId: sender, selectorType: 'reviewer' }),
    ).rejects.toThrow(/messages_one_selector/);
    await expect(withSelector({ selectorKind: 'type', selectorShipId: sender })).rejects.toThrow(
      /messages_one_selector/,
    );
    await expect(withSelector({ selectorKind: 'type' })).rejects.toThrow(/messages_one_selector/);
    await expect(withSelector({ selectorKind: 'ship', selectorShipId: sender })).resolves.toMatchObject({
      selectorKind: 'ship',
      selectorShipId: sender,
      selectorType: null,
    });
  });

  it("refuse a sender or an addressed ship of another fleet", async () => {
    const shipOfAnotherFleet = await createShip(await createFleet());
    const fleetId = await createFleet();
    const sender = await createShip(fleetId);

    await expect(message(fleetId, { senderShipId: shipOfAnotherFleet })).rejects.toThrow(/Foreign key constraint/);
    await expect(
      message(fleetId, { senderShipId: sender, selector: { selectorKind: 'ship', selectorShipId: shipOfAnotherFleet } }),
    ).rejects.toThrow(/Foreign key constraint/);
  });
});

describe('deliveries', () => {
  it('go to a ship or a type, never both and never neither', async () => {
    const fleetId = await createFleet();
    const shipId = await createShip(fleetId);
    const messageId = await createMessage(fleetId);
    const delivery = (recipient: { recipientShipId?: ShipId; recipientType?: string }) =>
      database.delivery.create({ data: { id: newId('delivery'), fleetId, messageId, createdAt: now, ...recipient } });

    await expect(delivery({})).rejects.toThrow(/deliveries_one_recipient/);
    await expect(delivery({ recipientShipId: shipId, recipientType: 'reviewer' })).rejects.toThrow(
      /deliveries_one_recipient/,
    );
    await expect(delivery({ recipientShipId: shipId })).resolves.toMatchObject({ state: 'pending', attempts: 0 });
    await expect(delivery({ recipientType: 'reviewer' })).resolves.toMatchObject({ state: 'pending', attempts: 0 });
  });

  it('can be dismissed and carry a read date', async () => {
    const fleetId = await createFleet();
    const shipId = await createShip(fleetId);
    const messageId = await createMessage(fleetId);

    await expect(
      database.delivery.create({
        data: {
          id: newId('delivery'),
          fleetId,
          messageId,
          recipientShipId: shipId,
          state: 'dismissed',
          readAt: now,
          createdAt: now,
        },
      }),
    ).resolves.toMatchObject({ state: 'dismissed', readAt: now });
  });

  it('name the ship and the lease that claimed them while in flight or acknowledged, and neither while pending', async () => {
    const fleetId = await createFleet();
    const shipId = await createShip(fleetId);
    const { id: leaseId } = await database.lease.create({ data: lease(fleetId, shipId) });
    const delivery = async (claim: {
      state: 'pending' | 'handed' | 'acknowledged';
      claimedByShipId?: ShipId;
      claimedByLeaseId?: string;
    }) =>
      database.delivery.create({
        data: { id: newId('delivery'), fleetId, messageId: await createMessage(fleetId), recipientShipId: shipId, createdAt: now, ...claim },
      });

    await expect(delivery({ state: 'handed' })).rejects.toThrow(/deliveries_claim/);
    await expect(delivery({ state: 'handed', claimedByShipId: shipId })).rejects.toThrow(/deliveries_claim/);
    await expect(delivery({ state: 'pending', claimedByShipId: shipId, claimedByLeaseId: leaseId })).rejects.toThrow(
      /deliveries_claim/,
    );
    await expect(delivery({ state: 'handed', claimedByShipId: shipId, claimedByLeaseId: leaseId })).resolves.toMatchObject({
      claimedByLeaseId: leaseId,
    });
    await expect(
      delivery({ state: 'acknowledged', claimedByShipId: shipId, claimedByLeaseId: leaseId }),
    ).resolves.toMatchObject({ state: 'acknowledged' });
    await expect(delivery({ state: 'pending' })).resolves.toMatchObject({ claimedByShipId: null, claimedByLeaseId: null });
  });

  it("refuse a claim by another fleet's lease", async () => {
    const fleetId = await createFleet();
    const shipId = await createShip(fleetId);
    const otherFleetId = await createFleet();
    const { id: foreignLeaseId } = await database.lease.create({ data: lease(otherFleetId, await createShip(otherFleetId)) });

    await expect(
      database.delivery.create({
        data: {
          id: newId('delivery'),
          fleetId,
          messageId: await createMessage(fleetId),
          recipientShipId: shipId,
          state: 'handed',
          claimedByShipId: shipId,
          claimedByLeaseId: foreignLeaseId,
          createdAt: now,
        },
      }),
    ).rejects.toThrow(/Foreign key constraint/);
  });

  it('hold one row per recipient', async () => {
    const fleetId = await createFleet();
    const shipId = await createShip(fleetId);
    const messageId = await createMessage(fleetId);
    const toShip = () =>
      database.delivery.create({ data: { id: newId('delivery'), fleetId, messageId, recipientShipId: shipId, createdAt: now } });
    const toType = () =>
      database.delivery.create({ data: { id: newId('delivery'), fleetId, messageId, recipientType: 'reviewer', createdAt: now } });

    await toShip();
    await expect(toShip()).rejects.toThrow(/Unique constraint/);
    await toType();
    await expect(toType()).rejects.toThrow(/Unique constraint/);
  });
});

describe('events', () => {
  /** Each event a test writes takes the next number; the tests here write outside a unit of work. */
  let lastSeq = 0n;
  const nextSeq = () => {
    lastSeq += 1n;
    return lastSeq;
  };

  it('keep their details as a JSON object', async () => {
    const fleetId = await createFleet();
    const event = (details: object) =>
      database.event.create({
        data: { id: newId('event'), fleetId, type: 'FleetInitialised', occurredAt: now, actorKind: 'system', details, seq: nextSeq() },
      });

    await expect(event(['name'])).rejects.toThrow(/events_details_object/);
    await expect(event({ name: 'home fleet' })).resolves.toMatchObject({ details: { name: 'home fleet' } });
  });

  it("refuse a ship of another fleet as actor or subject", async () => {
    const shipOfAnotherFleet = await createShip(await createFleet());
    const fleetId = await createFleet();
    const event = (ids: { actorShipId?: string; shipId?: string }) =>
      database.event.create({
        data: { id: newId('event'), fleetId, type: 'ShipClaimed', occurredAt: now, actorKind: ids.actorShipId === undefined ? 'system' : 'ship', details: {}, seq: nextSeq(), ...ids },
      });

    await expect(event({ actorShipId: shipOfAnotherFleet })).rejects.toThrow(/Foreign key constraint/);
    await expect(event({ shipId: shipOfAnotherFleet })).rejects.toThrow(/Foreign key constraint/);
  });


  it('take each number once per fleet', async () => {
    const fleetId = await createFleet();
    const event = () =>
      database.event.create({ data: { id: newId('event'), fleetId, type: 'ShipClaimed', occurredAt: now, actorKind: 'system', details: {}, seq: 1n } });

    await event();
    await expect(event()).rejects.toThrow(/Unique constraint/);
  });

  it('are append-only: never updated, deleted or truncated', async () => {
    const fleetId = await createFleet();
    const id = newId('event');
    await database.event.create({
      data: { id, fleetId, type: 'ShipCommissioned', occurredAt: now, actorKind: 'system', details: {}, seq: nextSeq() },
    });

    await expect(database.event.update({ where: { id }, data: { type: 'ShipRetired' } })).rejects.toThrow(
      /append-only: UPDATE/,
    );
    await expect(database.event.delete({ where: { id } })).rejects.toThrow(/append-only: DELETE/);
    await expect(database.$executeRaw`TRUNCATE events`).rejects.toThrow(/append-only: TRUNCATE/);
    await expect(database.event.findUnique({ where: { id } })).resolves.toMatchObject({ type: 'ShipCommissioned' });
  });
});

describe('the handed migration', () => {
  const MIGRATIONS = fileURLToPath(new URL('../src/adapters/prisma/migrations', import.meta.url));

  const names = readdirSync(MIGRATIONS)
    .filter((name) => /^\d{14}_/.test(name))
    .sort();
  const handed = names.findIndex((name) => name.endsWith('_delivery_handed'));

  async function apply(databaseUrl: string, migrations: string[]): Promise<void> {
    for (const name of migrations) {
      await executeSqlFile(databaseUrl, `${MIGRATIONS}/${name}/migration.sql`);
    }
  }

  /** A fleet as the fleet stored it before handed: one delivery delivered, its DeliveryClaimed, and a later ack's event. */
  async function storedBeforeHanded(url: string) {
    await apply(url, names.slice(0, handed));
    const before = createPrismaClient(url);
    const fleetId = newId('fleet');
    const shipId = newId('ship');
    const leaseId = newId('lease');
    const messageId = newId('message');
    const deliveryId = newId('delivery');
    const [claimed, acknowledged] = [newId('event'), newId('event')];
    try {
      // Raw: the generated client writes the defaults of columns later migrations add.
      await before.$executeRaw`INSERT INTO fleets (id, name, created_at, last_event_seq) VALUES (${fleetId}, 'old fleet', ${now}, 2)`;
      // createMany: it returns no row, so it reads none of the columns later migrations add.
      await before.ship.createMany({ data: [{ id: shipId, fleetId, name: 'scout', type: 'reviewer', kind: 'agent', scopes: [], createdAt: now }] });
      // Raw: the generated client writes the defaults of columns later migrations add.
      await before.$executeRaw`
        INSERT INTO leases (id, fleet_id, ship_id, location, started_at)
        VALUES (${leaseId}, ${fleetId}, ${shipId}, 'DEVICE', ${now})`;
      // Raw: the generated client writes the defaults of columns later migrations add.
      await before.$executeRaw`
        INSERT INTO messages (id, fleet_id, sender_ship_id, selector_kind, selector_ship_id, payload, content_type, idempotency_key, request_hash, created_at)
        VALUES (${messageId}, ${fleetId}, ${shipId}, 'ship', ${shipId}, '{}', 'application/json', ${messageId}, ${messageId}, ${now})`;
      // Raw: the generated client knows no state delivered any more.
      await before.$executeRaw`
        INSERT INTO deliveries (id, fleet_id, message_id, recipient_ship_id, state, claimed_by_ship_id, claimed_by_lease_id, attempts, created_at)
        VALUES (${deliveryId}, ${fleetId}, ${messageId}, ${shipId}, 'delivered', ${shipId}, ${leaseId}, 2, ${now})`;
      await insertEventsBeforeActors(before, [
        { id: claimed, fleetId, type: 'DeliveryClaimed', occurredAt: now, actorShipId: shipId, shipId, messageId, deliveryId, details: { leaseId, attempts: 2 }, seq: 1n },
        { id: acknowledged, fleetId, type: 'DeliveryAcknowledged', occurredAt: now, actorShipId: shipId, shipId, messageId, deliveryId, details: { leaseId }, seq: 2n },
      ]);
    } finally {
      await before.$disconnect();
    }
    return { deliveryId, claimed, acknowledged, leaseId };
  }

  it('names a delivery that was delivered handed, keeping who holds it and its attempts', async () => {
    const url = await createEmptyDatabase();
    const { deliveryId, leaseId } = await storedBeforeHanded(url);

    await apply(url, [names[handed] ?? 'missing']);

    const after = createPrismaClient(url);
    try {
      // Raw: the generated client reads columns later migrations add.
      await expect(
        after.$queryRaw`SELECT state::text AS state, claimed_by_lease_id, attempts FROM deliveries WHERE id = ${deliveryId}`,
      ).resolves.toEqual([{ state: 'handed', claimed_by_lease_id: leaseId, attempts: 2 }]);
    } finally {
      await after.$disconnect();
    }
  });

  it('names every stored DeliveryClaimed DeliveryHanded, with its details and number, and leaves the other events as they were', async () => {
    const url = await createEmptyDatabase();
    const { claimed, acknowledged, leaseId } = await storedBeforeHanded(url);

    await apply(url, [names[handed] ?? 'missing']);

    const after = createPrismaClient(url);
    try {
      await expect(after.event.findMany({ select: { id: true, type: true, details: true, seq: true }, orderBy: { seq: 'asc' } })).resolves.toEqual([
        { id: claimed, type: 'DeliveryHanded', details: { leaseId, attempts: 2 }, seq: 1n },
        { id: acknowledged, type: 'DeliveryAcknowledged', details: { leaseId }, seq: 2n },
      ]);
    } finally {
      await after.$disconnect();
    }
  });
});

describe('the owners migration', () => {
  const MIGRATIONS = fileURLToPath(new URL('../src/adapters/prisma/migrations', import.meta.url));
  const names = readdirSync(MIGRATIONS)
    .filter((name) => /^\d{14}_/.test(name))
    .sort();
  const owners = names.findIndex((name) => name.endsWith('_owners'));

  it("makes argo the owner of every ship of its fleet but argo and the viewer, retired ships included (decision 0045)", async () => {
    const url = await createEmptyDatabase();
    for (const name of names.slice(0, owners)) {
      await executeSqlFile(url, `${MIGRATIONS}/${name}/migration.sql`);
    }
    const before = createPrismaClient(url);
    const fleetId = newId('fleet');
    const argoId = newId('ship');
    const viewerId = newId('ship');
    const scoutId = newId('ship');
    const retiredId = newId('ship');
    try {
      // Raw: the generated client knows the owner column the migration adds.
      await before.$executeRaw`INSERT INTO fleets (id, name, created_at) VALUES (${fleetId}, 'old fleet', ${now})`;
      for (const [id, name, kind, retiredAt] of [
        [argoId, 'argo', 'operator', null],
        [viewerId, 'viewer', 'viewer', null],
        [scoutId, 'scout', 'agent', null],
        [retiredId, 'lookout', 'agent', now],
      ] as const) {
        await before.$executeRaw`INSERT INTO ships (id, fleet_id, name, type, kind, scopes, created_at, retired_at)
          VALUES (${id}, ${fleetId}, ${name}, ${name}, ${kind}::ship_kind, '{}', ${now}, ${retiredAt})`;
      }
    } finally {
      await before.$disconnect();
    }

    await executeSqlFile(url, `${MIGRATIONS}/${names[owners] ?? 'missing'}/migration.sql`);

    const after = createPrismaClient(url);
    try {
      await expect(after.ship.findMany({ select: { id: true, ownerShipId: true }, orderBy: { id: 'asc' } })).resolves.toEqual([
        { id: argoId, ownerShipId: null },
        { id: viewerId, ownerShipId: null },
        { id: scoutId, ownerShipId: argoId },
        { id: retiredId, ownerShipId: argoId },
      ]);
    } finally {
      await after.$disconnect();
    }
  });
});

describe('the network in core migration', () => {
  const MIGRATIONS = fileURLToPath(new URL('../src/adapters/prisma/migrations', import.meta.url));

  const names = readdirSync(MIGRATIONS)
    .filter((name) => /^\d{14}_/.test(name))
    .sort();
  const networkInCore = names.findIndex((name) => name.endsWith('_network_in_core'));

  async function apply(databaseUrl: string, migrations: string[]): Promise<void> {
    for (const name of migrations) {
      await executeSqlFile(databaseUrl, `${MIGRATIONS}/${name}/migration.sql`);
    }
  }

  it("keeps no rules applied for a fleet whose open was on, all-to-all, and its rules for a fleet whose open was off, and forgets the plugin", async () => {
    // The database as the migrations before left it: rules always a list, open per verb, the networking plugin, and no draft.
    const url = await createEmptyDatabase();
    await apply(url, names.slice(0, networkInCore));
    const client = createPrismaClient(url);
    const [open, closed] = [newId('fleet'), newId('fleet')];
    const rules = [{ verb: 'send', from: [], to: [] }];
    try {
      // Raw: the generated client knows columns that later migrations add and drop.
      await client.$executeRaw`INSERT INTO "fleets" ("id", "name", "created_at") VALUES (${open}, 'old fleet', ${now}), (${closed}, 'old fleet', ${now})`;
      await client.$executeRaw`INSERT INTO "network_settings" ("fleet_id", "rules", "version", "built_in_open_send", "built_in_open_read", "built_in_open_manage") VALUES (${open}, '[]'::jsonb, 2, true, true, true), (${closed}, ${JSON.stringify(rules)}::jsonb, 5, false, false, false)`;

      await apply(url, [names[networkInCore] ?? 'missing']);

      await expect(client.networkSettings.findMany({ select: { fleetId: true, rules: true, version: true }, orderBy: { version: 'asc' } })).resolves.toEqual([
        { fleetId: open, rules: null, version: 2 },
        { fleetId: closed, rules, version: 5 },
      ]);
      const columns = await client.$queryRaw<{ column_name: string }[]>`SELECT "column_name" FROM information_schema.columns WHERE "table_name" IN ('network_settings', 'reach_refusals') AND ("column_name" LIKE 'plugin%' OR "column_name" LIKE 'built_in_open%' OR "column_name" = 'while_plugin_unavailable')`;
      expect(columns).toEqual([]);
    } finally {
      await client.$disconnect();
    }
  });
});

describe('the verify scope migration', () => {
  const MIGRATIONS = fileURLToPath(new URL('../src/adapters/prisma/migrations', import.meta.url));
  const verify = readdirSync(MIGRATIONS).find((name) => name.endsWith('_verify_scope'));
  const everyScopeBefore = ['messages:send', 'messages:receive', 'messages:force', 'messages:resend', 'fleet:read', 'fleet:commission', 'fleet:manage', 'crew:assign', 'crew:run', 'labels:define', 'labels:assign', 'fleet:network', 'fleet:on-behalf', 'fleet:person', 'fleet:owner', 'fleet:explain', 'fleet:connect', 'labels:any', 'scopes:declare', 'scopes:grant', 'squadrons:form'];

  it("gives every fleet's argo fleet:verify in catalogue order, once, and no other ship (decision 0059)", async () => {
    const url = await createMigratedDatabase();
    const client = createPrismaClient(url);
    const fleetId = newId('fleet');
    const argoId = newId('ship');
    const scoutId = newId('ship');
    try {
      await client.fleet.create({ data: { id: fleetId, name: 'old fleet', createdAt: now } });
      await client.ship.createMany({
        data: [
          { id: argoId, fleetId, name: 'argo', type: 'operator', kind: 'operator', scopes: everyScopeBefore, createdAt: now },
          { id: scoutId, fleetId, name: 'scout', type: 'reviewer', kind: 'agent', scopes: ['messages:send', 'messages:receive', 'fleet:read'], createdAt: now },
        ],
      });

      await executeSqlFile(url, `${MIGRATIONS}/${verify ?? 'missing'}/migration.sql`);
      await executeSqlFile(url, `${MIGRATIONS}/${verify ?? 'missing'}/migration.sql`);

      const ships = await client.ship.findMany({ where: { fleetId }, select: { id: true, scopes: true } });
      expect(new Map(ships.map(({ id, scopes }) => [id, scopes]))).toEqual(
        new Map([
          [
            argoId,
            ['messages:send', 'messages:receive', 'messages:force', 'messages:resend', 'fleet:read', 'fleet:commission', 'fleet:manage', 'crew:assign', 'crew:run', 'labels:define', 'labels:assign', 'fleet:network', 'fleet:on-behalf', 'fleet:person', 'fleet:owner', 'fleet:explain', 'fleet:connect', 'labels:any', 'fleet:verify', 'scopes:declare', 'scopes:grant', 'squadrons:form'],
          ],
          [scoutId, ['messages:send', 'messages:receive', 'fleet:read']],
        ]),
      );
    } finally {
      await client.$disconnect();
    }
  });

  it('records ScopesChanged for each argo it changes, adding fleet:verify, by the system, at the next number of its fleet', async () => {
    const url = await createMigratedDatabase();
    const client = createPrismaClient(url);
    const fleetId = newId('fleet');
    const argoId = newId('ship');
    try {
      await client.fleet.create({ data: { id: fleetId, name: 'old fleet', createdAt: now, lastEventSeq: 1n } });
      await client.ship.create({ data: { id: argoId, fleetId, name: 'argo', type: 'operator', kind: 'operator', scopes: everyScopeBefore, createdAt: now } });

      await executeSqlFile(url, `${MIGRATIONS}/${verify ?? 'missing'}/migration.sql`);

      const recorded = await client.event.findMany({ where: { fleetId } });
      expect(recorded).toMatchObject([
        { type: 'ScopesChanged', actorKind: 'system', actorShipId: null, shipId: argoId, details: { added: 'fleet:verify', removed: '' }, seq: 2n },
      ]);
      expect(idSchema('event').safeParse(recorded[0]?.id).success).toBe(true);
    } finally {
      await client.$disconnect();
    }
  });

  it('lets a ship hold fleet:verify', async () => {
    const url = await createMigratedDatabase();
    const client = createPrismaClient(url);
    const fleetId = newId('fleet');
    try {
      await client.fleet.create({ data: { id: fleetId, name: 'fleet', createdAt: now } });

      await expect(
        client.ship.create({ data: { id: newId('ship'), fleetId, name: 'gateway', type: 'gateway', kind: 'agent', scopes: ['messages:send', 'messages:receive', 'fleet:verify'], createdAt: now } }),
      ).resolves.toBeDefined();
    } finally {
      await client.$disconnect();
    }
  });
});

describe('the meetings:open scope migration', () => {
  const MIGRATIONS = fileURLToPath(new URL('../src/adapters/prisma/migrations', import.meta.url));
  const meetingsOpen = readdirSync(MIGRATIONS).find((name) => name.endsWith('_meetings_open_scope'));
  const everyScopeBefore = ['messages:send', 'messages:receive', 'messages:force', 'messages:resend', 'fleet:read', 'fleet:commission', 'fleet:manage', 'crew:assign', 'crew:run', 'labels:define', 'labels:assign', 'fleet:network', 'fleet:on-behalf', 'fleet:person', 'fleet:owner', 'fleet:explain', 'fleet:connect', 'labels:any', 'fleet:verify', 'scopes:declare', 'scopes:grant', 'squadrons:form'];

  it("gives every fleet's argo meetings:open in catalogue order, once, and no other ship (decision 0061)", async () => {
    const url = await createMigratedDatabase();
    const client = createPrismaClient(url);
    const fleetId = newId('fleet');
    const argoId = newId('ship');
    const scoutId = newId('ship');
    try {
      await client.fleet.create({ data: { id: fleetId, name: 'old fleet', createdAt: now } });
      await client.ship.createMany({
        data: [
          { id: argoId, fleetId, name: 'argo', type: 'operator', kind: 'operator', scopes: everyScopeBefore, createdAt: now },
          { id: scoutId, fleetId, name: 'scout', type: 'reviewer', kind: 'agent', scopes: ['messages:send', 'messages:receive', 'fleet:read'], createdAt: now },
        ],
      });

      await executeSqlFile(url, `${MIGRATIONS}/${meetingsOpen ?? 'missing'}/migration.sql`);
      await executeSqlFile(url, `${MIGRATIONS}/${meetingsOpen ?? 'missing'}/migration.sql`);

      const ships = await client.ship.findMany({ where: { fleetId }, select: { id: true, scopes: true } });
      expect(new Map(ships.map(({ id, scopes }) => [id, scopes]))).toEqual(
        new Map([
          [
            argoId,
            ['messages:send', 'messages:receive', 'messages:force', 'messages:resend', 'fleet:read', 'fleet:commission', 'fleet:manage', 'crew:assign', 'crew:run', 'labels:define', 'labels:assign', 'fleet:network', 'fleet:on-behalf', 'fleet:person', 'fleet:owner', 'fleet:explain', 'fleet:connect', 'labels:any', 'fleet:verify', 'scopes:declare', 'scopes:grant', 'meetings:open', 'squadrons:form'],
          ],
          [scoutId, ['messages:send', 'messages:receive', 'fleet:read']],
        ]),
      );
    } finally {
      await client.$disconnect();
    }
  });

  it('records ScopesChanged for each argo it changes, adding meetings:open, by the system, at the next number of its fleet', async () => {
    const url = await createMigratedDatabase();
    const client = createPrismaClient(url);
    const fleetId = newId('fleet');
    const argoId = newId('ship');
    try {
      await client.fleet.create({ data: { id: fleetId, name: 'old fleet', createdAt: now, lastEventSeq: 1n } });
      await client.ship.create({ data: { id: argoId, fleetId, name: 'argo', type: 'operator', kind: 'operator', scopes: everyScopeBefore, createdAt: now } });

      await executeSqlFile(url, `${MIGRATIONS}/${meetingsOpen ?? 'missing'}/migration.sql`);

      const recorded = await client.event.findMany({ where: { fleetId } });
      expect(recorded).toMatchObject([
        { type: 'ScopesChanged', actorKind: 'system', actorShipId: null, shipId: argoId, details: { added: 'meetings:open', removed: '' }, seq: 2n },
      ]);
    } finally {
      await client.$disconnect();
    }
  });

  it('lets a ship hold meetings:open, and keeps the meetings namespace from any plugin', async () => {
    const url = await createMigratedDatabase();
    const client = createPrismaClient(url);
    const fleetId = newId('fleet');
    try {
      await client.fleet.create({ data: { id: fleetId, name: 'fleet', createdAt: now } });

      await expect(
        client.ship.create({ data: { id: newId('ship'), fleetId, name: 'chief', type: 'chief-of-staff', kind: 'agent', scopes: ['messages:send', 'messages:receive', 'meetings:open'], createdAt: now } }),
      ).resolves.toBeDefined();
      await expect(
        client.ship.create({ data: { id: newId('ship'), fleetId, name: 'rogue', type: 'rogue', kind: 'agent', scopes: ['messages:send', 'meetings:close'], createdAt: now } }),
      ).rejects.toThrow();
    } finally {
      await client.$disconnect();
    }
  });
});

describe('the message days migration', () => {
  const MIGRATIONS = fileURLToPath(new URL('../src/adapters/prisma/migrations', import.meta.url));
  const names = readdirSync(MIGRATIONS)
    .filter((name) => /^\d{14}_/.test(name))
    .sort();
  const messageDays = names.findIndex((name) => name.endsWith('_message_days'));

  it("counts every message stored before it once, on its fleet's row for the UTC day it was stored, with its payload's UTF-8 bytes", async () => {
    const url = await createEmptyDatabase();
    for (const name of names.slice(0, messageDays)) {
      await executeSqlFile(url, `${MIGRATIONS}/${name}/migration.sql`);
    }
    const client = createPrismaClient(url);
    const [home, away] = [newId('fleet'), newId('fleet')];
    const [homeArgo, awayArgo] = [newId('ship'), newId('ship')];
    try {
      await client.$executeRaw`INSERT INTO fleets (id, name, created_at) VALUES (${home}, 'home', ${now}), (${away}, 'away', ${now})`;
      await client.$executeRaw`
        INSERT INTO ships (id, fleet_id, name, type, kind, scopes, created_at)
        VALUES (${homeArgo}, ${home}, 'argo', 'operator', 'operator', '{}', ${now}), (${awayArgo}, ${away}, 'argo', 'operator', 'operator', '{}', ${now})`;
      const message = ({ fleetId, senderShipId, payload, createdAt }: { fleetId: FleetId; senderShipId: ShipId; payload: string; createdAt: string }) =>
        client.$executeRaw`
          INSERT INTO messages (id, fleet_id, sender_ship_id, selector_kind, selector_ship_id, payload, content_type, idempotency_key, request_hash, created_at)
          VALUES (${newId('message')}, ${fleetId}, ${senderShipId}, 'ship', ${senderShipId}, ${payload}, 'text/plain', ${newId('message')}, 'hash', ${new Date(createdAt)})`;
      await message({ fleetId: home, senderShipId: homeArgo, payload: 'Prüfe ✓', createdAt: '2026-10-03T23:59:59.999Z' });
      await message({ fleetId: home, senderShipId: homeArgo, payload: 'Review', createdAt: '2026-10-03T08:00:00.000Z' });
      await message({ fleetId: home, senderShipId: homeArgo, payload: 'Next', createdAt: '2026-10-04T00:00:00.000Z' });
      await message({ fleetId: away, senderShipId: awayArgo, payload: 'Hi', createdAt: '2026-10-04T10:00:00.000Z' });

      await executeSqlFile(url, `${MIGRATIONS}/${names[messageDays] ?? 'missing'}/migration.sql`);

      await expect(
        client.$queryRaw`SELECT fleet_id AS "fleetId", to_char(day, 'YYYY-MM-DD') AS day, messages, payload_bytes AS "payloadBytes" FROM message_days ORDER BY fleet_id, day`,
      ).resolves.toEqual(
        [
          { fleetId: home, day: '2026-10-03', messages: 2, payloadBytes: 16n },
          { fleetId: home, day: '2026-10-04', messages: 1, payloadBytes: 4n },
          { fleetId: away, day: '2026-10-04', messages: 1, payloadBytes: 2n },
        ].toSorted((a, b) => a.fleetId.localeCompare(b.fleetId) || a.day.localeCompare(b.day)),
      );
    } finally {
      await client.$disconnect();
    }
  });
});
