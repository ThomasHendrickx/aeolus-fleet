import { z } from 'zod';

import { eventTypeSchema, fleetScopeSchema, locationKindSchema, scopeSchema, shipKindSchema, shipStatusSchema } from '../fleet/index.js';
import { idSchema } from '../ids/index.js';
import { SHIP_HANDLE_MAX_LENGTH, SHIP_HANDLE_MESSAGE, SHIP_HANDLE_PATTERN } from '../rules/ship-handle.js';
import { idempotencyKeySchema } from './idempotency-key.js';
import { listedCrewRequestSchema } from './crew-request.js';
import { carriedLabelSchema } from './label.js';
import { listedReportSchema } from './report.js';

/**
 * Inputs and outputs of the fleet procedures: commission a ship, get its
 * starting prompt, release it, list the fleet, follow its events live.
 */

export { SHIP_HANDLE_MAX_LENGTH, SHIP_HANDLE_PATTERN } from '../rules/ship-handle.js';

/** A ship's name or type, by the rule in rules/ship-handle.ts. */
export const shipHandleSchema = z
  .string()
  .max(SHIP_HANDLE_MAX_LENGTH, SHIP_HANDLE_MESSAGE)
  .regex(SHIP_HANDLE_PATTERN, SHIP_HANDLE_MESSAGE);

export const SHIP_NOTE_MAX_LENGTH = 500;

/**
 * Input of `fleet.commission`. The note is free text for the operator;
 * whitespace around it is dropped. `fleetScopes` adds fleet:read,
 * fleet:manage, crew:assign and/or crew:run to the scopes every agent ship has; none
 * when left out.
 * `idempotencyKey` is the caller's own key, as for a send: a retry with the
 * same key and the same request commissions no second ship.
 */
export const commissionShipInputSchema = z.object({
  name: shipHandleSchema,
  type: shipHandleSchema,
  fleetScopes: z.array(fleetScopeSchema).optional(),
  note: z
    .string()
    .trim()
    .max(SHIP_NOTE_MAX_LENGTH, `A note is at most ${SHIP_NOTE_MAX_LENGTH} characters`)
    .optional(),
  idempotencyKey: idempotencyKeySchema,
});

export type CommissionShipInput = z.infer<typeof commissionShipInputSchema>;

/** Input of `fleet.getStartingPrompt`. */
export const getStartingPromptInputSchema = z.object({ shipId: idSchema('ship') });

/**
 * One crew line: the starting prompt's identity in one line for a harness
 * with the aeolus plugin, `/aeolus:crew <fleetUrl> <shipId> <secret>` for
 * Claude Code, `$aeolus-crew <fleetUrl> <shipId> <secret>` for Codex.
 */
export const crewLineSchema = z.object({ harness: z.string(), line: z.string() });

export type CrewLine = z.infer<typeof crewLineSchema>;

/**
 * Output of `fleet.getStartingPrompt` and `fleet.recrew`: the starting
 * prompt, holding the ship's new secret, one crew line per harness, and the
 * secret itself, for a client that registers the ship for a session of its
 * own. Shown once; the secret is never readable again.
 */
export const startingPromptOutputSchema = z.object({
  shipId: idSchema('ship'),
  prompt: z.string(),
  crewLines: z.array(crewLineSchema),
  secret: z.string(),
});

export type StartingPromptOutput = z.infer<typeof startingPromptOutputSchema>;

/**
 * Output of `fleet.commission`: the ship, and on the first commission its
 * starting prompt, crew lines and secret, shown once. A repeat under the same key
 * answers neither (the secret is never readable again), and says how its
 * starting prompt stands; get a new one with `fleet.getStartingPrompt`.
 */
export const commissionShipOutputSchema = z.object({
  shipId: idSchema('ship'),
  prompt: z.string().nullable(),
  crewLines: z.array(crewLineSchema).nullable(),
  secret: z.string().nullable(),
  /** When its valid secret was issued (ISO 8601 in UTC) and whether a session claimed it; null when it has none. */
  startingPrompt: z.object({ issuedAt: z.iso.datetime(), isClaimed: z.boolean() }).nullable(),
});

export type CommissionShipOutput = z.infer<typeof commissionShipOutputSchema>;

/** Input of `fleet.release`: the crewed ship whose session loses it. */
export const releaseShipInputSchema = z.object({ shipId: idSchema('ship') });

export type ReleaseShipInput = z.infer<typeof releaseShipInputSchema>;

/** Output of `fleet.release`: nothing; the OK is the answer. */
export const releaseShipOutputSchema = z.strictObject({});

/** Input of `fleet.rename`: the ship and its new name, a handle as at commissioning. Never argo or a retired ship. */
export const renameShipInputSchema = z.object({ shipId: idSchema('ship'), name: shipHandleSchema });

/** Output of `fleet.rename`: nothing; the OK is the answer. */
export const renameShipOutputSchema = z.strictObject({});

/** Input of `fleet.retire`: the ship to end for good. Never argo. */
export const retireShipInputSchema = z.object({ shipId: idSchema('ship') });

/** Output of `fleet.retire`: how many of its direct deliveries it abandoned. */
export const retireShipOutputSchema = z.object({ abandonedDeliveries: z.int().min(0) });

/**
 * Input of `fleet.recrew`: a crewed ship whose session is gone. The answer is
 * a new starting prompt, as from `fleet.getStartingPrompt`.
 */
export const recrewShipInputSchema = z.object({ shipId: idSchema('ship') });

/**
 * How a ship's last ping stands: waiting for an answer, answered with pong,
 * received with a plain ack, or undeliverable: handed out again and again and
 * never acknowledged.
 */
export const PING_STATES = ['waiting', 'answered', 'received', 'undeliverable'] as const;

export const pingStateSchema = z.enum(PING_STATES);

export type PingState = z.infer<typeof pingStateSchema>;

/**
 * One ship in `fleet.list`. `startingPrompt` is the prompt holding the ship's
 * valid secret, when there is one: when it was issued and whether a session
 * has claimed the ship with it. `location` is where the session crewing the
 * ship runs, as it reported on claim, and `harness` what it runs in; both
 * null while no session crews it. `lastSeenAt` is its session's last call.
 * `model` is the ship's current model: the last one its sessions stated on a
 * send, with when; null before any.
 */
export const listedShipSchema = z.object({
  id: idSchema('ship'),
  name: z.string(),
  type: z.string(),
  /** `operator` for `argo`, `agent` for every other ship. */
  kind: shipKindSchema,
  status: shipStatusSchema,
  startingPrompt: z
    .object({
      /** ISO 8601 in UTC. */
      issuedAt: z.iso.datetime(),
      isClaimed: z.boolean(),
    })
    .nullable(),
  location: z
    .object({
      kind: locationKindSchema,
      /** Set for OTHER only. */
      description: z.string().nullable(),
    })
    .nullable(),
  /**
   * When the session crewing the ship last called the fleet (ISO 8601 in UTC):
   * observation only, nothing acts on it. Null while no session crews it.
   */
  lastSeenAt: z.iso.datetime().nullable(),
  /**
   * The ship's last ping (ISO 8601 in UTC): when argo sent it, how it stands,
   * and when pong answered it. Null before any ping, or once the operator
   * dismissed the last one. Observation only.
   */
  ping: z
    .object({
      state: pingStateSchema,
      sentAt: z.iso.datetime(),
      answeredAt: z.iso.datetime().nullable(),
    })
    .nullable(),
  /** The harness the crewing session stated, read together with `location`; null while none crews it. */
  harness: z.string().nullable(),
  /** The last model the ship's sessions stated on a send, and when (ISO 8601 in UTC); null before any, and for argo. */
  model: z.object({ id: z.string(), statedAt: z.iso.datetime() }).nullable(),
  /** What the ship may do, checked on every call: every agent ship sends and receives, argo has all. */
  scopes: z.array(scopeSchema),
  /**
   * The crew's last report (ISO 8601 in UTC): its state, its note, when it
   * last reported and the version of its details, never the details
   * themselves. Null until the crew reports, and for a ship no session crews.
   */
  report: listedReportSchema.nullable(),
  /** The ship's crew request (decision 0029); null when it holds none. */
  crewRequest: listedCrewRequestSchema.nullable(),
  /** The label values the ship carries, with their labels, by key then value (decision 0031). */
  labels: z.array(carriedLabelSchema),
  /** Since when the ship awaits crew (ISO 8601 in UTC): its commission, or the end of its last session. Null unless it awaits crew. */
  awaitingCrewSince: z.iso.datetime().nullable(),
  /** When the operator retired the ship (ISO 8601 in UTC); null while it is active. */
  retiredAt: z.iso.datetime().nullable(),
});

export type ListedShip = z.infer<typeof listedShipSchema>;

/** Output of `fleet.list`: every ship in the caller's fleet, `argo` included. */
export const fleetListOutputSchema = z.array(listedShipSchema);

/** Up to 15 digits: every number below 2^53, so it stays an exact JavaScript number. */
const STREAM_POSITION_PATTERN = /^\d{1,15}$/;

/**
 * Input of the `fleet.events` subscription: the number of the last event the
 * browser applied. tRPC sends it back as `lastEventId` when it reconnects;
 * none means the browser has not loaded the fleet yet.
 */
export const fleetEventsInputSchema = z.object({
  lastEventId: z.string().regex(STREAM_POSITION_PATTERN, 'A position is the number of an event').nullish(),
});

export type FleetEventsInput = z.infer<typeof fleetEventsInputSchema>;

/**
 * One committed event as the live fleet view hears it: its number in the
 * fleet's stream (commit order, without gaps), what happened and when, which
 * ship caused it, and which ship, message and delivery it concerns. Never its
 * details.
 */
export const liveFleetEventSchema = z.object({
  seq: z.number().int().positive(),
  id: idSchema('event'),
  type: eventTypeSchema,
  /** ISO 8601 in UTC. */
  occurredAt: z.iso.datetime(),
  /** The ship that caused it; null for the system. */
  actorShipId: idSchema('ship').nullable(),
  shipId: idSchema('ship').nullable(),
  messageId: idSchema('message').nullable(),
  deliveryId: idSchema('delivery').nullable(),
});

export type LiveFleetEvent = z.infer<typeof liveFleetEventSchema>;

/**
 * What the `fleet.events` subscription sends: the next event, or `resync`,
 * which tells the browser to load the fleet again and apply what follows.
 */
export const fleetStreamItemSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('event'), event: liveFleetEventSchema }),
  z.object({ kind: z.literal('resync') }),
]);

export type FleetStreamItem = z.infer<typeof fleetStreamItemSchema>;

/**
 * The calling fleet's ship and daily message limits, with what each counts:
 * its ships that are not retired (argo included), and the messages it stored
 * since 00:00 UTC, which count again from `resetsAt`. A limit of null is none.
 */
export const fleetLimitsOutputSchema = z.object({
  ships: z.object({ limit: z.int().min(0).nullable(), count: z.int().min(0) }),
  dailyMessages: z.object({ limit: z.int().min(0).nullable(), count: z.int().min(0), resetsAt: z.iso.datetime() }),
});

export type FleetLimitsOutput = z.infer<typeof fleetLimitsOutputSchema>;
