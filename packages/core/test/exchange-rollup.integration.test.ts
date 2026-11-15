import { fileURLToPath } from 'node:url';
import { createIdGenerator, idSchema, type DeliveryId, type MessageId, type ShipId } from '@aeolus-fleet/common';
import { z } from 'zod';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { createApp } from '../src/app.js';
import { sha256Hasher } from '../src/adapters/crypto/secrets.js';
import { createPrismaMetadataFillIndexes } from '../src/adapters/prisma/message-metadata-fill.js';
import { createPrismaUnitOfWork, type PrismaTx } from '../src/adapters/prisma/unit-of-work.js';
import { createAcknowledgeDelivery } from '../src/domain/messaging/acknowledge-delivery.js';
import { createAcknowledgeUpTo } from '../src/domain/messaging/acknowledge-up-to.js';
import { createSendMessage } from '../src/domain/messaging/send-message.js';
import type { Crew, ShipCaller } from '../src/domain/shared/caller.js';
import type { Selector } from '../src/domain/shared/selector.js';
import type { UnitOfWork } from '../src/domain/shared/unit-of-work.js';
import { executeSqlFile } from '../src/testing/database.js';
import { newKey } from '../src/testing/keys.js';
import { unwrap } from '../src/testing/result.js';
import { operatorCaller, secretOf } from './support/core-fixtures.js';
import { fillUntilComplete, metadataFillOf } from './support/metadata-fill.js';
import { withOperatorLogin } from './support/operator-login.js';
import { createPostgresCore, heldUnitOfWork, type PostgresCore } from './support/postgres-core.js';
import { unsealedFleetsOnly } from './support/sealing.js';

// The rollup of the list of exchanges on a real Postgres
// (docs/design/exchange-read, E4, E5, section 5): kept for person ships in
// the transactions that make, claim, acknowledge and return a delivery, it
// stays what a recount from the deliveries says under concurrent sends,
// claims, acks and lease ends, and a transaction rolled back changes it not.

const MODEL = 'claude-opus-5-5';
const newId = createIdGenerator();

let core: PostgresCore;
let argo: ShipCaller;

beforeEach(async () => {
  core = await createPostgresCore();
  argo = operatorCaller(unwrap(await withOperatorLogin(core.prisma, core.useCases.initialiseFleet({ name: 'home fleet' }))));
});

afterEach(async () => {
  await core.close();
});

async function crewed(ship: { name: string; kind: 'person' | 'agent'; type: string }): Promise<Crew> {
  const { shipId, secret } = unwrap(await core.useCases.commissionShip(argo, { ...ship, idempotencyKey: newKey() }));
  const { crewToken } = unwrap(await core.useCases.claimShip({ shipId, secret: secretOf(secret), location: { kind: 'CLOUD' }, harness: 'claude-code' }));
  return unwrap(await core.useCases.authenticate.byCrewToken(crewToken));
}

function sendOf(from: ShipCaller, { to, payload }: { to: Selector; payload: string }) {
  const model = from.kind === 'agent' ? { model: MODEL } : {};
  return { selector: to, payload, contentType: 'text/plain', idempotencyKey: newKey(), ...model };
}

async function send(from: ShipCaller, message: { to: Selector; payload: string }): Promise<MessageId> {
  core.clock.advance(1_000);
  return unwrap(await core.useCases.sendMessage(from, sendOf(from, message))).messageId;
}

async function deliveryOf(messageId: MessageId, shipId: ShipId): Promise<DeliveryId> {
  const delivery = await core.prisma.delivery.findFirstOrThrow({ where: { messageId, reachedShipId: shipId } });
  return idSchema('delivery').parse(delivery.id);
}

async function labelOf(shipIds: readonly ShipId[]): Promise<Selector> {
  const scopes = ['labels:define', 'labels:assign', 'labels:any'] as const;
  const { shipId } = unwrap(await core.useCases.commissionShip(argo, { idempotencyKey: newKey(), name: 'trierarch-plugin', type: 'trierarch-plugin', scopes: [...scopes] }));
  const plugin: ShipCaller = { fleetId: argo.fleetId, shipId, kind: 'agent', scopes: [...scopes] };
  const { values } = unwrap(await core.useCases.defineLabel(plugin, { key: 'team', values: ['bridge'] }));
  const valueId = values[0]?.id;
  if (valueId === undefined) {
    throw new Error('defineLabel answered no value');
  }
  for (const labelled of shipIds) {
    unwrap(await core.useCases.assignLabel(plugin, { shipId: labelled, valueId }));
  }
  return { kind: 'label', valueIds: [valueId] };
}

/** The rollup as stored: each person ship's row per other ship. */
async function rollup(): Promise<{ shipId: string; otherShipId: string; newestMessageId: string; unacknowledged: number; unseenPlainMessages: number }[]> {
  return z
    .array(z.object({ shipId: z.string(), otherShipId: z.string(), newestMessageId: z.string(), unacknowledged: z.int(), unseenPlainMessages: z.int() }))
    .parse(
      await core.prisma.$queryRaw`
        SELECT ship_id AS "shipId", other_ship_id AS "otherShipId", newest_message_id AS "newestMessageId", unacknowledged, unseen_plain_messages AS "unseenPlainMessages"
        FROM exchanges ORDER BY ship_id, other_ship_id`,
    );
}

/** The metadata fill's indexes there are, by name, and whether each is valid. */
async function fillIndexes(): Promise<{ name: string; isValid: boolean }[]> {
  return z.array(z.object({ name: z.string(), isValid: z.boolean() })).parse(
    await core.prisma.$queryRaw`
      SELECT c.relname AS name, i.indisvalid AS "isValid" FROM pg_index i JOIN pg_class c ON c.oid = i.indexrelid
      WHERE c.relname IN ('deliveries_open_exchange_idx', 'messages_unfilled_questions_idx') ORDER BY c.relname`,
  );
}

/** What a recount from the deliveries says each person ship's rows hold: the deliveries from the other ship still open, and the newest message both ways. */
async function recount(): Promise<{ shipId: string; otherShipId: string; newestMessageId: string; unacknowledged: number; unseenPlainMessages: number }[]> {
  return z
    .array(z.object({ shipId: z.string(), otherShipId: z.string(), newestMessageId: z.string(), unacknowledged: z.int(), unseenPlainMessages: z.int() }))
    .parse(
      await core.prisma.$queryRaw`
        SELECT s.id AS "shipId", x.other AS "otherShipId", max(x.message_id) AS "newestMessageId",
               (count(*) FILTER (WHERE x.is_to_ship AND x.state IN ('pending', 'received', 'handed')))::int AS unacknowledged,
               (count(*) FILTER (WHERE x.is_to_ship AND x.state IN ('pending', 'received', 'handed') AND lower(btrim(split_part(m.content_type, ';', 1))) NOT IN ('application/vnd.aeolus.question+json')))::int AS "unseenPlainMessages"
        FROM ships s
        JOIN LATERAL (
          SELECT d.sender_ship_id AS other, d.message_id, d.state::text AS state, true AS is_to_ship
          FROM deliveries d WHERE d.fleet_id = s.fleet_id AND d.is_in_exchange AND d.reached_ship_id = s.id
          UNION ALL
          SELECT d.reached_ship_id, d.message_id, d.state::text, false
          FROM deliveries d WHERE d.fleet_id = s.fleet_id AND d.is_in_exchange AND d.sender_ship_id = s.id AND d.reached_ship_id IS NOT NULL
        ) x ON true
        JOIN messages m ON m.fleet_id = s.fleet_id AND m.id = x.message_id
        WHERE s.kind = 'person'
        GROUP BY 1, 2
        ORDER BY 1, 2`,
    );
}

describe('the rollup of exchanges on Postgres', () => {
  it('counts unseen plain messages separately from conventions and clears only plain messages seen up to here', async () => {
    // Given a person has two plain messages and a question from the same ship.
    const thomas = await crewed({ name: 'thomas', kind: 'person', type: 'person' });
    const lookout = await crewed({ name: 'lookout', kind: 'agent', type: 'reviewer' });
    const to: Selector = { kind: 'ship', shipId: thomas.shipId };
    await send(lookout, { to, payload: 'One' });
    const last = unwrap(await core.useCases.sendMessage(lookout, { ...sendOf(lookout, { to, payload: '{}' }), contentType: 'application/json' })).messageId;
    unwrap(await core.useCases.sendMessage(lookout, { ...sendOf(lookout, { to, payload: JSON.stringify({ id: 'db3ef9eb-4b56-463e-9de6-92b475b70a59', title: 'Merge?', context: '', options: [{ key: 1, label: 'Yes' }], pick: { option: 1, why: 'Ready' } }) }), contentType: 'application/vnd.aeolus.question+json; charset=utf-8' }));

    const retired = await crewed({ name: 'retired', kind: 'agent', type: 'reviewer' });
    await send(retired, { to, payload: 'An old chat' });
    unwrap(await core.useCases.retireShip(argo, { shipId: retired.shipId }));
    const { meetingId } = unwrap(await core.useCases.openMeeting(lookout, { ships: [{ shipId: thomas.shipId }], idempotencyKey: newKey(), model: MODEL }));
    await send(lookout, { to: { kind: 'meeting', meetingId }, payload: 'In the meeting' });
    unwrap(await core.useCases.pingShip(argo, { shipId: thomas.shipId }));

    // When the person reads the exchanges, the migration backfills them again, and the person marks the plain messages seen.
    const before = unwrap(await core.useCases.readExchanges(thomas, {}));
    await core.prisma.$executeRaw`ALTER TABLE exchanges DROP COLUMN unseen_plain_messages`;
    await executeSqlFile(core.databaseUrl, fileURLToPath(new URL('../src/adapters/prisma/migrations/20261115100000_unseen_plain_messages/migration.sql', import.meta.url)));
    const partial = unwrap(await core.useCases.readExchanges(thomas, {}));
    // Each batch commits separately; restarting from the beginning is harmless.
    await fillUntilComplete(core.prisma, 1);
    await expect(rollup()).resolves.toEqual(await recount());
    const backfilled = unwrap(await core.useCases.readExchanges(thomas, {}));
    unwrap(await core.useCases.acknowledgeUpTo(thomas, { otherShipId: lookout.shipId, messageId: last }));
    const after = unwrap(await core.useCases.readExchanges(thomas, {}));

    // Then the count held two plain messages before and after the backfill, and the question stays unacknowledged but adds no unseen plain message.
    expect(before.items).toMatchObject([{ unacknowledged: 3, unseenPlainMessages: 2 }]);
    expect(partial.items).toMatchObject([{ unacknowledged: 3, unseenPlainMessages: 2 }]);
    expect(backfilled.items).toMatchObject([{ unacknowledged: 3, unseenPlainMessages: 2 }]);
    expect(after.items).toMatchObject([{ unacknowledged: 1, unseenPlainMessages: 0 }]);
  });

  it('starts serving before filling old exchanges and finishes the fill while serving', async () => {
    // Given an old exchange and a server that has not started listening.
    const thomas = await crewed({ name: 'thomas', kind: 'person', type: 'person' });
    const lookout = await crewed({ name: 'lookout', kind: 'agent', type: 'reviewer' });
    await send(lookout, { to: { kind: 'ship', shipId: thomas.shipId }, payload: 'One' });
    await core.prisma.$executeRaw`UPDATE exchanges SET unseen_plain_messages = NULL`;
    const server = createApp({ databaseUrl: core.databaseUrl, publicUrl: 'http://localhost', clock: core.clock, logger: false });
    try {
      const before = await core.prisma.exchange.findFirstOrThrow();
      const indexesBefore = await fillIndexes();
      // When core starts listening, its background pass builds the fill's indexes and fills the exchange.
      await server.listen({ host: '127.0.0.1', port: 0 });
      await expect.poll(async () => (await core.prisma.messageMetadataBackfill.findUnique({ where: { fleetId: argo.fleetId } }))?.isComplete).toBe(true);
      // Then neither the migrations nor anything before listen built an index or filled a count, and the serving core built both valid and committed the right count.
      expect(before.unseenPlainMessages).toBeNull();
      expect(indexesBefore).toEqual([]);
      await expect(fillIndexes()).resolves.toEqual([
        { name: 'deliveries_open_exchange_idx', isValid: true },
        { name: 'messages_unfilled_questions_idx', isValid: true },
      ]);
      await expect(rollup()).resolves.toEqual(await recount());
    } finally {
      await server.close();
    }
  });

  it('rolls back a failed batch with its cursor and resumes without doubling the count', async () => {
    // Given an old exchange with a pending plain message and no filled count.
    const thomas = await crewed({ name: 'thomas', kind: 'person', type: 'person' });
    const lookout = await crewed({ name: 'lookout', kind: 'agent', type: 'reviewer' });
    await send(lookout, { to: { kind: 'ship', shipId: thomas.shipId }, payload: 'One' });
    await core.prisma.$executeRaw`UPDATE exchanges SET unseen_plain_messages = NULL`;
    await core.prisma.$executeRawUnsafe(`CREATE FUNCTION fail_cursor() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'cursor disk full'; END $$`);
    await core.prisma.$executeRawUnsafe(`CREATE TRIGGER fail_cursor BEFORE UPDATE ON message_metadata_backfills FOR EACH ROW EXECUTE FUNCTION fail_cursor()`);

    // When the batch fails after recounting but before committing its cursor.
    const failures: unknown[] = [];
    await expect(metadataFillOf(core.prisma)((_, error) => failures.push(error))).resolves.toEqual({ isComplete: false });
    const failed = await core.prisma.exchange.findFirstOrThrow();
    await core.prisma.$executeRawUnsafe('DROP TRIGGER fail_cursor ON message_metadata_backfills');
    await fillUntilComplete(core.prisma);

    // Then the failed transaction changed nothing and its retry counted exactly once.
    expect(String(failures)).toContain('cursor disk full');
    expect(failed.unseenPlainMessages).toBeNull();
    await expect(rollup()).resolves.toEqual(await recount());
    expect(unwrap(await core.useCases.readExchanges(thomas, {})).items).toMatchObject([{ unseenPlainMessages: 1 }]);
  });

  it('keeps the filled count correct when a batch runs before an acknowledgement commits', async () => {
    // Given a pending plain message in an unfilled old exchange.
    const thomas = await crewed({ name: 'thomas', kind: 'person', type: 'person' });
    const lookout = await crewed({ name: 'lookout', kind: 'agent', type: 'reviewer' });
    const messageId = await send(lookout, { to: { kind: 'ship', shipId: thomas.shipId }, payload: 'One' });
    unwrap(await core.useCases.pushReceiveDeliveries(thomas, {}));
    await core.prisma.$executeRaw`UPDATE exchanges SET unseen_plain_messages = NULL`;
    // As core serves once its first pass built the fill's indexes: a build waits for every open transaction, the held ack's too.
    await createPrismaMetadataFillIndexes(core.prisma).build();
    const { uow } = heldUnitOfWork(core.prisma, (tx, hold) => ({
      ...tx,
      deliveries: {
        ...tx.deliveries,
        update: async (delivery) => {
          await tx.deliveries.update(delivery);
          await hold(metadataFillOf(core.prisma)().then(() => undefined));
        },
      },
    }));
    // When the batch counts the committed delivery while its ack is uncommitted.
    const acknowledge = createAcknowledgeDelivery({ uow, clock: core.clock, ids: newId });
    unwrap(await acknowledge(thomas, { deliveryId: await deliveryOf(messageId, thomas.shipId) }));
    // Then the ack's subsequent delta clears the filled count exactly once.
    await expect(rollup()).resolves.toEqual(await recount());
    expect(unwrap(await core.useCases.readExchanges(thomas, {})).items).toMatchObject([{ unseenPlainMessages: 0 }]);
  });

  it('fills an exchange whose newest message the walk by message id already passed, as when pruning moves it back or a send commits late', async () => {
    // Given two old exchanges, the message walk already past every message, and the exchange walk not started.
    const thomas = await crewed({ name: 'thomas', kind: 'person', type: 'person' });
    const lookout = await crewed({ name: 'lookout', kind: 'agent', type: 'reviewer' });
    const scout = await crewed({ name: 'scout', kind: 'agent', type: 'reviewer' });
    await send(lookout, { to: { kind: 'ship', shipId: thomas.shipId }, payload: 'One' });
    const newest = await send(scout, { to: { kind: 'ship', shipId: thomas.shipId }, payload: 'Two' });
    await core.prisma.$executeRaw`UPDATE exchanges SET unseen_plain_messages = NULL`;
    await core.prisma.$executeRaw`INSERT INTO message_metadata_backfills (fleet_id, after_message_id) VALUES (${argo.fleetId}, ${newest})`;

    // When the fill runs, one exchange a batch, until it says it is complete.
    await fillUntilComplete(core.prisma, 1);

    // Then every exchange from before holds its count, and none is left to recount on each read.
    await expect(core.prisma.exchange.count({ where: { unseenPlainMessages: null } })).resolves.toBe(0);
    await expect(rollup()).resolves.toEqual(await recount());
  });

  it('builds an index a failed build left invalid again, and builds none twice', async () => {
    // Given a failed build left the open deliveries index invalid, on the wrong columns.
    await core.prisma.$executeRaw`CREATE INDEX deliveries_open_exchange_idx ON deliveries (id)`;
    await core.prisma.$executeRaw`UPDATE pg_index SET indisvalid = false WHERE indexrelid = 'deliveries_open_exchange_idx'::regclass`;

    // When the fill runs twice.
    await fillUntilComplete(core.prisma);
    await fillUntilComplete(core.prisma);

    // Then both indexes are valid, the open deliveries one on its own columns.
    await expect(fillIndexes()).resolves.toEqual([
      { name: 'deliveries_open_exchange_idx', isValid: true },
      { name: 'messages_unfilled_questions_idx', isValid: true },
    ]);
    const [definition] = await core.prisma.$queryRaw<{ indexdef: string }[]>`SELECT indexdef FROM pg_indexes WHERE indexname = 'deliveries_open_exchange_idx'`;
    expect(definition?.indexdef).toContain('(fleet_id, reached_ship_id, sender_ship_id, id) WHERE');
  });

  it('is kept as messages are sent, claimed, acknowledged and returned when a lease ends', async () => {
    // Given the lookout wrote thomas by name and by type, thomas's crew took both and acknowledged one, and thomas answered.
    const thomas = await crewed({ name: 'thomas', kind: 'person', type: 'person' });
    const lookout = await crewed({ name: 'lookout', kind: 'agent', type: 'reviewer' });
    const byName = await send(lookout, { to: { kind: 'ship', shipId: thomas.shipId }, payload: 'Merge PR #1497?' });
    await send(lookout, { to: { kind: 'type', type: 'person' }, payload: 'Who is on call?' });
    unwrap(await core.useCases.pushReceiveDeliveries(thomas, { max: 10 }));
    unwrap(await core.useCases.acknowledgeDelivery(thomas, { deliveryId: await deliveryOf(byName, thomas.shipId) }));
    const answer = await send(thomas, { to: { kind: 'ship', shipId: lookout.shipId }, payload: 'Yes, merge it' });
    const kept = await rollup();

    // When thomas's lease ends, which returns the one of its type to pending, no longer reaching thomas.
    unwrap(await core.useCases.releaseShip(argo, { shipId: thomas.shipId }));

    // Then the row of thomas and the lookout held one open before, and none after; only person ships have rows.
    expect(kept).toEqual([{ shipId: thomas.shipId, otherShipId: lookout.shipId, newestMessageId: answer, unacknowledged: 1, unseenPlainMessages: 1 }]);
    expect(await rollup()).toEqual([{ shipId: thomas.shipId, otherShipId: lookout.shipId, newestMessageId: answer, unacknowledged: 0, unseenPlainMessages: 0 }]);
    expect(await recount()).toEqual(await rollup());
  });

  it('stays what a recount says under concurrent sends, label sends, claims, acks and a lease end', async () => {
    // Given two person ships and four agents.
    const thomas = await crewed({ name: 'thomas', kind: 'person', type: 'person' });
    const maria = await crewed({ name: 'maria', kind: 'person', type: 'person' });
    const agents = await Promise.all(['lookout', 'scout', 'pilot', 'bosun'].map((name) => crewed({ name, kind: 'agent', type: 'reviewer' })));
    const team = await labelOf([thomas.shipId, maria.shipId]);
    const sendAll = (count: number) =>
      agents.flatMap((agent, index) =>
        Array.from({ length: count }, (_, n) => {
          const to: Selector = n % 3 === 0 ? team : n % 3 === 1 ? { kind: 'ship', shipId: (index % 2 === 0 ? thomas : maria).shipId } : { kind: 'type', type: 'person' };
          return core.useCases.sendMessage(agent, sendOf(agent, { to, payload: `Note ${String(n)}` }));
        }),
      );
    await Promise.all(sendAll(6));

    // When more come while both person ships take and acknowledge what waits, and thomas's lease ends meanwhile.
    const takeAndAck = async (crew: Crew) => {
      const taken = await core.useCases.pushReceiveDeliveries(crew, { max: 10 });
      if (!taken.isOk) {
        return;
      }
      await Promise.all(taken.value.deliveries.map((delivery) => core.useCases.acknowledgeDelivery(crew, { deliveryId: delivery.deliveryId })));
    };
    await Promise.all([...sendAll(6), takeAndAck(thomas), takeAndAck(maria), takeAndAck(maria), core.useCases.releaseShip(argo, { shipId: thomas.shipId })]);

    // Then the rollup's counts are what a recount says.
    const counts = (rows: Awaited<ReturnType<typeof rollup>>) => rows.map(({ shipId, otherShipId, unacknowledged, unseenPlainMessages }) => ({ shipId, otherShipId, unacknowledged, unseenPlainMessages }));
    expect(counts(await rollup())).toEqual(counts(await recount()));
    expect((await rollup()).length).toBe(8);
  });

  it('changes not when the transaction rolls back: a send that fails after its deliveries, an ack that fails after its change', async () => {
    // Given thomas and maria hold a label, and the lookout wrote thomas once.
    const thomas = await crewed({ name: 'thomas', kind: 'person', type: 'person' });
    const maria = await crewed({ name: 'maria', kind: 'person', type: 'person' });
    const lookout = await crewed({ name: 'lookout', kind: 'agent', type: 'reviewer' });
    const team = await labelOf([thomas.shipId, maria.shipId]);
    const byName = await send(lookout, { to: { kind: 'ship', shipId: thomas.shipId }, payload: 'Merge PR #1497?' });
    unwrap(await core.useCases.pushReceiveDeliveries(thomas, {}));
    const before = await rollup();
    const failingAfter = (step: 'deliveries' | 'update'): UnitOfWork<PrismaTx> => {
      const uow = createPrismaUnitOfWork(core.prisma);
      return {
        run: (work) =>
          uow.run((tx) =>
            work({
              ...tx,
              deliveries: {
                ...tx.deliveries,
                create: async (delivery, message) => {
                  await tx.deliveries.create(delivery, message);
                  if (step === 'deliveries' && delivery.recipient.kind === 'ship' && delivery.recipient.shipId === maria.shipId) {
                    throw new Error('disk full');
                  }
                },
                update: async (delivery) => {
                  await tx.deliveries.update(delivery);
                  if (step === 'update') {
                    throw new Error('disk full');
                  }
                },
              },
            }),
          ),
      };
    };

    // When a label send fails after its deliveries are made, and thomas's ack fails after the delivery changed.
    const sending = createSendMessage({ uow: failingAfter('deliveries'), clock: core.clock, ids: newId, hasher: sha256Hasher, sealing: unsealedFleetsOnly });
    const acking = createAcknowledgeDelivery({ uow: failingAfter('update'), clock: core.clock, ids: newId });
    await expect(sending(lookout, sendOf(lookout, { to: team, payload: 'Standup in five' }))).rejects.toThrow('disk full');
    await expect(acking(thomas, { deliveryId: await deliveryOf(byName, thomas.shipId) })).rejects.toThrow('disk full');

    // Then the rollup is as it was.
    expect(before).toEqual([{ shipId: thomas.shipId, otherShipId: lookout.shipId, newestMessageId: byName, unacknowledged: 1, unseenPlainMessages: 1 }]);
    expect(await rollup()).toEqual(before);
  });

  it('stays what a recount says when seen up to here races sends, claims and acks', async () => {
    // Given two person ships, and two agents who wrote them by name and by type.
    const thomas = await crewed({ name: 'thomas', kind: 'person', type: 'person' });
    const maria = await crewed({ name: 'maria', kind: 'person', type: 'person' });
    const [lookout, scout] = await Promise.all(['lookout', 'scout'].map((name) => crewed({ name, kind: 'agent', type: 'reviewer' })));
    if (!lookout || !scout) {
      throw new Error('crewed two agents');
    }
    const sendAll = (count: number) =>
      [lookout, scout].flatMap((agent) =>
        Array.from({ length: count }, (_, n) => {
          const to: Selector = n % 3 === 0 ? { kind: 'ship', shipId: thomas.shipId } : n % 3 === 1 ? { kind: 'ship', shipId: maria.shipId } : { kind: 'type', type: 'person' };
          return send(agent, { to, payload: `Note ${String(n)}` });
        }),
      );
    await Promise.all(sendAll(6));
    const seenUpTo = async (crew: Crew, other: Crew) => {
      const newest = await core.prisma.delivery.findFirst({ where: { senderShipId: other.shipId, recipientShipId: crew.shipId }, orderBy: { id: 'desc' } });
      return newest ? core.useCases.acknowledgeUpTo(crew, { otherShipId: other.shipId, messageId: idSchema('message').parse(newest.messageId) }) : undefined;
    };
    const takeAndAck = async (crew: Crew) => {
      const taken = await core.useCases.pushReceiveDeliveries(crew, { max: 3 });
      if (taken.isOk) {
        await Promise.all(taken.value.deliveries.map((delivery) => core.useCases.acknowledgeDelivery(crew, { deliveryId: delivery.deliveryId })));
      }
    };

    // When more come while both person ships claim and acknowledge, and each marks the agents' exchanges seen, at once.
    await Promise.all([...sendAll(6), takeAndAck(thomas), takeAndAck(maria), seenUpTo(thomas, lookout), seenUpTo(thomas, scout), seenUpTo(maria, lookout), seenUpTo(thomas, lookout)]);

    // Then the rollup is what a recount says, each count and newest message, and no count is below zero.
    expect(await rollup()).toEqual(await recount());
    expect((await rollup()).every((row) => row.unacknowledged >= 0)).toBe(true);
  });

  it('changes not when seen up to here fails after some of its deliveries changed', async () => {
    // Given the lookout wrote thomas three times, and thomas's crew took them.
    const thomas = await crewed({ name: 'thomas', kind: 'person', type: 'person' });
    const lookout = await crewed({ name: 'lookout', kind: 'agent', type: 'reviewer' });
    const to: Selector = { kind: 'ship', shipId: thomas.shipId };
    const sent = [await send(lookout, { to, payload: 'One' }), await send(lookout, { to, payload: 'Two' }), await send(lookout, { to, payload: 'Three' })];
    unwrap(await core.useCases.pushReceiveDeliveries(thomas, {}));
    const before = await rollup();
    const uow = createPrismaUnitOfWork(core.prisma);
    let updated = 0;
    const failingSecond: UnitOfWork<PrismaTx> = {
      run: (work) =>
        uow.run((tx) =>
          work({
            ...tx,
            deliveries: {
              ...tx.deliveries,
              update: async (delivery) => {
                await tx.deliveries.update(delivery);
                updated += 1;
                if (updated === 2) {
                  throw new Error('disk full');
                }
              },
            },
          }),
        ),
    };

    // When thomas marks the exchange seen up to the last, and it fails after the second delivery changed.
    const seeing = createAcknowledgeUpTo({ uow: failingSecond, clock: core.clock, ids: newId });
    await expect(seeing(thomas, { otherShipId: lookout.shipId, messageId: sent.at(-1) ?? newId('message') })).rejects.toThrow('disk full');

    // Then none is acknowledged, no event was written, and the rollup is as it was and what a recount says.
    expect(updated).toBe(2);
    await expect(core.prisma.delivery.count({ where: { state: 'acknowledged' } })).resolves.toBe(0);
    await expect(core.prisma.event.count({ where: { type: 'DeliveryAcknowledged' } })).resolves.toBe(0);
    expect(before).toEqual([{ shipId: thomas.shipId, otherShipId: lookout.shipId, newestMessageId: sent.at(-1), unacknowledged: 3, unseenPlainMessages: 3 }]);
    expect(await rollup()).toEqual(before);
    expect(await recount()).toEqual(before);
  });
});
