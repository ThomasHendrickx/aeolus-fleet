import type { ListedShip } from '@aeolus-fleet/common';
import { duration, relativeTime } from './relative-time';

const MINUTE_MS = 60_000;
const SECOND_MS = 1_000;

/**
 * Whether the console offers Ping on the ship: an agent ship a session crews.
 * Never argo, a ship awaiting crew or a retired one: no session would answer.
 */
export function canPing(ship: Pick<ListedShip, 'kind' | 'status'>): boolean {
  return ship.kind === 'agent' && ship.status === 'crewed';
}

/** How long the session took to answer: seconds under a minute ("4 s"), then as other durations. */
export function answerTime(sentAt: Date, answeredAt: Date): string {
  const elapsedMs = Math.max(0, answeredAt.getTime() - sentAt.getTime());
  return elapsedMs < MINUTE_MS ? `${String(Math.round(elapsedMs / SECOND_MS))} s` : duration(sentAt, answeredAt);
}

/**
 * How the ship's last ping stands, in one line: "Pinged 3 min ago, no answer
 * yet" until its session answers, then "Answered ping in 4 s", or "Received,
 * not answered with pong" after a plain ack. Observation only: no timeout.
 */
export function pingLine(ping: NonNullable<ListedShip['ping']>, now: Date): string {
  const sentAt = new Date(ping.sentAt);
  switch (ping.state) {
    case 'waiting': {
      const when = relativeTime(sentAt, now);
      return `Pinged ${when === 'Just now' ? 'just now' : when}, no answer yet`;
    }
    case 'answered':
      return ping.answeredAt === null
        ? 'Answered ping'
        : `Answered ping in ${answerTime(sentAt, new Date(ping.answeredAt))}`;
    case 'received':
      return 'Received, not answered with pong';
  }
}
