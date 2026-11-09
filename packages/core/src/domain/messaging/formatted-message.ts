import { isQuestionContentType, isStepContentType, questionSchema, stepSchema } from '@aeolus-fleet/common';

import { refuse, type DomainError } from '../shared/errors.js';
import { ok, type Result } from '../shared/result.js';

/** Checks only the declared format on plaintext, without rewriting it or consulting message history. */
export function checkFormattedMessage(message: { contentType: string; payload: string }): Result<undefined, DomainError<'INVALID_FORMATTED_MESSAGE'>> {
  const format = isQuestionContentType(message.contentType) ? { kind: 'question', schema: questionSchema }
    : isStepContentType(message.contentType) ? { kind: 'step', schema: stepSchema }
      : undefined;
  if (format === undefined) {
    return ok(undefined);
  }
  let value: unknown;
  try {
    value = JSON.parse(message.payload);
  } catch {
    return refuse('INVALID_FORMATTED_MESSAGE', `${format.kind}: Invalid JSON; supply a valid JSON payload`);
  }
  const checked = format.schema.safeParse(value);
  if (!checked.success) {
    const problems = checked.error.issues.map((issue) => `${format.kind}${issue.path.length === 0 ? '' : `.${issue.path.join('.')}`}: ${issue.message}`);
    return refuse('INVALID_FORMATTED_MESSAGE', problems.join('; '));
  }
  return ok(undefined);
}
