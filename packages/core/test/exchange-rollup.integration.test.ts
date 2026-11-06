import { createIdGenerator, idSchema, type DeliveryId, type MessageId, type ShipId } from '@aeolus-fleet/common';
import { z } from 'zod';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { sha256Hasher } from '../src/adapters/crypto/secrets.js';
import { createPrismaUnitOfWork, type PrismaTx } from '../src/adapters/prisma/unit-of-work.js';
import { createAcknowledgeDelivery } from '../src/domain/messaging/acknowledge-delivery.js';
import { createAcknowledgeUpTo } from '../src/domain/messaging/acknowledge-up-to.js';
import { createSendMessage } from '../src/domain/messaging/send-message.js';
import type { Crew, ShipCaller } from '../src/domain/shared/caller.js';
import type { Selector } from '../src/domain/shared/selector.js';
import type { UnitOfWork } from '../src/domain/shared/unit-of-work.js';
import { newKey } from '../src/testing/keys.js';
import { unwrap } from '../src/testing/result.js';
import { operatorCaller, secretOf } from './support/core-fixtures.js';
import { withOperatorLogin } from './support/operator-login.js';
import { createPostgresCore, type PostgresCore } from './support/postgres-core.js';
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
async function rollup(): Promise<{ shipId: string; otherShipId: string; newestMessageId: string; unacknowledged: number }[]> {
  return z
    .array(z.object({ shipId: z.string(), otherShipId: z.string(), newestMessageId: z.string(), unacknowledged: z.int() }))
    .parse(
      await core.prisma.$queryRaw`
        SELECT ship_id AS "shipId", other_ship_id AS "otherShipId", newest_message_id AS "newestMessageId", unacknowledged
        FROM exchanges ORDER BY ship_id, other_ship_id`,
    );
}

/** What a recount from the deliveries says each person ship's rows hold: the deliveries from the other ship still open, and the newest message both ways. */
async function recount(): Promise<{ shipId: string; otherShipId: string; newestMessageId: string; unacknowledged: number }[]> {
  return z
    .array(z.object({ shipId: z.string(), otherShipId: z.string(), newestMessageId: z.string(), unacknowledged: z.int() }))
    .parse(
      await core.prisma.$queryRaw`
        SELECT s.id AS "shipId", x.other AS "otherShipId", max(x.message_id) AS "newestMessageId",
               (count(*) FILTER (WHERE x.is_to_ship AND x.state IN ('pending', 'received', 'handed')))::int AS unacknowledged
        FROM ships s
        JOIN LATERAL (
          SELECT d.sender_ship_id AS other, d.message_id, d.state::text AS state, true AS is_to_ship
          FROM deliveries d WHERE d.fleet_id = s.fleet_id AND d.is_in_exchange AND d.reached_ship_id = s.id
          UNION ALL
          SELECT d.reached_ship_id, d.message_id, d.state::text, false
          FROM deliveries d WHERE d.fleet_id = s.fleet_id AND d.is_in_exchange AND d.sender_ship_id = s.id AND d.reached_ship_id IS NOT NULL
        ) x ON true
        WHERE s.kind = 'person'
        GROUP BY 1, 2
        ORDER BY 1, 2`,
    );
}

describe('the rollup of exchanges on Postgres', () => {
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
    expect(kept).toEqual([{ shipId: thomas.shipId, otherShipId: lookout.shipId, newestMessageId: answer, unacknowledged: 1 }]);
    expect(await rollup()).toEqual([{ shipId: thomas.shipId, otherShipId: lookout.shipId, newestMessageId: answer, unacknowledged: 0 }]);
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
    const counts = (rows: Awaited<ReturnType<typeof rollup>>) => rows.map(({ shipId, otherShipId, unacknowledged }) => ({ shipId, otherShipId, unacknowledged }));
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
    expect(before).toEqual([{ shipId: thomas.shipId, otherShipId: lookout.shipId, newestMessageId: byName, unacknowledged: 1 }]);
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
    expect(before).toEqual([{ shipId: thomas.shipId, otherShipId: lookout.shipId, newestMessageId: sent.at(-1), unacknowledged: 3 }]);
    expect(await rollup()).toEqual(before);
    expect(await recount()).toEqual(before);
  });
});
