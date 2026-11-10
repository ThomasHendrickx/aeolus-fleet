import { describe, expect, it } from 'vitest';

import { personShipPageInputSchema, shipReportsInputSchema } from './person-ship-reads.js';

const first = 'shp_00000000000000000000000001';
const second = 'shp_00000000000000000000000002';

describe('bounded person ship read requests', () => {
  it('accepts independent first pages, continuation and concerned-id refresh', () => {
    // Given the approved alternatives, with core normalizing search later.
    const requests = [{}, { search: '  X%_\\  ', cursor: null }, { cursor: 'opaque' }, { search: 'X', shipIds: [first, second] }];

    // When requests enter the shared contract.
    const parsed = requests.map((request) => personShipPageInputSchema.safeParse(request).success);

    // Then each approved request shape is accepted.
    expect(parsed).toEqual([true, true, true, true]);
  });

  it.each([
    { limit: 100 }, { accountId: 'someone' }, { fleetId: 'another' },
    { personShipId: first }, { shipIds: [] }, { shipIds: [first, first] },
    { shipIds: [first], cursor: null }, { status: 'retired' },
    { shipIds: Array.from({ length: 21 }, (_, index) => `shp_${String(index).padStart(26, '0')}`) },
  ])('rejects widened or ambiguous page request %j', (request) => {
    // Given an unapproved filter, subject, duplicate or oversized refresh.
    // When the request enters the API contract.
    const parsed = personShipPageInputSchema.safeParse(request);

    // Then no widening enters the use case.
    expect(parsed.success).toBe(false);
  });

  it('allows an empty report batch but refuses duplicates, unknown fields and more than 20 ids', () => {
    // Given bounded resource ids, never permission subjects.
    const requests = [{ shipIds: [] }, { shipIds: [first, second] }, { shipIds: [first, first] }, { shipIds: [first], scopes: ['fleet:read'] },
      { shipIds: Array.from({ length: 21 }, (_, index) => `shp_${String(index).padStart(26, '0')}`) }];

    // When report batches enter the contract.
    const parsed = requests.map((request) => shipReportsInputSchema.safeParse(request).success);

    // Then empty and bounded distinct batches alone are valid.
    expect(parsed).toEqual([true, true, false, false, false]);
  });
});
