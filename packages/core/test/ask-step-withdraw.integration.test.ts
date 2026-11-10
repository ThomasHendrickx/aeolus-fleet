import { createIdGenerator, type FleetId, type ShipId } from '@aeolus-fleet/common';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { sha256Hasher } from '../src/adapters/crypto/secrets.js';
import { createPrismaUnitOfWork, type PrismaTx } from '../src/adapters/prisma/unit-of-work.js';
import { createSendFormattedMessage, type FormattedMessageToSend } from '../src/domain/messaging/send-formatted-message.js';
import type { ShipCaller } from '../src/domain/shared/caller.js';
import type { UnitOfWork } from '../src/domain/shared/unit-of-work.js';
import { agentCaller, operatorCaller } from './support/core-fixtures.js';
import { aQuestion, aStep } from './support/formatted-message-fixtures.js';
import { createPostgresCore, racingUnitOfWork, type PostgresCore } from './support/postgres-core.js';
import { unwrap } from '../src/testing/result.js';
import { newKey } from '../src/testing/keys.js';
import { withOperatorLogin } from './support/operator-login.js';
import { unsealedFleetsOnly } from './support/sealing.js';

// Ask, step and withdraw on a real Postgres (docs/design/ask-and-step): they
// send through send's own acceptance, so its guarantees hold for them too. A
// failure mid-transaction stores nothing, concurrent identical calls with one
// key store one message, and a retry after a lost answer gets the original id.

const newId = createIdGenerator();
const SCOUT_MODEL = 'claude-opus-5-5';

let core: PostgresCore;
let fleetId: FleetId;
let argoId: ShipId;
let scout: ShipCaller;

beforeEach(async () => {
  core = await createPostgresCore();
  const fleet = unwrap(await withOperatorLogin(core.prisma, core.useCases.initialiseFleet({ name: 'home fleet' })));
  ({ fleetId, operatorShipId: argoId } = fleet);
  const { shipId: scoutId } = unwrap(await core.useCases.commissionShip(operatorCaller(fleet), { idempotencyKey: newKey(), name: 'scout', type: 'reviewer' }));
  scout = agentCaller({ fleetId, shipId: scoutId });
  core.clock.advance(60_000);
});

afterEach(async () => {
  await core.close();
});

/** Scout's question to argo by name, with a key of its own. */
function aQuestionToArgo(): FormattedMessageToSend {
  return { selector: { kind: 'ship', name: 'argo' }, message: { kind: 'question', question: aQuestion() }, model: SCOUT_MODEL, idempotencyKey: `ask-${newId('message')}` };
}

function sendFormattedMessageWith(uow: UnitOfWork<PrismaTx>) {
  return createSendFormattedMessage({ sealing: unsealedFleetsOnly, uow, clock: core.clock, ids: newId, hasher: sha256Hasher });
}

async function storedCounts() {
  return {
    messages: await core.prisma.message.count(),
    deliveries: await core.prisma.delivery.count(),
    accepted: await core.prisma.event.count({ where: { type: 'MessageAccepted' } }),
  };
}

describe('ask, step and withdraw on Postgres', () => {
  it.each([
    { kind: 'question', message: { kind: 'question', question: aQuestion() }, contentType: 'application/vnd.aeolus.question+json' },
    { kind: 'step', message: { kind: 'step', step: aStep() }, contentType: 'application/vnd.aeolus.step+json' },
    { kind: 'withdrawal', message: { kind: 'withdrawal', target: { kind: 'step', stepId: aStep().id } }, contentType: 'application/vnd.aeolus.step-withdrawal+json' },
  ] as const)('stores a $kind with its content type, one pending delivery to the ship named and MessageAccepted', async ({ message, contentType }) => {
    const { messageId } = unwrap(await core.useCases.sendFormattedMessage(scout, { ...aQuestionToArgo(), message }));

    const stored = await core.prisma.message.findUniqueOrThrow({ where: { id: messageId } });
    expect(stored.contentType).toBe(contentType);
    await expect(core.prisma.delivery.findMany({ where: { messageId }, select: { recipientShipId: true, state: true } })).resolves.toEqual([
      { recipientShipId: argoId, state: 'pending' },
    ]);
    await expect(storedCounts()).resolves.toEqual({ messages: 1, deliveries: 1, accepted: 1 });
  });

  it('answers a retry after a lost answer with the original message id, and stores nothing new', async () => {
    const input = aQuestionToArgo();
    const { messageId } = unwrap(await core.useCases.sendFormattedMessage(scout, input));

    await expect(core.useCases.sendFormattedMessage(scout, input)).resolves.toEqual({ isOk: true, value: { messageId } });
    await expect(storedCounts()).resolves.toEqual({ messages: 1, deliveries: 1, accepted: 1 });
  });
});

describe('an ask that fails right after the message insert', () => {
  it('leaves no message, no delivery and no event', async () => {
    const uow = createPrismaUnitOfWork(core.prisma);
    const sendFormattedMessage = sendFormattedMessageWith({
      run: (work) => uow.run((tx) => work({ ...tx, deliveries: { ...tx.deliveries, create: () => Promise.reject(new Error('disk full')) } })),
    });

    await expect(sendFormattedMessage(scout, aQuestionToArgo())).rejects.toThrow('disk full');

    await expect(storedCounts()).resolves.toEqual({ messages: 0, deliveries: 0, accepted: 0 });
  });
});

describe('concurrent identical asks with one idempotency key', () => {
  it('store one message: every ask gets its id', async () => {
    const sendFormattedMessage = sendFormattedMessageWith(
      racingUnitOfWork({ prisma: core.prisma, transactions: 5 }, (tx, allArrived) => ({
        ...tx,
        messages: {
          ...tx.messages,
          findByIdempotencyKey: async (key) => {
            await allArrived();
            return tx.messages.findByIdempotencyKey(key);
          },
        },
      })),
    );
    const input = aQuestionToArgo();

    const results = await Promise.all(Array.from({ length: 5 }, () => sendFormattedMessage(scout, input)));

    const [message] = await core.prisma.message.findMany();
    expect(results).toEqual(Array.from({ length: 5 }, () => ({ isOk: true, value: { messageId: message?.id } })));
    await expect(storedCounts()).resolves.toEqual({ messages: 1, deliveries: 1, accepted: 1 });
  });
});
