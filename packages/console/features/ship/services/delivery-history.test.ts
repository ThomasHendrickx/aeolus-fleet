import { createIdGenerator, type DeliveryHistoryEntry, type MessageRecipient } from '@aeolus-fleet/common';
import { describe, expect, it } from 'vitest';

import { deliveryHistorySentence, deliveryHistoryState, offsetTime } from './delivery-history';
import { plainText } from '../../../lib/sentence';

const newId = createIdGenerator();
const planner = { id: newId('ship'), name: 'planner' };
const toPlanner: MessageRecipient = { kind: 'ship', ship: planner };
const toReviewers: MessageRecipient = { kind: 'type', type: 'reviewer' };
const atMacMini = { kind: 'trierarch', trierarch: { id: newId('ship'), name: 'mac-mini' } } as const;
const watcher = { kind: 'pluginWatcher' } as const;

function anEntry(type: DeliveryHistoryEntry['type'], overrides: Partial<DeliveryHistoryEntry> = {}): DeliveryHistoryEntry {
  return {
    seq: 1,
    type,
    occurredAt: '2026-10-01T09:00:00.000Z',
    ship: null,
    location: null,
    harness: null,
    attempts: null,
    by: null,
    handOverNumber: null,
    channel: null,
    isAgain: false,
    isOnceMore: false,
    overdue: null,
    leaseEnd: null,
    ...overrides,
  };
}

function sentence(entry: DeliveryHistoryEntry, read: { recipient?: MessageRecipient; older?: DeliveryHistoryEntry } = {}): string {
  return plainText(deliveryHistorySentence(entry, { recipient: read.recipient ?? toPlanner, older: read.older }));
}

describe('deliveryHistorySentence', () => {
  it('says a message to one ship was stored in its inbox', () => {
    expect(sentence(anEntry('MessageAccepted'))).toBe('Stored in the inbox of planner.');
  });

  it('says a message to a type was queued for any ship of it', () => {
    expect(sentence(anEntry('MessageAccepted'), { recipient: toReviewers })).toBe('Queued for any ship of type reviewer.');
  });

  it('says it was handed (pulled) to the ship, and where its session ran', () => {
    const handed = anEntry('DeliveryHanded', { ship: planner, location: { kind: 'DEVICE', description: null }, attempts: 1 });

    expect(sentence(handed)).toBe('Handed (pulled) to planner, session on Device.');
  });

  it("uses the session's own description, and counts the attempt after the first", () => {
    const handed = anEntry('DeliveryHanded', {
      ship: planner,
      location: { kind: 'SERVER', description: 'hetzner-1' },
      attempts: 3,
    });

    expect(sentence(handed)).toBe('Attempt 3: handed (pulled) to planner, session on hetzner-1.');
  });

  it('says a returned message to one ship is back in its inbox', () => {
    expect(sentence(anEntry('DeliveryReturned', { ship: planner }))).toBe(
      'Back in the inbox: the session of planner ended before acknowledging it.',
    );
  });

  it('says a returned message to a type is back in the queue', () => {
    expect(sentence(anEntry('DeliveryReturned', { ship: planner }), { recipient: toReviewers })).toBe(
      'Returned to the queue: the session of planner ended before acknowledging it.',
    );
  });

  it('names the ship that acknowledged it', () => {
    expect(sentence(anEntry('DeliveryAcknowledged', { ship: planner }))).toBe('Acknowledged by planner.');
  });

  it('counts the hand-overs of an undeliverable message and says the fifth receive was refused', () => {
    expect(sentence(anEntry('DeliveryUndeliverable', { ship: planner, attempts: 5 }))).toBe(
      'Handed (pulled) 4 times, never acknowledged; fifth receive refused: undeliverable.',
    );
  });

  it('names the trierarch on its computer that received it', () => {
    expect(sentence(anEntry('DeliveryReceived', { ship: planner, by: atMacMini }))).toBe('Received by the trierarch on mac-mini for planner.');
  });

  it('says the plugin watcher received it again, which changed nothing', () => {
    expect(sentence(anEntry('DeliveryReceived', { ship: planner, by: watcher, isAgain: true }))).toBe('Received again by the plugin watcher for planner.');
  });

  it('says it was handed to the agent with its hand-over number, by the computer side', () => {
    expect(sentence(anEntry('DeliveryHanded', { ship: planner, by: atMacMini, handOverNumber: 2, attempts: 2 }))).toBe(
      'Handed to planner (no. 2) by the trierarch on mac-mini.',
    );
  });

  it('says which channel it was handed through, by the gateway (interop 5.1)', () => {
    expect(sentence(anEntry('DeliveryHanded', { ship: planner, by: { kind: 'gateway' }, handOverNumber: 1, attempts: 1, channel: 'tools/call' }))).toBe(
      'Handed to planner (no. 1) by the gateway via tools/call.',
    );
  });

  it.each([
    [{ kind: 'personApp' } as const, "the person's app"],
    [{ kind: 'adapter' } as const, 'the adapter'],
  ])('names %o as the computer side that received it', (by, words) => {
    expect(sentence(anEntry('DeliveryReceived', { ship: planner, by }))).toBe(`Received by ${words} for planner.`);
  });

  it('says it was handed once more after its turn died', () => {
    expect(sentence(anEntry('DeliveryHanded', { ship: planner, by: atMacMini, handOverNumber: 3, isOnceMore: true }))).toBe(
      'Handed once more to planner (no. 3): its turn died.',
    );
  });

  it('says the turn that took it ended: handled', () => {
    expect(sentence(anEntry('DeliveryHandled', { ship: planner }))).toBe('Handled by planner: its turn ended.');
  });

  it('says its turn died twice: not handled', () => {
    expect(sentence(anEntry('DeliveryNotHandled', { ship: planner }))).toBe('Not handled: the turn of planner died twice.');
  });

  it.each([
    [{ clock: 'notConfirmed', minutes: 10 }, 'argo told: handed 10 min, not confirmed.'],
    [{ clock: 'idle', minutes: 10 }, 'argo told: waiting 10 min, session idle.'],
    [{ clock: 'busy', minutes: 60 }, 'argo told: waiting 60 min, session busy.'],
  ] as const)('says argo was told by the clock that ran out', (overdue, told) => {
    expect(sentence(anEntry('DeliveryOverdue', { ship: planner, overdue }))).toBe(told);
  });

  it('says why the lease ended and what the return to pending ended', () => {
    const handedBefore = anEntry('DeliveryHanded', { ship: planner, by: watcher, handOverNumber: 1 });

    expect(sentence(anEntry('DeliveryReturned', { ship: planner, leaseEnd: 'released' }), { older: handedBefore })).toBe(
      'Back in the inbox: planner was released (was handed).',
    );
  });

  it('counts the hand-overs of a pushed undeliverable message, never confirmed', () => {
    expect(sentence(anEntry('DeliveryUndeliverable', { ship: planner, attempts: 5, handOverNumber: 5 }))).toBe(
      'Handed 4 times, never confirmed; fifth refused: undeliverable.',
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
    ['DeliveryReceived', 'received'],
    ['DeliveryHanded', 'handed'],
    ['DeliveryAcknowledged', 'acknowledged'],
    ['DeliveryHandled', 'handled'],
    ['DeliveryNotHandled', 'notHandled'],
    ['DeliveryOverdue', 'overdue'],
    ['DeliveryAbandoned', 'abandoned'],
    ['DeliveryDismissed', 'dismissed'],
    ['DeliveryUndeliverable', 'undeliverable'],
  ] as const)('shows %s as %s', (type, state) => {
    expect(deliveryHistoryState({ type, handOverNumber: null, isOnceMore: false })).toBe(state);
  });

  it('shows a hand-over by the computer side as handed, not pulled', () => {
    expect(deliveryHistoryState({ type: 'DeliveryHanded', handOverNumber: 1, isOnceMore: false })).toBe('handedPushed');
  });
});

describe('offsetTime', () => {
  const storedAt = new Date('2026-10-01T09:00:00.000Z');

  it.each([
    [2_000, '+2 s'],
    [59_999, '+59 s'],
    [60_000, '+1 min'],
    [6 * 60_000, '+6 min'],
    [65 * 60_000, '+1 h 5 min'],
  ])('reads %i ms after the store as %s', (elapsedMs, offset) => {
    expect(offsetTime(storedAt, new Date(storedAt.getTime() + elapsedMs))).toBe(offset);
  });
});
