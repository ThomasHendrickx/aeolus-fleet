import { describe, expect, it } from 'vitest';

import { KEY_NOT_REACHABLE, SEALED, SEALING, SEALING_NOW } from '../../../lib/fixtures/sealing.fixtures';
import { keyNotReachableNotice } from './key-not-reachable';

describe('the overview notice when the company key is not reachable (decision 0068, screen 2)', () => {
  it('given a sealed fleet whose KMS refuses its key, then the overview says since when and why, and that nothing waiting is lost', () => {
    expect(keyNotReachableNotice(KEY_NOT_REACHABLE, SEALING_NOW)).toEqual({
      title: 'Company key not reachable',
      description: 'Since 09:05 your KMS answers: access denied. Sends and receives in this fleet are refused until it is reachable again. Nothing waiting is lost.',
    });
  });

  it('given a sealed or sealing fleet whose key is reachable, then the overview shows no notice', () => {
    expect(keyNotReachableNotice(SEALED, SEALING_NOW)).toBeUndefined();
    expect(keyNotReachableNotice(SEALING, SEALING_NOW)).toBeUndefined();
  });

  it('given a fleet without sealing, or its sealing not read yet or failed to load, then the overview shows no notice', () => {
    expect(keyNotReachableNotice({ state: 'none' }, SEALING_NOW)).toBeUndefined();
    expect(keyNotReachableNotice(undefined, SEALING_NOW)).toBeUndefined();
  });
});
