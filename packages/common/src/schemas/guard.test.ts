import { describe, expect, it } from 'vitest';

import { guardStatusSchema } from './guard.js';

describe('guard mechanism refusals', () => {
  it.each(['guard failed: unreadable rules', 'protected: guard/rules.json', 'unknown tool: other', 'unresolvable: eval'])('keeps %s without attributing it to a rule set', (rule) => {
    // Given a mechanism refusal even when no rule set applies
    const guard = { sets: [], refusals: 1, recent: [{ at: '2026-11-24T12:00:00Z', tool: 'shell', rule, set: null, commit: null }] };

    // When core reads the observation, then the mechanism reason and null provenance survive
    expect(guardStatusSchema.parse(guard)).toEqual(guard);
  });

  it('keeps the actual set and commit when a set refuses the call', () => {
    const guard = { sets: [], refusals: 1, recent: [{ at: '2026-11-24T12:00:00Z', tool: 'shell', rule: 'git.push', set: 'no-push', commit: 'abc1234' }] };
    expect(guardStatusSchema.parse(guard)).toEqual(guard);
  });
});
