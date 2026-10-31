import { z } from 'zod';

import { idSchema } from '../ids/index.js';
import { accountIdSchema } from './account-token.js';
import { reportTaskSchema } from './report.js';

/**
 * Expectations on a ship (decision 0071, docs/design/monitoring 4.7): what
 * its owner, or a ship the fleet's rules let manage it, expects of it,
 * standing, at most one of each. Core holds them and compares nothing; the
 * watch compares them with the ship's report and tells.
 */

/** The fewest minutes "report changes within" may expect. */
export const REPORT_CHANGES_WITHIN_MIN_MINUTES = 5;

/** The most minutes "report changes within" may expect: a week. */
export const REPORT_CHANGES_WITHIN_MAX_MINUTES = 10_080;

/** Minutes within which the report is expected to change, while it says working or blocked. */
export const reportChangesWithinMinutesSchema = z.int().min(REPORT_CHANGES_WITHIN_MIN_MINUTES).max(REPORT_CHANGES_WITHIN_MAX_MINUTES);

/**
 * Input of `fleet.setExpectations` (fleet:manage, manage reach on the ship):
 * `reportChangesWithin` in minutes, and `taskDoneBy`, the task it is set for
 * and the time it is expected done by. Left out, one stays as it is; null
 * clears it.
 */
export const setExpectationsInputSchema = z.object({
  shipId: idSchema('ship'),
  reportChangesWithin: reportChangesWithinMinutesSchema.nullable().optional(),
  taskDoneBy: z.object({ task: reportTaskSchema, doneBy: z.iso.datetime({ offset: true }) }).nullable().optional(),
});

export type SetExpectationsInput = z.infer<typeof setExpectationsInputSchema>;

/** Output of `fleet.setExpectations`: nothing; read them back with the ship (`fleet.ship`). */
export const setExpectationsOutputSchema = z.strictObject({});

/** Who set an expectation, as decision 0057 names an actor: an account by its id only. */
export const expectationSetterSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('ship'), shipId: idSchema('ship') }),
  z.object({ kind: z.literal('account'), accountId: accountIdSchema }),
  z.object({ kind: z.literal('installation') }),
]);

export type ExpectationSetter = z.infer<typeof expectationSetterSchema>;

/** A ship's expectations as `fleet.ship` reads them back (ISO 8601 in UTC): each with who set it and when; null while not set. */
export const expectationsSchema = z.object({
  reportChangesWithin: z.object({ minutes: z.int(), setBy: expectationSetterSchema, setAt: z.iso.datetime() }).nullable(),
  taskDoneBy: z.object({ task: reportTaskSchema, doneBy: z.iso.datetime(), setBy: expectationSetterSchema, setAt: z.iso.datetime() }).nullable(),
});

export type ExpectationsOutput = z.infer<typeof expectationsSchema>;
