import type { AlertOutput, AlertSignal } from '@aeolus-fleet/common';

import { duration, sinceTime } from './relative-time';
import { reportAge } from './report';

/**
 * Open alerts in words (docs/design/monitoring, 4.8): what parted and for
 * how long, the fact that says more where the signal has one, since when,
 * and that it clears by itself. Read from core's alert record, never the
 * alert message (4.9, sealed fleets).
 */

/** What parted, as the console words a signal (4.4): "Delivery unacknowledged". */
export const SIGNAL_WORDS: Readonly<Record<AlertSignal, string>> = {
  'crew-request-unassigned': 'Crew request unassigned',
  'delivery-unacknowledged': 'Delivery unacknowledged',
  'delivery-overdue': 'Delivery overdue',
  'ping-unanswered': 'Ping unanswered',
  'report-unchanged': 'Report unchanged',
  'task-not-done': 'Task not done',
};

const CLEARS_BY_ITSELF = 'clears by itself';

/** A signal as a sentence carries it, in lower case; a signal the console does not know as its own name. */
export function signalWords(signal: string): string {
  const words = Object.entries(SIGNAL_WORDS).find(([known]) => known === signal)?.[1];
  return words === undefined ? signal : words.toLowerCase();
}

/** The overview's Open alerts line: "deploy-bot", "Delivery unacknowledged 22 min, awaiting crew", "since 14:31 · clears by itself". */
export function alertOverviewLine(alert: AlertOutput, now: Date): { ship: string; text: string; caption: string } {
  const since = new Date(alert.since);
  const detail = detailOf(alert);
  return {
    ship: alert.ship.name,
    text: `${SIGNAL_WORDS[alert.signal]} ${reportAge(since, now)}${detail === null ? '' : `, ${detail}`}`,
    caption: `since ${sinceTime(since, now)} · ${CLEARS_BY_ITSELF}`,
  };
}

/** The ship page's open alert: "Report unchanged 3 h 10 min", "Expected within 60 min", "since 12:05 · owner told · clears by itself". */
export function alertShipPanel(alert: AlertOutput, now: Date): { headline: string; detail: string | null; caption: string } {
  const since = new Date(alert.since);
  const detail = detailOf(alert);
  return {
    headline: `${SIGNAL_WORDS[alert.signal]} ${duration(since, now)}`,
    detail: detail === null ? null : `${detail.charAt(0).toUpperCase()}${detail.slice(1)}`,
    caption: [`since ${sinceTime(since, now)}`, ...(alert.ownerShipId === null ? [] : ['owner told']), CLEARS_BY_ITSELF].join(' · '),
  };
}

/** The fact that says more of what parted, where the signal has one: the assigner's reason, awaiting crew, the expectation. */
function detailOf(alert: AlertOutput): string | null {
  switch (alert.signal) {
    case 'crew-request-unassigned':
      return alert.facts.reason;
    case 'delivery-unacknowledged':
      return alert.facts.awaitingCrew ? 'awaiting crew' : null;
    case 'report-unchanged':
      return `expected within ${String(alert.facts.minutes)} min`;
    case 'delivery-overdue':
    case 'ping-unanswered':
    case 'task-not-done':
      return null;
  }
}
