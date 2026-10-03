import { describe, expect, it } from 'vitest';

import { isSoftwareModel } from './model-tag';

describe('isSoftwareModel', () => {
  it.each(['@aeolus-fleet/squadrons@0.12.0', '@scope/tool', 'tool@1.2.3'])('takes %s for software', (value) => {
    expect(isSoftwareModel(value)).toBe(true);
  });

  it.each(['claude-opus-5-5', 'gpt-6-sol', 'claude-opus-4@20250514'])('takes %s for a model', (value) => {
    expect(isSoftwareModel(value)).toBe(false);
  });
});
