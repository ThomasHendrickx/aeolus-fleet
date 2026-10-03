import { describe, expect, it } from 'vitest';

import { harnessKind, harnessWord } from './harness';

describe('harnessWord', () => {
  it.each([
    ['claude-code', 'Claude Code'],
    ['codex', 'Codex'],
    ['claude-chat', 'Claude chat'],
    ['chatgpt', 'ChatGPT'],
    ['grok', 'Grok'],
    ['grokbot', 'Grokbot'],
    ['console', 'Console'],
  ])('names the known harness %s', (harness, word) => {
    expect(harnessWord(harness)).toBe(word);
  });

  it('shows any other harness as the session stated it', () => {
    expect(harnessWord('github-actions')).toBe('github-actions');
  });
});

describe('harnessKind', () => {
  it.each([
    ['claude-code', 'coding'],
    ['codex', 'coding'],
    ['claude-chat', 'chat'],
    ['chatgpt', 'chat'],
    ['grok', 'chat'],
    ['grokbot', 'bot'],
    ['console', 'console'],
  ])('knows %s as a %s harness', (harness, kind) => {
    expect(harnessKind(harness)).toBe(kind);
  });

  it('knows no kind for free text', () => {
    expect(harnessKind('github-actions')).toBeUndefined();
  });
});
