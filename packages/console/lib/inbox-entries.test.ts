import { createIdGenerator, QUESTION_CONTENT_TYPE, WITHDRAWAL_CONTENT_TYPE, type InboxMessage, type ShipId } from '@aeolus-fleet/common';
import { describe, expect, it } from 'vitest';

import { inboxEntriesOf } from './inbox-entries';

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

function aMessage({ sender = ORCHESTRATOR, contentType = 'text/plain', payload = 'Slice 7 done' }: { sender?: { id: ShipId; name: string }; contentType?: string; payload?: string } = {}): InboxMessage {
  return {
    deliveryId: newId('delivery'),
    state: 'pending',
    readAt: null,
    doneAt: null,
    repliedWith: null,
    replies: [],
    message: { id: newId('message'), sender: { id: sender.id, name: sender.name }, inReplyTo: null, sentAt: AT, contentType, model: 'claude-opus-5-5', payload },
  };
}

const SHIPS = [ORCHESTRATOR, TRIERARCH, SQUADRONS];

describe('inboxEntriesOf', () => {
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

  it.each([TRIERARCH, SQUADRONS, { id: newId('ship'), name: 'trierarch-plugin', type: 'trierarch-plugin' }, { id: newId('ship'), name: 'networking-plugin', type: 'networking-plugin' }])(
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
    const message = { ...aMessage(), replies: [{ id: newId('message'), contentType: 'text/plain', payload: 'Go.', sentAt: AT }] };

    const [entry] = inboxEntriesOf([message], SHIPS);

    expect(entry?.kind === 'message' ? entry.replies.map(({ text }) => text.headline) : []).toEqual(['Go.']);
  });
});
