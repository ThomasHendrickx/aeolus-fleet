import type { Caller } from '../shared/caller.js';
import { NOT_STARTED, type GuideProgress, type GuideStep } from './guide.js';
import { consoleReaderOf, isForSessionOf } from './notice.js';
import type { GuideProgressRepository, GuideRepository } from './ports.js';

export type ReadGuide = (caller: Caller) => Promise<{ steps: readonly GuideStep[]; progress: GuideProgress } | null>;

/**
 * Use case: the guide a console session shows (decision 0024): the
 * installation's, when it is for the session's audience, with where the
 * session is in it; open at the first step until the session moves. A step
 * past the end of a guide set shorter since reads as its last step. None
 * without a console session.
 */
export function createReadGuide(deps: { guide: GuideRepository; progress: GuideProgressRepository }): ReadGuide {
  return async (caller) => {
    const reader = consoleReaderOf(caller);
    const guide = await deps.guide.read();
    if (reader === undefined || guide === null || !isForSessionOf(guide, reader.kind)) {
      return null;
    }
    const progress = (await deps.progress.progress({ fleetId: caller.fleetId, reader })) ?? NOT_STARTED;
    return { steps: guide.steps, progress: { ...progress, step: Math.min(progress.step, guide.steps.length - 1) } };
  };
}
