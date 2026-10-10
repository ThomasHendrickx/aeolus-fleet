import { describe, expect, it, vi } from 'vitest';

import { hasLiveSession, isSignedIn, signInUrlFor } from './console-gate';

describe('signInUrlFor', () => {
  it("is the hosting service's sign-in when AEOLUS_HOSTED_SIGN_IN_URL is set", () => {
    expect(signInUrlFor({ AEOLUS_HOSTED_SIGN_IN_URL: 'https://pagasae.example.com/sign-in' }, 'https://fleet.example.com/ships').href).toBe('https://pagasae.example.com/sign-in');
  });

  it("is the console's own sign-in otherwise", () => {
    expect(signInUrlFor({}, 'https://fleet.example.com/ships?tab=messages').href).toBe('https://fleet.example.com/sign-in');
  });
});

describe('hasLiveSession', () => {
  const request = { serverUrl: 'http://server:4000', cookie: 'aeolus_session=abc' };

  it("asks the server's console.session with the request's cookie, and is true when it answers", async () => {
    const fetchImplementation = vi.fn<typeof fetch>().mockResolvedValue(new Response('{}', { status: 200 }));

    await expect(hasLiveSession(request, fetchImplementation)).resolves.toBe(true);
    expect(fetchImplementation).toHaveBeenCalledWith('http://server:4000/trpc/console.session', expect.objectContaining({ headers: { cookie: 'aeolus_session=abc' } }));
  });

  it('is false when the server refuses the session', async () => {
    await expect(hasLiveSession(request, vi.fn<typeof fetch>().mockResolvedValue(new Response('{}', { status: 401 })))).resolves.toBe(false);
  });

  it('is undefined when the server fails or does not answer, so the browser decides', async () => {
    await expect(hasLiveSession(request, vi.fn<typeof fetch>().mockResolvedValue(new Response('{}', { status: 500 })))).resolves.toBeUndefined();
    await expect(hasLiveSession(request, vi.fn<typeof fetch>().mockRejectedValue(new Error('offline')))).resolves.toBeUndefined();
  });
});

describe('isSignedIn', () => {
  const serverUrl = 'http://server:4000';

  function aRequest(cookie?: string): Request {
    return new Request('http://console/api/reads/machines', cookie === undefined ? {} : { headers: { cookie } });
  }

  it('is false without a session cookie, and asks the server nothing', async () => {
    const fetchImplementation = vi.fn<typeof fetch>();

    await expect(isSignedIn(aRequest('theme=dark'), { serverUrl, fetchImplementation })).resolves.toBe(false);
    expect(fetchImplementation).not.toHaveBeenCalled();
  });

  it('is true when the server answers for the session', async () => {
    await expect(isSignedIn(aRequest('aeolus_session=abc'), { serverUrl, fetchImplementation: vi.fn<typeof fetch>().mockResolvedValue(new Response('{}', { status: 200 })) })).resolves.toBe(true);
  });

  it('is false when the server refuses the session', async () => {
    await expect(isSignedIn(aRequest('aeolus_session=abc'), { serverUrl, fetchImplementation: vi.fn<typeof fetch>().mockResolvedValue(new Response('{}', { status: 401 })) })).resolves.toBe(false);
  });

  it('is false when the server fails or does not answer', async () => {
    await expect(isSignedIn(aRequest('aeolus_session=abc'), { serverUrl, fetchImplementation: vi.fn<typeof fetch>().mockResolvedValue(new Response('{}', { status: 500 })) })).resolves.toBe(false);
    await expect(isSignedIn(aRequest('aeolus_session=abc'), { serverUrl, fetchImplementation: vi.fn<typeof fetch>().mockRejectedValue(new Error('offline')) })).resolves.toBe(false);
  });
});
