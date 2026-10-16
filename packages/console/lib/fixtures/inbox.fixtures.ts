import { idSchema, type DeliveryId, type MessageId, type ShipId } from '@aeolus-fleet/common';

import type { InboxEntry, InboxSender, MessageEntry, QuestionEntry } from '../inbox-entry';
import type { ThreadMessage } from '../inbox-thread';
import { messageTextOf } from '../message-text';

/**
 * argo's inbox for the stories (#849): the proposal's invented fleet, with
 * three open questions, ship messages and plugin ships' messages. Times sit
 * before NOW.
 */

export const NOW = new Date('2026-10-15T20:30:00Z');

const shipId = (suffix: string): ShipId => idSchema('ship').parse(`shp_01j8xk4tqzr3a9w6m2v5n7${suffix}`);
const messageId = (suffix: string): MessageId => idSchema('message').parse(`msg_01j8zd2vqzr3a9w6m2v5n7${suffix}`);
const deliveryId = (suffix: string): DeliveryId => idSchema('delivery').parse(`dlv_01j8zd2vqzr3a9w6m2v5n7${suffix}`);

function sender({ name, suffix, type }: { name: string; suffix: string; type: string }): InboxSender {
  return { id: shipId(suffix), name, type, isNameShared: false };
}

const IMPLEMENTER = sender({ name: 'implementer-c', suffix: 'c001', type: 'implementer' });
const ORCHESTRATOR = sender({ name: 'orchestrator-2', suffix: 'c002', type: 'orchestrator' });
const REVIEWER = sender({ name: 'reviewer-2', suffix: 'c003', type: 'reviewer' });
const BUILD_HOST = sender({ name: 'build-host-2', suffix: 'c004', type: 'trierarch' });
const SQUADRONS = sender({ name: 'squadrons', suffix: 'c005', type: 'squadrons' });

function aQuestion(suffix: string, changes: Partial<QuestionEntry> & Pick<QuestionEntry, 'sender' | 'sentAt' | 'question'>): QuestionEntry {
  return {
    kind: 'question',
    deliveryId: deliveryId(suffix),
    messageId: messageId(suffix),
    state: 'pending',
    readAt: null,
    doneAt: null,
    model: 'claude-opus-5-5',
    stale: null,
    replaces: null,
    ...changes,
  };
}

function aMessage(suffix: string, changes: Partial<MessageEntry> & Pick<MessageEntry, 'sender' | 'sentAt'> & { payload: string; contentType?: string }): MessageEntry {
  const { payload, contentType = 'text/plain', ...entry } = changes;
  return {
    kind: 'message',
    deliveryId: deliveryId(suffix),
    messageId: messageId(suffix),
    state: 'pending',
    readAt: null,
    doneAt: null,
    model: 'claude-opus-5-5',
    isFromPlugin: false,
    repliedWith: null,
    inReplyTo: null,
    replies: [],
    text: messageTextOf({ contentType, payload }),
    ...entry,
  };
}

export const TIDE_TABLES = aQuestion('a001', {
  sender: IMPLEMENTER,
  sentAt: '2026-10-15T19:23:00Z',
  question: {
    id: '3f1c2a9e-7b4d-4e8a-9c1f-2d6b8e0a5c47',
    title: 'How many days of tide tables does the app keep offline?',
    context: 'Slice 7 caches tide tables on the phone. The build plan says “a week or more”. 7 days is 1.2 MB per station, 30 days 5 MB. Most users follow 2 to 3 stations.',
    options: [
      { key: 1, label: '7 days', detail: 'Smallest cache; a week offline covers a sailing weekend.' },
      { key: 2, label: '14 days', detail: 'Twice the size; covers a two-week trip.' },
      { key: 3, label: '30 days', detail: 'Largest; up to 15 MB for three stations.' },
    ],
    pick: { option: 2, why: 'covers the trips the blueprint names, at a size users will not notice.' },
    answer: null,
  },
});

export const MERGE_NOW = aQuestion('a002', {
  sender: ORCHESTRATOR,
  sentAt: '2026-10-15T19:48:00Z',
  question: {
    id: '5c8e1a3b-6d2f-4b7a-9e0c-3a5d7f9b1c2e',
    title: 'Merge PR #412 now, or wait for the harbour-ios check?',
    context: 'harbour-ios runs nightly; everything else is green.',
    options: [
      { key: 1, label: 'Merge now', detail: '' },
      { key: 2, label: 'Wait for the check', detail: 'About 8 hours.' },
    ],
    pick: { option: 1, why: 'the check never failed on this path.' },
    answer: null,
  },
});

export const ANSWERED = {
  ...TIDE_TABLES,
  state: 'acknowledged',
  readAt: '2026-10-15T20:30:00Z',
  doneAt: '2026-10-15T20:31:00Z',
  question: { ...TIDE_TABLES.question, answer: { messageId: messageId('b001'), sentAt: '2026-10-15T20:31:00Z', option: 2, note: null } },
} satisfies QuestionEntry;

export const WITHDRAWN = aQuestion('a003', {
  sender: REVIEWER,
  sentAt: '2026-10-15T18:18:00Z',
  question: {
    id: '9b2e4d6f-1a3c-4e5b-8d7f-0c2a4e6b8d1f',
    title: 'Block PR #412 on the missing offline badge story?',
    context: '',
    options: [
      { key: 1, label: 'Block', detail: '' },
      { key: 2, label: 'Follow-up', detail: '' },
    ],
    pick: { option: 2, why: 'it is a story, not behaviour.' },
    answer: null,
  },
  stale: { kind: 'withdrawn', deliveryId: deliveryId('a004'), sentAt: '2026-10-15T18:40:00Z' },
});

export const PR_READY = aMessage('a010', {
  sender: ORCHESTRATOR,
  sentAt: '2026-10-15T19:47:00Z',
  contentType: 'text/markdown',
  inReplyTo: messageId('a090'),
  payload:
    'PR #412 is ready for you: offline tide tables\n\nSlice 7 is done and waits for your merge.\n\n- CI green: unit, integration, e2e\n- reviewer-2: nothing blocking, 2 notes\n- implementer-c released\n\nI start slice 8 after the merge: https://github.com/example/tidewater/pull/412',
});

export const ISSUE_FILED = aMessage('a011', {
  sender: REVIEWER,
  sentAt: '2026-10-15T18:36:00Z',
  readAt: '2026-10-15T18:40:00Z',
  payload: 'Issue filed: tidewater #88, tide chart flickers on rotate\n\nhttps://github.com/example/tidewater/issues/88',
});

export const SLICE_DONE = aMessage('a012', {
  sender: ORCHESTRATOR,
  sentAt: '2026-10-15T18:22:00Z',
  state: 'acknowledged',
  readAt: '2026-10-15T18:25:00Z',
  doneAt: '2026-10-15T18:25:00Z',
  payload: 'Slice 6 done: PR #409 merged\n\nNext: slice 7, offline tide tables. implementer-c has it.',
});

export const DISCARDED = aMessage('a020', {
  sender: BUILD_HOST,
  sentAt: '2026-10-15T20:03:00Z',
  isFromPlugin: true,
  model: null,
  payload: Array.from({ length: 16 }, (_, at) => `M packages/app/src/tides/file-${String(at)}.ts`).reduce(
    (body, line) => `${body}\n${line}`,
    'build-host-2: released implementer-c (shp_01j8xk4tqzr3a9w6m2v5n7c001) and removed its tidewater worktree, discarding what was not pushed:\n',
  ),
});

export const KEPT = aMessage('a021', {
  sender: SQUADRONS,
  sentAt: '2026-10-15T19:12:00Z',
  isFromPlugin: true,
  model: null,
  payload: 'squadrons kept a message for flagship sqd-tide: it does not handle text/plain',
});

export const THREAD: ThreadMessage[] = [
  { id: messageId('a089'), sender: ORCHESTRATOR, isArgo: false, sentAt: '2026-10-15T17:05:00Z', text: messageTextOf({ contentType: 'text/plain', payload: 'Starting slice 7. implementer-c crews it, reviewer-2 reviews.' }) },
  { id: messageId('a090'), sender: { id: shipId('c000'), name: 'argo' }, isArgo: true, sentAt: '2026-10-15T17:09:00Z', text: messageTextOf({ contentType: 'text/plain', payload: 'Go. Keep the cache under 20 MB.' }) },
];

export const ENTRIES: InboxEntry[] = [TIDE_TABLES, MERGE_NOW, WITHDRAWN, PR_READY, ISSUE_FILED, SLICE_DONE, DISCARDED, KEPT];
