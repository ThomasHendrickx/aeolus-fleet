import { describe, expect, it } from 'vitest';

import { missingConsoleUrlOf } from './console-origin';

describe('the console address a production start needs', () => {
  it('stops a production start without AEOLUS_CONSOLE_URL, naming it', () => {
    expect(missingConsoleUrlOf({ NODE_ENV: 'production' })).toContain('AEOLUS_CONSOLE_URL');
  });

  it('stops a production start whose AEOLUS_CONSOLE_URL is not an http(s) URL', () => {
    expect(missingConsoleUrlOf({ NODE_ENV: 'production', AEOLUS_CONSOLE_URL: 'fleet.example.com' })).toContain('AEOLUS_CONSOLE_URL');
  });

  it('lets a production start with AEOLUS_CONSOLE_URL go on', () => {
    expect(missingConsoleUrlOf({ NODE_ENV: 'production', AEOLUS_CONSOLE_URL: 'https://fleet.example.com' })).toBeUndefined();
  });

  it('lets development go on without it, on the request address', () => {
    expect(missingConsoleUrlOf({ NODE_ENV: 'development' })).toBeUndefined();
  });
});
