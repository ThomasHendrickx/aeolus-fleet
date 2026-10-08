import { describe, expect, it } from 'vitest';

import { crewLineHarnessWord, harnessDetection, harnessKind, harnessWord } from './harness';

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

describe('crewLineHarnessWord', () => {
  it.each([
    ['claude-code', 'Claude Code'],
    ['codex', 'Codex'],
    ['chat', 'Chat'],
  ])('words the %s crew line as %s', (harness, word) => {
    expect(crewLineHarnessWord(harness)).toBe(word);
  });
});

describe('harnessDetection (#365)', () => {
  const now = new Date('2026-10-08T18:00:00.000Z');

  it('gives the version and when its models were last confirmed', () => {
    expect(harnessDetection({ version: '2.1.293', modelsConfirmedAt: '2026-10-08T15:00:00.000Z' }, now)).toBe('2.1.293 · models confirmed 3 h ago');
  });

  it('says no model is confirmed when none is', () => {
    expect(harnessDetection({ version: '2.1.293', modelsConfirmedAt: null }, now)).toBe('2.1.293 · no model confirmed');
  });

  it('gives nothing for a harness a trierarch before 0.20.2 reports', () => {
    expect(harnessDetection({}, now)).toBeUndefined();
  });
});
