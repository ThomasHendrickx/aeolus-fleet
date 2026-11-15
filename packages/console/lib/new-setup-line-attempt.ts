import type { ShipId } from '@aeolus-fleet/common';

import { TRIERARCH_PLUGIN_NO_ANSWER } from './no-answer';
import { NewSetupLineError, newSetupLineOutcomeOf } from './new-setup-line-outcome';
import type { PluginAnswer } from './plugin-answer';
import type { Machine, NewSetupLine } from './trierarch-plugin-schemas';

/** What a new setup line's try needs from outside: the server function, a fresh read of the machine, and a new read of the list. */
export interface NewSetupLineParts {
  call: (shipId: ShipId) => Promise<PluginAnswer<NewSetupLine>>;
  /** Whether the machine is crewed now, read afresh; undefined when the read fails or no longer lists it. */
  isCrewedNow: (shipId: ShipId) => Promise<boolean | undefined>;
  refreshMachines: () => Promise<unknown>;
}

/**
 * The mutation of a machine's new setup line (trierarch#260). A refusal throws
 * a NewSetupLineError: a crewed machine is read again, since the plugin may
 * have released it before the new line failed. A server function that itself
 * fails answers nothing, so it may have gone through at any step: the
 * maybe-released outcome, with the no-answer words.
 */
export function newSetupLineOptions({ call, isCrewedNow, refreshMachines }: NewSetupLineParts) {
  return {
    mutationFn: async (machine: Pick<Machine, 'shipId' | 'status'>): Promise<NewSetupLine> => {
      let answer: PluginAnswer<NewSetupLine>;
      try {
        answer = await call(machine.shipId);
      } catch {
        throw new NewSetupLineError(TRIERARCH_PLUGIN_NO_ANSWER, 'unsure');
      }
      if (answer.kind === 'answered') {
        return answer.data;
      }
      const wasCrewed = machine.status === 'crewed';
      const outcome = newSetupLineOutcomeOf({ wasCrewed, isCrewedNow: wasCrewed ? await isCrewedNow(machine.shipId) : undefined });
      throw new NewSetupLineError(answer.message, outcome);
    },
    onSettled: async () => {
      await refreshMachines();
    },
  };
}
