import type { Caller } from '../shared/caller.js';
import type { Clock } from '../shared/clock.js';
import { refuse, type DomainError } from '../shared/errors.js';
import { ok, type Result } from '../shared/result.js';
import { isForSessionOf } from './notice.js';
import type { NoticeDismissals, NoticeRepository } from './ports.js';

export type DismissNoticeRefusal = DomainError<'NOTICE_NOT_FOUND' | 'NOTICE_NOT_DISMISSIBLE'>;

export type DismissNotice = (caller: Caller, input: { noticeId: string }) => Promise<Result<undefined, DismissNoticeRefusal>>;

/**
 * Use case: a console session dismisses a dismissible notice it sees, for
 * itself only (decision 0023); again is OK and changes nothing. No event: a
 * notice is how the console looks, not a change to the fleet.
 */
export function createDismissNotice(deps: { notices: NoticeRepository; dismissals: NoticeDismissals; clock: Clock }): DismissNotice {
  return async (caller, { noticeId }) => {
    const { consoleSessionId } = caller;
    const notice = (await deps.notices.read()).find((each) => each.id === noticeId && isForSessionOf(each, caller.kind));
    if (consoleSessionId === undefined || notice === undefined) {
      return refuse('NOTICE_NOT_FOUND', `No notice ${noticeId} shows in this console session`);
    }
    if (!notice.isDismissible) {
      return refuse('NOTICE_NOT_DISMISSIBLE', `Notice ${noticeId} stays: the installation made it not dismissible`);
    }
    await deps.dismissals.dismiss({ fleetId: caller.fleetId, consoleSessionId, noticeId, at: deps.clock.now() });
    return ok(undefined);
  };
}
