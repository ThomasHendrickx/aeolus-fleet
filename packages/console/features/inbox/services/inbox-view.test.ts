import { createIdGenerator, type DeliveryId } from '@aeolus-fleet/common';
import { describe, expect, it } from 'vitest';

import type { InboxEntry, MessageEntry, QuestionEntry } from '../../../lib/inbox-entry';
import { inboxViewOf, openQuestionsOf, waitingOf } from './inbox-view';

const newId = createIdGenerator();
const SENDER = { id: newId('ship'), name: 'orchestrator-2', type: 'orchestrator', isNameShared: false };

function aQuestion({ sentAt, answeredAt = null, isStale = false }: { sentAt: string; answeredAt?: string | null; isStale?: boolean }): QuestionEntry {
  return {
    kind: 'question',
    deliveryId: newId('delivery'),
    messageId: newId('message'),
    state: answeredAt === null ? 'pending' : 'acknowledged',
    readAt: null,
    doneAt: answeredAt,
    sender: SENDER,
    sentAt,
    model: null,
    question: {
      id: '3f1c2a9e-7b4d-4e8a-9c1f-2d6b8e0a5c47',
      title: 'Which port?',
      context: '',
      options: [{ key: 1, label: 'Keep 3000', detail: '' }],
      pick: { option: 1, why: 'Nothing else needs it.' },
      answer: answeredAt === null ? null : { messageId: newId('message'), sentAt: answeredAt, option: 1, note: null },
    },
    stale: isStale ? { kind: 'withdrawn', deliveryId: newId('delivery'), sentAt } : null,
    replaces: null,
  };
}

function aMessage({ sentAt, doneAt = null, isFromPlugin = false }: { sentAt: string; doneAt?: string | null; isFromPlugin?: boolean }): MessageEntry {
  return {
    kind: 'message',
    deliveryId: newId('delivery'),
    messageId: newId('message'),
    state: doneAt === null ? 'pending' : 'acknowledged',
    readAt: null,
    doneAt,
    sender: SENDER,
    sentAt,
    model: null,
    isFromPlugin,
    repliedWith: null,
    inReplyTo: null,
    text: { headline: 'Slice done', summary: '', body: [], lineCount: 0, links: [] },
    replies: [],
  };
}

function idsOf(entries: readonly InboxEntry[]): DeliveryId[] {
  return entries.map(({ deliveryId }) => deliveryId);
}

const early = aQuestion({ sentAt: '2026-10-16T08:00:00.000Z' });
const late = aQuestion({ sentAt: '2026-10-16T09:00:00.000Z' });
const answered = aQuestion({ sentAt: '2026-10-16T07:00:00.000Z', answeredAt: '2026-10-16T07:30:00.000Z' });
const stale = aQuestion({ sentAt: '2026-10-16T06:00:00.000Z', isStale: true });
const older = aMessage({ sentAt: '2026-10-16T08:30:00.000Z' });
const newer = aMessage({ sentAt: '2026-10-16T09:30:00.000Z' });
const done = aMessage({ sentAt: '2026-10-16T05:00:00.000Z', doneAt: '2026-10-16T05:10:00.000Z' });
const fromPlugin = aMessage({ sentAt: '2026-10-16T09:10:00.000Z', isFromPlugin: true });
const ENTRIES = [newer, late, fromPlugin, older, early, answered, done, stale];

describe('inboxViewOf', () => {
  it('lays out every question the segment read, its open ones first and oldest first, then the answered and stale ones newest first: nothing left out', () => {
    expect(idsOf(inboxViewOf(ENTRIES).questions)).toEqual([early.deliveryId, late.deliveryId, answered.deliveryId, stale.deliveryId]);
  });

  it('lays out every message the segment read newest first, done ones too, plugin ships apart', () => {
    const view = inboxViewOf(ENTRIES);

    expect(idsOf(view.messages)).toEqual([newer.deliveryId, older.deliveryId, done.deliveryId]);
    expect(idsOf(view.pluginMessages)).toEqual([fromPlugin.deliveryId]);
  });
});

describe('openQuestionsOf', () => {
  it('lists the open questions oldest first, for moving through them', () => {
    expect(idsOf(openQuestionsOf(ENTRIES))).toEqual([early.deliveryId, late.deliveryId]);
  });
});

describe('waitingOf', () => {
  it('says how long the oldest open question waits', () => {
    expect(waitingOf(ENTRIES, new Date('2026-10-16T09:07:00.000Z'))).toBe('1 h 7 min');
  });

  it('is undefined without open questions', () => {
    expect(waitingOf([newer], new Date('2026-10-16T09:07:00.000Z'))).toBeUndefined();
  });
});
