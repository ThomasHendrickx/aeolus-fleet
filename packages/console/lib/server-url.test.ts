import { describe, expect, it } from 'vitest';

import { serverInternalUrlFrom, serverUrlFrom } from './server-url';

describe('the server address', () => {
  it('is AEOLUS_SERVER_URL', () => {
    expect(serverUrlFrom({ AEOLUS_SERVER_URL: 'https://fleet.example.com' })).toBe('https://fleet.example.com');
  });

  it('drops a trailing slash, so paths join onto it', () => {
    expect(serverUrlFrom({ AEOLUS_SERVER_URL: 'https://fleet.example.com/' })).toBe('https://fleet.example.com');
  });

  it('is the server beside the web app, by localhost like the console, when AEOLUS_SERVER_URL is unset or empty', () => {
    expect(serverUrlFrom({})).toBe('http://localhost:4000');
    expect(serverUrlFrom({ AEOLUS_SERVER_URL: '' })).toBe('http://localhost:4000');
  });
});

describe("the server's address for the web app's server", () => {
  it('is AEOLUS_SERVER_INTERNAL_URL, without a trailing slash', () => {
    expect(serverInternalUrlFrom({ AEOLUS_SERVER_URL: 'https://fleet.example.com', AEOLUS_SERVER_INTERNAL_URL: 'http://server:4000/' })).toBe('http://server:4000');
  });

  it('falls back to AEOLUS_SERVER_URL when AEOLUS_SERVER_INTERNAL_URL is unset or empty', () => {
    expect(serverInternalUrlFrom({ AEOLUS_SERVER_URL: 'https://fleet.example.com' })).toBe('https://fleet.example.com');
    expect(serverInternalUrlFrom({ AEOLUS_SERVER_URL: 'https://fleet.example.com', AEOLUS_SERVER_INTERNAL_URL: '' })).toBe('https://fleet.example.com');
  });
});
