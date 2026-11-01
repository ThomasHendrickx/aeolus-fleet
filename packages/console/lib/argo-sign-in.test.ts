import { afterEach, describe, expect, it, vi } from 'vitest';

import { argoConfirmPathFor, signInAsArgo } from './argo-sign-in';

const CONSOLE_URL = 'https://fleet.example.com';
const ENVIRONMENT = { AEOLUS_CONSOLE_URL: CONSOLE_URL, AEOLUS_SERVER_INTERNAL_URL: 'http://core.internal' };
const PAGASAE = { url: 'https://account.example', clientId: 'console', clientSecret: 's'.repeat(32) };
const COOKIES = 'aeolus_account_session=shared; aeolus_account_token=tok';
const MESSAGE_PATH = '/inbox?message=dlv_01m6c7geg9d1wyr4xkaac3wevy';

/** Pagasae and core as the account sees them: allowed as argo, with argo held by someone else or by no one. */
function stubFleet({ isArgoHeld }: { isArgoHeld: boolean }): void {
  vi.stubGlobal(
    'fetch',
    vi.fn((url: string) => {
      if (url.endsWith('/api/apps')) {
        return Promise.resolve(Response.json({ fleets: [{ id: 'flt_1', name: 'Fleet', argo: true, apps: [{ app: 'console' }] }] }));
      }
      if (url.endsWith('/trpc/console.argoSignIn')) {
        return Promise.resolve(Response.json({ result: { data: isArgoHeld ? { isSignedIn: true, accountId: null } : { isSignedIn: false } } }));
      }
      if (url.startsWith(PAGASAE.url)) {
        return Promise.resolve(Response.json({ access_token: 'ticket-1' }));
      }
      return Promise.resolve(new Response('{}', { status: 200, headers: { 'set-cookie': 'aeolus_session=argo; Path=/' } }));
    }),
  );
}

function aPostFrom(fields: Record<string, string>): Request {
  return new Request(`${CONSOLE_URL}/sign-in/argo`, { method: 'POST', headers: { origin: CONSOLE_URL, cookie: COOKIES }, body: new URLSearchParams(fields) });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('the sign-in as argo that a message link goes through', () => {
  it('lands on the message once signed in as argo, from an account signed in as itself', async () => {
    stubFleet({ isArgoHeld: false });

    const answer = await signInAsArgo(aPostFrom({ returnTo: MESSAGE_PATH }), { pagasae: PAGASAE, environment: ENVIRONMENT });

    expect(answer.headers.get('location')).toBe(MESSAGE_PATH);
    expect(answer.headers.get('set-cookie')).toContain('aeolus_session=argo');
  });

  it('goes through the confirm page, keeping the message, when someone else holds argo', async () => {
    stubFleet({ isArgoHeld: true });

    const answer = await signInAsArgo(aPostFrom({ returnTo: MESSAGE_PATH }), { pagasae: PAGASAE, environment: ENVIRONMENT });

    expect(answer.headers.get('location')).toBe(argoConfirmPathFor(MESSAGE_PATH));
    expect(answer.headers.get('set-cookie')).toBeNull();
  });

  it('lands on the message after the confirm page', async () => {
    stubFleet({ isArgoHeld: true });

    const answer = await signInAsArgo(aPostFrom({ confirmed: 'yes', returnTo: MESSAGE_PATH }), { pagasae: PAGASAE, environment: ENVIRONMENT });

    expect(answer.headers.get('location')).toBe(MESSAGE_PATH);
  });

  it.each(['https://evil.example/inbox', '//evil.example/inbox', '/\\evil.example', 'inbox'])('lands on / for %s, a path outside the console', async (returnTo) => {
    stubFleet({ isArgoHeld: false });

    const answer = await signInAsArgo(aPostFrom({ returnTo }), { pagasae: PAGASAE, environment: ENVIRONMENT });

    expect(answer.headers.get('location')).toBe('/');
  });

  it('lands on / with no page named', async () => {
    stubFleet({ isArgoHeld: false });

    const answer = await signInAsArgo(aPostFrom({}), { pagasae: PAGASAE, environment: ENVIRONMENT });

    expect(answer.headers.get('location')).toBe('/');
  });
});

describe('argoConfirmPathFor', () => {
  it('carries the page, and only a path inside the console', () => {
    expect(argoConfirmPathFor(MESSAGE_PATH)).toBe(`/sign-in/argo/confirm?returnTo=${encodeURIComponent(MESSAGE_PATH)}`);
    expect(argoConfirmPathFor('https://evil.example')).toBe('/sign-in/argo/confirm');
  });
});
