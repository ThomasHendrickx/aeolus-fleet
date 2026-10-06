import type { Notice } from './notice.js';
import type { NoticeRepository } from './ports.js';

export type GetNotices = () => Promise<Notice[]>;

/** Use case: the notices the installation set (decision 0023), in its order; none before it sets any. */
export function createGetNotices(deps: { notices: NoticeRepository }): GetNotices {
  return () => deps.notices.read();
}
