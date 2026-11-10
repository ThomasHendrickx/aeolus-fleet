import { describe, expect, it } from 'vitest';

import { describeFailure, failureForLog } from './failure-log.js';

const MARKER = 'harmless-error-marker';

describe('safe failure diagnostics', () => {
  it.each([
    new Error(MARKER),
    new TypeError(MARKER),
    Object.assign(new Error(MARKER), { name: MARKER, stack: MARKER, code: MARKER }),
    new Error('failed', { cause: new Error(MARKER) }),
    MARKER,
  ])('omits caller text, custom names, stacks and unknown codes', (failure) => {
    const logged = failureForLog(failure);

    expect(JSON.stringify(logged)).not.toContain(MARKER);
    expect(logged).toMatchObject({ reason: 'Unexpected failure' });
    expect(logged).not.toHaveProperty('stack');
    expect(describeFailure(failure)).not.toContain(MARKER);
  });

  it('retains a built-in error type and a known system code without its message', () => {
    const failure = Object.assign(new TypeError(MARKER), { code: 'ECONNRESET' });

    const logged = failureForLog(failure);

    expect(logged).toEqual({ reason: 'Unexpected failure', errorType: 'TypeError', code: 'ECONNRESET' });
  });
});
