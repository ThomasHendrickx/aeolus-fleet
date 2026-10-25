import { z } from 'zod';

import { idSchema } from '../ids/index.js';
import { accountIdSchema } from './account-token.js';
import { OPERATOR_EMAIL_MAX_LENGTH } from './console.js';
import { healthOutputSchema } from './health.js';
import { idempotencyKeySchema } from './idempotency-key.js';

/**
 * The installation API (docs/architecture.md, "Installation"): what a service
 * hosting many fleets on one server, such as pagasae, calls with the
 * installation token. Create and delete take the caller's own request id, so
 * a replay answers what the first call answered.
 */

/** A limit as configured: a number, or null for no limit. Aeolus sets none of its own (decision 0016). */
const limitSchema = z.int().min(0).nullable();

/** How one of a fleet's limits is set: it follows the installation default, or is set for the fleet to a number or to no limit. */
export const fleetLimitSettingSchema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('default') }),
  z.strictObject({ kind: z.literal('fleet'), limit: limitSchema }),
]);

export type FleetLimitSetting = z.infer<typeof fleetLimitSettingSchema>;

const fleetLimitSchema = z.object({ setting: fleetLimitSettingSchema, applies: limitSchema });

/** A new fleet with its operator, who has no password: a hosted operator signs in another way. */
export const installationFleetsCreateInputSchema = z.strictObject({
  requestId: idempotencyKeySchema,
  name: z.string(),
  operatorEmail: z.string().trim().min(1).max(OPERATOR_EMAIL_MAX_LENGTH),
  /** Whether the fleet gets a viewer ship, its read-only door into the console (decision 0022); none when left out. */
  viewer: z.boolean().optional(),
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
  /** Every message stored since 00:00 UTC today. */
  messagesToday: z.int().min(0),
  /** The messages stored on each UTC day of the last 7, today last. */
  messagesPerDay: z.array(z.object({ date: z.iso.date(), count: z.int().min(0) })),
  /** How each limit is set and the limit that applies (null: none). */
  limits: z.object({ ships: fleetLimitSchema, dailyMessages: fleetLimitSchema, schedulesPerShip: fleetLimitSchema, minimumScheduleInterval: fleetLimitSchema }),
  /** Whether its deliveries reach their ships (#304). */
  health: z.object({
    /** When its oldest pending delivery was sent; null when none is pending. */
    oldestPendingAt: z.iso.datetime().nullable(),
    /** Since when its oldest delivery in flight (received or handed) is in its state; null when none is. */
    oldestInFlightAt: z.iso.datetime().nullable(),
    /** Pending deliveries to a type no active ship can take. */
    noShipCanTake: z.int().min(0),
    /** Undeliverable deliveries; not handled is execution (decision 0042). */
    needsAttention: z.int().min(0),
    /** Overdue deliveries argo was told of that still stand. */
    overdue: z.int().min(0),
    ...healthOutputSchema.shape,
  }),
});

export type InstallationFleet = z.infer<typeof installationFleetSchema>;

export const installationFleetsListOutputSchema = z.array(installationFleetSchema);

export const installationFleetsGetInputSchema = z.strictObject({ fleetId: idSchema('fleet') });

/** Deletes the fleet and everything in it, for good. */
export const installationFleetsDeleteInputSchema = z.strictObject({ requestId: idempotencyKeySchema, fleetId: idSchema('fleet') });

export const installationFleetsDeleteOutputSchema = z.strictObject({});

/** A one-time sign-in ticket for the fleet's operator: single use, valid 2 minutes, redeemed in the console. */
/** Whom a ticket signs in as: the operator when left out, or a viewer of a fleet with a viewer ship (decision 0022). */
export const installationOperatorsIssueSignInTicketInputSchema = z.strictObject({
  fleetId: idSchema('fleet'),
  as: z.enum(['operator', 'viewer']).optional(),
  /** The account it signs in as argo, by its id only: core never takes its email or name (decisions 0054, 0058). */
  account: z.strictObject({ id: accountIdSchema }).optional(),
});

export const installationOperatorsIssueSignInTicketOutputSchema = z.object({ ticket: z.string() });
/**
 * The installation's settings: the ship, daily message and schedule limits a
 * fleet follows unless set for it, and the cap on the number of fleets. Each
 * may be null: no limit.
 */
export const installationSettingsSchema = z.strictObject({
  defaultShipLimit: limitSchema,
  defaultDailyMessageLimit: limitSchema,
  /** The schedules a ship may hold active or paused (decision 0062). */
  defaultSchedulesPerShipLimit: limitSchema,
  /** The shortest time between two send times of a repeating schedule, in seconds (decision 0062). */
  defaultMinimumScheduleInterval: limitSchema,
  fleetCap: limitSchema,
});

export type InstallationSettings = z.infer<typeof installationSettingsSchema>;

/** A fleet's limits: how each is set, and the limit that applies (null: none). */
export const installationFleetLimitsSchema = z.object({
  fleetId: idSchema('fleet'),
  ships: fleetLimitSchema,
  dailyMessages: fleetLimitSchema,
  schedulesPerShip: fleetLimitSchema,
  minimumScheduleInterval: fleetLimitSchema,
});

/** Sets some of a fleet's limits; one left out keeps how it is set. */
export const installationFleetsSetLimitsInputSchema = z.strictObject({
  fleetId: idSchema('fleet'),
  ships: fleetLimitSettingSchema.optional(),
  dailyMessages: fleetLimitSettingSchema.optional(),
  schedulesPerShip: fleetLimitSettingSchema.optional(),
  /** In seconds. */
  minimumScheduleInterval: fleetLimitSettingSchema.optional(),
});

/**
 * Input of `installation.accounts.cutOff`: the account pagasae disabled, by
 * its id only; every token of it issued before now is refused in every
 * fleet of the installation until the longest has ended (decision 0058).
 */
export const installationAccountsCutOffInputSchema = z.strictObject({ accountId: accountIdSchema });
export const installationAccountsCutOffOutputSchema = z.strictObject({});

/**
 * Input of `installation.accounts.signOut`: the account that signed out in
 * the account app, by its id only; every console sign-in as argo it opened
 * ends in every fleet of the installation.
 */
export const installationAccountsSignOutInputSchema = z.strictObject({ accountId: accountIdSchema });
export const installationAccountsSignOutOutputSchema = z.strictObject({});
