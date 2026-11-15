import { ANSWER_CONTENT_TYPE, createIdGenerator, REPLACEMENT_CONTENT_TYPE, idSchema, WITHDRAWAL_CONTENT_TYPE, type DeliveryId, type MessageId } from '@aeolus-fleet/common';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { sha256Hasher } from '../src/adapters/crypto/secrets.js';
import { createPrismaMessageRepository } from '../src/adapters/prisma/messaging.js';
import { createReplyToMessage } from '../src/domain/messaging/reply-to-message.js';
import { createRetireShip } from '../src/domain/registry/retire-ship.js';
import { isCrew, type Crew, type ShipCaller } from '../src/domain/shared/caller.js';
import { agentCaller, OPERATOR, operatorCaller } from './support/core-fixtures.js';
import { aQuestion } from './support/formatted-message-fixtures.js';
import { createPostgresCore, heldUnitOfWork, type PostgresCore } from './support/postgres-core.js';
import { unwrap } from '../src/testing/result.js';
import { newKey } from '../src/testing/keys.js';
import { withOperatorLogin } from './support/operator-login.js';
import { unsealedFleetsOnly } from './support/sealing.js';

// Retiring a ship withdraws its open questions on a real Postgres (#1632):
// in the retire's transaction, so a failure stores neither; and an answer
// racing the retire either lands first, and its question is not withdrawn,
// or comes after and is refused, the question withdrawn: never lost unseen.

const newId = createIdGenerator();
const SCOUT_MODEL = 'claude-opus-5-5';
const QUESTION_ID = '11111111-1111-4111-8111-111111111111';

let core: PostgresCore;
let operator: ShipCaller;
let argo: Crew;
let scout: ShipCaller;

beforeEach(async () => {
  core = await createPostgresCore();
  const fleet = unwrap(await withOperatorLogin(core.prisma, core.useCases.initialiseFleet({ name: 'home fleet' })));
  operator = operatorCaller(fleet);
  const { shipId } = unwrap(await core.useCases.commissionShip(operator, { idempotencyKey: newKey(), name: 'scout', type: 'reviewer' }));
  scout = agentCaller({ fleetId: fleet.fleetId, shipId });
  const { token } = unwrap(await core.useCases.signIn(OPERATOR));
  const use = await core.useCases.authenticate.byConsoleSession(token);
  if (!use || !isCrew(use.caller)) {
    throw new Error('The sign-in started no console session crewing argo');
  }
  argo = use.caller;
});

afterEach(async () => {
  await core.close();
});

/** Scout asks argo one question: its message and argo's delivery of it. */
async function askedArgo(questionId = QUESTION_ID): Promise<{ messageId: MessageId; deliveryId: DeliveryId }> {
  const { messageId } = unwrap(
    await core.useCases.sendFormattedMessage(scout, {
      selector: { kind: 'ship', name: 'argo' },
      message: { kind: 'question', question: aQuestion({ id: questionId }) },
      model: SCOUT_MODEL,
      idempotencyKey: newKey(),
    }),
  );
  const { id } = await core.prisma.delivery.findFirstOrThrow({ where: { messageId } });
  return { messageId, deliveryId: idSchema('delivery').parse(id) };
}

function answerTo(deliveryId: DeliveryId, questionId = QUESTION_ID) {
  return { deliveryId, contentType: ANSWER_CONTENT_TYPE, payload: JSON.stringify({ questionId, option: 2 }), idempotencyKey: `answer-${deliveryId}` };
}

function storedWithdrawals() {
  return core.prisma.message.findMany({ where: { contentType: WITHDRAWAL_CONTENT_TYPE }, select: { senderShipId: true, selectorShipId: true, questionId: true } });
}

describe('retiring a ship with an open question on Postgres', () => {
  it("withdraws it from argo in the retire's transaction: argo's inbox finds the withdrawal by the question's uuid", async () => {
    await askedArgo();

    unwrap(await core.useCases.retireShip(operator, { shipId: scout.shipId }));

    const found = unwrap(await core.useCases.readInboxWithdrawals(argo, { questionId: QUESTION_ID }));
    expect(found.items.map(({ message, state }) => ({ sender: message.sender.id, contentType: message.contentType, state }))).toEqual([
      { sender: scout.shipId, contentType: WITHDRAWAL_CONTENT_TYPE, state: 'pending' },
    ]);
  });

  it('stores no withdrawal when the retire fails after it, and leaves the ship active', async () => {
    await askedArgo();
    const { uow } = heldUnitOfWork(core.prisma, (tx) => ({
      ...tx,
      expectations: { ...tx.expectations, remove: () => Promise.reject(new Error('the database went away')) },
    }));

    await expect(createRetireShip({ uow, clock: core.clock, ids: newId, hasher: sha256Hasher, sealing: unsealedFleetsOnly })(operator, { shipId: scout.shipId })).rejects.toThrow('the database went away');

    await expect(storedWithdrawals()).resolves.toEqual([]);
    await expect(core.prisma.ship.findUniqueOrThrow({ where: { id: scout.shipId } })).resolves.toMatchObject({ retiredAt: null });
  });
});

describe("the open questions of a ship, as Postgres selects them", () => {
  const ANSWERED = '22222222-2222-4222-8222-222222222222';
  const WITHDRAWN = '33333333-3333-4333-8333-333333333333';
  const REPLACED = '44444444-4444-4444-8444-444444444444';
  const REPLACEMENT = '55555555-5555-4555-8555-555555555555';
  const ANSWERED_ELSEWHERE = '66666666-6666-4666-8666-666666666666';
  const OPEN = '77777777-7777-4777-8777-777777777777';

  it('leaves out the answered, the withdrawn and the replaced, keeps an open replacement and a question whose reply names another, and pages by message id', async () => {
    const answered = await askedArgo(ANSWERED);
    unwrap(await core.useCases.replyToMessage(argo, answerTo(answered.deliveryId, ANSWERED)));
    await askedArgo(WITHDRAWN);
    await askedArgo(REPLACED);
    const elsewhere = await askedArgo(ANSWERED_ELSEWHERE);
    unwrap(await core.useCases.replyToMessage(argo, answerTo(elsewhere.deliveryId, OPEN)));
    const open = await askedArgo(OPEN);
    unwrap(await core.useCases.sendFormattedMessage(scout, { selector: { kind: 'ship', name: 'argo' }, message: { kind: 'withdrawal', target: { kind: 'question', questionId: WITHDRAWN } }, model: SCOUT_MODEL, idempotencyKey: newKey() }));
    const { messageId: replacement } = unwrap(
      await core.useCases.sendMessage(scout, {
        selector: { kind: 'ship', name: 'argo' },
        contentType: REPLACEMENT_CONTENT_TYPE,
        payload: JSON.stringify({ questionId: REPLACED, question: aQuestion({ id: REPLACEMENT }) }),
        model: SCOUT_MODEL,
        idempotencyKey: newKey(),
      }),
    );
    const messages = createPrismaMessageRepository(core.prisma);

    const first = await messages.listOpenQuestionsOf(scout.fleetId, { shipId: scout.shipId, limit: 2 });
    const next = await messages.listOpenQuestionsOf(scout.fleetId, { shipId: scout.shipId, after: open.messageId, limit: 2 });

    expect([first, next]).toEqual([
      [
        { messageId: elsewhere.messageId, askedShipId: argo.shipId, questionId: ANSWERED_ELSEWHERE },
        { messageId: open.messageId, askedShipId: argo.shipId, questionId: OPEN },
      ],
      [{ messageId: replacement, askedShipId: argo.shipId, questionId: REPLACEMENT }],
    ]);
  });
});

describe('an answer racing the retire of the ship that asked', () => {
  it('waits for a retire that locked the ship first, then is refused, and the question is withdrawn', async () => {
    const question = await askedArgo();
    const { uow, reached } = heldUnitOfWork(core.prisma, (tx, hold) => ({
      ...tx,
      inFlightDeliveries: {
        ...tx.inFlightDeliveries,
        abandonPendingTo: async (fleetId, shipId) => {
          await hold();
          return tx.inFlightDeliveries.abandonPendingTo(fleetId, shipId);
        },
      },
    }));
    const retire = createRetireShip({ uow, clock: core.clock, ids: newId, hasher: sha256Hasher, sealing: unsealedFleetsOnly })(operator, { shipId: scout.shipId });
    await reached;

    const answer = core.useCases.replyToMessage(argo, answerTo(question.deliveryId));

    unwrap(await retire);
    await expect(answer).resolves.toMatchObject({ isOk: false, error: { kind: 'UNRESOLVABLE_SELECTOR' } });
    await expect(core.prisma.message.count({ where: { contentType: ANSWER_CONTENT_TYPE } })).resolves.toBe(0);
    await expect(storedWithdrawals()).resolves.toEqual([{ senderShipId: scout.shipId, selectorShipId: argo.shipId, questionId: QUESTION_ID }]);
  });

  it('makes a retire wait for an answer that holds the ship: the answer lands, and the answered question is not withdrawn', async () => {
    const question = await askedArgo();
    const { uow, reached } = heldUnitOfWork(core.prisma, (tx, hold) => ({
      ...tx,
      deliveries: {
        ...tx.deliveries,
        create: async (delivery, message) => {
          await tx.deliveries.create(delivery, message);
          await hold();
        },
      },
    }));
    const answer = createReplyToMessage({ uow, clock: core.clock, ids: newId, hasher: sha256Hasher, sealing: unsealedFleetsOnly })(argo, answerTo(question.deliveryId));
    await reached;

    const retire = core.useCases.retireShip(operator, { shipId: scout.shipId });

    const { messageId } = unwrap(await answer);
    unwrap(await retire);
    await expect(core.prisma.message.findUniqueOrThrow({ where: { id: messageId } })).resolves.toMatchObject({ contentType: ANSWER_CONTENT_TYPE, inReplyToMessageId: question.messageId });
    await expect(storedWithdrawals()).resolves.toEqual([]);
  });
});
