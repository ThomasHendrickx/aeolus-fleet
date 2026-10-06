import type { Caller } from '../shared/caller.js';
import type { Clock } from '../shared/clock.js';
import { refuse, type DomainError } from '../shared/errors.js';
import { ok, type Result } from '../shared/result.js';
import type { GuideProgress } from './guide.js';
import { isForSessionOf } from './notice.js';
import type { GuideProgressRepository, GuideRepository } from './ports.js';

export type RecordGuideProgressRefusal = DomainError<'GUIDE_NOT_FOUND' | 'GUIDE_STEP_NOT_FOUND'>;

export type RecordGuideProgress = (caller: Caller, progress: GuideProgress) => Promise<Result<undefined, RecordGuideProgressRefusal>>;

/**
 * Use case: a console session records where it is in the guide, for itself
 * only (decision 0024): open at a step, skipped or finished; open at the
 * first step again is Take the tour. No event: the guide is how the console
 * looks, not a change to the fleet.
 */
export function createRecordGuideProgress(deps: { guide: GuideRepository; progress: GuideProgressRepository; clock: Clock }): RecordGuideProgress {
  return async (caller, { step, state }) => {
    const { consoleSessionId } = caller;
    const guide = await deps.guide.read();
    if (consoleSessionId === undefined || guide === null || !isForSessionOf(guide, caller.kind)) {
      return refuse('GUIDE_NOT_FOUND', 'No guide shows in this console session');
    }
    if (step >= guide.steps.length) {
      return refuse('GUIDE_STEP_NOT_FOUND', `The guide has ${String(guide.steps.length)} steps, so no step ${String(step + 1)}`);
    }
    await deps.progress.record({ fleetId: caller.fleetId, consoleSessionId, step, state, at: deps.clock.now() });
    return ok(undefined);
  };
}
