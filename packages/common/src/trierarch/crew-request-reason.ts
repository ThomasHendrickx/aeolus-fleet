import { z } from 'zod';

import { idSchema } from '../ids/index.js';
import { CREW_REQUEST_REASON_MAX_LENGTH } from '../schemas/crew-request.js';

/** The content type of the message that tells a requester why its crew request waits. */
export const CREW_REQUEST_REASON_CONTENT_TYPE = 'application/vnd.aeolus.trierarch.crew-request-reason+json';

const REASON_MESSAGE = `A reason is one line of at most ${String(CREW_REQUEST_REASON_MAX_LENGTH)} characters`;

/**
 * Why a crew request waits, as the trierarch plugin's ship tells the ship
 * that made it (the trierarch plugin's docs/design/enabled-models-for-ships.md,
 * R4): the ship of the request by id and name, the settings version the
 * reason is for, and the reason placement wrote, one line as on the request.
 */
export const crewRequestReasonMessageSchema = z.strictObject({
  shipId: idSchema('ship'),
  shipName: z.string().min(1),
  settingsVersion: z.int().min(1),
  reason: z
    .string()
    .min(1, REASON_MESSAGE)
    .max(CREW_REQUEST_REASON_MAX_LENGTH, REASON_MESSAGE)
    .refine((reason) => !/[\r\n]/.test(reason), REASON_MESSAGE),
});

export type CrewRequestReasonMessage = z.infer<typeof crewRequestReasonMessageSchema>;
