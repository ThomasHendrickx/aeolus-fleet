import { aQuestion, aStep } from '../../../test/support/formatted-message-fixtures.js';
import { PAYLOAD_MAX_BYTES, type FleetId, type MessageId, type ShipId } from '@aeolus-fleet/common';
import { beforeEach, describe, expect, it } from 'vitest';

import { agentCaller, initialiseFleet, messagingUseCases, operatorCaller, registryUseCases } from '../../../test/support/core-fixtures.js';
import { createInMemoryCore, type InMemoryCore } from '../../../test/support/in-memory.js';
import { refusalOf, unwrap } from '../../testing/result.js';
import type { ShipCaller } from '../shared/caller.js';
import type { FormattedMessageToSend, SendFormattedMessage } from './send-formatted-message.js';
import { newKey } from '../../testing/keys.js';

// Ask, step and withdraw (docs/design/ask-and-step): the asking ship gives a
// question's or step's fields, or the uuid it withdraws; core builds the JSON
// and its content type and sends it as any message, so every send guarantee
// holds.

const SCOUT_MODEL = 'claude-opus-5-5';
const QUESTION_ID = '11111111-1111-4111-8111-111111111111';
const STEP_ID = '22222222-2222-4222-8222-222222222222';

let core: InMemoryCore;
let sendFormattedMessage: SendFormattedMessage;
let fleetId: FleetId;
let argoId: ShipId;
let argo: ShipCaller;
let scoutId: ShipId;
let scout: ShipCaller;

beforeEach(async () => {
  core = createInMemoryCore('2026-11-10T12:00:00.000Z');
  const fleet = await initialiseFleet(core);
  ({ fleetId, operatorShipId: argoId } = fleet);
  argo = operatorCaller(fleet);
  ({ shipId: scoutId } = unwrap(await registryUseCases(core).commissionShip(argo, { idempotencyKey: newKey(), name: 'scout', type: 'reviewer' })));
  scout = agentCaller({ fleetId, shipId: scoutId });
  sendFormattedMessage = messagingUseCases(core).sendFormattedMessage;
  core.clock.advance(60_000);
});

/** Scout's formatted message to argo by name, with a key of its own unless told otherwise. */
function toArgo(message: FormattedMessageToSend['message'], overrides: Partial<FormattedMessageToSend> = {}): FormattedMessageToSend {
  return { selector: { kind: 'ship', name: 'argo' }, message, model: SCOUT_MODEL, idempotencyKey: newKey(), ...overrides };
}

async function sent(input: FormattedMessageToSend): Promise<MessageId> {
  return unwrap(await sendFormattedMessage(scout, input)).messageId;
}

function storedOf(messageId: MessageId) {
  const message = core.state.messages.find((stored) => stored.id === messageId);
  return { payload: message?.payload, contentType: message?.contentType, deliveries: core.state.deliveries.filter((delivery) => delivery.messageId === messageId) };
}

describe('asking one ship', () => {
  it('sends the question as JSON of the question content type, with one pending delivery to that ship', async () => {
    const question = aQuestion();

    const messageId = await sent(toArgo({ kind: 'question', question }));

    const stored = storedOf(messageId);
    expect(stored.contentType).toBe('application/vnd.aeolus.question+json');
    expect(stored.payload).toBe(
      '{"id":"11111111-1111-4111-8111-111111111111","title":"Ship it?","context":"","options":[{"key":2,"label":"Ship","detail":""},{"key":4,"label":"Wait","detail":""}],"pick":{"option":2,"why":"Ready"}}',
    );
    expect(stored.deliveries).toMatchObject([{ recipient: { kind: 'ship', shipId: argoId }, state: 'pending' }]);
  });

  it('keeps quotes, newlines and Unicode in typed text as valid JSON', async () => {
    const question = aQuestion({ title: 'Merge "ship"?\nNow', context: 'Ship ⛵ 船 \\ done' });

    const messageId = await sent(toArgo({ kind: 'question', question }));

    expect(JSON.parse(storedOf(messageId).payload ?? '')).toEqual(question);
  });

  it('refuses a question whose generated JSON is over 256 KB, though its text alone is not, and stores nothing', async () => {
    const quotes = '"'.repeat(PAYLOAD_MAX_BYTES / 2);

    const refused = refusalOf(await sendFormattedMessage(scout, toArgo({ kind: 'question', question: aQuestion({ context: quotes }) })));

    expect(refused.kind).toBe('PAYLOAD_TOO_LARGE');
    expect(core.state.messages).toEqual([]);
  });
});

describe('a step for one ship', () => {
  it('sends the step as JSON of the step content type, with its link, and one pending delivery to that ship', async () => {
    const messageId = await sent(toArgo({ kind: 'step', step: aStep({ link: 'https://github.com/new' }) }));

    const stored = storedOf(messageId);
    expect(stored.contentType).toBe('application/vnd.aeolus.step+json');
    expect(stored.payload).toBe('{"id":"22222222-2222-4222-8222-222222222222","title":"Sign in","why":"","link":"https://github.com/new"}');
    expect(stored.deliveries).toMatchObject([{ recipient: { kind: 'ship', shipId: argoId }, state: 'pending' }]);
  });

  it('leaves the link out of a step without one', async () => {
    const messageId = await sent(toArgo({ kind: 'step', step: aStep() }));

    expect(storedOf(messageId).payload).toBe('{"id":"22222222-2222-4222-8222-222222222222","title":"Sign in","why":""}');
  });
});

describe('withdrawing a question or step', () => {
  it.each([
    { target: { kind: 'question', questionId: QUESTION_ID } as const, contentType: 'application/vnd.aeolus.question-withdrawal+json', payload: `{"questionId":"${QUESTION_ID}"}` },
    { target: { kind: 'step', stepId: STEP_ID } as const, contentType: 'application/vnd.aeolus.step-withdrawal+json', payload: `{"stepId":"${STEP_ID}"}` },
  ])('sends the existing $target.kind withdrawal, with one pending delivery to that ship', async ({ target, contentType, payload }) => {
    const messageId = await sent(toArgo({ kind: 'withdrawal', target }));

    const stored = storedOf(messageId);
    expect(stored).toMatchObject({ contentType, payload });
    expect(stored.deliveries).toMatchObject([{ recipient: { kind: 'ship', shipId: argoId }, state: 'pending' }]);
  });

  it('sends a withdrawal of a uuid the fleet never carried: core looks up no original', async () => {
    const messageId = await sent(toArgo({ kind: 'withdrawal', target: { kind: 'step', stepId: '33333333-3333-4333-8333-333333333333' } }));

    expect(core.state.messages.map((message) => message.id)).toEqual([messageId]);
  });

  it('keeps both an answer and a withdrawal that race: the recipient decides which applies', async () => {
    const questionId = await sent(toArgo({ kind: 'question', question: aQuestion() }));
    const answer = unwrap(
      await messagingUseCases(core).sendMessage(argo, {
        selector: { kind: 'ship', shipId: scoutId },
        payload: `{"questionId":"${QUESTION_ID}","option":2}`,
        contentType: 'application/vnd.aeolus.answer+json',
        inReplyTo: questionId,
        idempotencyKey: newKey(),
      }),
    ).messageId;

    const withdrawal = await sent(toArgo({ kind: 'withdrawal', target: { kind: 'question', questionId: QUESTION_ID } }));

    expect(core.state.messages.map((message) => message.id)).toEqual([questionId, answer, withdrawal]);
    expect(core.state.deliveries.map((delivery) => delivery.messageId)).toEqual([questionId, answer, withdrawal]);
  });
});

describe('a retry of ask, step or withdraw', () => {
  it.each([
    { kind: 'question', message: { kind: 'question', question: aQuestion() } },
    { kind: 'step', message: { kind: 'step', step: aStep() } },
    { kind: 'withdrawal', message: { kind: 'withdrawal', target: { kind: 'question', questionId: QUESTION_ID } } },
  ] as const)('of the same $kind with the same key returns the original message id and stores nothing new', async ({ message }) => {
    const input = toArgo(message);
    const messageId = await sent(input);

    await expect(sendFormattedMessage(scout, input)).resolves.toEqual({ isOk: true, value: { messageId } });
    expect(core.state.messages).toHaveLength(1);
  });

  it('returns the original message id even when its recipient was retired since', async () => {
    const recipient = unwrap(await registryUseCases(core).commissionShip(argo, { idempotencyKey: newKey(), name: 'thomas', type: 'person', kind: 'person' }));
    const input = toArgo({ kind: 'step', step: aStep() }, { selector: { kind: 'ship', name: 'thomas' } });
    const messageId = await sent(input);
    const retired = core.state.ships.find((ship) => ship.id === recipient.shipId);
    if (retired) {
      retired.retiredAt = core.clock.now();
    }

    await expect(sendFormattedMessage(scout, input)).resolves.toEqual({ isOk: true, value: { messageId } });
  });

  it('refuses another request with a used key, and stores nothing new', async () => {
    const input = toArgo({ kind: 'question', question: aQuestion() });
    await sent(input);

    const refused = refusalOf(await sendFormattedMessage(scout, { ...input, message: { kind: 'question', question: aQuestion({ title: 'Ship it now?' }) } }));

    expect(refused.kind).toBe('IDEMPOTENCY_KEY_REUSED');
    expect(core.state.messages).toHaveLength(1);
  });
});

describe('the rules of send for ask, step and withdraw', () => {
  it('refuses an agent ship that states no model, and stores nothing', async () => {
    const refused = refusalOf(await sendFormattedMessage(scout, toArgo({ kind: 'step', step: aStep() }, { model: undefined })));

    expect(refused.kind).toBe('MODEL_REQUIRED');
    expect(core.state.messages).toEqual([]);
  });

  it('refuses a retired recipient, and stores nothing', async () => {
    const recipient = unwrap(await registryUseCases(core).commissionShip(argo, { idempotencyKey: newKey(), name: 'thomas', type: 'person', kind: 'person' }));
    const retired = core.state.ships.find((ship) => ship.id === recipient.shipId);
    if (retired) {
      retired.retiredAt = core.clock.now();
    }

    const refused = refusalOf(await sendFormattedMessage(scout, toArgo({ kind: 'question', question: aQuestion() }, { selector: { kind: 'ship', shipId: recipient.shipId } })));

    expect(refused.kind).toBe('UNRESOLVABLE_SELECTOR');
    expect(core.state.messages).toEqual([]);
  });
});
