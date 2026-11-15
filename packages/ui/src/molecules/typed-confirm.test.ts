import { describe, expect, it } from 'vitest';

import { isTypedMatch } from './typed-confirm.js';

describe('isTypedMatch', () => {
  it('matches the expected text typed exactly', () => {
    expect(isTypedMatch('reviewer-01', 'reviewer-01')).toBe(true);
  });

  it('does not match text that differs in case', () => {
    expect(isTypedMatch('reviewer-01', 'Reviewer-01')).toBe(false);
  });

  it('does not match text that differs in hyphens', () => {
    expect(isTypedMatch('reviewer-01', 'reviewer01')).toBe(false);
  });

  it('does not match text typed only in part', () => {
    expect(isTypedMatch('reviewer-01', 'reviewer-0')).toBe(false);
  });
});
