import type { Caller } from '../shared/caller.js';
import { consoleReaderOf, isForSessionOf, type Notice } from './notice.js';
import type { NoticeDismissals, NoticeRepository } from './ports.js';

export type ReadNotices = (caller: Caller) => Promise<Notice[]>;

/**
 * Use case: the notices a console session shows above every page (decision
 * 0023): those of its audience, in the installation's order, less the
 * dismissible ones it dismissed. An account signed in as itself reads those for
 * accounts (accounts design, A9). A caller without a console session reads none.
 */
export function createReadNotices(deps: { notices: NoticeRepository; dismissals: NoticeDismissals }): ReadNotices {
  return async (caller) => {
    const reader = consoleReaderOf(caller);
    if (reader === undefined) {
      return [];
    }
    const [notices, dismissed] = await Promise.all([deps.notices.read(), deps.dismissals.dismissed({ fleetId: caller.fleetId, reader })]);
    return notices.filter((notice) => isForSessionOf(notice, reader.kind) && !(notice.isDismissible && dismissed.includes(notice.id)));
  };
}
