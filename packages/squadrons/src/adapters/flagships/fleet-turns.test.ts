import { describe, expect, it } from 'vitest';

import { FLEET_ID, OTHER_FLEET_ID } from '../../../test/support/management-fakes.js';
import { createFleetTurns } from './fleet-turns.js';

/** A gate the test opens: work waiting on it stays in its turn until then. */
function aGate(): { opened: Promise<void>; open: () => void } {
  let open = (): void => undefined;
  const opened = new Promise<void>((resolve) => {
    open = resolve;
  });
  return { opened, open };
}

/** Lets every turn that could start start. */
function settle(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 10));
}

describe("a fleet's turns (#626)", () => {
  it('run the work of one fleet one at a time, in the order it was taken', async () => {
    const turns = createFleetTurns();
    const gate = aGate();
    const done: string[] = [];

    const first = turns.take(FLEET_ID, async () => {
      await gate.opened;
      done.push('first');
    });
    const second = turns.take(FLEET_ID, () => {
      done.push('second');
      return Promise.resolve();
    });
    await settle();
    expect(done).toEqual([]);
    gate.open();
    await Promise.all([first, second]);

    expect(done).toEqual(['first', 'second']);
  });

  it("let another fleet's work run meanwhile", async () => {
    const turns = createFleetTurns();
    const gate = aGate();

    const held = turns.take(FLEET_ID, () => gate.opened);
    const other = await turns.take(OTHER_FLEET_ID, () => Promise.resolve('other'));
    gate.open();
    await held;

    expect(other).toBe('other');
  });

  it('pass on to the next work when one fails, and the failure reaches whoever took that turn', async () => {
    const turns = createFleetTurns();

    const failed = turns.take(FLEET_ID, () => Promise.reject(new Error('the fleet did not answer')));
    const next = turns.take(FLEET_ID, () => Promise.resolve('next'));

    await expect(failed).rejects.toThrow('the fleet did not answer');
    await expect(next).resolves.toBe('next');
  });
});
