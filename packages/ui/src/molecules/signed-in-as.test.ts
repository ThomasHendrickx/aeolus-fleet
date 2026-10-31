import { describe, expect, it } from 'vitest';

import { signedInAsOf } from './signed-in-as.js';

describe('how you are signed in here (header design H10)', () => {
  it('says each way of signing in', () => {
    expect([signedInAsOf('argo'), signedInAsOf('account'), signedInAsOf('viewer')]).toEqual(['Signed in as argo', 'Signed in as your account', 'Viewer']);
  });
});
