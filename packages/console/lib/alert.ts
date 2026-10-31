import type { AlertSignal } from '@aeolus-fleet/common';

/** What parted, as the console words a signal (docs/design/monitoring, 4.4, 4.8): "Delivery unacknowledged". */
export const SIGNAL_WORDS: Readonly<Record<AlertSignal, string>> = {
  'crew-request-unassigned': 'Crew request unassigned',
  'delivery-unacknowledged': 'Delivery unacknowledged',
  'delivery-overdue': 'Delivery overdue',
  'ping-unanswered': 'Ping unanswered',
  'report-unchanged': 'Report unchanged',
  'task-not-done': 'Task not done',
};

/** A signal as a sentence carries it, in lower case; a signal the console does not know as its own name. */
export function signalWords(signal: string): string {
  const words = Object.entries(SIGNAL_WORDS).find(([known]) => known === signal)?.[1];
  return words === undefined ? signal : words.toLowerCase();
}
