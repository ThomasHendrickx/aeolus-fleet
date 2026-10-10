import { describe, expect, it, vi } from 'vitest';

import { isSignedInElsewhere, trpcErrorCode } from './errors';
import { fetchConsoleRead } from './fetch-console-read';

function aWebApp(answer: () => Response) {
  return vi.fn<typeof fetch>(() => Promise.resolve(answer()));
}

describe("a console read, fetched from the web app's server", () => {
  it('asks the read by name, with its input', async () => {
    const webApp = aWebApp(() => Response.json({ kind: 'answered', data: [] }));

    await fetchConsoleRead({ read: 'kept-messages', input: { squadronId: 'sqd_1' } }, webApp);

    expect(webApp).toHaveBeenCalledWith(`/api/reads/kept-messages?input=${encodeURIComponent(JSON.stringify({ squadronId: 'sqd_1' }))}`, expect.objectContaining({ cache: 'no-store' }));
  });

  it('asks a read without input by name alone', async () => {
    const webApp = aWebApp(() => Response.json({ kind: 'answered', data: [] }));

    await fetchConsoleRead({ read: 'squadrons' }, webApp);

    expect(webApp).toHaveBeenCalledWith('/api/reads/squadrons', expect.anything());
  });

  it('resolves to the data the read answered', async () => {
    const webApp = aWebApp(() => Response.json({ kind: 'answered', data: [] }));

    await expect(fetchConsoleRead({ read: 'squadrons' }, webApp)).resolves.toEqual([]);
  });

  it("rejects with a refusal's words", async () => {
    const webApp = aWebApp(() => Response.json({ kind: 'refused', message: 'squadrons did not answer: try again in a moment' }));

    await expect(fetchConsoleRead({ read: 'squadrons' }, webApp)).rejects.toThrow('squadrons did not answer: try again in a moment');
  });

  it('rejects when the web app does not answer a read', async () => {
    const webApp = aWebApp(() => new Response('<html>Internal Server Error</html>', { status: 500 }));

    await expect(fetchConsoleRead({ read: 'squadrons' }, webApp)).rejects.toThrow('The console did not answer: try again in a moment');
  });

  it('rejects a read refused because the session ended as UNAUTHORIZED, so the page sends the operator to sign in', async () => {
    const webApp = aWebApp(() => Response.json({ kind: 'refused', message: 'Your console session ended: sign in again' }, { status: 401 }));

    const refusal: unknown = await fetchConsoleRead({ read: 'squadrons' }, webApp).catch((error: unknown) => error);

    expect(trpcErrorCode(refusal)).toBe('UNAUTHORIZED');
  });

  it('rejects a read refused because the operator signed in elsewhere as that refusal, so the page says why it went to sign in', async () => {
    const webApp = aWebApp(() => Response.json({ kind: 'refused', message: 'You signed in somewhere else, which ended this console session', refusal: 'SIGNED_IN_ELSEWHERE' }, { status: 401 }));

    const refusal: unknown = await fetchConsoleRead({ read: 'squadrons' }, webApp).catch((error: unknown) => error);

    expect([trpcErrorCode(refusal), isSignedInElsewhere(refusal)]).toEqual(['UNAUTHORIZED', true]);
  });
});
