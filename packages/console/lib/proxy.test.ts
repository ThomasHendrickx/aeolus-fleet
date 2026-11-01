import { NextRequest } from 'next/server';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { proxy } from '../proxy';

const CONSOLE_URL = 'https://fleet.example.com';
const MESSAGE_PATH = '/inbox?message=dlv_01m6c7geg9d1wyr4xkaac3wevy';

function stubSession(data: Record<string, unknown>): void {
  vi.stubGlobal('fetch', vi.fn(() => Promise.resolve(Response.json({ result: { data } }))));
}

function aRequestFor(path: string): NextRequest {
  return new NextRequest(`${CONSOLE_URL}${path}`, { headers: { cookie: 'aeolus_account_token=eyJ.a.b' } });
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe('a message link in argo\'s inbox', () => {
  it('goes through the sign-in as argo, keeping the message, for an account signed in as itself', async () => {
    vi.stubEnv('AEOLUS_CONSOLE_URL', CONSOLE_URL);
    stubSession({ kind: 'account', scopes: ['fleet:read'] });

    const answer = await proxy(aRequestFor(MESSAGE_PATH));

    expect(answer.headers.get('location')).toBe(`${CONSOLE_URL}/sign-in/argo/confirm?returnTo=${encodeURIComponent(MESSAGE_PATH)}`);
  });

  it('opens as it is for the sign-in as argo', async () => {
    vi.stubEnv('AEOLUS_CONSOLE_URL', CONSOLE_URL);
    stubSession({ kind: 'operator', scopes: ['fleet:read'] });

    const answer = await proxy(aRequestFor(MESSAGE_PATH));

    expect(answer.headers.get('location')).toBeNull();
  });

  it("leaves argo's inbox without a message to the account", async () => {
    vi.stubEnv('AEOLUS_CONSOLE_URL', CONSOLE_URL);
    stubSession({ kind: 'account', scopes: ['fleet:read'] });

    const answer = await proxy(aRequestFor('/inbox'));

    expect(answer.headers.get('location')).toBeNull();
  });
});
