import { describe, expect, it } from 'vitest';

import { startupWarnings } from './startup-warnings';

describe('the console startup warnings', () => {
  it('warn of a plain http AEOLUS_SERVER_URL beyond localhost, where the browser drops the session cookie', () => {
    expect(startupWarnings({ AEOLUS_SERVER_URL: 'http://fleet.example.com' })).toEqual([
      expect.stringMatching(/^AEOLUS_SERVER_URL is plain http on fleet\.example\.com: /),
    ]);
  });

  it.each([
    ['https', { AEOLUS_SERVER_URL: 'https://fleet.example.com' }],
    ['localhost', { AEOLUS_SERVER_URL: 'http://localhost:4000' }],
    ['the default, the server beside the web app', {}],
  ])('are none with %s', (_label, environment) => {
    expect(startupWarnings(environment)).toEqual([]);
  });
});
