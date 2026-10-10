import { describe, expect, it } from 'vitest';
import { z } from 'zod';

import { answerConsoleRead, consoleRead } from './console-read';
import { CONSOLE_READS } from './console-reads';

const reads = {
  'kept-messages': consoleRead(z.object({ squadronId: z.string() }), ({ squadronId }) => Promise.resolve({ kind: 'answered', data: [`kept for ${squadronId}`] })),
  squadrons: consoleRead(z.undefined(), () => Promise.resolve({ kind: 'refused', message: 'squadrons did not answer: try again in a moment' })),
};

const signedIn = { sessionOf: () => Promise.resolve('live' as const) };
const sessionEnded = { sessionOf: () => Promise.resolve('ended' as const) };
const sessionUnknown = { sessionOf: () => Promise.resolve('unknown' as const) };
const signedInElsewhere = { sessionOf: () => Promise.resolve('signedInElsewhere' as const) };

/** Every read's status and answer, the console's and one it does not have, asked with the given session. */
async function everyReadAnswered(session: typeof signedIn | typeof sessionEnded | typeof sessionUnknown | typeof signedInElsewhere): Promise<{ names: string[]; answers: { status: number; body: unknown }[] }> {
  const names = [...Object.keys(CONSOLE_READS), 'no-such-read'];
  const answers = await Promise.all(
    names.map(async (name) => {
      const response = await answerConsoleRead(aRequest(name), { name, reads: CONSOLE_READS, ...session });
      const body: unknown = await response.json();
      return { status: response.status, body };
    }),
  );
  return { names, answers };
}

function aRequest(name: string, input?: string): Request {
  const search = input === undefined ? '' : `?input=${encodeURIComponent(input)}`;
  return new Request(`http://console/api/reads/${name}${search}`);
}

describe("a console read, answered by the web app's server", () => {
  it('answers what the read answers, for its input', async () => {
    const response = await answerConsoleRead(aRequest('kept-messages', JSON.stringify({ squadronId: 'sqd_1' })), { name: 'kept-messages', reads, ...signedIn });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ kind: 'answered', data: ['kept for sqd_1'] });
  });

  it("answers a read's refusal with its words, for the page to show", async () => {
    const response = await answerConsoleRead(aRequest('squadrons'), { name: 'squadrons', reads, ...signedIn });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ kind: 'refused', message: 'squadrons did not answer: try again in a moment' });
  });

  it('refuses an input the read does not take', async () => {
    const response = await answerConsoleRead(aRequest('kept-messages', JSON.stringify({ squadron: 'sqd_1' })), { name: 'kept-messages', reads, ...signedIn });

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({ kind: 'refused', message: 'The console cannot read that' });
  });

  it('refuses an input that is not JSON', async () => {
    const response = await answerConsoleRead(aRequest('kept-messages', '{squadronId'), { name: 'kept-messages', reads, ...signedIn });

    expect(response.status).toBe(400);
  });

  it('answers 404 for a read it does not have, an inherited name included', async () => {
    const unknown = await answerConsoleRead(aRequest('machines'), { name: 'machines', reads, ...signedIn });
    const inherited = await answerConsoleRead(aRequest('toString'), { name: 'toString', reads, ...signedIn });

    expect([unknown.status, inherited.status]).toEqual([404, 404]);
    await expect(unknown.json()).resolves.toEqual({ kind: 'refused', message: 'The console has no such read' });
  });

  it('answers every read with an ended session as 401, the same for each name, so the page goes to sign in and nothing shows which plugins are configured', async () => {
    const { names, answers } = await everyReadAnswered(sessionEnded);

    expect(answers).toEqual(names.map(() => ({ status: 401, body: { kind: 'refused', message: 'Your console session ended: sign in again' } })));
  });

  it('answers every read with a session ended by a sign-in elsewhere as 401, the same for each name, saying so, so the page shows why it went to sign in', async () => {
    const { names, answers } = await everyReadAnswered(signedInElsewhere);

    expect(answers).toEqual(names.map(() => ({ status: 401, body: { kind: 'refused', message: 'You signed in somewhere else, which ended this console session', refusal: 'SIGNED_IN_ELSEWHERE' } })));
  });

  it('answers every read as one it does not have while the session check does not answer, so nothing is read for it', async () => {
    const { names, answers } = await everyReadAnswered(sessionUnknown);

    expect(answers).toEqual(names.map(() => ({ status: 404, body: { kind: 'refused', message: 'The console has no such read' } })));
  });
});
