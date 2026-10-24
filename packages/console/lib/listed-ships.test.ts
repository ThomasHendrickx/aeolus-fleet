import { idSchema, type ShipId } from '@aeolus-fleet/common';
import { describe, expect, it } from 'vitest';

import { SHIP_IDS_PER_READ, shipIdBatchesOf } from './listed-ships';

function shipId(index: number): ShipId {
  return idSchema('ship').parse(`shp_01m3tbfspe96yf1rnr4an${String(index).padStart(5, '0')}`);
}

describe('the reads of the ships a screen names', () => {
  it('asks each id once, sorted, so the same ids ask the same read', () => {
    expect(shipIdBatchesOf([shipId(2), shipId(1), shipId(2)])).toEqual([[shipId(1), shipId(2)]]);
  });

  it('asks at most 100 ids a read', () => {
    const batches = shipIdBatchesOf(Array.from({ length: SHIP_IDS_PER_READ + 1 }, (_, index) => shipId(index)));

    expect(batches.map((batch) => batch.length)).toEqual([100, 1]);
  });

  it('asks nothing for no id', () => {
    expect(shipIdBatchesOf([])).toEqual([]);
  });
});
