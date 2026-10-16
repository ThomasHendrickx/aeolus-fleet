import { createIdGenerator } from '@aeolus-fleet/common';
import { describe, expect, it } from 'vitest';

import { questionDeliveryIdsOf } from './questions';

const newId = createIdGenerator();

describe('questionDeliveryIdsOf', () => {
  it('names the deliveries of the questions and of the withdrawals that made one stale, which the inbox leaves out', () => {
    const [asked, withdrawal, replacement, replaced] = [newId('delivery'), newId('delivery'), newId('delivery'), newId('delivery')];
    const questions = [
      { deliveryId: asked, stale: { kind: 'withdrawn' as const, deliveryId: withdrawal } },
      { deliveryId: replacement, stale: null },
      { deliveryId: replaced, stale: { kind: 'replaced' as const, deliveryId: replacement } },
    ];

    expect(questionDeliveryIdsOf(questions)).toEqual(new Set([asked, withdrawal, replacement, replaced]));
  });
});
