import { describe, expect, it } from 'vitest';

import { sealingRefusalOf } from './sealing-refusal';

describe('a sealing refusal as the sealing page says it (sealing page mockup)', () => {
  it("refused: KEY_NOT_BOUND_TO_FLEET says the key's policy doesn't name this fleet", () => {
    expect(
      sealingRefusalOf({
        refusal: 'KEY_NOT_BOUND_TO_FLEET',
        message: 'The key policy of arn grants it for any fleet: grant it with a condition naming fleet flt_1',
      }),
    ).toEqual({
      kind: 'keyNotBoundToFleet',
    });
  });

  it("refused: KEY_UNAVAILABLE says the KMS's reason", () => {
    expect(
      sealingRefusalOf({
        refusal: 'KEY_UNAVAILABLE',
        message: "The fleet's company key is not reachable: access denied",
      }),
    ).toEqual({ kind: 'keyUnavailable', reason: 'access denied' });
  });

  it('refused: the current company key is not reachable, when changing it', () => {
    expect(
      sealingRefusalOf({
        refusal: 'KEY_UNAVAILABLE',
        message: "The fleet's company key is not reachable: disabled. The old company key must be reachable to change it; without it, recovery with the recovery key is the way",
      }),
    ).toEqual({ kind: 'currentKeyUnavailable' });
  });

  it("any other refusal keeps the server's message", () => {
    expect(
      sealingRefusalOf({
        refusal: 'INVALID_RECOVERY_KEY',
        message: 'Not an age X25519 recipient',
      }),
    ).toEqual({ kind: 'other', message: 'Not an age X25519 recipient' });
  });
});
