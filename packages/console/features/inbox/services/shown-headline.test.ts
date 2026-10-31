import { describe, expect, it } from 'vitest';

import { KEY_NOT_REACHABLE_PR_READY, PR_READY, SEALED_PR_READY } from '../../../lib/fixtures/inbox.fixtures';
import { shownHeadlineOf } from './shown-headline';

describe("a message's headline as the inbox lists it (decision 0068, N1)", () => {
  it('scenario 25: given a sealed message whose company key is not reachable, then its headline says so, also in the plugin ships row', () => {
    expect(shownHeadlineOf(KEY_NOT_REACHABLE_PR_READY)).toBe('Sealed, key not reachable');
  });

  it('given a readable message, sealed or not, then its own headline', () => {
    expect([shownHeadlineOf(PR_READY), shownHeadlineOf(SEALED_PR_READY)]).toEqual(['PR #412 is ready for you: offline tide tables', 'PR #412 is ready for you: offline tide tables']);
  });
});
