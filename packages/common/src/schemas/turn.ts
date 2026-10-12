import { z } from 'zod';

/**
 * The turn of a pushed ship's session as its hooks see it (decision 0040):
 * busy while a turn runs, idle between turns.
 */
export const TURN_STATES = ['idle', 'busy'] as const;
export const turnStateSchema = z.enum(TURN_STATES);
export type TurnState = z.infer<typeof turnStateSchema>;

/**
 * Input of `ship.turn`: the turn, and the time the hook saw it, in ISO 8601,
 * so a report sent again later keeps its own time.
 */
export const turnInputSchema = z.object({ turn: turnStateSchema, at: z.iso.datetime() });

export type TurnInput = z.infer<typeof turnInputSchema>;

/** Output of `ship.turn`: nothing; the OK is the answer. */
export const turnOutputSchema = z.strictObject({});

export type TurnOutput = z.infer<typeof turnOutputSchema>;
