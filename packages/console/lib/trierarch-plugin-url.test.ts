import { describe, expect, it } from 'vitest';

import { trierarchPluginUrlFrom } from './trierarch-plugin-url';

describe('trierarchPluginUrlFrom', () => {
  it('reads AEOLUS_TRIERARCH_PLUGIN_URL without a trailing slash', () => {
    expect(trierarchPluginUrlFrom({ AEOLUS_TRIERARCH_PLUGIN_URL: 'http://trierarch-plugin.internal:4200/' })).toBe('http://trierarch-plugin.internal:4200');
  });

  it.each([
    ['unset', {}],
    ['empty', { AEOLUS_TRIERARCH_PLUGIN_URL: '' }],
  ])('is undefined when %s: the console has no trierarch plugin', (_label, environment) => {
    expect(trierarchPluginUrlFrom(environment)).toBeUndefined();
  });
});
