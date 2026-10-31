import { describe, expect, it } from 'vitest';

import { ARGO_HEADLINE_MAX_LENGTH } from '../fleet/argo-message.js';
import { isNoticeContentType, NOTICE_CONTENT_TYPE, noticeMessageSchema } from './notice-message.js';

function aNotice(overrides: Record<string, unknown> = {}) {
  return {
    headline: 'build-bridge opened a pull request',
    body: 'Slice B2 is up for review.',
    link: { label: 'Pull request', url: 'https://github.com/ThomasHendrickx/aeolus-fleet/pull/1' },
    ...overrides,
  };
}

describe('the notice content type', () => {
  it('names a notice application/vnd.aeolus.notice+json', () => {
    expect(NOTICE_CONTENT_TYPE).toBe('application/vnd.aeolus.notice+json');
  });

  it.each([
    ['the type itself', 'application/vnd.aeolus.notice+json'],
    ['in any case', 'Application/VND.Aeolus.Notice+JSON'],
    ['with parameters', 'application/vnd.aeolus.notice+json; charset=utf-8'],
  ])('knows a notice: %s', (_, contentType) => {
    expect(isNoticeContentType(contentType)).toBe(true);
  });

  it('knows an alert is no notice', () => {
    expect(isNoticeContentType('application/vnd.aeolus.alert+json')).toBe(false);
  });
});

describe('noticeMessageSchema', () => {
  it('takes a headline, a Markdown body and a link', () => {
    expect(noticeMessageSchema.parse(aNotice())).toEqual(aNotice());
  });

  it('takes a notice without a link', () => {
    const withoutLink = aNotice({ link: undefined });
    expect(noticeMessageSchema.parse(withoutLink)).toEqual({ ...withoutLink, link: undefined });
  });

  it('refuses an empty headline', () => {
    expect(noticeMessageSchema.safeParse(aNotice({ headline: '' })).success).toBe(false);
  });

  it('refuses a headline over the headline length of a message to argo', () => {
    expect(noticeMessageSchema.safeParse(aNotice({ headline: 'x'.repeat(ARGO_HEADLINE_MAX_LENGTH + 1) })).success).toBe(false);
  });

  it('refuses a link that is not an http(s) URL', () => {
    expect(noticeMessageSchema.safeParse(aNotice({ link: { label: 'Open', url: 'javascript:alert(1)' } })).success).toBe(false);
  });

  it('refuses a link without a label', () => {
    expect(noticeMessageSchema.safeParse(aNotice({ link: { label: '', url: 'https://example.com' } })).success).toBe(false);
  });
});
