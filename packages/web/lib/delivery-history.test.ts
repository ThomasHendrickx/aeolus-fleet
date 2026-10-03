import { createIdGenerator, type DeliveryHistoryEntry, type MessageRecipient } from '@aeolus-fleet/common';
import { describe, expect, it } from 'vitest';

import { deliveryHistorySentence, deliveryHistoryState } from './delivery-history';
import { plainText } from './sentence';

const newId = createIdGenerator();
const planner = { id: newId('ship'), name: 'planner' };
const toPlanner: MessageRecipient = { kind: 'ship', ship: planner };
const toReviewers: MessageRecipient = { kind: 'type', type: 'reviewer' };

function anEntry(type: DeliveryHistoryEntry['type'], overrides: Partial<DeliveryHistoryEntry> = {}): DeliveryHistoryEntry {
  return { seq: 1, type, occurredAt: '2026-10-01T09:00:00.000Z', ship: null, location: null, harness: null, attempts: null, ...overrides };
}

function sentence(entry: DeliveryHistoryEntry, recipient: MessageRecipient = toPlanner): string {
  return plainText(deliveryHistorySentence(entry, recipient));
}

describe('deliveryHistorySentence', () => {
  it('says a message to one ship was stored in its inbox', () => {
    expect(sentence(anEntry('MessageAccepted'))).toBe('Stored in the inbox of planner.');
  });

  it('says a message to a type was queued for any ship of it', () => {
    expect(sentence(anEntry('MessageAccepted'), toReviewers)).toBe('Queued for any ship of type reviewer.');
  });

  it('names the ship that claimed it and where its session ran', () => {
    const claimed = anEntry('DeliveryClaimed', { ship: planner, location: { kind: 'DEVICE', description: null }, attempts: 1 });

    expect(sentence(claimed)).toBe('Claimed by planner, session on Device.');
  });

  it("uses the session's own description, and counts the attempt after the first", () => {
    const claimed = anEntry('DeliveryClaimed', {
      ship: planner,
      location: { kind: 'SERVER', description: 'hetzner-1' },
      attempts: 3,
    });

    expect(sentence(claimed)).toBe('Attempt 3: claimed by planner, session on hetzner-1.');
  });

  it('says a returned message to one ship is back in its inbox', () => {
    expect(sentence(anEntry('DeliveryReturned', { ship: planner }))).toBe(
      'Back in the inbox: the session of planner ended before acknowledging it.',
    );
  });

  it('says a returned message to a type is back in the queue', () => {
    expect(sentence(anEntry('DeliveryReturned', { ship: planner }), toReviewers)).toBe(
      'Returned to the queue: the session of planner ended before acknowledging it.',
    );
  });

  it('names the ship that acknowledged it', () => {
    expect(sentence(anEntry('DeliveryAcknowledged', { ship: planner }))).toBe('Acknowledged by planner.');
  });

  it('counts the claims of an undeliverable message', () => {
    expect(sentence(anEntry('DeliveryUndeliverable', { ship: planner, attempts: 5 }))).toBe(
      'Received 5 times, never acknowledged.',
    );
  });

  it('says a message was abandoned when its ship was retired', () => {
    expect(sentence(anEntry('DeliveryAbandoned', { ship: planner }))).toBe('Abandoned: planner was retired before taking it.');
  });

  it('says the operator dismissed an undeliverable message', () => {
    expect(sentence(anEntry('DeliveryDismissed', { ship: planner }))).toBe(
      'Dismissed by the operator: no ship takes it any more.',
    );
  });
});

describe('deliveryHistoryState', () => {
  it.each([
    ['MessageAccepted', 'pending'],
    ['DeliveryReturned', 'pending'],
    ['DeliveryClaimed', 'delivered'],
    ['DeliveryAcknowledged', 'acknowledged'],
    ['DeliveryAbandoned', 'abandoned'],
    ['DeliveryDismissed', 'dismissed'],
    ['DeliveryUndeliverable', 'undeliverable'],
  ] as const)('shows %s as %s', (type, state) => {
    expect(deliveryHistoryState({ type })).toBe(state);
  });
});
