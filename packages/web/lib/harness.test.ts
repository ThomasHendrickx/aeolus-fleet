import { describe, expect, it } from 'vitest';

import { harnessWord } from './harness';

describe('harnessWord', () => {
  it.each([
    ['claude-code', 'Claude Code'],
    ['claude-chat', 'Claude chat'],
    ['codex', 'Codex'],
  ])('names the known harness %s', (harness, word) => {
    expect(harnessWord(harness)).toBe(word);
  });

  it('shows any other harness as the session stated it', () => {
    expect(harnessWord('gemini cli')).toBe('gemini cli');
  });
});
