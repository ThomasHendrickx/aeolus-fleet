import { z } from 'zod';

import { idSchema } from '../ids/index.js';
import { payloadBytes } from '../rules/payload.js';
import { pageInputOf, pageOutputOf } from './page.js';
import { reportTaskSchema } from './report.js';

/**
 * Alerts (decision 0071, docs/design/monitoring 4.4, 4.5 and 4.9): the watch
 * raises one in core per occurrence of a signal on a ship, then sends the
 * owner's ship the alert message. Core holds the alert and never speaks for
 * a ship; the message is the watch's. Both read the signal and its facts
 * from here.
 */

/** The content type of the alert message the watch sends (4.9). */
export const ALERT_CONTENT_TYPE = 'application/vnd.aeolus.alert+json';

/** What parted (4.4): the four distribution signals, then the two expectations. */
export const ALERT_SIGNALS = ['crew-request-unassigned', 'delivery-unacknowledged', 'delivery-overdue', 'ping-unanswered', 'report-unchanged', 'task-not-done'] as const;
export const alertSignalSchema = z.enum(ALERT_SIGNALS);
export type AlertSignal = z.infer<typeof alertSignalSchema>;

/** The longest headline an alert message carries: an inbox shows it first (instruction 6). */
export const ALERT_HEADLINE_MAX_LENGTH = 80;
/** The most bytes an alert message's markdown body takes. */
export const ALERT_BODY_MAX_BYTES = 2 * 1024;
/** The most bytes a whole alert message payload takes, as JSON. */
export const ALERT_PAYLOAD_MAX_BYTES = 8 * 1024;
/** The longest occurrence key a raise names (4.4: a delivery id, a version, a time). */
export const ALERT_OCCURRENCE_KEY_MAX_LENGTH = 200;

const isoTime = z.iso.datetime({ offset: true });
const minutesSchema = z.int().min(1);

/** The facts at raise of each signal (4.9). */
const crewRequestUnassignedFactsSchema = z.strictObject({ settingsVersion: z.int().min(1), minutes: minutesSchema, reason: z.string().nullable() });
const deliveryUnacknowledgedFactsSchema = z.strictObject({
  deliveryId: idSchema('delivery'),
  messageId: idSchema('message'),
  state: z.enum(['pending', 'received', 'handed']),
  awaitingCrew: z.boolean(),
  minutes: minutesSchema,
});
const deliveryOverdueFactsSchema = z.strictObject({ deliveryId: idSchema('delivery'), messageId: idSchema('message'), overdueEventId: idSchema('event') });
const pingUnansweredFactsSchema = z.strictObject({ deliveryId: idSchema('delivery'), messageId: idSchema('message'), minutes: minutesSchema });
const reportUnchangedFactsSchema = z.strictObject({ reportChangedAt: isoTime, state: z.enum(['working', 'blocked']), minutes: minutesSchema, setBy: idSchema('ship') });
const taskNotDoneFactsSchema = z.strictObject({ task: reportTaskSchema, doneBy: isoTime, setBy: idSchema('ship') });

const alertFactsBySignal = [
  z.object({ signal: z.literal('crew-request-unassigned'), facts: crewRequestUnassignedFactsSchema }),
  z.object({ signal: z.literal('delivery-unacknowledged'), facts: deliveryUnacknowledgedFactsSchema }),
  z.object({ signal: z.literal('delivery-overdue'), facts: deliveryOverdueFactsSchema }),
  z.object({ signal: z.literal('ping-unanswered'), facts: pingUnansweredFactsSchema }),
  z.object({ signal: z.literal('report-unchanged'), facts: reportUnchangedFactsSchema }),
  z.object({ signal: z.literal('task-not-done'), facts: taskNotDoneFactsSchema }),
] as const;

/** A signal with its facts at raise. */
export const alertSignalFactsSchema = z.discriminatedUnion('signal', alertFactsBySignal);
export type AlertSignalFacts = z.infer<typeof alertSignalFactsSchema>;

/**
 * The alert message's payload (4.9): the alert in core, the line an inbox
 * shows first and the facts in words, the signal with its facts at raise,
 * the ship, its fleet, and why this recipient is told.
 */
export const alertMessageSchema = z
  .intersection(
    z.object({
      alertId: idSchema('alert'),
      headline: z.string().min(1).max(ALERT_HEADLINE_MAX_LENGTH),
      body: z.string().refine((body) => payloadBytes(body) <= ALERT_BODY_MAX_BYTES, `A body is at most ${String(ALERT_BODY_MAX_BYTES)} bytes`),
      ship: z.object({ id: idSchema('ship'), name: z.string() }),
      fleetId: idSchema('fleet'),
      toldAs: z.enum(['owner', 'setter']),
      since: isoTime,
      raisedAt: isoTime,
    }),
    alertSignalFactsSchema,
  )
  .refine((message) => payloadBytes(JSON.stringify(message)) <= ALERT_PAYLOAD_MAX_BYTES, `An alert message is at most ${String(ALERT_PAYLOAD_MAX_BYTES)} bytes`);

export type AlertMessage = z.infer<typeof alertMessageSchema>;

/**
 * Input of `fleet.raiseAlert` (fleet:alert, 4.5): the ship, the signal and
 * its facts at raise, the occurrence key the alert is unique by, and since
 * when the fact parted.
 */
export const raiseAlertInputSchema = z
  .object({
    shipId: idSchema('ship'),
    signal: alertSignalSchema,
    facts: z.union([
      crewRequestUnassignedFactsSchema,
      deliveryUnacknowledgedFactsSchema,
      deliveryOverdueFactsSchema,
      pingUnansweredFactsSchema,
      reportUnchangedFactsSchema,
      taskNotDoneFactsSchema,
    ]),
    occurrenceKey: z.string().min(1).max(ALERT_OCCURRENCE_KEY_MAX_LENGTH),
    since: isoTime,
  })
  // One object for the doors' JSON Schema; the facts must be the signal's.
  .transform(({ shipId, signal, facts, occurrenceKey, since }, context) => {
    const signalFacts = alertSignalFactsSchema.safeParse({ signal, facts });
    if (!signalFacts.success) {
      context.addIssue({ code: 'custom', message: "The facts are not the signal's", path: ['facts'] });
      return z.NEVER;
    }
    return { shipId, occurrenceKey, since, ...signalFacts.data };
  });

export type RaiseAlertInput = z.infer<typeof raiseAlertInputSchema>;

/** Input of `fleet.clearAlert` (fleet:alert): the alert to clear. */
export const clearAlertInputSchema = z.object({ alertId: idSchema('alert') });

/** Why an alert cleared: its fact moved back, as the watch saw, or its ship retired. */
export const ALERT_CLEARED_WHYS = ['cleared', 'retired'] as const;
export const alertClearedWhySchema = z.enum(ALERT_CLEARED_WHYS);
export type AlertClearedWhy = z.infer<typeof alertClearedWhySchema>;

/**
 * An alert as core holds it: the ship, the signal and its facts at raise,
 * the occurrence key, the owner told (the ship's owner at raise), since when
 * the fact parted, when it was raised, and when and why it cleared, null
 * while it is open.
 */
export const alertSchema = z.intersection(
  z.object({
    id: idSchema('alert'),
    ship: z.object({ id: idSchema('ship'), name: z.string() }),
    occurrenceKey: z.string(),
    ownerShipId: idSchema('ship').nullable(),
    since: z.iso.datetime(),
    raisedAt: z.iso.datetime(),
    cleared: z.object({ at: z.iso.datetime(), why: alertClearedWhySchema }).nullable(),
  }),
  alertSignalFactsSchema,
);

export type AlertOutput = z.infer<typeof alertSchema>;

/** Output of `fleet.raiseAlert` and `fleet.clearAlert`: the alert as core holds it now. */
export const alertOutputSchema = alertSchema;

/** Input of `fleet.openAlerts` (fleet:read): the cursor and size of a page. */
export const openAlertsInputSchema = pageInputOf(idSchema('alert')).optional();

/** Output of `fleet.openAlerts`: a page of the fleet's open alerts on the ships the caller reads, newest first. */
export const openAlertsOutputSchema = pageOutputOf(alertSchema, idSchema('alert'));
