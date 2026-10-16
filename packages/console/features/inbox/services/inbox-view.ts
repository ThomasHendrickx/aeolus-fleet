import type { InboxFilter } from '@aeolus-fleet/common';

import { isOpenEntry as isOpen, type InboxEntry, type MessageEntry, type QuestionEntry } from '../../../lib/inbox-entry';
import { duration } from '../../../lib/relative-time';

/**
 * argo's one inbox as it reads (#849): questions on top, then messages from
 * ships, then the messages of plugin ships, folded. Open holds what waits on
 * the operator: a question until it is answered or stale, whatever its
 * delivery's state (decision 0038), a message until it is done. Done holds
 * the rest, All both.
 */

export interface InboxView {
  questions: QuestionEntry[];
  messages: MessageEntry[];
  pluginMessages: MessageEntry[];
}

function oldestFirst<T extends InboxEntry>(entries: readonly T[]): T[] {
  return entries.toSorted((one, other) => one.sentAt.localeCompare(other.sentAt));
}

function newestFirst<T extends InboxEntry>(entries: readonly T[]): T[] {
  return entries.toSorted((one, other) => other.sentAt.localeCompare(one.sentAt));
}

function questionsIn(entries: readonly InboxEntry[]): QuestionEntry[] {
  return entries.filter((entry) => entry.kind === 'question');
}

function messagesIn(entries: readonly InboxEntry[]): MessageEntry[] {
  return entries.filter((entry) => entry.kind === 'message');
}

/** The open questions, oldest first: the order the operator answers them in. */
export function openQuestionsOf(entries: readonly InboxEntry[]): QuestionEntry[] {
  return oldestFirst(questionsIn(entries).filter(isOpen));
}

function keptBy(entries: readonly InboxEntry[], segment: InboxFilter): InboxEntry[] {
  switch (segment) {
    case 'open':
      return entries.filter(isOpen);
    case 'done':
      return entries.filter((entry) => !isOpen(entry));
    case 'all':
      return [...entries];
  }
}

export function inboxViewOf(entries: readonly InboxEntry[], segment: InboxFilter): InboxView {
  const kept = keptBy(entries, segment);
  const questions = questionsIn(kept);
  const messages = newestFirst(messagesIn(kept));
  return {
    questions: [...oldestFirst(questions.filter(isOpen)), ...newestFirst(questions.filter((question) => !isOpen(question)))],
    messages: messages.filter((message) => !message.isFromPlugin),
    pluginMessages: messages.filter((message) => message.isFromPlugin),
  };
}

/** The count beside each segment: Open counts open questions and open messages together. */
export function segmentCounts(entries: readonly InboxEntry[]): Record<InboxFilter, number> {
  return { open: keptBy(entries, 'open').length, done: keptBy(entries, 'done').length, all: entries.length };
}

/** "1 h 7 min": how long the oldest open question has waited; undefined without one. */
export function waitingOf(entries: readonly InboxEntry[], now: Date): string | undefined {
  const [oldest] = openQuestionsOf(entries);
  return oldest === undefined ? undefined : duration(new Date(oldest.sentAt), now);
}

function isSameDay(at: Date, now: Date): boolean {
  return at.getFullYear() === now.getFullYear() && at.getMonth() === now.getMonth() && at.getDate() === now.getDate();
}

/** What the operator did today, in the browser's time zone: questions answered, messages marked done. */
export function todayOf(entries: readonly InboxEntry[], now: Date): { answered: number; done: number } {
  const answered = questionsIn(entries).filter(({ question }) => question.answer !== null && isSameDay(new Date(question.answer.sentAt), now));
  const done = messagesIn(entries).filter(({ doneAt }) => doneAt !== null && isSameDay(new Date(doneAt), now));
  return { answered: answered.length, done: done.length };
}
