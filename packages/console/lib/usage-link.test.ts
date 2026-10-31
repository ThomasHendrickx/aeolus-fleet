import { idSchema } from '@aeolus-fleet/common';
import { describe, expect, it } from 'vitest';

import { usageLinkOf } from './usage-link';

const shipId = idSchema('ship').parse('shp_01j9k2t4qzr3a9w6m2v5n7ma01');

describe('the link to the Usage page', () => {
  it('opens it filtered to a machine', () => {
    expect(usageLinkOf({ machine: shipId })).toBe(`/usage?machine=${shipId}`);
  });

  it('opens it filtered to a ship', () => {
    expect(usageLinkOf({ ship: shipId })).toBe(`/usage?ship=${shipId}`);
  });
});
