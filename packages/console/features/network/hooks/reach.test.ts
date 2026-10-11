import { createIdGenerator } from '@aeolus-fleet/common';
import { describe, expect, it } from 'vitest';

import { networkPathOf } from './reach';

const newId = createIdGenerator();

describe("Network's path", () => {
  it('is /network while no ship is picked', () => {
    expect(networkPathOf(undefined)).toBe('/network');
  });

  it('carries the picked ship as reach', () => {
    const shipId = newId('ship');

    expect(networkPathOf(shipId)).toBe(`/network?reach=${shipId}`);
  });
});
