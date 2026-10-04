import { z } from 'zod';

import { idSchema } from '../ids/index.js';
import { OPERATOR_EMAIL_MAX_LENGTH } from './console.js';
import { idempotencyKeySchema } from './idempotency-key.js';

/**
 * The installation API (docs/architecture.md, "Installation"): what a service
 * hosting many fleets on one server, such as pagasae, calls with the
 * installation token. Create and delete take the caller's own request id, so
 * a replay answers what the first call answered.
 */

/** A new fleet with its operator, who has no password: a hosted operator signs in another way. */
export const installationFleetsCreateInputSchema = z.strictObject({
  requestId: idempotencyKeySchema,
  name: z.string(),
  operatorEmail: z.string().trim().min(1).max(OPERATOR_EMAIL_MAX_LENGTH),
});

export const installationFleetsCreateOutputSchema = z.object({
  fleetId: idSchema('fleet'),
  operatorShipId: idSchema('ship'),
});

/**
 * One fleet as the installation sees it: its operator, when it was created,
 * and its four measures (docs/architecture.md, "Installation"): ships, the
 * ones not retired, argo included; messages, every one stored in the last 7
 * days; last activity, the time of its newest event (null before any); and
 * storage, the UTF-8 bytes of every payload it ever stored.
 */
export const installationFleetSchema = z.object({
  fleetId: idSchema('fleet'),
  name: z.string(),
  operatorEmail: z.string(),
  createdAt: z.iso.datetime(),
  shipCount: z.int().min(0),
  messagesLast7Days: z.int().min(0),
  lastActivityAt: z.iso.datetime().nullable(),
  storage: z.int().min(0),
});

export type InstallationFleet = z.infer<typeof installationFleetSchema>;

export const installationFleetsListOutputSchema = z.array(installationFleetSchema);

export const installationFleetsGetInputSchema = z.strictObject({ fleetId: idSchema('fleet') });

/** Deletes the fleet and everything in it, for good. */
export const installationFleetsDeleteInputSchema = z.strictObject({ requestId: idempotencyKeySchema, fleetId: idSchema('fleet') });

export const installationFleetsDeleteOutputSchema = z.strictObject({});
