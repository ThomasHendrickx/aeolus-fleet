import type { FleetId } from '@aeolus-fleet/common';

import { refuse, type DomainError } from '../shared/errors.js';
import { ok, type Result } from '../shared/result.js';
import type { SquadronRepository } from './ports.js';

export type StandDownRefusal = DomainError<'SQUADRON_NOT_FOUND' | 'NOT_SAILING'>;

export type StandDown = (input: { fleetId: FleetId; squadronId: string }) => Promise<Result<undefined, StandDownRefusal>>;

/**
 * Use case: the operator stands a sailing squadron down (#86, B4). It goes
 * Standing down and takes no new work; advancing the stand-downs then sends
 * each member its stand-down and retires each once it is done. Only a sailing
 * squadron stands down this way: a forming one only by force.
 */
export function createStandDown(deps: { squadrons: SquadronRepository }): StandDown {
  return async ({ fleetId, squadronId }) => {
    const squadron = (await deps.squadrons.list(fleetId)).find((each) => each.id === squadronId);
    if (!squadron) {
      return refuse('SQUADRON_NOT_FOUND', `The fleet has no squadron ${squadronId}`);
    }
    if (squadron.state !== 'sailing') {
      return refuse('NOT_SAILING', `The squadron ${squadronId} is ${squadron.state}: only a sailing squadron stands down`);
    }
    await deps.squadrons.update({ before: squadron, after: { ...squadron, state: 'standing-down' } });
    return ok(undefined);
  };
}
