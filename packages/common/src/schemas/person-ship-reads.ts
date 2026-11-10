/** Narrow, bounded ship projections for independent messageable and readable pages. */
import { z } from 'zod';

import { shipKindSchema } from '../fleet/index.js';
import { idSchema } from '../ids/index.js';
import { HARBOUR_STATES } from '../rules/harbour.js';

export const PERSON_SHIP_PAGE_SIZE = 20;

const distinctShipIds = z.array(idSchema('ship')).max(PERSON_SHIP_PAGE_SIZE).refine((ids) => new Set(ids).size === ids.length, 'Ship ids must be distinct');

/** A page or a refresh of concerned resource ids, never a chosen permission subject. */
export const personShipPageInputSchema = z.union([
  z.strictObject({ search: z.string().optional(), cursor: z.string().nullable().optional() }),
  z.strictObject({ search: z.string().optional(), shipIds: distinctShipIds.refine((ids) => ids.length > 0, 'Name at least one ship') }),
]);
export type PersonShipPageInput = z.infer<typeof personShipPageInputSchema>;

export const personShipRowSchema = z.strictObject({ shipId: idSchema('ship'), name: z.string(), kind: shipKindSchema, description: z.string().nullable() });
export type PersonShipRow = z.infer<typeof personShipRowSchema>;

export const personShipReportSchema = z.discriminatedUnion('status', [
  z.strictObject({ status: z.literal('unavailable') }),
  z.strictObject({ status: z.literal('read'), state: z.enum(HARBOUR_STATES), note: z.string().nullable(), lastActivityAt: z.iso.datetime().nullable() }),
]);
export type PersonShipReport = z.infer<typeof personShipReportSchema>;

export const discoveryPageOutputSchema = z.strictObject({ rows: z.array(personShipRowSchema).max(PERSON_SHIP_PAGE_SIZE), nextCursor: z.string().nullable() });
export type DiscoveryPageOutput = z.infer<typeof discoveryPageOutputSchema>;

export const readableContextShipsOutputSchema = z.strictObject({
  rows: z.array(personShipRowSchema.extend({ report: personShipReportSchema })).max(PERSON_SHIP_PAGE_SIZE),
  nextCursor: z.string().nullable(),
});
export type ReadableContextShipsOutput = z.infer<typeof readableContextShipsOutputSchema>;

export const shipReportsInputSchema = z.strictObject({ shipIds: distinctShipIds });
export type ShipReportsInput = z.infer<typeof shipReportsInputSchema>;
export const shipReportsOutputSchema = z.strictObject({ rows: z.array(z.strictObject({ shipId: idSchema('ship'), report: personShipReportSchema })).max(PERSON_SHIP_PAGE_SIZE) });
export type ShipReportsOutput = z.infer<typeof shipReportsOutputSchema>;
