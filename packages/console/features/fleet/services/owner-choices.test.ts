import { idSchema } from '@aeolus-fleet/common';
import { describe, expect, it } from 'vitest';

import { ownerChoicesOf } from './owner-choices';

const burak = { id: idSchema('ship').parse('shp_01j9k2t4qzr3a9w6m2v5n7bk01'), name: 'burak', status: 'crewed' as const };
const charlotte = { id: idSchema('ship').parse('shp_01j9k2t4qzr3a9w6m2v5n7ch01'), name: 'charlotte', status: 'crewed' as const };
const retired = { id: idSchema('ship').parse('shp_01j9k2t4qzr3a9w6m2v5n7rt01'), name: 'old-timer', status: 'retired' as const };

describe('the person ships argo may name as owner', () => {
  it('offers the active person ships found', () => {
    expect(ownerChoicesOf([burak, retired, charlotte], undefined)).toEqual([
      { id: burak.id, name: 'burak' },
      { id: charlotte.id, name: 'charlotte' },
    ]);
  });

  it('keeps the owner argo named last offered when the page found does not hold it', () => {
    expect(ownerChoicesOf([burak], { id: charlotte.id, name: 'charlotte' })).toEqual([
      { id: burak.id, name: 'burak' },
      { id: charlotte.id, name: 'charlotte' },
    ]);
  });

  it('lists the owner argo named last once when the page holds it too', () => {
    expect(ownerChoicesOf([burak, charlotte], { id: charlotte.id, name: 'charlotte' })).toHaveLength(2);
  });

  it('offers the owner argo named last while the page is still being read', () => {
    expect(ownerChoicesOf(undefined, { id: charlotte.id, name: 'charlotte' })).toEqual([{ id: charlotte.id, name: 'charlotte' }]);
  });

  it('offers nothing before the page is read and no owner was named', () => {
    expect(ownerChoicesOf(undefined, undefined)).toBeUndefined();
  });
});
