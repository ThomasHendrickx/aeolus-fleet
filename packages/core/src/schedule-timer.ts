/** A server's timer to the earliest next schedule attempt it knows of (decision 0062, S14). */
export interface ScheduleTimer {
  /** A schedule's next attempt is due at `at`: the timer goes off then, unless it goes off earlier already. */
  told(at: Date): void;
  /** Stops the timer; settles once a send that runs has ended. */
  stop(): Promise<void>;
}

/**
 * The shortest wait between two sends: a server whose clock runs ahead of the
 * database's finds nothing due yet and is told the same attempt again, so
 * without it the timer would go off over and over until the database's clock
 * caught up.
 */
const MIN_GAP_MS = 1_000;

/** setTimeout's longest wait; a later attempt is waited for in steps. */
const MAX_WAIT_MS = 2 ** 31 - 1;

/**
 * Starts the timer: it sends at once, for what came due while no server
 * ran, then whenever the earliest attempt it was told of, or that a send
 * answered, is due. One send at a time, at least a second apart. A send that
 * fails goes to `onError`; the next schedule it is told of, or the 30 second
 * pass, sends what it missed, since a send reads its work from the database.
 */
export function startScheduleTimer(options: {
  send: () => Promise<{ nextAttemptAt: Date | undefined }>;
  now: () => number;
  onError: (error: unknown) => void;
}): ScheduleTimer {
  let timer: NodeJS.Timeout | undefined;
  let armedFor: number | undefined;
  let lastSendAt = Number.NEGATIVE_INFINITY;
  let running: Promise<void> | undefined;
  /** An attempt that came due while a send ran: armed again once it ends. */
  let dueWhileRunning: number | undefined;
  let isStopped = false;

  const arm = (at: number) => {
    if (isStopped || (armedFor !== undefined && armedFor <= at)) {
      return;
    }
    clearTimeout(timer);
    armedFor = at;
    const wait = Math.max(at - options.now(), lastSendAt + MIN_GAP_MS - options.now(), 0);
    timer = setTimeout(goOff, Math.min(wait, MAX_WAIT_MS));
  };

  const goOff = () => {
    timer = undefined;
    const at = armedFor;
    armedFor = undefined;
    if (at !== undefined && at > options.now()) {
      // A wait longer than setTimeout takes: wait the rest.
      arm(at);
      return;
    }
    if (running) {
      dueWhileRunning = Math.min(dueWhileRunning ?? Number.POSITIVE_INFINITY, at ?? options.now());
      return;
    }
    lastSendAt = options.now();
    running = options
      .send()
      .then(
        ({ nextAttemptAt }) => {
          if (nextAttemptAt) {
            arm(nextAttemptAt.getTime());
          }
        },
        (error: unknown) => {
          options.onError(error);
        },
      )
      .finally(() => {
        running = undefined;
        if (dueWhileRunning !== undefined) {
          const due = dueWhileRunning;
          dueWhileRunning = undefined;
          arm(due);
        }
      });
  };

  arm(options.now());
  return {
    told: (at) => {
      arm(at.getTime());
    },
    stop: async () => {
      isStopped = true;
      clearTimeout(timer);
      await running;
    },
  };
}
