import { describe, expect, it } from 'vitest';

import { classNames } from './class-names';

describe('classNames', () => {
  it('keeps a text colour next to a text style from the tokens', () => {
    expect(classNames('text-primary-foreground', 'text-body')).toBe('text-primary-foreground text-body');
  });

  it('lets a later text style win over an earlier one', () => {
    expect(classNames('text-body', 'text-meta')).toBe('text-meta');
  });
});
