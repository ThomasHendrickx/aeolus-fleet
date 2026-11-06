import { ALERT_CONTENT_TYPE } from './alert.js';
import { essenceOf } from './content-type.js';
import { isNoticeContentType } from './notice-message.js';
import { isAnswerContentType, isQuestionContentType, isReplacementContentType, isWithdrawalContentType } from './question.js';
import { isStepContentType, isStepOutcomeContentType, isStepReplacementContentType, isStepWithdrawalContentType } from './step.js';

/**
 * Whether a message is one of the conventions (decision 0038, the bridge
 * design): a question, a step, an alert or a notice, or a question's or a
 * step's withdrawal, replacement, answer or outcome. Each has its own way to
 * be done, so seen up to here leaves it as it is (docs/design/exchange-read,
 * E6) and retention keeps it as before (E8).
 */
export function isConventionContentType(contentType: string): boolean {
  return (
    isQuestionContentType(contentType) ||
    isAnswerContentType(contentType) ||
    isWithdrawalContentType(contentType) ||
    isReplacementContentType(contentType) ||
    isStepContentType(contentType) ||
    isStepOutcomeContentType(contentType) ||
    isStepWithdrawalContentType(contentType) ||
    isStepReplacementContentType(contentType) ||
    essenceOf(contentType) === ALERT_CONTENT_TYPE ||
    isNoticeContentType(contentType)
  );
}
