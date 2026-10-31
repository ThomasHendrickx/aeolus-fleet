import { describe, expect, it } from 'vitest';

import { idSchema } from '@aeolus-fleet/common';

import { machinesSendingNoUsage } from './silent-machines';

const shipId = (suffix: string) => idSchema('ship').parse(`shp_01j9k2t4qzr3a9w6m2v5n7${suffix}`);
const MAC = { shipId: shipId('ma01'), name: 'trierarch-mac' };
const MACBOOK = { shipId: shipId('ma02'), name: 'trierarch-macbook' };

describe('machines sending no usage', () => {
  it('names a machine the trierarch plugin lists that has no usage in the range', () => {
    const values = { values: [{ value: MAC.shipId, name: 'trierarch-mac', tokens: 1000 }], nextCursor: null };

    expect(machinesSendingNoUsage([MAC, MACBOOK], values)).toEqual(['trierarch-macbook']);
  });

  it('names none when every machine has usage', () => {
    const values = {
      values: [
        { value: MAC.shipId, name: 'trierarch-mac', tokens: 1000 },
        { value: MACBOOK.shipId, name: 'trierarch-macbook', tokens: 5 },
      ],
      nextCursor: null,
    };

    expect(machinesSendingNoUsage([MAC, MACBOOK], values)).toEqual([]);
  });

  it('names every machine when the range has no usage at all', () => {
    expect(machinesSendingNoUsage([MAC, MACBOOK], { values: [], nextCursor: null })).toEqual(['trierarch-mac', 'trierarch-macbook']);
  });

  it('names none while the machines or their usage are not read', () => {
    const values = { values: [], nextCursor: null };

    expect([machinesSendingNoUsage(undefined, values), machinesSendingNoUsage([MAC], undefined)]).toEqual([[], []]);
  });

  it('names none while more machines with usage wait on a later page, as a machine there may have usage', () => {
    const values = { values: [{ value: MAC.shipId, name: 'trierarch-mac', tokens: 1000 }], nextCursor: 'next' };

    expect(machinesSendingNoUsage([MAC, MACBOOK], values)).toEqual([]);
  });
});
