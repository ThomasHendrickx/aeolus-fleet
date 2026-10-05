import { createIdGenerator, idSchema, type FleetId, type MessageId, type ShipId } from '@aeolus-fleet/common';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { createPrismaClient, type PrismaClient } from '../src/adapters/prisma/client.js';
import { createEmptyDatabase, createMigratedDatabase, prisma } from './support/database.js';

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
      'console_sessions',
      'credentials',
      'deliveries',
      'events',
      'fleets',
      'guide_progress',
      'guides',
      'installation_requests',
      'installation_settings',
      'leases',
      'messages',
      'notice_dismissals',
      'notices',
      'operators',
      'ships',
      'sign_in_tickets',
    ]);
    // The installation's settings, notices and guide belong to no fleet (decisions 0020, 0023 and 0024).
    expect(tables.filter((table) => !table.hasFleetId).map((table) => table.table_name)).toEqual(['fleets', 'guides', 'installation_settings', 'notices']);
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
      await prisma(databaseUrl, 'db', 'execute', '--file', `${MIGRATIONS}/${name}/migration.sql`);
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
      await prisma(databaseUrl, 'db', 'execute', '--file', `${MIGRATIONS}/${name}/migration.sql`);
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
  it('are only the five known ones', async () => {
    const id = await createShip(await createFleet());

    await expect(
      database.ship.update({ where: { id }, data: { scopes: ['messages:send', 'fleet:write'] } }),
    ).rejects.toThrow(/ships_scopes_known/);
    await expect(
      database.ship.update({
        where: { id },
        data: { scopes: ['messages:send', 'messages:receive', 'fleet:read', 'fleet:manage', 'fleet:crew'] },
      }),
    ).resolves.toMatchObject({ scopes: ['messages:send', 'messages:receive', 'fleet:read', 'fleet:manage', 'fleet:crew'] });
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
      state: 'pending' | 'delivered' | 'acknowledged';
      claimedByShipId?: ShipId;
      claimedByLeaseId?: string;
    }) =>
      database.delivery.create({
        data: { id: newId('delivery'), fleetId, messageId: await createMessage(fleetId), recipientShipId: shipId, createdAt: now, ...claim },
      });

    await expect(delivery({ state: 'delivered' })).rejects.toThrow(/deliveries_claim/);
    await expect(delivery({ state: 'delivered', claimedByShipId: shipId })).rejects.toThrow(/deliveries_claim/);
    await expect(delivery({ state: 'pending', claimedByShipId: shipId, claimedByLeaseId: leaseId })).rejects.toThrow(
      /deliveries_claim/,
    );
    await expect(delivery({ state: 'delivered', claimedByShipId: shipId, claimedByLeaseId: leaseId })).resolves.toMatchObject({
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
          state: 'delivered',
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
        data: { id: newId('event'), fleetId, type: 'FleetInitialised', occurredAt: now, details, seq: nextSeq() },
      });

    await expect(event(['name'])).rejects.toThrow(/events_details_object/);
    await expect(event({ name: 'home fleet' })).resolves.toMatchObject({ details: { name: 'home fleet' } });
  });

  it("refuse a ship of another fleet as actor or subject", async () => {
    const shipOfAnotherFleet = await createShip(await createFleet());
    const fleetId = await createFleet();
    const event = (ids: { actorShipId?: string; shipId?: string }) =>
      database.event.create({
        data: { id: newId('event'), fleetId, type: 'ShipClaimed', occurredAt: now, details: {}, seq: nextSeq(), ...ids },
      });

    await expect(event({ actorShipId: shipOfAnotherFleet })).rejects.toThrow(/Foreign key constraint/);
    await expect(event({ shipId: shipOfAnotherFleet })).rejects.toThrow(/Foreign key constraint/);
  });


  it('take each number once per fleet', async () => {
    const fleetId = await createFleet();
    const event = () =>
      database.event.create({ data: { id: newId('event'), fleetId, type: 'ShipClaimed', occurredAt: now, details: {}, seq: 1n } });

    await event();
    await expect(event()).rejects.toThrow(/Unique constraint/);
  });

  it('are append-only: never updated, deleted or truncated', async () => {
    const fleetId = await createFleet();
    const id = newId('event');
    await database.event.create({
      data: { id, fleetId, type: 'ShipCommissioned', occurredAt: now, details: {}, seq: nextSeq() },
    });

    await expect(database.event.update({ where: { id }, data: { type: 'ShipRetired' } })).rejects.toThrow(
      /append-only: UPDATE/,
    );
    await expect(database.event.delete({ where: { id } })).rejects.toThrow(/append-only: DELETE/);
    await expect(database.$executeRaw`TRUNCATE events`).rejects.toThrow(/append-only: TRUNCATE/);
    await expect(database.event.findUnique({ where: { id } })).resolves.toMatchObject({ type: 'ShipCommissioned' });
  });
});
