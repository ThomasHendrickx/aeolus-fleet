import { createIdGenerator } from '@aeolus-fleet/common';
import { describe, expect, it } from 'vitest';

import { recipientGroupWords } from './recipient';

const newId = createIdGenerator();

describe('recipientGroupWords', () => {
  it('says a message to a type went to any ship of it', () => {
    expect(recipientGroupWords({ kind: 'type', type: 'reviewer' })).toBe('any ship of type reviewer');
  });

  it("says a contribution went to the meeting's other participants (decision 0061)", () => {
    const meetingId = newId('meeting');

    expect(recipientGroupWords({ kind: 'meeting', meetingId })).toBe(`every other participant of meeting ${meetingId}`);
  });
});
