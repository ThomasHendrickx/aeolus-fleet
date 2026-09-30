import { describe, expect, it } from 'vitest';

import { contentType } from './content-type.js';

describe('a content type', () => {
  it.each([
    { label: 'plain text', raw: 'text/plain' },
    { label: 'a vendor type with parameters', raw: 'application/vnd.aeolus.review+json; charset=utf-8' },
    { label: 'upper case and a quoted parameter', raw: 'Text/Markdown; charset="UTF-8"' },
  ])('takes $label, exactly as given', ({ raw }) => {
    expect(contentType(raw)).toEqual({ isOk: true, value: raw });
  });

  it('takes 256 characters', () => {
    const raw = `application/${'x'.repeat(256 - 'application/'.length)}`;

    expect(contentType(raw)).toEqual({ isOk: true, value: raw });
  });

  it('refuses the character U+0000, and says so', () => {
    expect(contentType('text/plain\u0000')).toEqual({
      isOk: false,
      error: { kind: 'INVALID_CONTENT_TYPE', message: 'A content type cannot hold the character U+0000 (NUL)' },
    });
  });

  it.each([
    { label: 'no subtype', raw: 'json' },
    { label: 'a space inside', raw: 'text/pl ain' },
    { label: 'a parameter without a value', raw: 'text/plain; charset' },
    { label: 'nothing', raw: '' },
    { label: 'over 256 characters', raw: `application/${'x'.repeat(257 - 'application/'.length)}` },
  ])('refuses $label', ({ raw }) => {
    expect(contentType(raw)).toEqual({
      isOk: false,
      error: {
        kind: 'INVALID_CONTENT_TYPE',
        message: 'A content type is a media type such as text/plain or application/json; charset=utf-8, of at most 256 characters',
      },
    });
  });
});
