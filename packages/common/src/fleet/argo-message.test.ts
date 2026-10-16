import { describe, expect, it } from 'vitest';

import { ARGO_HEADLINE_MAX_LENGTH, argoMessage, MARKDOWN_CONTENT_TYPE } from './argo-message.js';

describe('a message to argo', () => {
  it('opens with its headline, then a blank line, then its body', () => {
    expect(argoMessage({ headline: 'scout crashed 4 times in an hour', body: '- Ship: scout\n- Status: crashed' })).toBe('scout crashed 4 times in an hour\n\n- Ship: scout\n- Status: crashed');
  });

  it('keeps a headline of exactly 80 characters whole', () => {
    const headline = 'a'.repeat(80);

    expect(argoMessage({ headline, body: 'body' }).split('\n')[0]).toBe(headline);
  });

  it('cuts a headline of 81 characters to 80, ending in an ellipsis', () => {
    expect(argoMessage({ headline: 'a'.repeat(81), body: 'body' }).split('\n')[0]).toBe(`${'a'.repeat(79)}…`);
  });

  it('keeps its headline on one line', () => {
    expect(argoMessage({ headline: 'two\nlines  here', body: 'body' })).toBe('two lines here\n\nbody');
  });

  it('allows headlines of at most 80 characters, sent as markdown', () => {
    expect(ARGO_HEADLINE_MAX_LENGTH).toBe(80);
    expect(MARKDOWN_CONTENT_TYPE).toBe('text/markdown');
  });
});
