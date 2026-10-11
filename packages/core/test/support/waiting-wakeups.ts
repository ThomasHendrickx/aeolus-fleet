import type { ReceiverWakeups } from '../../src/domain/messaging/ports.js';

/**
 * The given wake-ups, and `waiting`, which settles once a receive waits on
 * them: it has looked at the inbox, holding its lease, and found nothing. A
 * test that acts under a waiting receive waits for this, not for a fixed time.
 */
export function waitingWakeups(wakeups: ReceiverWakeups): { wakeups: ReceiverWakeups; waiting: Promise<void> } {
  const waiting = Promise.withResolvers<undefined>();
  return {
    wakeups: {
      watch: (address) => {
        const watch = wakeups.watch(address);
        return {
          next: (ms) => {
            waiting.resolve(undefined);
            return watch.next(ms);
          },
          stop: () => {
            watch.stop();
          },
        };
      },
    },
    waiting: waiting.promise,
  };
}
