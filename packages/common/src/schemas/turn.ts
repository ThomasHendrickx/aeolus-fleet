import { z } from 'zod';

/**
 * The turn of a pushed ship's session as its hooks see it (decision 0040):
 * busy while a turn runs, idle between turns.
 */
export const TURN_STATES = ['idle', 'busy'] as const;
export const turnStateSchema = z.enum(TURN_STATES);
export type TurnState = z.infer<typeof turnStateSchema>;
