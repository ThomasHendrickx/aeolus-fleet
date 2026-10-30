import { REPORT_STEP_MAX, type ReportStep } from '@aeolus-fleet/common';

import { refuse, type DomainError } from '../shared/errors.js';
import { ok, type Result } from '../shared/result.js';

export type ReportStepRefusal = DomainError<'INVALID_REPORT_STEP'>;

/** A report's step, step `at` of `of`, once it holds: whole numbers with 1 <= at <= of <= 1000. */
export function reportStep(step: ReportStep): Result<ReportStep, ReportStepRefusal> {
  const { at, of } = step;
  if (!Number.isInteger(at) || !Number.isInteger(of) || at < 1 || at > of || of > REPORT_STEP_MAX) {
    return refuse('INVALID_REPORT_STEP', `A step is at of of, whole numbers with 1 <= at <= of <= ${String(REPORT_STEP_MAX)}`);
  }
  return ok({ at, of });
}

/** Two steps are the same when both their numbers are. */
export function isSameStep(first: ReportStep | null, second: ReportStep | null): boolean {
  return first === null || second === null ? first === second : first.at === second.at && first.of === second.of;
}
