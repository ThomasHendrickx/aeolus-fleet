import { createIdGenerator, type MessageId } from '@aeolus-fleet/common';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { createPushReceiveDeliveries } from '../src/domain/messaging/push-receive-deliveries.js';
import type { Crew, ShipCaller } from '../src/domain/shared/caller.js';
import { newKey } from '../src/testing/keys.js';
import { unwrap } from '../src/testing/result.js';
import { operatorCaller, secretOf } from './support/core-fixtures.js';
import { withOperatorLogin } from './support/operator-login.js';
import { createPostgresCore, heldUnitOfWork, type PostgresCore } from './support/postgres-core.js';
import { unsealedFleetsOnly } from './support/sealing.js';

// Seen up to here on a real Postgres (docs/design/exchange-read, E6, the
// unhappy paths): its deliveries are locked in id order, so two at once
// acknowledge each delivery once and a push receive holding one is waited
// for, none skipped; the rollup never counts below zero.

const MODEL = 'claude-opus-5-5';
const newId = createIdGenerator();

let core: PostgresCore;
let argo: ShipCaller;
let thomas: Crew;
let lookout: Crew;

async function crewed(ship: { name: string; kind: 'person' | 'agent'; type: string }): Promise<Crew> {
  const { shipId, secret } = unwrap(await core.useCases.commissionShip(argo, { ...ship, idempotencyKey: newKey() }));
  const { crewToken } = unwrap(await core.useCases.claimShip({ shipId, secret: secretOf(secret), location: { kind: 'CLOUD' }, harness: 'claude-code' }));
  return unwrap(await core.useCases.authenticate.byCrewToken(crewToken));
}

beforeEach(async () => {
  core = await createPostgresCore();
  argo = operatorCaller(unwrap(await withOperatorLogin(core.prisma, core.useCases.initialiseFleet({ name: 'home fleet' }))));
  thomas = await crewed({ name: 'thomas', kind: 'person', type: 'person' });
  lookout = await crewed({ name: 'lookout', kind: 'agent', type: 'reviewer' });
});

afterEach(async () => {
  await core.close();
});

async function notes(count: number): Promise<MessageId[]> {
  const sent: MessageId[] = [];
  for (let n = 1; n <= count; n += 1) {
    core.clock.advance(1_000);
    const send = { selector: { kind: 'ship' as const, shipId: thomas.shipId }, payload: `Note ${String(n)}`, contentType: 'text/plain', idempotencyKey: newKey(), model: MODEL };
    sent.push(unwrap(await core.useCases.sendMessage(lookout, send)).messageId);
  }
  return sent;
}

async function unacknowledged(): Promise<number | undefined> {
  const row = await core.prisma.exchange.findFirst({ where: { shipId: thomas.shipId, otherShipId: lookout.shipId } });
  return row?.unacknowledged;
}

describe('seen up to here on Postgres', () => {
  it('acknowledges each delivery once when two places mark the exchange seen at once', async () => {
    // Given the lookout wrote thomas ten times.
    const sent = await notes(10);
    const upTo = sent.at(-1) ?? newId('message');

    // When two of thomas's places mark it seen up to the last at once.
    const [first, second] = await Promise.all([
      core.useCases.acknowledgeUpTo(thomas, { otherShipId: lookout.shipId, messageId: upTo }),
      core.useCases.acknowledgeUpTo(thomas, { otherShipId: lookout.shipId, messageId: upTo }),
    ]);

    // Then the ten are acknowledged once between them, each with one event, and none is counted open.
    expect(unwrap(first).acknowledged + unwrap(second).acknowledged).toBe(10);
    await expect(core.prisma.event.count({ where: { type: 'DeliveryAcknowledged' } })).resolves.toBe(10);
    await expect(core.prisma.delivery.count({ where: { state: 'acknowledged' } })).resolves.toBe(10);
    await expect(unacknowledged()).resolves.toBe(0);
  });

  it('waits for a push receive that holds one of its deliveries, then acknowledges it too', async () => {
    // Given the lookout wrote thomas three times, and a push receive of thomas's crew holds the first, received, in its transaction.
    const sent = await notes(3);
    const { uow, reached } = heldUnitOfWork(core.prisma, (tx, hold) => ({
      ...tx,
      deliveries: {
        ...tx.deliveries,
        update: async (delivery) => {
          await tx.deliveries.update(delivery);
          await hold();
        },
      },
    }));
    const receiving = createPushReceiveDeliveries({ uow, clock: core.clock, ids: newId, sealing: unsealedFleetsOnly, wakeups: { watch: () => ({ next: () => Promise.resolve('timedOut'), stop: () => undefined }) } })(thomas, {});
    await reached;

    // When thomas marks the exchange seen up to the last meanwhile.
    const seen = core.useCases.acknowledgeUpTo(thomas, { otherShipId: lookout.shipId, messageId: sent.at(-1) ?? newId('message') });

    // Then it waits for the receive, and acknowledges all three.
    unwrap(await receiving);
    expect(unwrap(await seen)).toEqual({ acknowledged: 3 });
    await expect(core.prisma.delivery.count({ where: { state: 'acknowledged' } })).resolves.toBe(3);
    await expect(unacknowledged()).resolves.toBe(0);
  });
});
