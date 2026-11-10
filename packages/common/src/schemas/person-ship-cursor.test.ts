import { describe, expect, it } from 'vitest';

import { idSchema } from '../ids/index.js';
import { parsePersonShipCursor, personShipCursorOf, type PersonShipCursorRecord } from './person-ship-cursor.js';

const record: PersonShipCursorRecord = {
  version: 1,
  fleetId: idSchema('fleet').parse('flt_00000000000000000000000001'),
  section: 'discovery',
  actor: { kind: 'ship', id: idSchema('ship').parse('shp_00000000000000000000000001') },
  associatedShipId: idSchema('ship').parse('shp_00000000000000000000000001'),
  search: 'Καλημέρα %_\\',
  order: 'folded-name-id-v1',
  after: { name: 'καλημέρα', shipId: idSchema('ship').parse('shp_00000000000000000000000002') },
};

function encoded(value: unknown): string {
  return btoa(String.fromCharCode(...new TextEncoder().encode(JSON.stringify(value)))).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '');
}

describe('strict opaque person ship continuation record', () => {
  it('continues a valid long Unicode literal search without exceeding the JavaScript argument limit', () => {
    // Given a literal that can match a valid statement within the payload bound.
    const long = { ...record, search: '界'.repeat(60000) };
    // When its authorized page needs a continuation.
    const cursor = personShipCursorOf(long);
    // Then the full query binding survives without a service failure.
    expect(parsePersonShipCursor(cursor)).toEqual(long);
  });

  it('round trips the version, authenticated bindings and database ordering key including Unicode', () => {
    // Given a continuation record from an authorized last row.
    // When the core encodes and later validates it.
    const decoded = parsePersonShipCursor(personShipCursorOf(record));

    // Then every binding and the database key survives, without a snapshot version.
    expect(decoded).toEqual(record);
  });

  it.each([
    '', '%%%invalid', 'eyJmb28iOjF9', encoded(null), encoded([]),
    encoded({ ...record, version: 2 }), encoded({ ...record, section: 'reports' }),
    encoded({ ...record, order: 'another' }), encoded({ ...record, extra: true }),
    encoded({ ...record, after: { name: 'x', shipId: 'invalid' } }),
    encoded({ ...record, actor: { kind: 'ship', id: 'invalid' } }),
    encoded({ ...record, associatedShipId: undefined }),
    encoded({ ...record, fleetId: 'invalid' }),
  ])('refuses malformed or unrecognized record %j', (cursor) => {
    // Given a malformed continuation, never an authorization grant.
    // When it is decoded at the boundary.
    const decoded = parsePersonShipCursor(cursor);

    // Then no continuation position is trusted.
    expect(decoded).toBeUndefined();
  });
});
