import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';

import { callPlugin, sessionCookieOf } from './plugin-call';

const PLUGIN_URL = 'http://squadrons.internal:4100';
const COOKIE = 'aeolus_session=abc';

function answering(body: unknown) {
  return vi.fn<typeof fetch>(() => Promise.resolve(Response.json(body)));
}

const call = { plugin: 'squadrons', url: PLUGIN_URL, cookie: COOKIE, answers: z.object({ name: z.string() }) };

describe('a plugin call from the web app server', () => {
  it('hands back the parsed data', async () => {
    await expect(callPlugin({ ...call, procedure: 'repositories.add', isMutation: true, input: { url: 'https://x' }, fetch: answering({ result: { data: { name: 'x' } } }) })).resolves.toEqual({
      kind: 'answered',
      data: { name: 'x' },
    });
  });

  it('sends a query as GET with its input in the address and only the session cookie', async () => {
    const send = answering({ result: { data: { name: 'x' } } });
    await callPlugin({ ...call, procedure: 'squadrons.messages', input: { squadronId: 'sq_1' }, fetch: send });
    const [url, init] = send.mock.calls[0] ?? [];
    expect(url).toBe(`${PLUGIN_URL}/trpc/squadrons.messages?input=${encodeURIComponent('{"squadronId":"sq_1"}')}`);
    expect(init?.method).toBeUndefined();
    expect(init?.headers).toEqual({ cookie: COOKIE });
  });

  it('sends a mutation as JSON in a POST', async () => {
    const send = answering({ result: { data: { name: 'x' } } });
    await callPlugin({ ...call, procedure: 'repositories.remove', isMutation: true, input: { name: 'x' }, fetch: send });
    const [url, init] = send.mock.calls[0] ?? [];
    expect(url).toBe(`${PLUGIN_URL}/trpc/repositories.remove`);
    expect(init).toMatchObject({ method: 'POST', body: '{"name":"x"}', headers: { cookie: COOKIE, 'content-type': 'application/json' } });
  });

  it("hands back the plugin's refusal in its own words", async () => {
    await expect(callPlugin({ ...call, procedure: 'squadrons.list', fetch: answering({ error: { message: 'No such squadron' } }) })).resolves.toEqual({
      kind: 'refused',
      message: 'No such squadron',
    });
  });

  it('refuses an answer the console does not understand', async () => {
    await expect(callPlugin({ ...call, procedure: 'squadrons.list', fetch: answering({ result: { data: { name: 7 } } }) })).resolves.toEqual({
      kind: 'refused',
      message: 'squadrons answered something the console does not understand',
    });
  });

  it('says so when the plugin does not answer', async () => {
    const send = vi.fn<typeof fetch>(() => Promise.reject(new TypeError('fetch failed')));
    await expect(callPlugin({ ...call, procedure: 'squadrons.list', fetch: send })).resolves.toEqual({
      kind: 'refused',
      message: 'squadrons did not answer: try again in a moment',
    });
  });
});

describe('the cookie a plugin call forwards', () => {
  it('is the console session cookie only', () => {
    expect(sessionCookieOf('theme=dark; aeolus_session=abc; other=1')).toBe('aeolus_session=abc');
  });

  it('is empty without a session cookie', () => {
    expect(sessionCookieOf('theme=dark')).toBe('');
    expect(sessionCookieOf(null)).toBe('');
  });
});
