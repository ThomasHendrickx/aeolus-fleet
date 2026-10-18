import { describe, expect, it } from 'vitest';

import { gatewayUrlFrom } from './gateway-url';

describe('gatewayUrlFrom', () => {
  it('reads AEOLUS_GATEWAY_URL without a trailing slash', () => {
    expect(gatewayUrlFrom({ AEOLUS_GATEWAY_URL: 'http://gateway.internal:4400/' })).toBe('http://gateway.internal:4400');
  });

  it.each([
    ['unset', {}],
    ['empty', { AEOLUS_GATEWAY_URL: '' }],
  ])('is undefined when %s: the console has no gateway', (_label, environment) => {
    expect(gatewayUrlFrom(environment)).toBeUndefined();
  });
});
