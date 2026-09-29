import { createIdGenerator } from '@aeolus-fleet/common';
import { describe, expect, it } from 'vitest';

import { hasScope, type Caller } from './caller.js';

const newId = createIdGenerator();

describe('hasScope', () => {
  const agent: Caller = {
    shipId: newId('ship'),
    fleetId: newId('fleet'),
    kind: 'agent',
    scopes: ['messages:send', 'messages:receive'],
  };

  it('grants a scope the ship holds', () => {
    expect(hasScope(agent, 'messages:send')).toBe(true);
  });

  it('refuses a scope the ship does not hold', () => {
    expect(hasScope(agent, 'fleet:read')).toBe(false);
    expect(hasScope(agent, 'fleet:manage')).toBe(false);
  });
});
