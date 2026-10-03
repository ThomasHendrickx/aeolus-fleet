import { describe, expect, it } from 'vitest';

import { ConfigError } from './config.js';
import { readSquadronsFile } from './squadrons-file.js';

describe('readSquadronsFile', () => {
  it('reads the repositories, their names, paths and tokens from the environment, and the refresh interval', () => {
    const text = [
      'repositories:',
      '  - url: https://github.com/thomashendrickx/squadron-templates.git',
      '    token: TEMPLATES_TOKEN',
      '  - url: https://gitlab.example.com/ops/fleet.git',
      '    name: ops-fleet',
      '    path: ops/squadrons',
      'refresh: 10m',
    ].join('\n');

    expect(readSquadronsFile(text, { TEMPLATES_TOKEN: 'ghp_secret' })).toEqual({
      repositories: [
        { url: 'https://github.com/thomashendrickx/squadron-templates.git', name: 'github.com/thomashendrickx/squadron-templates', path: undefined, token: 'ghp_secret' },
        { url: 'https://gitlab.example.com/ops/fleet.git', name: 'ops-fleet', path: 'ops/squadrons', token: undefined },
      ],
      refreshMinutes: 10,
    });
  });

  it('has no repositories and refreshes every 5 minutes when the file is empty', () => {
    expect(readSquadronsFile('', {})).toEqual({ repositories: [], refreshMinutes: 5 });
  });

  it.each([
    ['a token variable the environment does not hold', 'repositories:\n  - url: https://example.com/a.git\n    token: MISSING_TOKEN\n'],
    ['a repository without a URL', 'repositories:\n  - name: a\n'],
    ['a refresh that is no duration', 'refresh: often\n'],
    ['YAML that does not parse', 'repositories: [unclosed\n'],
  ])('refuses %s', (_label, text) => {
    expect(() => readSquadronsFile(text, {})).toThrow(ConfigError);
  });
});
