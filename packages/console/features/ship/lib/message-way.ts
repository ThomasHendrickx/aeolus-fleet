import { isPingContentType, type DeliveryHolder, type MessageDetail } from '@aeolus-fleet/common';

import type { Machine } from '../../../lib/trierarch-plugin-schemas';
import { duration, relativeTime, sinceTime } from '../../../lib/relative-time';
import type { DeliveryStepState } from './delivery-history';

/**
 * A message's way through as the MessageSheet leads with it (#756): the
 * state, who holds it and since when, then the clock lines that speak for
 * it. Short lines: the badge, the icon and the tone carry the rest.
 */

/** What a way line's icon shows; the molecule maps it to a Lucide icon. */
export type WayIcon = 'fleet' | 'computer' | 'watcher' | 'agent' | 'time' | 'clock' | 'busy' | 'restart' | 'silent' | 'died' | 'ping' | 'unknown';

/** The tone family of a way line (docs/design/conventions.md, "Colour"). */
export type WayTone = 'neutral' | 'waiting' | 'active' | 'attention';

export interface WayLine {
  icon: WayIcon;
  tone: WayTone;
  text: string;
}

export interface MessageWay {
  status: DeliveryStepState;
  lines: WayLine[];
}

/** The attempts a pushed hand-over is allowed before the fifth is refused (decision 0040). */
const ATTEMPTS_BEFORE_UNDELIVERABLE = 5;
const SECOND_MS = 1_000;
const MINUTE_MS = 60_000;

function line(icon: WayIcon, said: { tone: WayTone; text: string }): WayLine {
  return { icon, ...said };
}

/** Who holds it, by its part: "Fleet", "Trierarch on mac-mini", "Plugin watcher", "Agent". */
function holderWords(holder: DeliveryHolder): { icon: WayIcon; words: string } {
  switch (holder.kind) {
    case 'fleet':
      return { icon: 'fleet', words: 'Fleet' };
    case 'trierarch':
      return { icon: 'computer', words: `Trierarch on ${holder.trierarch.name}` };
    case 'pluginWatcher':
      return { icon: 'watcher', words: 'Plugin watcher' };
    case 'agent':
      return { icon: 'agent', words: 'Agent' };
  }
}

/** The holder line: who holds it, since when, and what it waits for. */
function holderLine(message: MessageDetail, now: Date): WayLine {
  const { state, attempts, way } = message.delivery;
  const since = relativeTime(new Date(way.since), now);
  if (way.holder === null) {
    return line('time', { tone: 'neutral', text: since });
  }
  const { icon, words } = holderWords(way.holder);
  if (state !== 'handed') {
    return line(icon, { tone: state === 'acknowledged' ? 'neutral' : 'waiting', text: `${words} · ${since}` });
  }
  if (way.isPulled) {
    const times = attempts > 1 ? ` · handed (pulled) ${String(attempts)} times` : '';
    return line(icon, { tone: 'waiting', text: `${words} (pulled) · ${since} · not acknowledged${times}` });
  }
  const attempt = attempts > 1 ? ` · attempt ${String(attempts)} of ${String(ATTEMPTS_BEFORE_UNDELIVERABLE)}` : '';
  return line(icon, { tone: 'waiting', text: `${words} · ${since} · not confirmed${attempt}` });
}

/** What became of an acknowledged one's turn when nobody reports it: a pull ship, or a lease that ended first. */
function handledLines(message: MessageDetail): WayLine[] {
  const { state, way } = message.delivery;
  if (state !== 'acknowledged') {
    return [];
  }
  if (way.isPulled) {
    return [line('unknown', { tone: 'neutral', text: 'Handled: not reported (pull ship)' })];
  }
  return way.lease?.isEnded ? [line('unknown', { tone: 'waiting', text: 'Handled unknown: lease ended' })] : [];
}

/** The lines the 10 and 60 minute clocks speak and the session's side: told, busy, restarting, silent. */
function clockLines(message: MessageDetail, context: { now: Date; machines: readonly WayMachine[] }): WayLine[] {
  const { now, machines } = context;
  const { state, way } = message.delivery;
  const lines: WayLine[] = [];
  const isWaiting = state === 'pending' || state === 'received';
  const turn = way.lease?.turn;
  if (isWaiting && turn?.turn === 'busy') {
    lines.push(line('busy', { tone: 'active', text: `Session busy since ${sinceTime(new Date(turn.at), now)}` }));
  }
  const isInFlight = state === 'received' || state === 'handed';
  if (isInFlight && way.crew?.status === 'restarting') {
    lines.push(line('restart', { tone: 'waiting', text: `Session restarting (restart ${String(way.crew.attempt)})` }));
  }
  if (isInFlight && way.crew?.status === 'crashed') {
    lines.push(line('died', { tone: 'attention', text: 'Session crashed' }));
  }
  if (isInFlight && way.crew?.status === 'running' && way.crew.attempt > 0 && way.crew.startedAt !== null) {
    lines.push(line('restart', { tone: 'neutral', text: `Session restarted ${sinceTime(new Date(way.crew.startedAt), now)}` }));
  }
  const side = way.lease?.by;
  const machine = side?.kind === 'trierarch' ? machines.find((each) => each.shipId === side.trierarch.id) : undefined;
  if (side && isWaiting && machine?.isSilent) {
    const seen = machine.lastSeenAt === null ? '' : ` since ${sinceTime(new Date(machine.lastSeenAt), now)}`;
    lines.push(line('silent', { tone: 'attention', text: `${holderWords(side).words} silent${seen}` }));
  }
  if (way.overdue) {
    lines.push(line('clock', { tone: 'attention', text: `argo told at ${String(way.overdue.minutes)} min` }));
  }
  if (state === 'notHandled') {
    lines.push(line('died', { tone: 'attention', text: `Session died twice · argo told ${sinceTime(new Date(way.since), now)}` }));
  }
  return lines;
}

/** A ping's way (3.17): when it was pinged and handed, then how soon after the hand-over it was answered. */
function pingLine(message: MessageDetail, now: Date): WayLine {
  const { history } = message.delivery;
  const handedStep = history.find((step) => step.type === 'DeliveryHanded');
  const answered = history.find((step) => step.type === 'DeliveryAcknowledged');
  if (answered && handedStep) {
    const after = new Date(answered.occurredAt).getTime() - new Date(handedStep.occurredAt).getTime();
    const took = after < MINUTE_MS ? `${String(Math.floor(Math.max(0, after) / SECOND_MS))} s` : duration(new Date(handedStep.occurredAt), new Date(answered.occurredAt));
    return line('ping', { tone: 'neutral', text: `Answered ping in ${took} after hand-over` });
  }
  const pinged = `Pinged ${relativeTime(new Date(message.sentAt), now).toLowerCase()}`;
  const handedAt = handedStep ? ` · handed ${relativeTime(new Date(handedStep.occurredAt), now).toLowerCase()}` : '';
  return line('ping', { tone: 'waiting', text: `${pinged}${handedAt} · no answer yet` });
}

/** What the way needs of a machine: its trierarch's ship and whether it answers. */
export type WayMachine = Pick<Machine, 'shipId' | 'isSilent' | 'lastSeenAt'>;

/** The state a delivery shows as, from its newest step: a pushed hand-over reads "Handed", not "Handed (pulled)". */
function wayStatus(message: MessageDetail): DeliveryStepState {
  const { state, way } = message.delivery;
  return state === 'handed' && !way.isPulled ? 'handedPushed' : state;
}

/**
 * A message's way: its StatusBadge and its lines, the holder line first,
 * then the clock lines. A ping reads as a ping. The machines, when the
 * trierarch plugin is on, tell a silent trierarch.
 */
export function messageWay(message: MessageDetail, context: { now: Date; machines?: readonly WayMachine[] }): MessageWay {
  const { now, machines = [] } = context;
  const isPing = isPingContentType(message.contentType);
  const isOpenPing = isPing && (message.delivery.state === 'pending' || message.delivery.state === 'received' || message.delivery.state === 'handed');
  const lead = isPing && (isOpenPing || message.delivery.state === 'acknowledged') ? pingLine(message, now) : holderLine(message, now);
  return {
    status: wayStatus(message),
    lines: [lead, ...(isPing ? [] : handledLines(message)), ...clockLines(message, { now, machines })],
  };
}
