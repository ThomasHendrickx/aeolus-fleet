import { PAYLOAD_MAX_BYTES, WITHDRAWAL_CONTENT_TYPE, type FleetId, type ShipId } from '@aeolus-fleet/common';
import { beforeEach, describe, expect, it } from 'vitest';

import { agentCaller, initialiseFleet, messagingUseCases, operatorCaller, registryUseCases, sealFleet } from '../../../test/support/core-fixtures.js';
import { createInMemoryCore, type InMemoryCore } from '../../../test/support/in-memory.js';
import { newKey } from '../../testing/keys.js';
import { refusalOf, unwrap } from '../../testing/result.js';
import type { ShipCaller } from '../shared/caller.js';
import type { MessageToSend, SendMessage } from './send-message.js';
import { DATA_KEY_CACHE_MS } from './data-keys.js';

let core: InMemoryCore;
let sendMessage: SendMessage;
let fleetId: FleetId;
let scoutId: ShipId;
let scout: ShipCaller;
let argoId: ShipId;

const MODEL = 'claude-opus-5-5';
const QUESTION_ID = '0f8e2c1a-5b7d-4e3f-9a6b-2c4d8e1f0a3b';

beforeEach(async () => {
  core = createInMemoryCore('2026-10-29T12:00:00.000Z');
  const fleet = await initialiseFleet(core);
  ({ fleetId, operatorShipId: argoId } = fleet);
  ({ shipId: scoutId } = unwrap(await registryUseCases(core).commissionShip(operatorCaller(fleet), { idempotencyKey: newKey(), name: 'scout', type: 'reviewer' })));
  scout = agentCaller({ fleetId, shipId: scoutId });
  sendMessage = messagingUseCases(core).sendMessage;
  await sealFleet(core, fleetId);
  core.state.events.length = 0;
});

function aReview(overrides: Partial<MessageToSend> = {}): MessageToSend {
  return {
    selector: { kind: 'ship', shipId: argoId },
    payload: 'Review https://github.com/ThomasHendrickx/aeolus-fleet/pull/1373',
    contentType: 'text/plain',
    idempotencyKey: newKey(),
    model: MODEL,
    ...overrides,
  };
}

function stored(messageId: string) {
  const message = core.state.messages.find((held) => held.id === messageId);
  expect(message).toBeDefined();
  return message;
}

describe('a send in a sealed fleet (decision 0068, B8)', () => {
  it('scenario 7: the stored row holds ciphertext under the current data key, the plain byte count and no plain payload', async () => {
    const payload = 'Review the café menu: 5 €';

    const { messageId } = unwrap(await sendMessage(scout, aReview({ payload })));

    const message = stored(messageId);
    const [currentKey] = core.state.dataKeys;
    expect(typeof message?.payload).toBe('object');
    expect(message?.payload).toMatchObject({ sealed: { dataKeyId: currentKey?.id }, plainBytes: 28 });
    expect(JSON.stringify(core.state.messages)).not.toContain('café');
    expect(core.state.deliveries.filter((delivery) => delivery.messageId === messageId)).toHaveLength(1);
  });

  it('scenario 8: a 256 KB payload is accepted, as in a fleet without sealing', async () => {
    const payload = 'x'.repeat(PAYLOAD_MAX_BYTES);

    const { messageId } = unwrap(await sendMessage(scout, aReview({ payload })));

    expect(stored(messageId)?.payload).toMatchObject({ plainBytes: PAYLOAD_MAX_BYTES });
  });

  it('scenario 10: a repeat of the same request with its key answers the original; with another payload it is refused as today', async () => {
    const first = aReview();
    const { messageId } = unwrap(await sendMessage(scout, first));

    const repeat = await sendMessage(scout, { ...first });
    const changed = await sendMessage(scout, { ...first, payload: 'Review https://github.com/ThomasHendrickx/aeolus-fleet/pull/1374' });

    expect(unwrap(repeat)).toEqual({ messageId });
    expect(refusalOf(changed).kind).toBe('IDEMPOTENCY_KEY_REUSED');
    expect(core.state.messages.filter((held) => held.senderShipId === scoutId)).toHaveLength(1);
  });

  it("scenario 10: a sealed message's request hash leaves its payload out, so a copy confirms no guessed payload", async () => {
    const { messageId: one } = unwrap(await sendMessage(scout, aReview({ payload: 'yes' })));
    const { messageId: other } = unwrap(await sendMessage(scout, aReview({ payload: 'no' })));

    expect(stored(one)?.requestHash).toBe(stored(other)?.requestHash);
  });

  it('scenario 11: a withdrawal stores the question id it names in its own column, found though its payload is sealed (B18)', async () => {
    const { messageId } = unwrap(
      await sendMessage(scout, aReview({ contentType: WITHDRAWAL_CONTENT_TYPE, payload: JSON.stringify({ questionId: QUESTION_ID }) })),
    );

    expect(stored(messageId)).toMatchObject({ questionId: QUESTION_ID, payload: { plainBytes: 53 } });
  });

  it('scenario 9: with the company key disabled and the data key cache run out, a send is refused KEY_UNAVAILABLE and stores no message, delivery or event of its own', async () => {
    const [sealing] = core.state.fleetSealings;
    await core.keyVault.disable(sealing?.companyKey ?? '');
    core.clock.advance(DATA_KEY_CACHE_MS);
    const before = structuredClone(core.state);

    const refusal = refusalOf(await sendMessage(scout, aReview()));

    expect(refusal.kind).toBe('KEY_UNAVAILABLE');
    expect({ messages: core.state.messages, deliveries: core.state.deliveries }).toEqual({ messages: before.messages, deliveries: before.deliveries });
    expect(core.state.events.slice(before.events.length).map(({ type }) => type)).toEqual(['FleetKeyUnavailable']);
  });
});
