import { describe, expect, it } from 'vitest';

import { createSessionFetch } from './session-fetch';

const SERVER = 'http://localhost:4000/trpc';
const SIGN_OUT = `${SERVER}/console.signOut`;
const A_READ = `${SERVER}/console.account,fleet.list?batch=1`;

/** A server call the test answers when it wants, so a call can still be on its way when another is asked. */
interface HeldCall {
  url: string;
  answer(): void;
  fail(): void;
}

/** A fetch that holds every call until the test answers it, keeping the order calls reached the server in. */
function aHoldingFetch(): { fetchImplementation: typeof fetch; sent: HeldCall[] } {
  const sent: HeldCall[] = [];
  const fetchImplementation: typeof fetch = (input) =>
    new Promise<Response>((resolve, reject) => {
      sent.push({
        url: input instanceof Request ? input.url : String(input),
        answer: () => {
          resolve(new Response('[]'));
        },
        fail: () => {
          reject(new TypeError('Failed to fetch'));
        },
      });
    });
  return { fetchImplementation, sent };
}

/** Lets every promise that can settle now settle. */
async function settled(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0));
}

function urlsOf(sent: readonly HeldCall[]): string[] {
  return sent.map((call) => call.url);
}

function callTo(sent: readonly HeldCall[], url: string): HeldCall {
  const call = sent.find((held) => held.url === url);
  if (call === undefined) {
    throw new Error(`no call to ${url} reached the server`);
  }
  return call;
}

describe('createSessionFetch', () => {
  it('sends a call at once while no sign out is on its way', async () => {
    const { fetchImplementation, sent } = aHoldingFetch();
    const sessionFetch = createSessionFetch(fetchImplementation);

    void sessionFetch(A_READ);
    await settled();

    expect(urlsOf(sent)).toEqual([A_READ]);
  });

  it('sends sign out only once every call on its way has answered, so none renews the cookie after sign out clears it', async () => {
    const { fetchImplementation, sent } = aHoldingFetch();
    const sessionFetch = createSessionFetch(fetchImplementation);
    void sessionFetch(A_READ);
    await settled();

    void sessionFetch(SIGN_OUT, { method: 'POST' });
    await settled();
    expect(urlsOf(sent)).toEqual([A_READ]);

    callTo(sent, A_READ).answer();
    await settled();
    expect(urlsOf(sent)).toEqual([A_READ, SIGN_OUT]);
  });

  it('sends sign out once a call on its way fails, as when it has answered', async () => {
    const { fetchImplementation, sent } = aHoldingFetch();
    const sessionFetch = createSessionFetch(fetchImplementation);
    void sessionFetch(A_READ).catch(() => undefined);
    await settled();

    void sessionFetch(SIGN_OUT, { method: 'POST' });
    callTo(sent, A_READ).fail();
    await settled();

    expect(urlsOf(sent)).toEqual([A_READ, SIGN_OUT]);
  });

  it('holds a call asked while sign out is on its way until sign out has answered, when it carries no session to renew', async () => {
    const { fetchImplementation, sent } = aHoldingFetch();
    const sessionFetch = createSessionFetch(fetchImplementation);
    void sessionFetch(SIGN_OUT, { method: 'POST' });
    await settled();

    void sessionFetch(A_READ);
    await settled();
    expect(urlsOf(sent)).toEqual([SIGN_OUT]);

    callTo(sent, SIGN_OUT).answer();
    await settled();
    expect(urlsOf(sent)).toEqual([SIGN_OUT, A_READ]);
  });

  it('lets a held call go when sign out fails, as the operator is still signed in', async () => {
    const { fetchImplementation, sent } = aHoldingFetch();
    const sessionFetch = createSessionFetch(fetchImplementation);
    void sessionFetch(SIGN_OUT, { method: 'POST' }).catch(() => undefined);
    await settled();
    void sessionFetch(A_READ);

    callTo(sent, SIGN_OUT).fail();
    await settled();

    expect(urlsOf(sent)).toEqual([SIGN_OUT, A_READ]);
  });

  it('answers each call with what the server answered', async () => {
    const { fetchImplementation, sent } = aHoldingFetch();
    const sessionFetch = createSessionFetch(fetchImplementation);

    const answer = sessionFetch(A_READ);
    await settled();
    callTo(sent, A_READ).answer();

    await expect((await answer).text()).resolves.toBe('[]');
  });
});
