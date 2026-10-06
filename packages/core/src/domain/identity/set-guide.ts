import type { Guide } from './guide.js';
import type { GuideRepository } from './ports.js';

export type SetGuide = (input: { guide: Guide | null }) => Promise<Guide | null>;

/**
 * Use case: the installation sets the console's guide (decision 0024),
 * replacing the one it set before; null clears it. No event: the guide
 * belongs to the installation, not to a fleet.
 */
export function createSetGuide(deps: { guide: GuideRepository }): SetGuide {
  return async ({ guide }) => {
    await deps.guide.replace(guide);
    return guide;
  };
}
