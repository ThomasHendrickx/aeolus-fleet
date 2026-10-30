/**
 * A report's task (docs/design/monitoring, 4.2): a typed reference to where
 * the work lives, a `kind` and that kind's fields. Core checks the kinds it
 * knows and takes any other kind unchecked, so a newer ship never blocks on
 * an older core (question N7). Core never fetches a URL nor looks a message up.
 */
import { isId, REPORT_TASK_URL_MAX_LENGTH, type ReportTask } from '@aeolus-fleet/common';

import { refuse, type DomainError } from '../shared/errors.js';
import { ok, type Result } from '../shared/result.js';
import { isSameJson } from './report-details.js';

export type ReportTaskRefusal = DomainError<'INVALID_REPORT_TASK'>;

const HTTPS = 'https:';

/** The task as it is kept, once its kind's fields check out. */
export function reportTask(task: ReportTask): Result<ReportTask, ReportTaskRefusal> {
  switch (task.kind) {
    case '':
      return refuse('INVALID_REPORT_TASK', 'A task names its kind, such as url or message');
    case 'url':
      return isTaskUrl(task.url)
        ? ok(task)
        : refuse('INVALID_REPORT_TASK', `A url task's url is an absolute https URL of at most ${String(REPORT_TASK_URL_MAX_LENGTH)} characters`);
    case 'message':
      return isId(task.fleetId, 'fleet') && isId(task.messageId, 'message')
        ? ok(task)
        : refuse('INVALID_REPORT_TASK', "A message task's fleetId is a flt_ id and its messageId a msg_ id");
    default:
      return ok(task);
  }
}

function isTaskUrl(url: unknown): boolean {
  if (typeof url !== 'string' || url.length > REPORT_TASK_URL_MAX_LENGTH || !URL.canParse(url)) {
    return false;
  }
  return new URL(url).protocol === HTTPS;
}

/** Two tasks are the same task when their kind and every field are equal. */
export function isSameTask(first: ReportTask | null, second: ReportTask | null): boolean {
  return first === null || second === null ? first === second : isSameJson(first, second);
}
