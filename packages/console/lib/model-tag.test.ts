import { describe, expect, it } from 'vitest';

import { isSoftwareModel, modelStatedWords } from './model-tag';

describe('isSoftwareModel', () => {
  it.each(['@aeolus-fleet/squadrons@0.12.0', '@scope/tool', 'tool@1.2.3'])('takes %s for software', (value) => {
    expect(isSoftwareModel(value)).toBe(true);
  });

  it.each(['claude-opus-5-5', 'gpt-6-sol', 'claude-opus-4@20250514'])('takes %s for a model', (value) => {
    expect(isSoftwareModel(value)).toBe(false);
  });
});

describe('modelStatedWords', () => {
  const NOW = new Date('2026-10-05T12:00:00.000Z');

  it('says a model was stated seconds ago, under a minute', () => {
    expect(modelStatedWords({ id: 'claude-opus-5-5', statedAt: '2026-10-05T11:59:35.000Z' }, NOW)).toBe('Model, stated 25 s ago');
  });

  it('says software was stated as other relative times after a minute', () => {
    expect(modelStatedWords({ id: '@aeolus-fleet/squadrons@0.12.0', statedAt: '2026-10-05T09:00:00.000Z' }, NOW)).toBe('Software, stated 3 h ago');
  });
});
