import { z } from 'zod';

import { shipStatusSchema } from '../fleet/index.js';
import { idSchema } from '../ids/index.js';

/**
 * Inputs and outputs of the fleet procedures: commission a ship, get its
 * starting prompt, list the fleet.
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
 * prompt, holding the ship's new secret. Shown once; the secret is never
 * readable again.
 */
export const startingPromptOutputSchema = z.object({
  shipId: idSchema('ship'),
  prompt: z.string(),
});

export type StartingPromptOutput = z.infer<typeof startingPromptOutputSchema>;

/**
 * One ship in `fleet.list`. `startingPrompt` is the prompt holding the ship's
 * valid secret, when there is one: when it was issued and whether a session
 * has claimed the ship with it.
 */
export const listedShipSchema = z.object({
  id: idSchema('ship'),
  name: z.string(),
  type: z.string(),
  status: shipStatusSchema,
  startingPrompt: z
    .object({
      /** ISO 8601 in UTC. */
      issuedAt: z.iso.datetime(),
      isClaimed: z.boolean(),
    })
    .nullable(),
});

export type ListedShip = z.infer<typeof listedShipSchema>;

/** Output of `fleet.list`: every ship in the caller's fleet, `argo` included. */
export const fleetListOutputSchema = z.array(listedShipSchema);
