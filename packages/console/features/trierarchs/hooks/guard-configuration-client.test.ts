import { afterEach, expect, it, vi } from 'vitest';

import { updateGuardRepository } from './guard-configuration-client';

afterEach(() => {
  vi.unstubAllGlobals();
});

it.each([
  { reply: 'cannot reach the console', fetch: () => Promise.reject(new TypeError('fetch failed')) },
  { reply: 'gets no catalogue or refusal', fetch: () => Promise.resolve(Response.json({})) },
])('shows the trierarch read error when Update $reply', async ({ fetch }) => {
  // Given no usable answer to the request.
  vi.stubGlobal('fetch', fetch);

  // When the operator updates the repository.
  const result = await updateGuardRepository('company/rules');

  // Then the Update control gets the console's existing trierarch read error.
  expect(result).toEqual({
    kind: 'unconfirmed',
    reason: 'the trierarch plugin or the fleet did not answer: try again in a moment',
  });
});
