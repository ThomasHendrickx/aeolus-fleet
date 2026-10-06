import { describe, expect, it } from 'vitest';

import { mutationRefusal, sessionCookieOf } from './squadrons-proxy';

const URL_OF_ROUTE = 'https://console.example.com/api/squadrons/repositories.add';

function post(headers: Record<string, string>): Request {
  return new Request(URL_OF_ROUTE, { method: 'POST', headers, body: '{}' });
}

describe('a squadrons mutation through the proxy', () => {
  it('passes from the console: same-origin and JSON', () => {
    expect(mutationRefusal(post({ 'sec-fetch-site': 'same-origin', 'content-type': 'application/json' }))).toBeUndefined();
  });

  it('is refused from a sibling host of the same site', () => {
    expect(mutationRefusal(post({ 'sec-fetch-site': 'same-site', origin: 'https://other.example.com', 'content-type': 'application/json' }))).toBe(
      'Squadrons changes come only from the console',
    );
  });

  it('is refused from another site', () => {
    expect(mutationRefusal(post({ 'sec-fetch-site': 'cross-site', 'content-type': 'application/json' }))).toBe('Squadrons changes come only from the console');
  });

  it('passes without Sec-Fetch-Site when the Origin is the console', () => {
    expect(mutationRefusal(post({ origin: 'https://console.example.com', 'content-type': 'application/json; charset=utf-8' }))).toBeUndefined();
  });

  it('is refused without Sec-Fetch-Site when the Origin is another host, or missing', () => {
    expect(mutationRefusal(post({ origin: 'https://other.example.com', 'content-type': 'application/json' }))).toBe('Squadrons changes come only from the console');
    expect(mutationRefusal(post({ 'content-type': 'application/json' }))).toBe('Squadrons changes come only from the console');
  });

  it('is refused as a plain form, even from the console', () => {
    expect(mutationRefusal(post({ 'sec-fetch-site': 'same-origin', 'content-type': 'text/plain' }))).toBe('A squadrons change is sent as JSON');
    expect(mutationRefusal(post({ 'sec-fetch-site': 'same-origin' }))).toBe('A squadrons change is sent as JSON');
  });
});

describe('the cookie the proxy forwards', () => {
  it('is the console session cookie only', () => {
    expect(sessionCookieOf('theme=dark; aeolus_session=abc; other=1')).toBe('aeolus_session=abc');
  });

  it('is empty without a session cookie', () => {
    expect(sessionCookieOf('theme=dark')).toBe('');
    expect(sessionCookieOf(null)).toBe('');
  });
});
