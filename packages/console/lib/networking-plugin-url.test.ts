import { describe, expect, it } from 'vitest';

import { networkingPluginUrlFrom } from './networking-plugin-url';

describe('networkingPluginUrlFrom', () => {
  it('reads AEOLUS_NETWORKING_PLUGIN_URL without a trailing slash', () => {
    expect(networkingPluginUrlFrom({ AEOLUS_NETWORKING_PLUGIN_URL: 'http://networking-plugin.internal:4300/' })).toBe('http://networking-plugin.internal:4300');
  });

  it.each([
    ['unset', {}],
    ['empty', { AEOLUS_NETWORKING_PLUGIN_URL: '' }],
  ])('is undefined when %s: the console has no networking plugin', (_label, environment) => {
    expect(networkingPluginUrlFrom(environment)).toBeUndefined();
  });
});
