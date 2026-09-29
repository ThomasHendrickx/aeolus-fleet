import { createIdGenerator } from '@aeolus-fleet/common';
import { describe, expect, it } from 'vitest';

import { startingPromptText } from './starting-prompt.js';

const shipId = createIdGenerator()('ship');

describe('the starting prompt text', () => {
  const text = startingPromptText({ fleetUrl: 'https://fleet.example.com', shipId, secret: 'aeolus_sk_v1_abc' });

  it('carries the fleet URL, the ship id and the secret, one per line', () => {
    expect(text.split('\n')).toEqual(
      expect.arrayContaining([
        'Fleet URL: https://fleet.example.com',
        `Ship id: ${shipId}`,
        'Ship secret: aeolus_sk_v1_abc',
      ]),
    );
  });

  it('says it is a placeholder', () => {
    expect(text).toMatch(/placeholder/i);
  });
});
