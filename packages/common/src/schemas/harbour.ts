import { z } from 'zod';

import { shipKindSchema } from '../fleet/index.js';
import { idSchema } from '../ids/index.js';
import { HARBOUR_STATES } from '../rules/harbour.js';
import { shipCursorSchema } from './label.js';
import { pageInputOf } from './page.js';

/** The most ships a live reload of Harbour's tiles names at once. */
export const HARBOUR_SHIP_IDS_MAX = 100;

/**
 * Input of `fleet.harbour` (docs/design/fleet-overview, "The read Harbour
 * needs"): a page, its cursor and size; or the ships whose tiles a live
 * event reloads, never both. One object, so a client reads its pages as any
 * paged list.
 */
export const harbourInputSchema = pageInputOf(shipCursorSchema)
  .extend({ shipIds: z.array(idSchema('ship')).min(1).max(HARBOUR_SHIP_IDS_MAX).optional() })
  .refine((input) => input.shipIds === undefined || (input.cursor === undefined && input.limit === undefined), { message: 'Ask for shipIds or for a page, not both' })
  .optional();

export type HarbourInput = z.input<typeof harbourInputSchema>;

/** Output of `fleet.harbour`: each ship's tile, where the next page starts, and the numbers on a first page only. */
export const harbourOutputSchema = z.object({
  items: z.array(
    z.object({
      id: idSchema('ship'),
      name: z.string(),
      kind: shipKindSchema,
      state: z.enum(HARBOUR_STATES),
      /** What the ship is doing: its crew's report note; null before it reports or without a note. */
      note: z.string().nullable(),
    }),
  ),
  nextCursor: z.string().nullable(),
  counts: z.object({ ships: z.int().min(0), alert: z.int().min(0), waiting: z.int().min(0), working: z.int().min(0), idle: z.int().min(0) }).nullable(),
});

export type HarbourOutput = z.infer<typeof harbourOutputSchema>;
