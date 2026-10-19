import type { MessageId } from '@aeolus-fleet/common';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { createPrismaClient, type PrismaClient } from '../src/adapters/prisma/client.js';
import { createReceiverWakeups } from '../src/adapters/prisma/receiver-wakeups.js';
import type { ShipCaller, Crew } from '../src/domain/shared/caller.js';
import { createUseCases, systemClock, type UseCases } from '../src/wiring.js';
import { OPERATOR, operatorCaller, secretOf } from './support/core-fixtures.js';
import { createMigratedDatabase } from '../src/testing/database.js';
import { newKey } from '../src/testing/keys.js';
import { refusalOf, unwrap } from '../src/testing/result.js';

// A sender reading where its message's delivery stands, on a real Postgres:
// the state and since when, read from the delivery and its events.

let prisma: PrismaClient;
let useCases: UseCases;
let argo: ShipCaller;
let scout: Crew;
let lookout: Crew;

beforeEach(async () => {
  prisma = createPrismaClient(await createMigratedDatabase());
  useCases = createUseCases({ prisma, clock: systemClock, wakeups: createReceiverWakeups(), receiveWaitMs: 1_000 });
  const fleet = unwrap(await useCases.initialiseFleet({ name: 'home fleet', ...OPERATOR }));
  argo = operatorCaller(fleet);
  scout = await crewedReviewer('scout');
  lookout = await crewedReviewer('lookout');
});

afterEach(async () => {
  await prisma.$disconnect();
});

async function crewedReviewer(name: string): Promise<Crew> {
  const { shipId, secret } = unwrap(await useCases.commissionShip(argo, { idempotencyKey: newKey(), name, type: 'reviewer' }));
  const { crewToken } = unwrap(await useCases.claimShip({ shipId, secret: secretOf(secret), location: { kind: 'CLOUD' }, harness: 'claude-code' }));
  return unwrap(await useCases.authenticate.byCrewToken(crewToken));
}

async function scoutAsksLookout(): Promise<MessageId> {
  const { messageId } = unwrap(
    await useCases.sendMessage(scout, {
      selector: { kind: 'ship', shipId: lookout.shipId },
      payload: 'Look up account 42',
      contentType: 'text/plain',
      model: 'claude-opus-5-5',
      idempotencyKey: newKey(),
    }),
  );
  return messageId;
}

describe('a sender reading its sent message on Postgres', () => {
  it('gives its delivery handed since the DeliveryHanded of the receive that took it, and its recipient by name', async () => {
    const messageId = await scoutAsksLookout();
    unwrap(await useCases.receiveDeliveries(lookout, {}));
    const handed = await prisma.event.findFirstOrThrow({ where: { type: 'DeliveryHanded' } });

    expect(unwrap(await useCases.sentMessage(scout, { messageId }))).toMatchObject({
      messageId,
      recipient: { kind: 'ship', ship: { id: lookout.shipId, name: 'lookout' } },
      delivery: { state: 'handed', since: handed.occurredAt },
    });
  });

  it("refuses the recipient's read of it as none", async () => {
    const messageId = await scoutAsksLookout();

    expect(refusalOf(await useCases.sentMessage(lookout, { messageId }))).toMatchObject({ kind: 'MESSAGE_NOT_FOUND' });
  });
});
