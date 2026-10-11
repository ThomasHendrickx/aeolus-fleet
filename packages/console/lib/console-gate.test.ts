import { describe, expect, it, vi } from 'vitest';

import { sessionOf, signInUrlFor } from './console-gate';

describe('signInUrlFor', () => {
  it("is the hosting service's sign-in when AEOLUS_HOSTED_SIGN_IN_URL is set", () => {
    expect(signInUrlFor({ AEOLUS_HOSTED_SIGN_IN_URL: 'https://pagasae.example.com/sign-in' }, { requestUrl: 'https://fleet.example.com/ships' }).href).toBe('https://pagasae.example.com/sign-in');
  });

  it("is the console's own sign-in otherwise", () => {
    expect(signInUrlFor({}, { requestUrl: 'https://fleet.example.com/ships?tab=messages' }).href).toBe('https://fleet.example.com/sign-in');
  });

  it("says the operator signed in somewhere else on the console's own sign-in, as a read or call that hears it does", () => {
    expect(signInUrlFor({}, { requestUrl: 'https://fleet.example.com/ships', ended: 'signedInElsewhere' }).href).toBe('https://fleet.example.com/sign-in?notice=signed-in-elsewhere');
  });

  it("is the console's own sign-in with the notice on a hosted console when the operator signed in somewhere else, so the notice shows before the hosting service's sign-in", () => {
    expect(signInUrlFor({ AEOLUS_HOSTED_SIGN_IN_URL: 'https://pagasae.example.com/sign-in' }, { requestUrl: 'https://fleet.example.com/ships', ended: 'signedInElsewhere' }).href).toBe('https://fleet.example.com/sign-in?notice=signed-in-elsewhere');
  });
});

describe('sessionOf', () => {
  const serverUrl = 'http://server:4000';

  function aRequest(cookie?: string): Request {
    return new Request('http://console/api/reads/machines', cookie === undefined ? {} : { headers: { cookie } });
  }

  it('is ended without a session cookie, and asks the server nothing', async () => {
    const fetchImplementation = vi.fn<typeof fetch>();

    await expect(sessionOf(aRequest('theme=dark'), { serverUrl, fetchImplementation })).resolves.toBe('ended');
    expect(fetchImplementation).not.toHaveBeenCalled();
  });

  it("asks the server's console.session with the request's cookie, and is live when it answers", async () => {
    const fetchImplementation = vi.fn<typeof fetch>().mockResolvedValue(new Response('{}', { status: 200 }));

    await expect(sessionOf(aRequest('aeolus_session=abc'), { serverUrl, fetchImplementation })).resolves.toBe('live');
    expect(fetchImplementation).toHaveBeenCalledWith('http://server:4000/trpc/console.session', expect.objectContaining({ headers: { cookie: 'aeolus_session=abc' } }));
  });

  it('is ended when the server refuses the session', async () => {
    await expect(sessionOf(aRequest('aeolus_session=abc'), { serverUrl, fetchImplementation: vi.fn<typeof fetch>().mockResolvedValue(new Response('{}', { status: 401 })) })).resolves.toBe('ended');
  });

  it('is signed in elsewhere when the server refuses the session because the operator signed in somewhere else', async () => {
    const takenOver = Response.json({ error: { message: 'You signed in somewhere else, which ended this console session', data: { code: 'UNAUTHORIZED', refusal: 'SIGNED_IN_ELSEWHERE' } } }, { status: 401 });

    await expect(sessionOf(aRequest('aeolus_session=abc'), { serverUrl, fetchImplementation: vi.fn<typeof fetch>().mockResolvedValue(takenOver) })).resolves.toBe('signedInElsewhere');
  });

  it('is unknown when the server fails or does not answer', async () => {
    await expect(sessionOf(aRequest('aeolus_session=abc'), { serverUrl, fetchImplementation: vi.fn<typeof fetch>().mockResolvedValue(new Response('{}', { status: 500 })) })).resolves.toBe('unknown');
    await expect(sessionOf(aRequest('aeolus_session=abc'), { serverUrl, fetchImplementation: vi.fn<typeof fetch>().mockRejectedValue(new Error('offline')) })).resolves.toBe('unknown');
  });
});
