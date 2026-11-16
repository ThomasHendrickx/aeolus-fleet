/** Plugin-agnostic synchronous dispatch: authority travels only in server context. */
import { z } from 'zod';

import { scopeNameSchema } from '../fleet/index.js';
import { idSchema } from '../ids/index.js';
import { PAYLOAD_MAX_BYTES, payloadBytes } from '../rules/payload.js';
import { accountIdSchema } from './account-token.js';

export const callPluginInputSchema = z.strictObject({
  pluginShipId: idSchema('ship'),
  procedure: z.string().min(1),
  input: z.json(),
}).refine((value) => payloadBytes(JSON.stringify(value)) <= PAYLOAD_MAX_BYTES, 'Plugin call exceeds 256 KB');

export type CallPluginInput = z.infer<typeof callPluginInputSchema>;

/** Exactly actorOf(caller), excluding system and every original credential. */
export const pluginActorSchema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('ship'), shipId: idSchema('ship'), signedInAccountId: accountIdSchema.optional() }),
  z.strictObject({ kind: z.literal('account'), accountId: accountIdSchema, throughShipId: idSchema('ship').nullable() }),
  z.strictObject({ kind: z.literal('installation') }),
]);

export const pluginCallContextSchema = z.strictObject({
  requestId: z.uuid(),
  fleetId: idSchema('fleet'),
  pluginShipId: idSchema('ship'),
  actor: pluginActorSchema,
  scopes: z.array(scopeNameSchema),
  procedure: z.string().min(1),
  input: z.json(),
  expiresAt: z.iso.datetime(),
});
export type PluginCallContext = z.infer<typeof pluginCallContextSchema>;

export const pluginRefusalCodeSchema = z.enum(['UNAUTHORIZED', 'FORBIDDEN', 'NOT_FOUND', 'PRECONDITION_FAILED', 'BAD_REQUEST', 'CONFLICT', 'BAD_GATEWAY', 'TIMEOUT', 'INTERNAL_SERVER_ERROR']);
export type PluginRefusalCode = z.infer<typeof pluginRefusalCodeSchema>;

/** tRPC data/error shape, with no upstream diagnostic admitted by core. */
export const pluginCallAnswerSchema = z.union([
  z.strictObject({ result: z.strictObject({ data: z.json() }) }),
  z.strictObject({ error: z.strictObject({ data: z.strictObject({ code: pluginRefusalCodeSchema }) }) }),
]);
export const callPluginOutputSchema = z.json();
export type PluginCallData = z.infer<typeof callPluginOutputSchema>;
