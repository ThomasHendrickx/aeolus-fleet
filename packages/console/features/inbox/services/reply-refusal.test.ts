import { describe, expect, it } from 'vitest';

import { replyRefusalOf } from './reply-refusal';

describe('a reply refused while the company key is not reachable (decision 0068, screen 3)', () => {
  it('given the company key not reachable, when argo replies, then the reader says nothing was sent and the reply is kept', () => {
    expect(replyRefusalOf('KEY_UNAVAILABLE')).toEqual({
      title: 'Couldn’t send your reply',
      description: 'Your company key is not reachable. Nothing was sent; your reply is kept.',
    });
  });

  it('leaves every other failure to the toast, as before', () => {
    expect(replyRefusalOf('DELIVERY_NOT_OPEN')).toBeUndefined();
    expect(replyRefusalOf(undefined)).toBeUndefined();
  });
});
