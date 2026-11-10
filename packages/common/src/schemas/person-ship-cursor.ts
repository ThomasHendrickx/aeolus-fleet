/** Strict continuation records bind current reads to their authenticated identity and query. */
import { z } from 'zod';

import { idSchema } from '../ids/index.js';
import { accountIdSchema } from './account-token.js';

const actorSchema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('ship'), id: idSchema('ship') }),
  z.strictObject({ kind: z.literal('account'), id: accountIdSchema }),
  z.strictObject({ kind: z.literal('installation') }),
]);

export const personShipCursorRecordSchema = z.strictObject({
  version: z.literal(1),
  fleetId: idSchema('fleet'),
  section: z.enum(['discovery', 'readableContext']),
  actor: actorSchema,
  associatedShipId: idSchema('ship').nullable(),
  search: z.string(),
  order: z.literal('folded-name-id-v1'),
  after: z.strictObject({ name: z.string(), shipId: idSchema('ship') }),
});
export type PersonShipCursorRecord = z.infer<typeof personShipCursorRecordSchema>;

function base64url(binary: string): string {
  return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '');
}

export function personShipCursorOf(record: PersonShipCursorRecord): string {
  const bytes = new TextEncoder().encode(JSON.stringify(record));
  return base64url(String.fromCharCode(...bytes));
}

/** Invalid encodings and unknown record fields never provide a continuation key. */
export function parsePersonShipCursor(cursor: string): PersonShipCursorRecord | undefined {
  if (!/^[A-Za-z0-9_-]+$/.test(cursor)) {
    return undefined;
  }
  try {
    const binary = atob(cursor.replaceAll('-', '+').replaceAll('_', '/'));
    if (base64url(binary) !== cursor) {
      return undefined;
    }
    const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
    const value: unknown = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
    const parsed = personShipCursorRecordSchema.safeParse(value);
    return parsed.success ? parsed.data : undefined;
  } catch {
    return undefined;
  }
}
