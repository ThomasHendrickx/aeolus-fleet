import { createIdGenerator, QUESTION_CONTENT_TYPE, REPLACEMENT_CONTENT_TYPE, WITHDRAWAL_CONTENT_TYPE, type InboxMessage, type ShipId } from '@aeolus-fleet/common';
import { describe, expect, it } from 'vitest';

import { inboxEntriesOf, inboxEntryOf } from './inbox-entries';
import { isOpenEntry } from './inbox-entry';

const newId = createIdGenerator();
const AT = '2026-10-16T09:00:00.000Z';

const ORCHESTRATOR = { id: newId('ship'), name: 'orchestrator-2', type: 'orchestrator' };
const TRIERARCH = { id: newId('ship'), name: 'build-host-2', type: 'trierarch' };
const SQUADRONS = { id: newId('ship'), name: 'squadrons', type: 'squadrons' };

const QUESTION = {
  id: '3f1c2a9e-7b4d-4e8a-9c1f-2d6b8e0a5c47',
  title: 'Which port?',
  context: 'The docs name two.',
  options: [
    { key: 1, label: 'Keep 3000', detail: '' },
    { key: 2, label: 'Move to 4000', detail: '' },
  ],
  pick: { option: 1, why: 'Nothing else needs it.' },
};

function aMessage({
  sender = ORCHESTRATOR,
  contentType = 'text/plain',
  payload = 'Slice 7 done',
  isPayloadSealed = false,
  isPayloadUnreadable = false,
}: { sender?: { id: ShipId; name: string }; contentType?: string; payload?: string; isPayloadSealed?: boolean; isPayloadUnreadable?: boolean } = {}): InboxMessage {
  return {
    deliveryId: newId('delivery'),
    state: 'pending',
    readAt: null,
    doneAt: null,
    repliedWith: null,
    replies: [],
    message: { id: newId('message'), sender: { id: sender.id, name: sender.name }, inReplyTo: null, sentAt: AT, contentType, model: 'claude-opus-5-5', payload, isPayloadUnreadable, isPayloadSealed },
  };
}

const SHIPS = [ORCHESTRATOR, TRIERARCH, SQUADRONS];

describe('inboxEntriesOf', () => {
  it('marks a payload stored sealed, and not one stored before sealing (decision 0068, N1)', () => {
    const entries = inboxEntriesOf([aMessage({ isPayloadSealed: true }), aMessage({ contentType: QUESTION_CONTENT_TYPE, payload: JSON.stringify(QUESTION), isPayloadSealed: true }), aMessage()], SHIPS);

    expect(entries.map(({ kind, payload }) => ({ kind, payload }))).toEqual([
      { kind: 'message', payload: 'sealed' },
      { kind: 'question', payload: 'sealed' },
      { kind: 'message', payload: 'plain' },
    ]);
  });

  it('scenario 25: given a sealed message and a sealed question whose company key is not reachable, each lists as a message saying so', () => {
    const entries = inboxEntriesOf(
      [aMessage({ payload: '', isPayloadSealed: true, isPayloadUnreadable: true }), aMessage({ contentType: QUESTION_CONTENT_TYPE, payload: '', isPayloadSealed: true, isPayloadUnreadable: true })],
      SHIPS,
    );

    expect(entries.map(({ kind, payload }) => ({ kind, payload }))).toEqual([
      { kind: 'message', payload: 'keyNotReachable' },
      { kind: 'message', payload: 'keyNotReachable' },
    ]);
  });

  it('reads a message with its headline and the sender type', () => {
    const message = aMessage({ payload: 'PR #412 is ready\n\nCI green.' });

    const [entry] = inboxEntriesOf([message], SHIPS);

    expect(entry).toMatchObject({
      kind: 'message',
      deliveryId: message.deliveryId,
      isFromPlugin: false,
      sender: { id: ORCHESTRATOR.id, name: 'orchestrator-2', type: 'orchestrator', isNameShared: false },
      text: { headline: 'PR #412 is ready', summary: 'CI green.' },
      model: 'claude-opus-5-5',
    });
  });

  it.each([
    TRIERARCH,
    SQUADRONS,
    { id: newId('ship'), name: 'trierarch-plugin', type: 'trierarch-plugin' },
    { id: newId('ship'), name: 'gateway', type: 'gateway' },
  ])(
    'marks a message from the $type ship as from a plugin',
    (ship) => {
      const [entry] = inboxEntriesOf([aMessage({ sender: ship })], [...SHIPS, ship]);

      expect(entry).toMatchObject({ kind: 'message', isFromPlugin: true });
    },
  );

  it('reads a question as a question', () => {
    const [entry] = inboxEntriesOf([aMessage({ contentType: QUESTION_CONTENT_TYPE, payload: JSON.stringify(QUESTION) })], SHIPS);

    expect(entry).toMatchObject({ kind: 'question', question: { title: 'Which port?', answer: null }, stale: null });
  });

  it('leaves out the withdrawal that made a question stale', () => {
    const question = aMessage({ contentType: QUESTION_CONTENT_TYPE, payload: JSON.stringify(QUESTION) });
    const withdrawal = aMessage({ contentType: WITHDRAWAL_CONTENT_TYPE, payload: JSON.stringify({ questionId: QUESTION.id }) });

    const entries = inboxEntriesOf([withdrawal, question], SHIPS);

    expect(entries.map(({ deliveryId }) => deliveryId)).toEqual([question.deliveryId]);
  });

  it('reads a question whose options have no detail as a question, and leaves out its withdrawal (#854)', () => {
    const bare = { ...QUESTION, options: [{ key: 1, label: 'Keep 3000' }, { key: 2, label: 'Move to 4000' }] };
    const question = aMessage({ contentType: QUESTION_CONTENT_TYPE, payload: JSON.stringify(bare, null, 2) });
    const withdrawal = aMessage({ contentType: WITHDRAWAL_CONTENT_TYPE, payload: JSON.stringify({ questionId: bare.id }) });

    const entries = inboxEntriesOf([withdrawal, question], SHIPS);

    expect(entries.map(({ kind, deliveryId }) => [kind, deliveryId])).toEqual([['question', question.deliveryId]]);
  });

  it('says a sender name is shared when another ship of the fleet has it', () => {
    const retiredNamesake = { id: newId('ship'), name: 'orchestrator-2', type: 'orchestrator' };

    const [entry] = inboxEntriesOf([aMessage()], [...SHIPS, retiredNamesake]);

    expect(entry?.sender.isNameShared).toBe(true);
  });

  it('has no type for a sender the fleet does not list', () => {
    const [entry] = inboxEntriesOf([aMessage()], []);

    expect(entry).toMatchObject({ sender: { type: null, isNameShared: false }, kind: 'message', isFromPlugin: false });
  });

  it("lays out argo's replies to a message", () => {
    const message = { ...aMessage(), replies: [{ id: newId('message'), contentType: 'text/plain', payload: 'Go.', isPayloadUnreadable: false, sentAt: AT }] };

    const [entry] = inboxEntriesOf([message], SHIPS);

    expect(entry?.kind === 'message' ? entry.replies.map(({ text }) => text.headline) : []).toEqual(['Go.']);
  });

  it('counts neither a stale question nor its withdrawal as open, though their deliveries stay pending; the replacement is open', () => {
    const replaced = { ...QUESTION, id: '5c8e1a3b-6d2f-4b7a-9e0c-3a5d7f9b1c2e', title: 'Rename the inbox filter?' };
    const replacement = { ...QUESTION, id: '9b2e4d6f-1a3c-4e5b-8d7f-0c2a4e6b8d1f', title: 'Rename the inbox filter, now that core moved?' };
    const inbox = [
      aMessage({ payload: 'Deployed.' }),
      aMessage({ contentType: QUESTION_CONTENT_TYPE, payload: JSON.stringify(QUESTION) }),
      aMessage({ contentType: QUESTION_CONTENT_TYPE, payload: JSON.stringify(replaced) }),
      aMessage({ contentType: WITHDRAWAL_CONTENT_TYPE, payload: JSON.stringify({ questionId: QUESTION.id }) }),
      aMessage({ contentType: REPLACEMENT_CONTENT_TYPE, payload: JSON.stringify({ questionId: replaced.id, question: replacement }) }),
    ];

    const open = inboxEntriesOf(inbox, SHIPS).filter(isOpenEntry);

    expect(open.map((entry) => (entry.kind === 'question' ? entry.question.title : entry.text.headline))).toEqual(['Deployed.', 'Rename the inbox filter, now that core moved?']);
  });
});

describe('inboxEntryOf', () => {
  it('reads the one question or message with this delivery, laid out with the withdrawal that made it stale', () => {
    const question = aMessage({ contentType: QUESTION_CONTENT_TYPE, payload: JSON.stringify(QUESTION) });
    const withdrawal = aMessage({ contentType: WITHDRAWAL_CONTENT_TYPE, payload: JSON.stringify({ questionId: QUESTION.id }) });

    const entry = inboxEntryOf([withdrawal, aMessage(), question], { ships: SHIPS, deliveryId: question.deliveryId });

    expect(entry).toMatchObject({ kind: 'question', deliveryId: question.deliveryId, stale: { kind: 'withdrawn' } });
  });

  it('reads none for a delivery the inbox does not hold', () => {
    expect(inboxEntryOf([aMessage()], { ships: SHIPS, deliveryId: newId('delivery') })).toBeNull();
  });
});

