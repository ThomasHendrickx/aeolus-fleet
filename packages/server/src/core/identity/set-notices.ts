import type { Notice } from './notice.js';
import type { NoticeRepository } from './ports.js';

export type SetNotices = (input: { notices: readonly Notice[] }) => Promise<Notice[]>;

/**
 * Use case: the installation sets the console's notices (decision 0023),
 * replacing those it set before, in its order; none clears them. No event:
 * notices belong to the installation, not to a fleet.
 */
export function createSetNotices(deps: { notices: NoticeRepository }): SetNotices {
  return async ({ notices }) => {
    await deps.notices.replace(notices);
    return [...notices];
  };
}
