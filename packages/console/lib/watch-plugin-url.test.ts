import { describe, expect, it } from 'vitest';

import { watchPluginUrlFrom } from './watch-plugin-url';

describe('watchPluginUrlFrom', () => {
  it('reads AEOLUS_WATCH_PLUGIN_URL without a trailing slash', () => {
    expect(watchPluginUrlFrom({ AEOLUS_WATCH_PLUGIN_URL: 'http://watch-plugin.internal:4300/' })).toBe('http://watch-plugin.internal:4300');
  });

  it.each([
    ['unset', {}],
    ['empty', { AEOLUS_WATCH_PLUGIN_URL: '' }],
  ])('is undefined when %s: the console has no watch plugin', (_label, environment) => {
    expect(watchPluginUrlFrom(environment)).toBeUndefined();
  });
});
