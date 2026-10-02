import { z } from 'zod';

import { eventTypeSchema, locationKindSchema, shipKindSchema, shipStatusSchema } from '../fleet/index.js';
import { idSchema } from '../ids/index.js';

/**
 * Inputs and outputs of the fleet procedures: commission a ship, get its
 * starting prompt, release it, list the fleet, follow its events live.
 */

/** A ship's name and its type are handles (docs/blueprint.md, "Ship"). */
export const SHIP_HANDLE_MAX_LENGTH = 48;
export const SHIP_HANDLE_PATTERN = /^[a-z0-9-]+$/;
const HANDLE_MESSAGE = `Use 1 to ${SHIP_HANDLE_MAX_LENGTH} lowercase letters, digits or hyphens`;

export const shipHandleSchema = z
  .string()
  .max(SHIP_HANDLE_MAX_LENGTH, HANDLE_MESSAGE)
  .regex(SHIP_HANDLE_PATTERN, HANDLE_MESSAGE);

export const SHIP_NOTE_MAX_LENGTH = 500;

/** Input of `fleet.commission`. The note is free text for the operator; whitespace around it is dropped. */
export const commissionShipInputSchema = z.object({
  name: shipHandleSchema,
  type: shipHandleSchema,
  note: z
    .string()
    .trim()
    .max(SHIP_NOTE_MAX_LENGTH, `A note is at most ${SHIP_NOTE_MAX_LENGTH} characters`)
    .optional(),
});

export type CommissionShipInput = z.infer<typeof commissionShipInputSchema>;

/** Input of `fleet.getStartingPrompt`. */
export const getStartingPromptInputSchema = z.object({ shipId: idSchema('ship') });

/**
 * Output of `fleet.commission` and `fleet.getStartingPrompt`: the starting
 * prompt, holding the ship's new secret, and the crew line, the same in one
 * line for a Claude Code session with the aeolus plugin. Shown once; the
 * secret is never readable again.
 */
export const startingPromptOutputSchema = z.object({
  shipId: idSchema('ship'),
  prompt: z.string(),
  /** `/aeolus:crew <fleetUrl> <shipId> <secret>`. */
  crewLine: z.string(),
});

export type StartingPromptOutput = z.infer<typeof startingPromptOutputSchema>;

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

/** How a ship's last ping stands: waiting for an answer, answered with pong, or received with a plain ack. */
export const PING_STATES = ['waiting', 'answered', 'received'] as const;

export const pingStateSchema = z.enum(PING_STATES);

export type PingState = z.infer<typeof pingStateSchema>;

/**
 * One ship in `fleet.list`. `startingPrompt` is the prompt holding the ship's
 * valid secret, when there is one: when it was issued and whether a session
 * has claimed the ship with it. `location` is where the session crewing the
 * ship runs, as it reported on claim; null while no session crews it.
 * `lastSeenAt` is its session's last call.
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
   * and when pong answered it. Null before any ping, or when the last one went
   * undeliverable. Observation only.
   */
  ping: z
    .object({
      state: pingStateSchema,
      sentAt: z.iso.datetime(),
      answeredAt: z.iso.datetime().nullable(),
    })
    .nullable(),
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
