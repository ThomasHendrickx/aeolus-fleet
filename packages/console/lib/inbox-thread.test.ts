import { createIdGenerator, type MessageId } from '@aeolus-fleet/common';
import { describe, expect, it } from 'vitest';

import { threadBefore, type ThreadSource } from './inbox-thread';

const newId = createIdGenerator();
const ARGO = { id: newId('ship'), name: 'argo' };
const ORCHESTRATOR = { id: newId('ship'), name: 'orchestrator-2' };

function aSource(messages: readonly ThreadSource[]): (messageId: MessageId) => Promise<ThreadSource | undefined> {
  return (messageId) => Promise.resolve(messages.find(({ id }) => id === messageId));
}

function aMessage({ sender, inReplyTo = null, payload }: { sender: { id: ReturnType<typeof newId<'ship'>>; name: string }; inReplyTo?: MessageId | null; payload: string }): ThreadSource {
  return { id: newId('message'), sender, inReplyTo, sentAt: '2026-10-16T09:00:00.000Z', contentType: 'text/plain', payload };
}

describe('threadBefore', () => {
  it('lists the messages a message replies to, oldest first, argo marked', async () => {
    const start = aMessage({ sender: ORCHESTRATOR, payload: 'Starting slice 7.' });
    const reply = aMessage({ sender: ARGO, inReplyTo: start.id, payload: 'Go.' });

    const thread = await threadBefore(reply.id, { read: aSource([start, reply]), argoId: ARGO.id });

    expect(thread.map(({ sender, isArgo, text }) => [sender.name, isArgo, text.headline])).toEqual([
      ['orchestrator-2', false, 'Starting slice 7.'],
      ['argo', true, 'Go.'],
    ]);
  });

  it('is empty for a message that replies to none', async () => {
    expect(await threadBefore(null, { read: aSource([]), argoId: ARGO.id })).toEqual([]);
  });

  it('stops at a message it cannot read', async () => {
    const reply = aMessage({ sender: ARGO, inReplyTo: newId('message'), payload: 'Go.' });

    const thread = await threadBefore(reply.id, { read: aSource([reply]), argoId: ARGO.id });

    expect(thread.map(({ text }) => text.headline)).toEqual(['Go.']);
  });

  it('reads at most ten messages back', async () => {
    const chain = Array.from({ length: 12 }, (_, index) => index).reduce<ThreadSource[]>(
      (messages, index) => [...messages, aMessage({ sender: ORCHESTRATOR, inReplyTo: messages.at(-1)?.id ?? null, payload: `message ${String(index)}` })],
      [],
    );

    const thread = await threadBefore(chain.at(-1)?.id ?? null, { read: aSource(chain), argoId: ARGO.id });

    expect(thread.map(({ text }) => text.headline)).toEqual(['message 2', 'message 3', 'message 4', 'message 5', 'message 6', 'message 7', 'message 8', 'message 9', 'message 10', 'message 11']);
  });
});
