import { ALERT_CONTENT_TYPE } from './alert.js';
import { essenceOf } from './content-type.js';
import { NOTICE_CONTENT_TYPE } from './notice-message.js';
import { ANSWER_CONTENT_TYPE, QUESTION_CONTENT_TYPE, REPLACEMENT_CONTENT_TYPE, WITHDRAWAL_CONTENT_TYPE } from './question.js';
import { STEP_CONTENT_TYPE, STEP_OUTCOME_CONTENT_TYPE, STEP_REPLACEMENT_CONTENT_TYPE, STEP_WITHDRAWAL_CONTENT_TYPE } from './step.js';

/** The conventions' content types, by essence; a query that tells them apart in SQL builds its list from this one. */
export const CONVENTION_CONTENT_TYPES: readonly string[] = [
  QUESTION_CONTENT_TYPE,
  ANSWER_CONTENT_TYPE,
  WITHDRAWAL_CONTENT_TYPE,
  REPLACEMENT_CONTENT_TYPE,
  STEP_CONTENT_TYPE,
  STEP_OUTCOME_CONTENT_TYPE,
  STEP_WITHDRAWAL_CONTENT_TYPE,
  STEP_REPLACEMENT_CONTENT_TYPE,
  ALERT_CONTENT_TYPE,
  NOTICE_CONTENT_TYPE,
];

/**
 * Whether a message is one of the conventions (decision 0038, the bridge
 * design): a question, a step, an alert or a notice, or a question's or a
 * step's withdrawal, replacement, answer or outcome. Each has its own way to
 * be done, so seen up to here leaves it as it is (docs/design/exchange-read,
 * E6) and retention keeps it as before (E8).
 */
export function isConventionContentType(contentType: string): boolean {
  return CONVENTION_CONTENT_TYPES.includes(essenceOf(contentType));
}
