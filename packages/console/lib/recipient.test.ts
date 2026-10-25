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

  it('says a send to a label went to every ship carrying its values, each by its key and value (decision 0065)', () => {
    const values = [
      { valueId: newId('labelValue'), key: 'team', value: 'a' },
      { valueId: newId('labelValue'), key: 'site', value: 'north' },
    ];

    expect(recipientGroupWords({ kind: 'label', values })).toBe('every ship carrying team=a and site=north');
  });

  it('names a value its label no longer has by its id', () => {
    const valueId = newId('labelValue');

    expect(recipientGroupWords({ kind: 'label', values: [{ valueId, key: null, value: null }] })).toBe(`every ship carrying ${valueId}`);
  });
});
