import { describe, expect, it } from 'vitest';

import { serverUrlFrom } from './server-url';

describe('the server address', () => {
  it('is AEOLUS_SERVER_URL', () => {
    expect(serverUrlFrom({ AEOLUS_SERVER_URL: 'https://fleet.example.com' })).toBe('https://fleet.example.com');
  });

  it('drops a trailing slash, so paths join onto it', () => {
    expect(serverUrlFrom({ AEOLUS_SERVER_URL: 'https://fleet.example.com/' })).toBe('https://fleet.example.com');
  });

  it('is the server beside the web app when AEOLUS_SERVER_URL is unset or empty', () => {
    expect(serverUrlFrom({})).toBe('http://127.0.0.1:4000');
    expect(serverUrlFrom({ AEOLUS_SERVER_URL: '' })).toBe('http://127.0.0.1:4000');
  });
});
