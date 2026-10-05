import { describe, expect, it } from 'vitest';

import { dismissNoticeInputSchema, MAX_NOTICES, NOTICE_TEXT_MAX, setNoticesInputSchema } from './notice.js';

// Notices (decision 0023): plain text with optional links, shown above every
// console page to the sessions of their audience, set by the installation.

function aNotice(overrides: Record<string, unknown> = {}) {
  return { id: 'upgrade', audience: 'everyone', text: 'Interruptions expected between 00:00 and 01:00 for an infra upgrade.', ...overrides };
}

describe('setNoticesInputSchema', () => {
  it('takes a notice with only its id, audience and text: no links, not dismissible', () => {
    expect(setNoticesInputSchema.parse({ notices: [aNotice()] })).toEqual({ notices: [{ ...aNotice(), links: [], isDismissible: false }] });
  });

  it('takes links that go somewhere, sign out, or both', () => {
    const links = [{ label: 'Sign up', url: 'https://pagasae.example.com/sign-up' }, { label: 'Leave', url: 'https://pagasae.example.com', isSignOut: true }, { label: 'Sign out', isSignOut: true }];

    expect(setNoticesInputSchema.parse({ notices: [aNotice({ links })] }).notices[0]?.links).toEqual(links);
  });

  it.each([
    ['an audience it does not know', aNotice({ audience: 'admins' })],
    ['an empty text', aNotice({ text: '   ' })],
    ['a text one character too long', aNotice({ text: 'x'.repeat(NOTICE_TEXT_MAX + 1) })],
    ['an id that is no handle', aNotice({ id: 'Upgrade Now' })],
    ['a link that neither goes anywhere nor signs out', aNotice({ links: [{ label: 'Nothing' }] })],
    ['a link to a URL that is no http(s)', aNotice({ links: [{ label: 'Run', url: 'javascript:alert(1)' }] })],
    ['four links', aNotice({ links: Array.from({ length: 4 }, (_, index) => ({ label: `Link ${String(index)}`, isSignOut: true })) })],
  ])('refuses a notice with %s', (_label, notice) => {
    expect(setNoticesInputSchema.safeParse({ notices: [notice] }).success).toBe(false);
  });

  it('takes a text of exactly the most characters', () => {
    expect(setNoticesInputSchema.safeParse({ notices: [aNotice({ text: 'x'.repeat(NOTICE_TEXT_MAX) })] }).success).toBe(true);
  });

  it('refuses two notices with one id', () => {
    expect(setNoticesInputSchema.safeParse({ notices: [aNotice(), aNotice({ audience: 'viewers' })] }).success).toBe(false);
  });

  it('takes the most notices and refuses one more', () => {
    const notices = (count: number) => Array.from({ length: count }, (_, index) => aNotice({ id: `notice-${String(index)}` }));

    expect(setNoticesInputSchema.safeParse({ notices: notices(MAX_NOTICES) }).success).toBe(true);
    expect(setNoticesInputSchema.safeParse({ notices: notices(MAX_NOTICES + 1) }).success).toBe(false);
  });

  it('takes no notices: that clears them', () => {
    expect(setNoticesInputSchema.parse({ notices: [] })).toEqual({ notices: [] });
  });
});

describe('dismissNoticeInputSchema', () => {
  it('takes a notice id', () => {
    expect(dismissNoticeInputSchema.parse({ noticeId: 'upgrade' })).toEqual({ noticeId: 'upgrade' });
  });
});
