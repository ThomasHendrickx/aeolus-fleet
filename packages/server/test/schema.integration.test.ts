import { createIdGenerator, idSchema, type FleetId, type MessageId, type ShipId } from '@aeolus-fleet/common';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createPrismaClient, type PrismaClient } from '../src/adapters/prisma/client.js';
import { createMigratedDatabase, prisma } from './support/database.js';

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

async function createMessage(fleetId: FleetId, payload = '{}'): Promise<MessageId> {
  const id = newId('message');
  await database.message.create({
    data: { id, fleetId, payload, contentType: 'application/json', idempotencyKey: id, createdAt: now },
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
      'leases',
      'messages',
      'ships',
    ]);
    expect(tables.filter((table) => !table.hasFleetId).map((table) => table.table_name)).toEqual(['fleets']);
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

describe('scopes', () => {
  it('are only the four known ones', async () => {
    const id = await createShip(await createFleet());

    await expect(
      database.ship.update({ where: { id }, data: { scopes: ['messages:send', 'fleet:write'] } }),
    ).rejects.toThrow(/ships_scopes_known/);
    await expect(
      database.ship.update({
        where: { id },
        data: { scopes: ['messages:send', 'messages:receive', 'fleet:read', 'fleet:manage'] },
      }),
    ).resolves.toMatchObject({ scopes: ['messages:send', 'messages:receive', 'fleet:read', 'fleet:manage'] });
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
  it('keep their details as a JSON object', async () => {
    const fleetId = await createFleet();
    const event = (details: object) =>
      database.event.create({ data: { id: newId('event'), fleetId, type: 'FleetInitialised', occurredAt: now, details } });

    await expect(event(['name'])).rejects.toThrow(/events_details_object/);
    await expect(event({ name: 'home fleet' })).resolves.toMatchObject({ details: { name: 'home fleet' } });
  });

  it("refuse a ship of another fleet as actor or subject", async () => {
    const shipOfAnotherFleet = await createShip(await createFleet());
    const fleetId = await createFleet();
    const event = (ids: { actorShipId?: string; shipId?: string }) =>
      database.event.create({
        data: { id: newId('event'), fleetId, type: 'ShipClaimed', occurredAt: now, details: {}, ...ids },
      });

    await expect(event({ actorShipId: shipOfAnotherFleet })).rejects.toThrow(/Foreign key constraint/);
    await expect(event({ shipId: shipOfAnotherFleet })).rejects.toThrow(/Foreign key constraint/);
  });


  it('are append-only: never updated, deleted or truncated', async () => {
    const fleetId = await createFleet();
    const id = newId('event');
    await database.event.create({ data: { id, fleetId, type: 'ShipCommissioned', occurredAt: now, details: {} } });

    await expect(database.event.update({ where: { id }, data: { type: 'ShipRetired' } })).rejects.toThrow(
      /append-only: UPDATE/,
    );
    await expect(database.event.delete({ where: { id } })).rejects.toThrow(/append-only: DELETE/);
    await expect(database.$executeRaw`TRUNCATE events`).rejects.toThrow(/append-only: TRUNCATE/);
    await expect(database.event.findUnique({ where: { id } })).resolves.toMatchObject({ type: 'ShipCommissioned' });
  });
});
