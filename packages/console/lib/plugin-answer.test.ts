import { describe, expect, it } from 'vitest';

import { dataFrom } from './plugin-answer';

const NO_ANSWER = 'the gateway or the fleet did not answer: try again in a moment';

describe('a failed Connect always names a reason (#1028)', () => {
  it('hands back the data the server function answered', async () => {
    await expect(dataFrom(() => Promise.resolve({ kind: 'answered', data: 'connected' }), NO_ANSWER)).resolves.toBe('connected');
  });

  it("throws the refusal's words", async () => {
    await expect(dataFrom(() => Promise.resolve({ kind: 'refused', message: 'Connect from the console' }), NO_ANSWER)).rejects.toThrow('Connect from the console');
  });

  it('names the plugin or the fleet as not answering when a refusal has no words', async () => {
    await expect(dataFrom(() => Promise.resolve({ kind: 'refused', message: ' ' }), NO_ANSWER)).rejects.toThrow(NO_ANSWER);
  });

  it('names the plugin or the fleet as not answering when the server function fails with an empty message', async () => {
    // What the browser gets when the server action's response is an empty text/plain failure.
    await expect(dataFrom(() => Promise.reject(new Error('')), NO_ANSWER)).rejects.toThrow(NO_ANSWER);
  });

  it('names the plugin or the fleet as not answering when the server function fails at all', async () => {
    await expect(dataFrom(() => Promise.reject(new Error('An unexpected response was received from the server.')), NO_ANSWER)).rejects.toThrow(NO_ANSWER);
  });
});
