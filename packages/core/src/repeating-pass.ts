/** A background pass core runs while it serves: one at a time, each after the last one ended. */
export interface RepeatingPass {
  /** Stops passing; settles once a pass that runs has ended. */
  stop(): Promise<void>;
}

/**
 * Runs `pass` every `everyMs`, the first one `everyMs` after it starts. A pass
 * that fails goes to `onError` and the next one runs as usual: what a pass
 * missed, the next one finds, since it reads its work from the database.
 */
export function repeatPass(options: { pass: () => Promise<void>; everyMs: number; onError: (error: unknown) => void }): RepeatingPass {
  let timer: NodeJS.Timeout | undefined;
  let running: Promise<void> = Promise.resolve();
  let isStopped = false;

  const schedule = () => {
    timer = setTimeout(() => {
      running = options
        .pass()
        .catch(options.onError)
        .finally(() => {
          if (!isStopped) {
            schedule();
          }
        });
    }, options.everyMs);
  };

  schedule();
  return {
    stop: async () => {
      isStopped = true;
      clearTimeout(timer);
      await running;
    },
  };
}
