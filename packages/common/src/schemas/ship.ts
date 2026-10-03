import { z } from 'zod';

import { idSchema } from '../ids/index.js';

/**
 * Inputs and outputs of the ship procedures: `register` claims a ship with its
 * secret and returns a crew token; `whoami` tells the caller which ship it is;
 * `deregister` ends the caller's own lease.
 */

/** The longest description an OTHER location carries, not counting whitespace around it. */
export const LOCATION_DESCRIPTION_MAX_LENGTH = 100;

/**
 * The longest ship secret `register` takes. A real one is much shorter; the
 * bound only keeps an absurd input from reaching the hash.
 */
export const SHIP_SECRET_MAX_LENGTH = 256;

/**
 * Where the session claiming a ship runs (docs/blueprint.md, "Location"):
 * DEVICE, CLOUD or SERVER, or OTHER with a short description. Stored with the
 * lease, never interpreted.
 */
export const locationSchema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.enum(['DEVICE', 'CLOUD', 'SERVER']) }),
  z.strictObject({
    kind: z.literal('OTHER'),
    description: z
      .string()
      .trim()
      .min(1, 'An OTHER location needs a description')
      .max(LOCATION_DESCRIPTION_MAX_LENGTH, `A description is at most ${LOCATION_DESCRIPTION_MAX_LENGTH} characters`),
  }),
]);

export type LocationInput = z.infer<typeof locationSchema>;

/** The harnesses the console names; any other is free text. */
export const KNOWN_HARNESSES = ['claude-code', 'claude-chat', 'codex'] as const;

/** The longest harness a session may state. */
export const HARNESS_MAX_LENGTH = 50;

/**
 * The harness a session runs in (docs/blueprint.md, "Harness"), such as
 * claude-code, claude-chat or codex: free text, trimmed and in lower case.
 * Stated once when the session crews the ship, read together with its
 * location; never interpreted.
 */
export const harnessSchema = z
  .string()
  .trim()
  .toLowerCase()
  .min(1, `A harness names what the session runs in, such as ${KNOWN_HARNESSES.join(', ')}`)
  .max(HARNESS_MAX_LENGTH, `A harness is at most ${String(HARNESS_MAX_LENGTH)} characters`);

/** Input of `ship.register`: the ship id and secret from the starting prompt, where the session runs and in which harness. */
export const registerInputSchema = z.object({
  shipId: idSchema('ship'),
  secret: z.string().min(1).max(SHIP_SECRET_MAX_LENGTH),
  location: locationSchema,
  harness: harnessSchema,
});

export type RegisterInput = z.infer<typeof registerInputSchema>;

/**
 * Output of `ship.register`: the crew token every later ship call carries
 * (ADR 0015). Returned once; only its hash is stored.
 */
export const registerOutputSchema = z.object({ crewToken: z.string() });

export type RegisterOutput = z.infer<typeof registerOutputSchema>;

/** Output of `ship.whoami`: the caller's ship. */
export const whoamiOutputSchema = z.object({
  shipId: idSchema('ship'),
  fleetId: idSchema('fleet'),
  name: z.string(),
  type: z.string(),
});

export type WhoamiOutput = z.infer<typeof whoamiOutputSchema>;

/** Output of `ship.deregister`: nothing; the OK is the answer. */
export const deregisterOutputSchema = z.strictObject({});
