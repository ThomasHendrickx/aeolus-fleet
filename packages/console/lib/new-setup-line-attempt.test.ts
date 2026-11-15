import { createIdGenerator, type ShipId } from '@aeolus-fleet/common';
import { MutationObserver, QueryClient } from '@tanstack/query-core';
import { describe, expect, it, vi } from 'vitest';

import { newSetupLineOptions } from './new-setup-line-attempt';
import { failureWords, NewSetupLineError } from './new-setup-line-outcome';
import { TRIERARCH_PLUGIN_NO_ANSWER } from './no-answer';
import type { PluginAnswer } from './plugin-answer';
import type { NewSetupLine } from './trierarch-plugin-schemas';

const SHIP = createIdGenerator()('ship');
const LINE: NewSetupLine = { shipId: SHIP, setupLine: 'curl | sh' };
const REASON = 'This call needs the fleet:manage or crew:run scope.';

/** The flow of the open dialog: confirm, a refusal, the fresh reads, then confirm again from the same dialog. */
function openDialog({ answers, reads: readsOf }: { answers: (PluginAnswer<NewSetupLine> | Error)[]; reads: (boolean | undefined)[] }) {
  const calls = [...answers];
  const reads = [...readsOf];
  const isCrewedNow = vi.fn(() => Promise.resolve(reads.shift()));
  const refreshMachines = vi.fn(() => Promise.resolve());
  const call = vi.fn(() => {
    const next = calls.shift();
    if (next === undefined) {
      return Promise.reject(new Error('no answer left'));
    }
    return next instanceof Error ? Promise.reject(next) : Promise.resolve(next);
  });
  const observer = new MutationObserver<NewSetupLine, NewSetupLineError, { shipId: ShipId; status: 'crewed' | 'awaitingCrew' }>(new QueryClient(), newSetupLineOptions({ call, isCrewedNow, refreshMachines }));
  const failureShown = () => {
    const error = observer.getCurrentResult().error;
    return error === null ? undefined : `${error.message} ${failureWords('trierarch-mac', error.outcome)}`;
  };
  return { observer, call, isCrewedNow, refreshMachines, failureShown };
}

const crewed = { shipId: SHIP, status: 'crewed' } as const;
const refusal: PluginAnswer<NewSetupLine> = { kind: 'refused', message: REASON };

describe('a new setup line that fails and is tried again from the still-open dialog', () => {
  it.each([
    { name: 'released', read: false, words: 'trierarch-mac was released, but has no new setup line yet' },
    { name: 'maybe released', read: undefined, words: 'trierarch-mac may have been released' },
  ])('shows the $name words, reads the machine and the list again, and the retry gives the line', async ({ read, words }) => {
    const dialog = openDialog({ answers: [refusal, { kind: 'answered', data: LINE }], reads: [read] });

    await expect(dialog.observer.mutate(crewed)).rejects.toBeInstanceOf(NewSetupLineError);
    expect(dialog.failureShown()).toContain(`${REASON} ${words}`);
    expect(dialog.failureShown()).not.toContain('Nothing changed');
    expect(dialog.isCrewedNow).toHaveBeenCalledTimes(1);
    expect(dialog.refreshMachines).toHaveBeenCalledTimes(1);

    await expect(dialog.observer.mutate(crewed)).resolves.toEqual(LINE);
    expect(dialog.observer.getCurrentResult().error).toBeNull();
    expect(dialog.observer.getCurrentResult().data).toEqual(LINE);
    expect(dialog.call).toHaveBeenCalledTimes(2);
    expect(dialog.refreshMachines).toHaveBeenCalledTimes(2);
  });

  it('says nothing changed when the machine is still crewed', async () => {
    const dialog = openDialog({ answers: [refusal], reads: [true] });
    await expect(dialog.observer.mutate(crewed)).rejects.toBeInstanceOf(NewSetupLineError);
    expect(dialog.failureShown()).toBe(`${REASON} Nothing changed.`);
  });
});

describe('a server function that fails itself (a plain Error, no outcome)', () => {
  it('is the maybe-released outcome with the no-answer words, never undefined, and the retry works', async () => {
    const dialog = openDialog({ answers: [new Error('Server Components render error'), { kind: 'answered', data: LINE }], reads: [] });

    await expect(dialog.observer.mutate(crewed)).rejects.toBeInstanceOf(NewSetupLineError);
    const shown = dialog.failureShown();
    expect(shown).toBe(`${TRIERARCH_PLUGIN_NO_ANSWER} ${failureWords('trierarch-mac', 'unsure')}`);
    expect(shown).not.toContain('undefined');
    expect(dialog.refreshMachines).toHaveBeenCalledTimes(1);

    await expect(dialog.observer.mutate(crewed)).resolves.toEqual(LINE);
  });
});
